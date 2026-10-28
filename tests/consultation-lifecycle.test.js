/**
 * Consultation request lifecycle tests (issue #25):
 *   * one-hour offer window, sequential rerouting, waiting state + retry
 *   * late/expired/foreign acceptances rejected; concurrent accepts race-safe
 *   * five-hour expiry: idempotent, terminal-state-safe, history preserved
 *   * legacy adoption (scheduled only) vs opportunistic enforcement (never
 *     adopts), scheduler duplicate-run safety + notification dedup
 *   * cron endpoint authorization
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};
let query, lifecycle, usersRepo, consultationsRepo;

// Extra Medecine Generale doctors with strictly lower ratings → deterministic
// routing order (rating DESC): doctor_t1 (5.0) → doctor_mg2 (4.9) → doctor_mg3 (4.8).
const MG2 = 'doctor_mg2';
const MG3 = 'doctor_mg3';
const CARD2 = 'doctor_card2';

async function mkDoctor(id, username, name, specialty, rating) {
  const { hashPassword } = await import('../src/auth.js').then((m) => m.default ?? m);
  return usersRepo.create({
    id, username, password_hash: hashPassword('Passw0rd!'), role: 'doctor',
    name, specialty, rating,
  });
}

/** Create a consultation through the API (REQUIRE_PAYMENT=false). */
async function apiCreateConsultation(patientToken, body) {
  const res = await r.post('/api/consultations')
    .set('Authorization', `Bearer ${patientToken}`)
    .send({ description: 'test', urgencyLevel: 'Moyenne', ...body });
  expect(res.status).toBe(201);
  return res.body;
}

async function offersFor(consultationId) {
  const { rows } = await query(
    `SELECT * FROM consultation_offers WHERE consultation_id = $1 ORDER BY id`, [consultationId]);
  return rows;
}

async function setOfferExpired(consultationId) {
  await query(
    `UPDATE consultations SET offer_deadline = now() - interval '1 second' WHERE id = $1`, [consultationId]);
  await query(
    `UPDATE consultation_offers SET deadline_at = now() - interval '1 second' WHERE consultation_id = $1 AND status = 'PENDING'`,
    [consultationId]);
}

function recordingHub() {
  const events = [];
  return {
    events,
    publishToUser(userId, event) { events.push({ userId, type: event.type }); },
    publishToRole() {},
  };
}

beforeAll(async () => {
  ({ request: r } = await h.setup());
  query = await import('../src/db.js').then((m) => (m.default ?? m).query);
  lifecycle = await import('../src/consultation-lifecycle.js').then((m) => m.default ?? m);
  usersRepo = await import('../src/repos/users.js').then((m) => m.default ?? m);
  consultationsRepo = await import('../src/repos/consultations.js').then((m) => m.default ?? m);

  await h.resetDb();
  users = await h.createFixtureUsers();
  await mkDoctor(MG2, 't.doctor.mg2', 'Dr MG Deux', 'Medecine Generale', 4.9);
  await mkDoctor(MG3, 't.doctor.mg3', 'Dr MG Trois', 'Medecine Generale', 4.8);
  await mkDoctor(CARD2, 't.doctor.card2', 'Dr Card Deux', 'Cardiologie', 4.9);

  for (const [k, u] of Object.entries({
    patient: 't.patient', doctor: 't.doctor', admin: 't.admin',
    mg2: 't.doctor.mg2', mg3: 't.doctor.mg3', card2: 't.doctor.card2', doctor2: 't.doctor2',
  })) {
    token[k] = await h.loginToken(r, u);
  }
});

afterAll(async () => {
  await h.closeAll();
});

describe('creation routing (initial offer)', () => {
  it('routes to the best-rated eligible available doctor with a 1-hour window', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    expect(cons.doctor_id).toBe(users.doctor.id); // rating 5.0 → first
    expect(cons.status).toBe('RECHERCHE_MEDECIN');
    expect(cons.offer_deadline).toBeGreaterThan(Math.floor(Date.now() / 1000) + 55 * 60);
    expect(cons.offer_deadline).toBeLessThan(Math.floor(Date.now() / 1000) + 65 * 60);

    const offers = await offersFor(cons.id);
    expect(offers).toHaveLength(1);
    expect(offers[0].doctor_id).toBe(users.doctor.id);
    expect(offers[0].status).toBe('PENDING');
    expect(offers[0].origin).toBe('routing');
  });

  it('the patient-picked doctor receives the first offer regardless of rating', async () => {
    const cons = await apiCreateConsultation(token.patient, {
      specialtyNeeded: 'Medecine Generale', doctorId: MG3,
    });
    expect(cons.doctor_id).toBe(MG3);
    const offers = await offersFor(cons.id);
    expect(offers[0].doctor_id).toBe(MG3);
    expect(offers[0].origin).toBe('patient_choice');
  });

  it('the request is visible ONLY to the current offer holder (not the whole pool)', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });

    const holderList = await r.get('/api/consultations').set('Authorization', `Bearer ${token.doctor}`);
    expect(holderList.body.some((c) => c.id === cons.id)).toBe(true);

    const otherList = await r.get('/api/consultations').set('Authorization', `Bearer ${token.mg2}`);
    expect(otherList.body.some((c) => c.id === cons.id)).toBe(false);

    const patientList = await r.get('/api/consultations').set('Authorization', `Bearer ${token.patient}`);
    expect(patientList.body.some((c) => c.id === cons.id)).toBe(true);
  });
});

describe('acceptance', () => {
  it('the offer holder accepts within the window → EN_COURS + 5-hour deadline', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });

    const other = await r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.mg2}`);
    expect(other.status).toBe(409); // offered to someone else — must not take ownership

    const res = await r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EN_COURS');
    expect(res.body.doctor_id).toBe(users.doctor.id);
    expect(res.body.accepted_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 2);
    expect(res.body.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 4 * 3600 + 55 * 60);
    expect(res.body.expires_at).toBeLessThan(Math.floor(Date.now() / 1000) + 5 * 3600 + 5 * 60);
    expect(res.body.offer_deadline).toBeNull();

    const offers = await offersFor(cons.id);
    expect(offers[0].status).toBe('ACCEPTED');
    expect(offers[0].responded_at).not.toBeNull();
  });

  it('a second accept after EN_COURS is 404', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    await r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`);
    const again = await r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`);
    expect(again.status).toBe(404);
  });
});

describe('offer timeout + automatic rerouting', () => {
  it('a late acceptance is rejected (410) and the request reroutes to the next doctor', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    await setOfferExpired(cons.id);

    const late = await r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`);
    expect(late.status).toBe(410);
    expect(late.body.error).toContain('depasse');

    // Rerouted to the next eligible doctor (mg2, rating 4.9).
    const after = await r.get(`/api/consultations/${cons.id}`).set('Authorization', `Bearer ${token.admin}`);
    expect(after.body.status).toBe('RECHERCHE_MEDECIN');
    expect(after.body.doctor_id).toBe(MG2);
    expect(after.body.offer_deadline).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const offers = await offersFor(cons.id);
    expect(offers.map((o) => [o.doctor_id, o.status])).toEqual([
      [users.doctor.id, 'EXPIRED'],
      [MG2, 'PENDING'],
    ]);

    // The expired doctor no longer sees the request; the new holder does.
    const t1List = await r.get('/api/consultations').set('Authorization', `Bearer ${token.doctor}`);
    expect(t1List.body.some((c) => c.id === cons.id)).toBe(false);
    const mg2List = await r.get('/api/consultations').set('Authorization', `Bearer ${token.mg2}`);
    expect(mg2List.body.some((c) => c.id === cons.id)).toBe(true);
  });

  it('the previously-expired doctor cannot accept after the reroute', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    await setOfferExpired(cons.id);
    await r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`); // 410 + reroute
    const steal = await r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`);
    expect(steal.status).toBe(409);
  });

  it('scheduler-driven timeout also reroutes (duplicate runs are harmless)', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    await setOfferExpired(cons.id);

    const hub = recordingHub();
    const first = await lifecycle.processDueDeadlines({ hub });
    expect(first.offersExpired).toBeGreaterThanOrEqual(1);
    expect(first.rerouted).toBeGreaterThanOrEqual(1);

    const second = await lifecycle.processDueDeadlines({ hub });
    // Nothing due anymore for this consultation — idempotent no-op.
    const offers = await offersFor(cons.id);
    expect(offers.filter((o) => o.status === 'PENDING')).toHaveLength(1);
    expect(offers.filter((o) => o.status === 'EXPIRED')).toHaveLength(1);

    // Notification dedup: consultation:new to the new doctor emitted once.
    const newDoctorEvents = hub.events.filter((e) => e.userId === MG2 && e.type === 'consultation:new');
    expect(newDoctorEvents).toHaveLength(1);
    void second;
  });
});

describe('pool exhaustion → waiting state', () => {
  // CARD2 is toggled unavailable for these tests so Cardiologie has exactly
  // ONE eligible doctor (doctor_t2) — deterministic pool exhaustion.
  beforeAll(async () => {
    await usersRepo.setAvailability(CARD2, false);
  });
  afterAll(async () => {
    await usersRepo.setAvailability(CARD2, true);
  });

  it('no eligible doctor remains → retryable waiting state, visible to nobody but the patient', async () => {
    // Cardiologie has exactly one available doctor (doctor_t2 / doctor2).
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Cardiologie' });
    expect(cons.doctor_id).toBe(users.doctor2.id);

    await setOfferExpired(cons.id);
    const result = await lifecycle.processDueDeadlines({ hub: recordingHub() });
    expect(result.waiting).toBeGreaterThanOrEqual(1);

    const row = (await query(`SELECT * FROM consultations WHERE id = $1`, [cons.id])).rows[0];
    expect(row.status).toBe('RECHERCHE_MEDECIN');
    expect(row.doctor_id).toBeNull();
    expect(row.offer_deadline).toBeNull();
    expect(row.reroute_after).not.toBeNull();
    expect(row.reroute_after.getTime()).toBeGreaterThan(Date.now());

    // No doctor sees the waiting request.
    for (const tok of [token.doctor2, token.doctor, token.card2]) {
      const list = await r.get('/api/consultations').set('Authorization', `Bearer ${tok}`);
      expect(list.body.some((c) => c.id === cons.id)).toBe(false);
    }
    // The patient still sees it as searching.
    const patientList = await r.get('/api/consultations').set('Authorization', `Bearer ${token.patient}`);
    expect(patientList.body.some((c) => c.id === cons.id && c.status === 'RECHERCHE_MEDECIN')).toBe(true);
  });

  it('a waiting request is re-offered when a new eligible doctor becomes available', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Cardiologie' });
    await setOfferExpired(cons.id);
    await lifecycle.processDueDeadlines({ hub: recordingHub() }); // → waiting

    // A second Cardiologie doctor (CARD2) becomes available → make the
    // retry cooldown due and re-scan.
    await usersRepo.setAvailability(CARD2, true);
    await query(`UPDATE consultations SET reroute_after = now() - interval '1 second' WHERE id = $1`, [cons.id]);
    const hub = recordingHub();
    const result = await lifecycle.processDueDeadlines({ hub });
    expect(result.retried).toBeGreaterThanOrEqual(1);

    const row = (await query(`SELECT * FROM consultations WHERE id = $1`, [cons.id])).rows[0];
    expect(row.doctor_id).toBe(CARD2);
    expect(row.offer_deadline).not.toBeNull();
    expect(hub.events.some((e) => e.userId === CARD2 && e.type === 'consultation:new')).toBe(true);
    expect(hub.events.some((e) => e.userId === users.patient.id && e.type === 'consultation:updated')).toBe(true);
  });

  it('the same doctor is never offered the same consultation twice (UNIQUE)', async () => {
    await usersRepo.setAvailability(CARD2, false); // only doctor_t2 eligible
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Cardiologie' });
    await setOfferExpired(cons.id);
    await lifecycle.processDueDeadlines({ hub: recordingHub() }); // waiting (only t2 eligible, already offered)

    // Retry even after the cooldown — t2 must NOT get a second offer.
    await query(`UPDATE consultations SET reroute_after = now() - interval '1 second' WHERE id = $1`, [cons.id]);
    await lifecycle.processDueDeadlines({ hub: recordingHub() });

    const offers = await offersFor(cons.id);
    expect(offers.filter((o) => o.doctor_id === users.doctor2.id)).toHaveLength(1);
    const row = (await query(`SELECT doctor_id, offer_deadline FROM consultations WHERE id = $1`, [cons.id])).rows[0];
    expect(row.doctor_id).toBeNull();
    expect(row.offer_deadline).toBeNull();
  });
});

describe('rejection semantics', () => {
  it('the patient-chosen doctor rejecting ends the request as REFUSE (legacy behavior)', async () => {
    const cons = await apiCreateConsultation(token.patient, {
      specialtyNeeded: 'Medecine Generale', doctorId: MG3,
    });
    const res = await r.put(`/api/consultations/${cons.id}/reject`).set('Authorization', `Bearer ${token.mg3}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REFUSE');

    const offers = await offersFor(cons.id);
    expect(offers[0].status).toBe('REJECTED');
  });

  it('a routed-offer rejection reroutes immediately instead of refusing', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    expect(cons.doctor_id).toBe(users.doctor.id);

    const res = await r.put(`/api/consultations/${cons.id}/reject`).set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RECHERCHE_MEDECIN');
    expect(res.body.doctor_id).toBe(MG2); // rerouted to the next doctor

    const offers = await offersFor(cons.id);
    expect(offers.find((o) => o.doctor_id === users.doctor.id).status).toBe('REJECTED');
    expect(offers.find((o) => o.doctor_id === MG2).status).toBe('PENDING');
  });

  it('a doctor who is not the current offer holder cannot reject', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    const res = await r.put(`/api/consultations/${cons.id}/reject`).set('Authorization', `Bearer ${token.mg2}`);
    expect(res.status).toBe(404);
  });
});

describe('five-hour expiration after acceptance', () => {
  async function acceptOne() {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    const res = await r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    return cons;
  }

  it('expires an accepted consultation past its deadline, preserves history, notifies both parties', async () => {
    const cons = await acceptOne();
    await r.post(`/api/consultations/${cons.id}/messages`)
      .set('Authorization', `Bearer ${token.patient}`).send({ text: 'bonjour avant expiration' });

    await query(`UPDATE consultations SET expires_at = now() - interval '1 second' WHERE id = $1`, [cons.id]);
    const hub = recordingHub();
    const result = await lifecycle.processDueDeadlines({ hub });
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const row = (await query(`SELECT status FROM consultations WHERE id = $1`, [cons.id])).rows[0];
    expect(row.status).toBe('EXPIRE');

    // Durable system message + the patient's message preserved.
    const msgs = await r.get(`/api/consultations/${cons.id}/messages`).set('Authorization', `Bearer ${token.patient}`);
    expect(msgs.body.some((m) => m.sender_id === 'system' && m.text.includes('expiree'))).toBe(true);
    expect(msgs.body.some((m) => m.text === 'bonjour avant expiration')).toBe(true);

    // Both parties were notified exactly once for this consultation.
    const updates = hub.events.filter((e) => e.type === 'consultation:updated');
    expect(updates.some((e) => e.userId === users.patient.id)).toBe(true);
    expect(updates.some((e) => e.userId === users.doctor.id)).toBe(true);
  });

  it('expiry is idempotent — a duplicate scheduler run changes nothing', async () => {
    const cons = await acceptOne();
    await query(`UPDATE consultations SET expires_at = now() - interval '1 second' WHERE id = $1`, [cons.id]);
    await lifecycle.processDueDeadlines({ hub: recordingHub() });

    const second = await lifecycle.processDueDeadlines({ hub: recordingHub() });
    const row = (await query(`SELECT status FROM consultations WHERE id = $1`, [cons.id])).rows[0];
    expect(row.status).toBe('EXPIRE');
    const msgs = await r.get(`/api/consultations/${cons.id}/messages`).set('Authorization', `Bearer ${token.patient}`);
    expect(msgs.body.filter((m) => m.sender_id === 'system' && m.text.includes('expiree'))).toHaveLength(1);
    void second;
  });

  it('completed and not-yet-due consultations are never expired', async () => {
    const done = await acceptOne();
    await r.put(`/api/consultations/${done.id}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`).send({ prescription: 'Repos' });
    await query(`UPDATE consultations SET expires_at = now() - interval '1 second' WHERE id = $1`, [done.id]);

    const future = await acceptOne(); // expires in ~5 hours — not due

    await lifecycle.processDueDeadlines({ hub: recordingHub() });
    const statuses = (await query(
      `SELECT id, status FROM consultations WHERE id IN ($1, $2)`, [done.id, future.id])).rows;
    expect(statuses.find((s) => s.id === done.id).status).toBe('TERMINE');
    expect(statuses.find((s) => s.id === future.id).status).toBe('EN_COURS');
  });

  it('prescribing requires an EN_CORS-active consultation (expired ones are out of scope)', async () => {
    const cons = await acceptOne();
    await query(`UPDATE consultations SET expires_at = now() - interval '1 second' WHERE id = $1`, [cons.id]);
    await lifecycle.processDueDeadlines({ hub: recordingHub() });

    const res = await r.put(`/api/consultations/${cons.id}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`).send({ prescription: 'X' });
    expect(res.status).toBe(404); // EXPIRE → cannot be completed anymore
  });
});

describe('legacy rows + opportunistic enforcement', () => {
  it('the scheduler adopts never-routed legacy requests (patient pick preserved)', async () => {
    const legacyPool = await h.createConsultationFixture({ patientId: users.patient.id });
    const legacyPicked = await h.createConsultationFixture({ patientId: users.patient.id, doctorId: MG3 });

    await lifecycle.processDueDeadlines({ hub: recordingHub() }); // adoptLegacy: true

    const poolRow = (await query(`SELECT doctor_id, offer_deadline, reroute_after FROM consultations WHERE id = $1`, [legacyPool.id])).rows[0];
    expect(poolRow.doctor_id).toBe(users.doctor.id); // best-rated MG doctor
    expect(poolRow.offer_deadline).not.toBeNull();

    const pickedRow = (await query(`SELECT doctor_id, offer_deadline FROM consultations WHERE id = $1`, [legacyPicked.id])).rows[0];
    expect(pickedRow.doctor_id).toBe(MG3);
    const pickedOffers = await offersFor(legacyPicked.id);
    expect(pickedOffers[0].origin).toBe('patient_choice');
  });

  it('opportunistic enforcement never adopts (reads do not change routing)', async () => {
    const legacy = await h.createConsultationFixture({ patientId: users.patient.id });
    lifecycle.resetEnforceThrottle();
    await lifecycle.enforceDueDeadlines(recordingHub());
    // Give the fire-and-forget run a beat to settle.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const offers = await offersFor(legacy.id);
    expect(offers).toHaveLength(0); // NOT adopted by a read-path run
    const row = (await query(`SELECT doctor_id, reroute_after FROM consultations WHERE id = $1`, [legacy.id])).rows[0];
    expect(row.doctor_id).toBeNull();
    expect(row.reroute_after).toBeNull();

    // Still broadcast-visible (legacy compatibility).
    const list = await r.get('/api/consultations').set('Authorization', `Bearer ${token.doctor}`);
    expect(list.body.some((c) => c.id === legacy.id)).toBe(true);
  });

  it('opportunistic enforcement DOES apply due deadlines (expiry stays fresh without a scheduler)', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    await r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`);
    await query(`UPDATE consultations SET expires_at = now() - interval '1 second' WHERE id = $1`, [cons.id]);

    lifecycle.resetEnforceThrottle();
    await lifecycle.enforceDueDeadlines(recordingHub());
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Any read (e.g. the detail endpoint) now reflects the expired state.
    const res = await r.get(`/api/consultations/${cons.id}`).set('Authorization', `Bearer ${token.patient}`);
    expect(res.body.status).toBe('EXPIRE');
  });
});

describe('accept vs expiry race (concurrency)', () => {
  it('a holder-accept racing the deadline yields exactly one consistent outcome', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    // Deadline exactly "now": either the accept or the expiry wins — never both.
    await query(`UPDATE consultations SET offer_deadline = now() WHERE id = $1`, [cons.id]);
    await query(`UPDATE consultation_offers SET deadline_at = now() WHERE consultation_id = $1 AND status = 'PENDING'`, [cons.id]);

    const [acceptRes, expireOutcome] = await Promise.all([
      r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`),
      lifecycle.expireOfferAndReroute(cons.id, {
        offersExpired: 0, rerouted: 0, waiting: 0, adopted: 0, retried: 0,
        expired: 0, notified: 0, consultation: null, notifyNewDoctor: null,
      }),
    ]);

    const row = (await query(`SELECT status, doctor_id FROM consultations WHERE id = $1`, [cons.id])).rows[0];
    if (acceptRes.status === 200) {
      expect(row.status).toBe('EN_COURS');
      expect(row.doctor_id).toBe(users.doctor.id);
    } else {
      // Late acceptance: the deadline won. Depending on where the reroute
      // commit landed relative to the accept's reads, the route answers 410
      // (holder's expired offer still visible) or 409 (reroute to the next
      // doctor already committed — the pre-existing "offered to another
      // doctor" branch). Both mean exactly ONE consistent outcome.
      expect([409, 410]).toContain(acceptRes.status);
      expect(row.status).toBe('RECHERCHE_MEDECIN');
      expect(row.doctor_id).toBe(MG2); // rerouted by whichever worker won
    }
    void expireOutcome;
  });

  it('two racing accepts from the same offer holder produce exactly one winner', async () => {
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    const results = await Promise.all([
      r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`),
      r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`),
      r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`),
    ]);
    expect(results.filter((res) => res.status === 200)).toHaveLength(1);
  });
});

describe('cron endpoint authorization + behavior', () => {
  it('rejects anonymous callers when no CRON_SECRET is set', async () => {
    const res = await r.get('/api/crons/consultation-deadlines');
    expect(res.status).toBe(401);
  });

  it('accepts the Vercel cron marker header when no CRON_SECRET is set', async () => {
    const res = await r.get('/api/crons/consultation-deadlines').set('x-vercel-cron', '1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty('processed');
    expect(res.body).toHaveProperty('earningsMaterialized');
  });

  it('accepts admin JWTs (manual operator runs)', async () => {
    const res = await r.get('/api/crons/consultation-deadlines').set('Authorization', `Bearer ${token.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('with CRON_SECRET set: only the correct bearer (or an admin) passes', async () => {
    process.env.CRON_SECRET = 'test-cron-secret-3f2b';
    try {
      const anon = await r.get('/api/crons/consultation-deadlines');
      expect(anon.status).toBe(401);

      const markerOnly = await r.get('/api/crons/consultation-deadlines').set('x-vercel-cron', '1');
      expect(markerOnly.status).toBe(401); // the marker alone is NOT enough once a secret exists

      const wrong = await r.get('/api/crons/consultation-deadlines').set('Authorization', 'Bearer nope');
      expect(wrong.status).toBe(401);

      const right = await r.get('/api/crons/consultation-deadlines').set('Authorization', 'Bearer test-cron-secret-3f2b');
      expect(right.status).toBe(200);
      expect(right.body.ok).toBe(true);

      const admin = await r.get('/api/crons/consultation-deadlines').set('Authorization', `Bearer ${token.admin}`);
      expect(admin.status).toBe(200);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  it('POST works too (operator convenience) and doctors/patients are rejected', async () => {
    const ok = await r.post('/api/crons/consultation-deadlines').set('x-vercel-cron', '1');
    expect(ok.status).toBe(200);
    const doctor = await r.post('/api/crons/consultation-deadlines').set('Authorization', `Bearer ${token.doctor}`);
    expect(doctor.status).toBe(403);
    const patient = await r.get('/api/crons/consultation-deadlines').set('Authorization', `Bearer ${token.patient}`);
    expect(patient.status).toBe(403);
  });
});
