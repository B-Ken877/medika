/**
 * Consultation request lifecycle engine (issue #25).
 *
 * State machine (server-authoritative — no client timestamps involved):
 *
 *   RECHERCHE_MEDECIN ──offer──▶ (doctor_id = current offer holder,
 *                                 offer_deadline = now + 1h)
 *        │                              │
 *        │ accept (atomic, within 1h)   │ deadline passes
 *        ▼                              ▼
 *      EN_COURS ──5h──▶ EXPIRE     offer EXPIRED → reroute to the next
 *        │                           eligible available doctor (never the
 *        ├──prescribe──▶ TERMINE     same doctor twice — DB-enforced) or a
 *        └──reject(patient_choice)   waiting state with a retry cooldown
 *           ──▶ REFUSE
 *
 * Routing rules (audited from the existing product):
 *   * A patient may pre-select a specific doctor at request creation; that
 *     doctor receives the FIRST offer regardless of the availability flag
 *     (explicit patient choice — unchanged legacy behavior; an explicit
 *     rejection from them ends the request as REFUSE exactly like before).
 *   * Otherwise the eligible pool is: role='doctor' AND is_available AND
 *     specialty matches the requested specialty, ordered by rating DESC,
 *     then account seniority — the same "best doctor first" heuristic the
 *     doctor directory exposes. Routed-offer rejections behave like
 *     timeouts (immediate reroute).
 *   * Once every eligible doctor has been offered, the request enters a
 *     waiting state and is re-scanned on a cooldown (never a hot loop);
 *     newly available doctors are picked up by the next scan.
 *
 * Durability: deadlines are enforced by processDueDeadlines(), which is
 * triggered (a) by the scheduled endpoint /api/crons/consultation-deadlines
 * (GitHub Actions / optional Vercel cron), and (b) opportunistically
 * (throttled) on consultation reads — so state stays correct even with no
 * scheduler at all. Every transition is an atomic conditional UPDATE under
 * a row lock, so concurrent workers and duplicate runs are harmless.
 */
'use strict';

const { query, withTransaction } = require('./db');
const { config } = require('./config');
const consultationsRepo = require('./repos/consultations');
const notifications = require('./notifications/emit');

const SYSTEM_SENDER = { sender_id: 'system', sender_name: 'Systeme' };

/** Eligible next doctor for a consultation (never previously offered). */
const NEXT_ELIGIBLE_DOCTOR_SQL = `
  SELECT u.id, u.name
    FROM users u
   WHERE u.role = 'doctor'
     AND u.is_available
     AND u.specialty = $1
     AND NOT EXISTS (
       SELECT 1 FROM consultation_offers o
        WHERE o.consultation_id = $2 AND o.doctor_id = u.id
     )
   ORDER BY u.rating DESC NULLS LAST, u.created_at ASC, u.id ASC
   LIMIT 1`;

/** The patient's pre-selected doctor (first offer, regardless of availability). */
async function findPatientChoiceDoctor(client, doctorId) {
  const { rows } = await client.query(
    `SELECT id, name FROM users WHERE id = $1 AND role = 'doctor'`,
    [doctorId]
  );
  return rows[0] || null;
}

/**
 * Create the next offer for a RECHERCHE_MEDECIN consultation (inside the
 * caller's transaction, consultation row already locked).
 * Returns { consultation, offeredTo, events } or { consultation, waiting }
 * when no eligible doctor remains.
 */
async function routeWithinTransaction(client, consultation, patientChoiceDoctorId) {
  let doctor = null;
  let origin = 'routing';

  if (patientChoiceDoctorId) {
    const alreadyOffered = await client.query(
      `SELECT 1 FROM consultation_offers WHERE consultation_id = $1 AND doctor_id = $2`,
      [consultation.id, patientChoiceDoctorId]
    );
    if (alreadyOffered.rowCount === 0) {
      doctor = await findPatientChoiceDoctor(client, patientChoiceDoctorId);
      origin = 'patient_choice';
    }
  }
  if (!doctor) {
    const { rows } = await client.query(NEXT_ELIGIBLE_DOCTOR_SQL,
      [consultation.specialty_needed || 'Medecine Generale', consultation.id]);
    doctor = rows[0] || null;
    origin = 'routing';
  }

  if (doctor) {
    await client.query(
      `INSERT INTO consultation_offers
         (consultation_id, doctor_id, doctor_name, origin, status, deadline_at)
       VALUES ($1, $2, $3, $4, 'PENDING', now() + make_interval(mins => $5))`,
      [consultation.id, doctor.id, doctor.name, origin, config.offerWindowMinutes]
    );
    const { rows } = await client.query(
      `UPDATE consultations
          SET doctor_id = $2,
              offer_deadline = now() + make_interval(mins => $3),
              reroute_after = NULL,
              updated_at = now()
        WHERE id = $1 AND status = 'RECHERCHE_MEDECIN'
        RETURNING *`,
      [consultation.id, doctor.id, config.offerWindowMinutes]
    );
    return { consultation: rows[0] || consultation, offeredTo: doctor, origin, events: ['offered'] };
  }

  // Nobody eligible: waiting state with a retry cooldown (never a hot loop).
  const { rows } = await client.query(
    `UPDATE consultations
        SET doctor_id = NULL,
            offer_deadline = NULL,
            reroute_after = now() + make_interval(mins => $2),
            updated_at = now()
      WHERE id = $1 AND status = 'RECHERCHE_MEDECIN'
      RETURNING *`,
    [consultation.id, config.rerouteRetryMinutes]
  );
  return { consultation: rows[0] || consultation, waiting: true, events: ['waiting'] };
}

/**
 * Route a freshly created consultation (issue #25 initial offer).
 * Returns the updated consultation row plus notification hints.
 */
async function routeNewConsultation(consultation, { patientChoiceDoctorId = null } = {}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM consultations WHERE id = $1 FOR UPDATE`,
      [consultation.id]
    );
    const current = rows[0];
    if (!current || current.status !== 'RECHERCHE_MEDECIN') {
      return { consultation: current || consultation, events: [] };
    }
    return routeWithinTransaction(client, current, patientChoiceDoctorId);
  });
}

/**
 * Expire a due offer and reroute (or park) the consultation.
 * Idempotent: the PENDING→EXPIRED claim is a conditional UPDATE, so a second
 * worker finds no PENDING offer and does nothing.
 */
async function expireOfferAndReroute(consultationId, outcome) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM consultations WHERE id = $1 FOR UPDATE`,
      [consultationId]
    );
    const c = rows[0];
    if (!c || c.status !== 'RECHERCHE_MEDECIN' || c.offer_deadline === null) return;

    // Atomic claim of the due PENDING offer (DB clock is authoritative).
    const claim = await client.query(
      `UPDATE consultation_offers
          SET status = 'EXPIRED', responded_at = now()
        WHERE consultation_id = $1
          AND status = 'PENDING'
          AND deadline_at <= now()
        RETURNING doctor_id, doctor_name`,
      [consultationId]
    );
    if (claim.rowCount === 0) return; // already processed by another run
    outcome.offersExpired += 1;

    const routed = await routeWithinTransaction(client, c, null);
    if (routed.offeredTo) {
      outcome.rerouted += 1;
      outcome.notifyNewDoctor = routed.offeredTo;
    } else {
      outcome.waiting += 1;
    }
    outcome.consultation = routed.consultation;
  });
}

/**
 * Five-hour consultation expiry (idempotent conditional UPDATE — a second
 * run can never re-apply or touch terminal consultations). Inserts a durable
 * system message so both parties see the expiry in the chat history; nothing
 * is ever deleted.
 */
async function expireConsultation(consultationId, outcome) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE consultations
          SET status = 'EXPIRE', updated_at = now()
        WHERE id = $1
          AND status = 'EN_COURS'
          AND expires_at IS NOT NULL
          AND expires_at <= now()
        RETURNING *`,
      [consultationId]
    );
    if (rows.length === 0) return; // terminal already, not due, or gone
    outcome.expired += 1;
    await client.query(
      `INSERT INTO messages (consultation_id, sender_id, sender_name, text)
       VALUES ($1, 'system', 'Systeme', $2)`,
      [consultationId,
        'Consultation expiree automatiquement apres 5 heures. L\'historique de la conversation est conserve.']
    );
    outcome.consultation = rows[0];
  });
}

/**
 * Waiting-state retry scan + legacy adoption. Rows with reroute_after NULL
 * are pre-migration requests: they get their first offer (adoption) or a
 * retry cooldown. Due rows re-scan the eligible pool for newly available
 * doctors. No re-offer to a doctor who already timed out (DB UNIQUE).
 *
 * `adoptLegacy=false` (the opportunistic read-path mode) skips never-routed
 * rows entirely: mid-read adoption would change which doctor a legacy
 * request is offered to without any scheduler decision. Adoption runs only
 * in the scheduled processor (`adoptLegacy=true`).
 */
async function retryWaiting(consultationId, outcome, { adoptLegacy = true } = {}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT *, now() AS dbnow FROM consultations WHERE id = $1 FOR UPDATE`,
      [consultationId]
    );
    const c = rows[0];
    if (!c || c.status !== 'RECHERCHE_MEDECIN' || c.offer_deadline !== null) return;
    const due = c.reroute_after === null || c.reroute_after <= c.dbnow;
    if (!due) return;
    if (c.reroute_after === null && !adoptLegacy) return;

    const wasLegacy = c.reroute_after === null;
    // Patient-picked legacy rows keep their chosen doctor for the first offer.
    const patientChoice = wasLegacy && c.doctor_id ? c.doctor_id : null;
    const routed = await routeWithinTransaction(client, c, patientChoice);
    if (routed.offeredTo) {
      if (wasLegacy) outcome.adopted += 1; else outcome.retried += 1;
      outcome.notifyNewDoctor = routed.offeredTo;
    } else if (wasLegacy) {
      outcome.adopted += 1; // adopted into the waiting state
    }
    outcome.consultation = routed.consultation;
  });
}

/**
 * Process every due deadline. Safe to run concurrently and repeatedly:
 * each consultation is handled under a row lock with conditional updates.
 * Notifications are emitted AFTER commit (never inside a transaction).
 *
 * adoptLegacy=true also gives never-routed legacy requests their first
 * offer (scheduled mode); the opportunistic read-path mode passes false so
 * reads never change routing decisions on their own.
 */
async function processDueDeadlines({ hub, maxPerRun = 100, adoptLegacy = true } = {}) {
  const outcome = {
    offersExpired: 0, rerouted: 0, waiting: 0, adopted: 0, retried: 0,
    expired: 0, notified: 0, consultation: null, notifyNewDoctor: null,
  };

  const dueOffers = await query(
    `SELECT id FROM consultations
      WHERE status = 'RECHERCHE_MEDECIN' AND offer_deadline IS NOT NULL AND offer_deadline <= now()
      ORDER BY offer_deadline ASC LIMIT $1`,
    [maxPerRun]
  );
  for (const row of dueOffers.rows) {
    outcome.notifyNewDoctor = null;
    outcome.consultation = null;
    await expireOfferAndReroute(row.id, outcome).catch((err) => {
      console.error('[lifecycle] offer timeout processing failed:', err.code || err.message);
    });
    emitNotifications(hub, outcome);
  }

  const dueExpiries = await query(
    `SELECT id FROM consultations
      WHERE status = 'EN_COURS' AND expires_at IS NOT NULL AND expires_at <= now()
      ORDER BY expires_at ASC LIMIT $1`,
    [maxPerRun]
  );
  for (const row of dueExpiries.rows) {
    outcome.consultation = null;
    await expireConsultation(row.id, outcome).catch((err) => {
      console.error('[lifecycle] expiry processing failed:', err.code || err.message);
    });
    emitNotifications(hub, outcome);
  }

  const dueRetries = await query(
    `SELECT id, reroute_after IS NULL AS is_legacy FROM consultations
      WHERE status = 'RECHERCHE_MEDECIN' AND offer_deadline IS NULL
        AND (reroute_after IS NULL OR reroute_after <= now())
      ORDER BY created_at ASC LIMIT $1`,
    [maxPerRun]
  );
  for (const row of dueRetries.rows) {
    if (row.is_legacy && !adoptLegacy) continue;
    outcome.notifyNewDoctor = null;
    outcome.consultation = null;
    await retryWaiting(row.id, outcome, { adoptLegacy }).catch((err) => {
      console.error('[lifecycle] waiting-retry processing failed:', err.code || err.message);
    });
    emitNotifications(hub, outcome);
  }

  return {
    offersExpired: outcome.offersExpired,
    rerouted: outcome.rerouted,
    waiting: outcome.waiting,
    adopted: outcome.adopted,
    retried: outcome.retried,
    expired: outcome.expired,
    notified: outcome.notified,
  };
}

/** Publish WS notifications for a processed consultation (post-commit). */
function emitNotifications(hub, outcome) {
  if (!hub || !outcome.consultation) return;
  const api = consultationsRepo.consToApi(outcome.consultation);
  const update = { type: 'consultation:updated', ...api };
  if (outcome.consultation.patient_id) {
    hub.publishToUser(outcome.consultation.patient_id, update);
    outcome.notified += 1;
  }
  if (outcome.consultation.doctor_id) {
    hub.publishToUser(outcome.consultation.doctor_id, update);
    outcome.notified += 1;
  }
  // The newly offered doctor ALSO gets the legacy consultation:new event so
  // existing dashboards (web + Android) toast + refresh without changes.
  if (outcome.notifyNewDoctor) {
    hub.publishToUser(outcome.notifyNewDoctor.id, {
      type: 'consultation:new',
      id: outcome.consultation.id,
      patientName: outcome.consultation.patient_name,
      description: outcome.consultation.description,
      specialtyNeeded: outcome.consultation.specialty_needed,
      urgencyLevel: outcome.consultation.urgency_level,
    });
    outcome.notified += 1;
  }

  // Issue #36: durable push notifications for the SAME post-commit
  // transitions (fire-and-forget; emit never throws). Every emission is
  // idempotent by a stable record-derived key, so duplicate cron runs and
  // reruns after a crash are harmless.
  const c = outcome.consultation;
  if (c.status === 'EXPIRE' && c.patient_id) {
    // Five-hour expiry — the transition itself is atomic, so this fires once.
    notifications.emit({
      userId: c.patient_id,
      eventType: 'consultation:expired',
      idempotencyKey: `consultation:${c.id}:expired`,
      ...notifications.COPY.consultationExpired,
    });
  }
  if (outcome.notifyNewDoctor) {
    // High-priority offer to the SPECIFIC newly assigned doctor only.
    notifications.emit({
      userId: outcome.notifyNewDoctor.id,
      eventType: 'consultation:offer',
      idempotencyKey: `consultation:${c.id}:offer:${outcome.notifyNewDoctor.id}`,
      ...notifications.COPY.consultationOffer,
    });
    // Patient "reassignment" signal — ONE per consultation (coalescing rapid
    // routing transitions; the definitive outcome carries the real news).
    if (c.patient_id) {
      notifications.emit({
        userId: c.patient_id,
        eventType: 'consultation:rerouted',
        idempotencyKey: `consultation:${c.id}:rerouted`,
        ...notifications.COPY.consultationRejected,
      });
    }
  }
  // Waiting-state retries emit NOTHING: unchanged waiting state must not
  // produce pushes (documented no-spam rule).
}

// ─── Opportunistic (throttled) enforcement ───────────────────────────────────

const ENFORCE_THROTTLE_MS = 15_000;
let lastEnforceAt = 0;
let enforceInFlight = null;

/**
 * Fire-and-forget deadline enforcement for read paths. At most one run per
 * process per throttle window; concurrent callers share the in-flight run.
 * NEVER throws — read paths must not fail because of background work.
 */
function enforceDueDeadlines(hub) {
  if (enforceInFlight) return enforceInFlight;
  if (Date.now() - lastEnforceAt < ENFORCE_THROTTLE_MS) return Promise.resolve(null);
  enforceInFlight = processDueDeadlines({ hub, adoptLegacy: false })
    .catch((err) => {
      console.error('[lifecycle] opportunistic enforcement failed:', err.code || err.message);
      return null;
    })
    .finally(() => {
      lastEnforceAt = Date.now();
      enforceInFlight = null;
    });
  return enforceInFlight;
}

/** Test/ops hook: reset the opportunistic throttle. */
function resetEnforceThrottle() {
  lastEnforceAt = 0;
  enforceInFlight = null;
}

/**
 * Doctor rejection of a consultation request (issue #25 semantics):
 *   * The PATIENT-CHOSEN doctor rejecting ends the request as REFUSE —
 *     exactly the historical behavior (the patient's explicit pick
 *     declined; they are notified and can create a new request).
 *   * A ROUTED offer being rejected behaves like a timeout: the offer is
 *     marked REJECTED and the request is immediately rerouted to the next
 *     eligible available doctor (or parked in the waiting state).
 * Returns null when the doctor is not the current offer holder (route → 404).
 */
async function rejectConsultation(consultationId, doctorId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM consultations WHERE id = $1 FOR UPDATE`,
      [consultationId]
    );
    const c = rows[0];
    if (!c || c.status !== 'RECHERCHE_MEDECIN' || c.doctor_id !== doctorId) return null;

    // Claim the doctor's PENDING offer (if any) to learn its origin.
    const claim = await client.query(
      `UPDATE consultation_offers
          SET status = 'REJECTED', responded_at = now()
        WHERE consultation_id = $1 AND doctor_id = $2 AND status = 'PENDING'
        RETURNING origin`,
      [consultationId, doctorId]
    );
    const origin = claim.rows[0] ? claim.rows[0].origin : 'patient_choice';

    if (origin === 'patient_choice') {
      const upd = await client.query(
        `UPDATE consultations
            SET status = 'REFUSE', offer_deadline = NULL, reroute_after = NULL,
                updated_at = now()
          WHERE id = $1 AND status = 'RECHERCHE_MEDECIN'
          RETURNING *`,
        [consultationId]
      );
      return { consultation: upd.rows[0], refused: true };
    }

    const routed = await routeWithinTransaction(client, c, null);
    return {
      consultation: routed.consultation,
      refused: false,
      nextDoctor: routed.offeredTo || null,
      waiting: Boolean(routed.waiting),
    };
  });
}

module.exports = {
  routeNewConsultation,
  rejectConsultation,
  processDueDeadlines,
  enforceDueDeadlines,
  resetEnforceThrottle,
  expireOfferAndReroute,
  expireConsultation,
  retryWaiting,
  SYSTEM_SENDER,
};
