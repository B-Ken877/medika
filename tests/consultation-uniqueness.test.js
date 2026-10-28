/**
 * One-active-consultation invariant tests (issue #60):
 *   * a patient cannot create a second blocking consultation (sequential
 *     AND concurrent — the partial unique index is the referee)
 *   * a doctor cannot hold two blocking consultations; patient-choice of a
 *     busy doctor → 409; routing skips busy doctors; concurrent booking of
 *     the same doctor leaves at most one request with that doctor
 *   * legacy broadcast double-accept → honest 409 (never a 500)
 *   * bounded pending timeout: stale RECHERCHE_MEDECIN expires safely,
 *     EN_COURS is never touched by that pass
 *   * legacy-duplicate reconciliation: deterministic greedy newest-first
 *     (incl. the patient/doctor cross-interaction edge), rerunnable, no
 *     history deleted
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};
let query, lifecycle, usersRepo, consultationsRepo;

const MG2 = 'doctor_mg2';
const MG3 = 'doctor_mg3';
const PAT3 = 'patient_t3';

async function mkUser(id, username, role, extra = {}) {
  const { hashPassword } = await import('../src/auth.js').then((m) => m.default ?? m);
  return usersRepo.create({
    id, username, password_hash: hashPassword('Passw0rd!'), role,
    name: extra.name || `User ${username}`, specialty: extra.specialty, rating: extra.rating,
  });
}

/** Login every fixture account used by this file. */
async function loginTokens(map) {
  for (const [k, u] of Object.entries(map)) {
    token[k] = await h.loginToken(r, u);
  }
}

/** Move every blocking consultation to a terminal state (slot release). */
async function releaseAll() {
  await query(`UPDATE consultations SET status = 'TERMINE', updated_at = now()
                WHERE status IN ('RECHERCHE_MEDECIN','EN_COURS')`);
}

/** Recreate the one-active invariant indexes (dropped by reconciliation tests). */
async function recreateIndexes() {
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_consultations_patient_active
                 ON consultations (patient_id)
                 WHERE patient_id IS NOT NULL AND status IN ('RECHERCHE_MEDECIN','EN_COURS')`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_consultations_doctor_active
                 ON consultations (doctor_id)
                 WHERE doctor_id IS NOT NULL AND status IN ('RECHERCHE_MEDECIN','EN_COURS')`);
}

beforeAll(async () => {
  ({ request: r } = await h.setup());
  query = await import('../src/db.js').then((m) => (m.default ?? m).query);
  lifecycle = await import('../src/consultation-lifecycle.js').then((m) => m.default ?? m);
  usersRepo = await import('../src/repos/users.js').then((m) => m.default ?? m);
  consultationsRepo = await import('../src/repos/consultations.js').then((m) => m.default ?? m);

  await h.resetDb();
  users = await h.createFixtureUsers();
  await mkUser(PAT3, 't.patient3', 'patient', { name: 'Pat Trois' });
  await mkUser(MG2, 't.doctor.mg2', 'doctor', { name: 'Dr MG Deux', specialty: 'Medecine Generale', rating: 4.9 });
  await mkUser(MG3, 't.doctor.mg3', 'doctor', { name: 'Dr MG Trois', specialty: 'Medecine Generale', rating: 4.8 });
  users.patient3 = { id: PAT3, username: 't.patient3' };
  await loginTokens({
    patient: 't.patient', patient2: 't.patient2', patient3: 't.patient3',
    doctor: 't.doctor', mg2: 't.doctor.mg2', admin: 't.admin',
  });
});

afterAll(async () => {
  await h.closeAll();
});

/** POST /api/consultations returning the raw response (no status assert). */
function postConsultation(patientToken, body = {}) {
  return r.post('/api/consultations')
    .set('Authorization', `Bearer ${patientToken}`)
    .send({ description: 'test', urgencyLevel: 'Moyenne', ...body });
}

async function apiCreateConsultation(patientToken, body = {}) {
  const res = await postConsultation(patientToken, body);
  expect(res.status).toBe(201);
  return res.body;
}

/** Raw SQL insert of a blocking consultation with a custom created_at. */
async function sqlInsertConsultation({ id, patientId, patientName, doctorId, status, ageHours, closeReason = null }) {
  await query(
    `INSERT INTO consultations
       (id, patient_id, patient_name, doctor_id, description, specialty_needed, status, created_at, close_reason)
     VALUES ($1, $2, $3, $4, 'issue 60 fixture', 'Medecine Generale', $5,
             now() - make_interval(hours => $6), $7)`,
    [id, patientId, patientName, doctorId, status, ageHours, closeReason]
  );
}

async function getConsultationRow(id) {
  const { rows } = await query(`SELECT * FROM consultations WHERE id = $1`, [id]);
  return rows[0] || null;
}

describe('one active consultation per patient (issue #60)', () => {
  it('rejects a second sequential booking with 409 + a link to the existing one', async () => {
    await releaseAll();
    const first = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    const res = await postConsultation(token.patient, { specialtyNeeded: 'Cardiologie' });
    expect(res.status).toBe(409);
    expect(res.body.existing_id).toBe(first.id);
    expect(res.body.existing_status).toBe('RECHERCHE_MEDECIN');
    expect(typeof res.body.error).toBe('string');
    // exactly one blocking consultation exists for this patient
    const active = await consultationsRepo.findActiveForPatient(users.patient.id);
    expect(active.id).toBe(first.id);
  });

  it('two simultaneous submissions by the same patient produce at most one consultation', async () => {
    await releaseAll();
    const [a, b] = await Promise.all([
      postConsultation(token.patient2, { specialtyNeeded: 'Medecine Generale' }),
      postConsultation(token.patient2, { specialtyNeeded: 'Medecine Generale' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const winner = a.status === 201 ? a.body : b.body;
    const loser = a.status === 409 ? a : b;
    expect(loser.body.existing_id).toBe(winner.id);
    const actives = await query(
      `SELECT id FROM consultations WHERE patient_id = $1 AND status IN ('RECHERCHE_MEDECIN','EN_COURS')`,
      [users.patient2.id]
    );
    expect(actives.rows).toHaveLength(1);
    expect(actives.rows[0].id).toBe(winner.id);
  });

  it('terminal consultations never block new bookings', async () => {
    // finish patient2's active consultation so the slot frees up
    const active = await consultationsRepo.findActiveForPatient(users.patient2.id);
    await query(`UPDATE consultations SET status = 'TERMINE', updated_at = now() WHERE id = $1`, [active.id]);
    const next = await postConsultation(token.patient2, { specialtyNeeded: 'Medecine Generale' });
    expect(next.status).toBe(201);
  });
});

describe('one active consultation per doctor (issue #60)', () => {
  it('patient-choice of a doctor who already holds a blocking consultation → 409', async () => {
    await releaseAll();
    const c1 = await apiCreateConsultation(token.patient3, {
      specialtyNeeded: 'Medecine Generale', doctorId: users.doctor.id,
    });
    expect(c1.doctor_id).toBe(users.doctor.id);
    // a different patient picks the SAME doctor → honest busy answer
    const res = await postConsultation(token.patient, {
      specialtyNeeded: 'Medecine Generale', doctorId: users.doctor.id,
    });
    expect(res.status).toBe(409);
    expect(res.body.existing_id).toBe(c1.id);
    expect(res.body.error).toContain('okipe');
  });

  it('routing skips busy doctors (they are never offered a second request)', async () => {
    await releaseAll();
    // doctor_t1 takes a request first…
    const c1 = await apiCreateConsultation(token.patient3, {
      specialtyNeeded: 'Medecine Generale', doctorId: users.doctor.id,
    });
    expect(c1.doctor_id).toBe(users.doctor.id);
    // …then a routed (non-patient-choice) booking goes to the next best
    // eligible MG doctor — MG2 — never to the busy holder.
    const cons = await apiCreateConsultation(token.patient, { specialtyNeeded: 'Medecine Generale' });
    expect(cons.doctor_id).toBe(MG2);
  });

  it('two simultaneous bookings of the same doctor: at most one wins, the loser gets a clear busy answer or a reroute', async () => {
    await releaseAll();
    const [a, b] = await Promise.all([
      postConsultation(token.patient, {
        specialtyNeeded: 'Medecine Generale', doctorId: users.doctor.id,
      }),
      postConsultation(token.patient3, {
        specialtyNeeded: 'Medecine Generale', doctorId: users.doctor.id,
      }),
    ]);
    expect([a.status, b.status]).not.toContain(500);
    // Both outcomes are legitimate per the issue: the loser is either refused
    // with the clear "doctor is currently busy" answer (the winner's atomic
    // insert-time reservation was already visible) or gracefully rerouted.
    // In both cases exactly ONE active consultation may involve that doctor.
    const ok = a.status === 201 ? a : b;
    const other = a.status === 201 ? b : a;
    expect(ok.status).toBe(201);
    expect([201, 409]).toContain(other.status);
    if (other.status === 409) {
      expect(other.body.error).toMatch(/okipe|aktif/);
    } else {
      expect(other.body.doctor_id === MG2 || other.body.doctor_id === null).toBe(true);
    }
    // the doctor-side invariant holds at the database level
    const held = await query(
      `SELECT id FROM consultations WHERE doctor_id = $1 AND status IN ('RECHERCHE_MEDECIN','EN_COURS')`,
      [users.doctor.id]
    );
    expect(held.rows).toHaveLength(1);
    expect(held.rows[0].id).toBe(ok.body.id);
  });

  it('a doctor accepting a legacy broadcast request while holding another active one gets 409, not 500', async () => {
    await releaseAll();
    // doctor_t1 must hold exactly one blocking consultation for this test
    const held = await apiCreateConsultation(token.patient3, {
      specialtyNeeded: 'Medecine Generale', doctorId: users.doctor.id,
    });
    expect(held.doctor_id).toBe(users.doctor.id);
    // a legacy-shaped broadcast row (no offers, unassigned) is visible to the
    // historical free-accept path — but the doctor-side index must refuse it.
    const legacy = await query(
      `INSERT INTO consultations
         (id, patient_id, patient_name, doctor_id, description, specialty_needed, status)
       VALUES ('cons_legacy_broadcast', $1, 'Pat Deux', NULL, 'legacy broadcast', 'Medecine Generale', 'RECHERCHE_MEDECIN')
       RETURNING id`,
      [users.patient2.id]
    );
    expect(legacy.rows).toHaveLength(1);

    const res = await r.put('/api/consultations/cons_legacy_broadcast/accept')
      .set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('aktif');
    // the legacy row stayed untouched (still pending, still unassigned)
    const row = await getConsultationRow('cons_legacy_broadcast');
    expect(row.status).toBe('RECHERCHE_MEDECIN');
    expect(row.doctor_id).toBeNull();
  });
});

describe('bounded pending timeout (issue #60 §3)', () => {
  it('expires stale pending requests, never in-progress ones', async () => {
    await releaseAll();
    await sqlInsertConsultation({ id: 'cons_stale_pending', patientId: users.patient.id, patientName: 'Pat', doctorId: null, status: 'RECHERCHE_MEDECIN', ageHours: 6 });
    await sqlInsertConsultation({ id: 'cons_young_pending', patientId: users.patient2.id, patientName: 'Pat Deux', doctorId: null, status: 'RECHERCHE_MEDECIN', ageHours: 0 });
    await sqlInsertConsultation({ id: 'cons_legacy_encours', patientId: users.patient3.id, patientName: 'Pat Trois', doctorId: users.doctor.id, status: 'EN_COURS', ageHours: 6 });

    const outcome = await lifecycle.processDueDeadlines({ hub: null, adoptLegacy: false });
    expect(outcome.pendingExpired).toBe(1);

    const stale = await getConsultationRow('cons_stale_pending');
    expect(stale.status).toBe('EXPIRE');
    expect(stale.close_reason).toBe('pending_timeout');
    const young = await getConsultationRow('cons_young_pending');
    expect(young.status).toBe('RECHERCHE_MEDECIN');
    const inProgress = await getConsultationRow('cons_legacy_encours');
    expect(inProgress.status).toBe('EN_COURS'); // never expired by the pending pass

    // visible, history-preserving cleanup
    const msgs = await query(`SELECT text FROM messages WHERE consultation_id = 'cons_stale_pending'`);
    expect(msgs.rows.length).toBeGreaterThan(0);
  });

  it('is idempotent — a second run is a no-op', async () => {
    const outcome = await lifecycle.processDueDeadlines({ hub: null, adoptLegacy: false });
    expect(outcome.pendingExpired).toBe(0);
  });
});

describe('legacy duplicate reconciliation (issue #60 §4)', () => {
  it('keeps the newest non-conflicting record per participant and cancels older conflicts — deterministically', async () => {
    await h.resetDb();
    users = await h.createFixtureUsers(); // fresh fixture ids after truncate
    await mkUser(PAT3, 't.patient3', 'patient', { name: 'Pat Trois' });
    await mkUser(MG2, 't.doctor.mg2', 'doctor', { name: 'Dr MG Deux', specialty: 'Medecine Generale', rating: 4.9 });
    users.patient3 = { id: PAT3, username: 't.patient3' };
    await loginTokens({ patient: 't.patient', patient2: 't.patient2', admin: 't.admin' });

    // Drop the invariant so legacy duplicates can exist again.
    await query(`DROP INDEX IF EXISTS uq_consultations_patient_active`);
    await query(`DROP INDEX IF EXISTS uq_consultations_doctor_active`);

    // Cross-participant edge from the issue:
    //   A (patient_t1, D1, 3h old, EN_COURS)
    //   B (patient_t1, D2, 2h old, RECHERCHE_MEDECIN)
    //   C (patient_t2, D2, 1h old, RECHERCHE_MEDECIN)  ← newest
    // Greedy newest-first: C kept (holds D2); B cancelled (D2 taken by newer C);
    // A kept (its patient slot freed when B was cancelled, D1 never contested).
    await sqlInsertConsultation({ id: 'cons_dup_A', patientId: users.patient.id, patientName: 'Pat', doctorId: users.doctor.id, status: 'EN_COURS', ageHours: 3 });
    await sqlInsertConsultation({ id: 'cons_dup_B', patientId: users.patient.id, patientName: 'Pat', doctorId: MG2, status: 'RECHERCHE_MEDECIN', ageHours: 2 });
    await sqlInsertConsultation({ id: 'cons_dup_C', patientId: users.patient2.id, patientName: 'Pat Deux', doctorId: MG2, status: 'RECHERCHE_MEDECIN', ageHours: 1 });
    // completed history must never be touched
    await sqlInsertConsultation({ id: 'cons_dup_done', patientId: users.patient3.id, patientName: 'Pat Trois', doctorId: users.doctor.id, status: 'TERMINE', ageHours: 5 });

    const first = await query(`SELECT * FROM reconcile_duplicate_active_consultations()`);
    expect(first.rows[0].cancelled).toBe(1);
    expect(first.rows[0].kept).toBe(2);

    const b = await getConsultationRow('cons_dup_B');
    expect(b.status).toBe('EXPIRE');
    expect(b.close_reason).toBe('duplicate_open_consultation');
    const a = await getConsultationRow('cons_dup_A');
    expect(a.status).toBe('EN_COURS'); // untouched — still the patient's active record
    expect(a.close_reason).toBeNull();
    const c = await getConsultationRow('cons_dup_C');
    expect(c.status).toBe('RECHERCHE_MEDECIN');
    const done = await getConsultationRow('cons_dup_done');
    expect(done.status).toBe('TERMINE'); // completed history never cancelled
    // history is preserved — nothing was deleted
    const preserved = await query(`SELECT id FROM consultations WHERE id IN ('cons_dup_A','cons_dup_B','cons_dup_C')`);
    expect(preserved.rows).toHaveLength(3);
    // visible reason in the conversation
    const msgs = await query(`SELECT text FROM messages WHERE consultation_id = 'cons_dup_B'`);
    expect(msgs.rows.length).toBeGreaterThan(0);

    // Rerun is a no-op (deterministic + safe to rerun).
    const second = await query(`SELECT * FROM reconcile_duplicate_active_consultations()`);
    expect(second.rows[0].cancelled).toBe(0);
    expect(second.rows[0].kept).toBe(2);

    // The invariant indexes can now be (re)created safely — the deploy-order
    // guarantee the migration relies on.
    await recreateIndexes();

    // The API exposes close_reason additively; terminal duplicates are history.
    const list = await r.get('/api/consultations').set('Authorization', `Bearer ${token.patient}`);
    expect(list.status).toBe(200);
    const dupB = list.body.find((x) => x.id === 'cons_dup_B');
    expect(dupB.close_reason).toBe('duplicate_open_consultation');
  });

  it('migration 008 reconciles BEFORE creating the invariant indexes (deploy-order contract)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'db', 'migrations', '008_one_active_consultation.sql'), 'utf8');
    const reconcileCall = sql.indexOf('SELECT * FROM reconcile_duplicate_active_consultations()');
    const patientIndex = sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_consultations_patient_active');
    const doctorIndex = sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_consultations_doctor_active');
    expect(reconcileCall).toBeGreaterThan(-1);
    expect(patientIndex).toBeGreaterThan(reconcileCall);
    expect(doctorIndex).toBeGreaterThan(reconcileCall);
    expect(sql).toContain('duplicate_open_consultation');
  });
});
