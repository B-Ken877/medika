/**
 * Consultations + messages repositories — replace data/consultations.json
 * and data/messages.json.
 *
 * Concurrency fixes vs legacy JSON:
 *  - message ids are BIGSERIAL (no read-modify-write Math.max+1 races)
 *  - accept() is an atomic conditional UPDATE (no double-accept / doctor-steal)
 *  - prescription() requires the acting doctor to own the consultation
 */
'use strict';

const { query, withTransaction } = require('../db');
const { config } = require('../config');

function consToApi(row) {
  if (!row) return null;
  const toEpoch = (v) => (v ? Math.floor(new Date(v).getTime() / 1000) : null);
  return {
    id: row.id,
    patient_id: row.patient_id,
    patient_name: row.patient_name,
    patient_age: row.patient_age ?? null,
    doctor_id: row.doctor_id ?? null,
    description: row.description ?? '',
    specialty_needed: row.specialty_needed ?? 'Medecine Generale',
    urgency_level: row.urgency_level ?? 'Moyenne',
    ai_summary: row.ai_summary ?? '',
    ai_explanation: row.ai_explanation ?? '',
    status: row.status,
    prescription: row.prescription ?? null,
    // Issue #60: why a consultation left the active set without a normal
    // completion — 'duplicate_open_consultation' (legacy reconciliation) or
    // 'pending_timeout' (bounded unanswered-request expiry). NULL for every
    // normal transition and all legacy rows. Additive; older clients ignore it.
    close_reason: row.close_reason ?? null,
    created_at: toEpoch(row.created_at),
    updated_at: toEpoch(row.updated_at),
    // Lifecycle deadlines (issue #25, additive). offer_deadline = acceptance
    // window for the CURRENT offer holder (countdown UI); expires_at = the
    // five-hour consultation deadline once accepted. NULL when not applicable
    // (legacy rows, non-RECHERCHE_MEDECIN states). Server-persisted values —
    // never client-supplied.
    offer_deadline: toEpoch(row.offer_deadline),
    accepted_at: toEpoch(row.accepted_at),
    expires_at: toEpoch(row.expires_at),
  };
}

function msgToApi(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    consultation_id: row.consultation_id,
    sender_id: row.sender_id,
    sender_name: row.sender_name,
    text: row.text ?? '',
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
    message_type: row.message_type ?? 'text',
    file_url: row.file_url ?? null,
    duration: row.duration ?? null,
    file_size: row.file_size === null ? null : Number(row.file_size),
    // Persisted read receipt (epoch seconds, NULL = unread). Same instant for
    // REST and WS-derived views; never derived client-side.
    read_at: row.read_at ? Math.floor(new Date(row.read_at).getTime() / 1000) : null,
    // Client correlation id (additive, migration 003). Present only when the
    // sender supplied one; lets retries reconcile to the canonical row.
    client_msg_id: row.client_msg_id ?? null,
  };
}

// ─── Consultations ───────────────────────────────────────────────────────────

/**
 * Doctor list SQL — routed-offer visibility (migration 004) vs the legacy
 * broadcast view. listForUser() degrades to DOCTOR_LIST_LEGACY_SQL when the
 * 004 schema is not applied yet (42703/42P01), so the doctor dashboard keeps
 * working during the deploy→migrate window (issue #35 root cause: every
 * doctor list read 500'd until 004 was applied).
 */
const DOCTOR_LIST_ROUTED_SQL = `SELECT * FROM consultations
   WHERE doctor_id = $1
      OR (
        doctor_id IS NULL AND status = 'RECHERCHE_MEDECIN'
        AND reroute_after IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM consultation_offers o
           WHERE o.consultation_id = consultations.id
        )
      )`;

const DOCTOR_LIST_LEGACY_SQL = `SELECT * FROM consultations
   WHERE doctor_id = $1
      OR (doctor_id IS NULL AND status = 'RECHERCHE_MEDECIN')`;

/** Memoized per process: once a 42703/42P01 is seen we stop retrying the
 *  routed query until restart (a failed round-trip per dashboard load is
 *  wasteful; the flag flips only when the schema is actually missing). */
let doctorListSchemaDrifted = false;

async function create({ id, patient_id, patient_name, patient_age, doctor_id, description, specialty_needed, urgency_level, ai_summary, ai_explanation }) {
  try {
    const { rows } = await query(
      `INSERT INTO consultations
         (id, patient_id, patient_name, patient_age, doctor_id, description,
          specialty_needed, urgency_level, ai_summary, ai_explanation, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'RECHERCHE_MEDECIN')
       RETURNING *`,
      [id, patient_id, patient_name, patient_age ?? null, doctor_id ?? null,
       description || '', specialty_needed || 'Medecine Generale',
       urgency_level || 'Moyenne', ai_summary || '', ai_explanation || '']
    );
    return rows[0];
  } catch (err) {
    // Issue #60: the partial unique indexes (uq_consultations_patient_active /
    // uq_consultations_doctor_active) are the AUTHORITATIVE one-active-per-
    // participant invariant. A 23505 here means a concurrent request won the
    // participant's slot between the caller's advisory pre-check and this
    // INSERT — annotated for a typed conflict response (never a 500).
    if (err && err.code === '23505') {
      err.constraint_scope = /patient/.test(String(err.constraint || '')) ? 'patient' : 'doctor';
    }
    throw err;
  }
}

/**
 * The caller's single blocking consultation, if any (issue #60 fast-fail
 * pre-check + conflict responses). NULL = free to book. Blocking states are
 * exactly RECHERCHE_MEDECIN and EN_COURS — terminal rows never block.
 */
async function findActiveForPatient(patientId) {
  if (!patientId) return null;
  const { rows } = await query(
    `SELECT * FROM consultations
      WHERE patient_id = $1 AND status IN ('RECHERCHE_MEDECIN', 'EN_COURS')
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [patientId]
  );
  return rows[0] || null;
}

/** The doctor's single blocking consultation (offer held or accepted), if any. */
async function findActiveForDoctor(doctorId) {
  if (!doctorId) return null;
  const { rows } = await query(
    `SELECT * FROM consultations
      WHERE doctor_id = $1 AND status IN ('RECHERCHE_MEDECIN', 'EN_COURS')
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [doctorId]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await query(`SELECT * FROM consultations WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function listForUser(user) {
  let sql;
  const params = [user.id];
  if (user.role === 'patient') {
    sql = `SELECT * FROM consultations WHERE patient_id = $1`;
  } else if (user.role === 'doctor') {
    // Issue #25: routed requests are visible ONLY to the current offer
    // holder (doctor_id). Never-routed rows (legacy data / pre-adoption)
    // keep the historical broadcast visibility; waiting-state rows (pool
    // exhausted, reroute_after set) are shown to no doctor.
    //
    // Issue #35 deploy-order safety: when migration 004 has not been
    // applied yet the routed query fails with 42703/42P01 (reroute_after /
    // consultation_offers undefined) — exactly the "Sèvis la pa disponib"
    // doctor-dashboard outage. Degrade to the legacy broadcast query so the
    // dashboard renders while the migration is pending, mirroring the
    // createMessage() 003 pattern.
    if (!doctorListSchemaDrifted) {
      try {
        const { rows } = await query(`${DOCTOR_LIST_ROUTED_SQL} ORDER BY created_at DESC`, params);
        return rows.map(consToApi);
      } catch (err) {
        if (err && (err.code === '42703' || err.code === '42P01')) {
          doctorListSchemaDrifted = true;
          console.error('[DB] listForUser: lifecycle schema missing (migration 004 pending) — legacy doctor visibility');
        } else {
          throw err;
        }
      }
    }
    sql = DOCTOR_LIST_LEGACY_SQL;
  } else {
    sql = `SELECT * FROM consultations`;
    params.length = 0;
  }
  sql += ` ORDER BY created_at DESC`;
  const { rows } = await query(sql, params);
  return rows.map(consToApi);
}

/**
 * Atomic doctor accept (issue #25 hardened). Acceptance requires:
 *   1. status = RECHERCHE_MEDECIN, and
 *   2a. the caller IS the current offer holder with an UNEXPIRED
 *       offer_deadline (the routed path), or
 *   2b. the consultation was NEVER routed (no offer rows, no waiting
 *       state — legacy rows and direct fixtures): the historical
 *       free-accept pool behavior is preserved for them.
 * On success the consultation becomes EN_COURS with a five-hour
 * expires_at deadline and the PENDING offer (if any) is marked ACCEPTED.
 * The single conditional UPDATE under the row lock makes concurrent
 * accepts race-safe: exactly one caller ever wins.
 */
async function accept(id, doctorId) {
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE consultations
           SET status = 'EN_COURS',
               doctor_id = $2,
               accepted_at = now(),
               expires_at = now() + make_interval(hours => $3),
               offer_deadline = NULL,
               reroute_after = NULL,
               updated_at = now()
         WHERE id = $1
           AND status = 'RECHERCHE_MEDECIN'
           AND (
             (doctor_id = $2 AND (offer_deadline IS NULL OR offer_deadline > now()))
             OR (
               doctor_id IS NULL AND offer_deadline IS NULL AND reroute_after IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM consultation_offers o WHERE o.consultation_id = consultations.id
               )
             )
           )
         RETURNING *`,
        [id, doctorId, config.consultationExpiryHours]
      );
      const row = rows[0];
      if (!row) return null;
      await client.query(
        `UPDATE consultation_offers
            SET status = 'ACCEPTED', responded_at = now()
          WHERE consultation_id = $1 AND doctor_id = $2 AND status = 'PENDING'`,
        [id, doctorId]
      );
      return row;
    });
  } catch (err) {
    // Issue #60: the doctor-side partial unique index makes a concurrent or
    // legacy double-accept impossible — the DB, not the API, is the referee.
    // Surfaced as a sentinel so the route answers 409 "you already have an
    // active consultation" instead of a generic failure.
    if (err && err.code === '23505') {
      return 'DOCTOR_BUSY';
    }
    // Issue #35 deploy-order safety: pre-004 schema (accepted_at/expires_at/
    // offer_deadline/reroute_after or consultation_offers undefined). Fall
    // back to the historical free-accept UPDATE so a doctor can still accept
    // the broadcast requests they can see on the degraded dashboard.
    if (err && (err.code === '42703' || err.code === '42P01')) {
      console.error('[DB] accept: lifecycle schema missing (migration 004 pending) — legacy accept');
      const { rows } = await query(
        `UPDATE consultations
           SET doctor_id = $2, status = 'EN_COURS', updated_at = now()
         WHERE id = $1
           AND status = 'RECHERCHE_MEDECIN'
           AND (doctor_id IS NULL OR doctor_id = $2)
         RETURNING *`,
        [id, doctorId]
      );
      return rows[0] || null;
    }
    throw err;
  }
}

/**
 * Complete an active consultation with a prescription (issue #25 hardened:
 * only an EN_COURS consultation owned by the acting doctor can be closed —
 * expired, refused or already-terminated consultations are out of scope).
 */
async function prescribe(id, doctorId, prescription) {
  const { rows } = await query(
    `UPDATE consultations
       SET prescription = $3, status = 'TERMINE', updated_at = now()
     WHERE id = $1 AND doctor_id = $2 AND status = 'EN_COURS'
     RETURNING *`,
    [id, doctorId, prescription]
  );
  return rows[0] || null;
}

async function adminDelete(id) {
  return withTransaction(async (client) => {
    // messages cascade via FK; payments keep the financial record (consultation_id → NULL)
    const { rows } = await client.query(`DELETE FROM consultations WHERE id = $1 RETURNING id`, [id]);
    return rows.length > 0;
  });
}

async function listAll({ status, doctor_id, patient_id } = {}) {
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (doctor_id) { params.push(doctor_id); where.push(`doctor_id = $${params.length}`); }
  if (patient_id) { params.push(patient_id); where.push(`patient_id = $${params.length}`); }
  const sql = `SELECT * FROM consultations ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC`;
  const { rows } = await query(sql, params);
  return rows;
}

// ─── Messages ────────────────────────────────────────────────────────────────

async function listMessages(consultationId) {
  const { rows } = await query(
    `SELECT * FROM messages WHERE consultation_id = $1 ORDER BY id ASC`, [consultationId]);
  return rows.map(msgToApi);
}

/** Insert one message. With `client_msg_id` the insert is IDEMPOTENT per
 * (sender, client_msg_id) — a retry of the same logical send (WS frame lost
 * after persistence, followed by a REST fallback or user retry) returns the
 * ALREADY-PERSISTED row instead of duplicating it. Without it (legacy
 * clients, system messages) the behavior is exactly the historical insert.
 *
 * Schema-drift safety: when migration 003 has not been applied yet, the
 * correlation-column insert fails with 42703 (undefined column) — the write
 * then degrades to the LEGACY insert so message delivery never depends on
 * the migration having run (deploy-order independence; idempotency simply
 * becomes unavailable until 003 is applied). */
async function createMessage({ consultation_id, sender_id, sender_name, text, message_type, file_url, duration, file_size, client_msg_id = null }) {
  const baseParams = [consultation_id, sender_id, sender_name, text || '',
    message_type || 'text', file_url ?? null, duration ?? null, file_size ?? null];

  if (client_msg_id) {
    try {
      const { rows } = await query(
        `INSERT INTO messages
           (consultation_id, sender_id, sender_name, text, message_type, file_url, duration, file_size, client_msg_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL
         DO NOTHING
         RETURNING *`,
        [...baseParams, client_msg_id]
      );
      if (rows[0]) return rows[0];
      // Conflict → this exact send was already persisted: hand back the
      // canonical row so the caller acknowledges the ORIGINAL message.
      const existing = await query(
        `SELECT * FROM messages WHERE sender_id = $1 AND client_msg_id = $2`,
        [sender_id, client_msg_id]
      );
      return existing.rows[0] || null;
    } catch (err) {
      if (err && err.code === '42703') {
        // messages.client_msg_id absent (migration 003 pending) — degrade to
        // the legacy insert. Category only in logs; never message content.
        console.error('[DB] createMessage: client_msg_id column missing (migration 003 pending) — legacy insert');
      } else {
        throw err;
      }
    }
  }

  const { rows } = await query(
    `INSERT INTO messages
       (consultation_id, sender_id, sender_name, text, message_type, file_url, duration, file_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    baseParams
  );
  return rows[0];
}

/** Last N messages across all consultations the user belongs to (legacy catch-up semantics). */
async function catchUp(userId, limit = 50) {
  const { rows } = await query(
    `SELECT m.* FROM messages m
     WHERE m.consultation_id IN (
       SELECT id FROM consultations WHERE patient_id = $1 OR doctor_id = $1
     )
     ORDER BY m.id DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.reverse().map(msgToApi);
}

/**
 * Distinct counterpart user ids across every consultation the user is part of
 * (presence scoping: presence is only ever signalled to these users).
 */
async function listCounterpartIds(userId) {
  const { rows } = await query(
    `SELECT DISTINCT CASE WHEN patient_id = $1 THEN doctor_id ELSE patient_id END AS other
       FROM consultations
      WHERE (patient_id = $1 OR doctor_id = $1)
        AND CASE WHEN patient_id = $1 THEN doctor_id ELSE patient_id END IS NOT NULL`,
    [userId]
  );
  return rows.map((r) => r.other);
}

/**
 * Atomically mark the OTHER participant's unread, non-system messages read.
 * `readerId` always comes from the authenticated request — never the payload.
 * Idempotent: rows already carrying read_at are filtered out, so repeated
 * requests are no-ops. One `now()` timestamps the whole batch. Returns
 * { messageIds, readAt } with readAt in epoch seconds (or null when nothing
 * needed marking).
 */
async function markIncomingRead({ consultationId, readerId, counterpartId }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE messages
          SET read_at = now()
        WHERE consultation_id = $1
          AND sender_id = $2
          AND sender_id <> $3
          AND read_at IS NULL
        RETURNING id, read_at`,
      [consultationId, counterpartId, readerId]
    );
    if (rows.length === 0) return { messageIds: [], readAt: null };
    const readAt = Math.floor(new Date(rows[0].read_at).getTime() / 1000);
    return { messageIds: rows.map((r) => Number(r.id)), readAt };
  });
}

async function countAll() {
  const { rows } = await query(`SELECT count(*)::int AS n FROM messages`);
  return rows[0].n;
}

async function deleteForConsultation(consultationId) {
  await query(`DELETE FROM messages WHERE consultation_id = $1`, [consultationId]);
}

module.exports = {
  consToApi,
  msgToApi,
  create,
  findById,
  findActiveForPatient,
  findActiveForDoctor,
  listForUser,
  accept,
  prescribe,
  adminDelete,
  listAll,
  listMessages,
  createMessage,
  catchUp,
  listCounterpartIds,
  markIncomingRead,
  countAll,
  deleteForConsultation,
};
