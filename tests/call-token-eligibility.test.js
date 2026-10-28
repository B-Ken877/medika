/**
 * Call-token lifecycle eligibility (issue #45 — fail closed).
 *
 * POST /api/call/token must deny every non-active consultation status.
 * Participant identity alone is NOT enough: a RECHERCHE_MEDECIN row can
 * already carry the current OFFER holder as doctor_id, and that doctor has
 * NOT accepted yet. Terminal states (TERMINE / REFUSE / EXPIRE) and the
 * unassigned/routing state must never mint a room token.
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';
// Dummy LiveKit credentials — JWT signing works offline.
process.env.LIVEKIT_URL = 'wss://livekit.example.com';
process.env.LIVEKIT_API_KEY = 'testkey';
process.env.LIVEKIT_API_SECRET = 'testsecret-testsecret-testsecret-testsecret';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {}, query;

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
  query = (await import('../src/db.js')).query;
});

afterAll(async () => {
  await h.closeAll();
});

function callToken(user, consId) {
  return r.post('/api/call/token')
    .set('Authorization', `Bearer ${token[user]}`)
    .send({ consultationId: consId, isVideo: true });
}

describe('POST /api/call/token — consultation lifecycle eligibility', () => {
  it('issues a token to the ASSIGNED DOCTOR of an EN_COURS consultation', async () => {
    const cons = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    const res = await callToken('doctor', cons.id);
    expect(res.status).toBe(200);
    expect(res.body.token.split('.')).toHaveLength(3); // LiveKit JWT
    expect(res.body.roomName).toBe('medika_' + cons.id);
    expect(res.body.participantIdentity).toBe(users.doctor.id);
  });

  it('denies a token while the consultation is UNASSIGNED (RECHERCHE_MEDECIN)', async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id });
    expect(cons.status).toBe('RECHERCHE_MEDECIN');
    const res = await callToken('patient', cons.id);
    expect(res.status).toBe(403);
  });

  it('denies the OFFER-HOLDING doctor before acceptance (RECHERCHE_MEDECIN + doctor_id)', async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id });
    // Simulate the routing engine's current offer holder: doctor_id set,
    // status still RECHERCHE_MEDECIN (not yet accepted).
    await query('UPDATE consultations SET doctor_id = $1 WHERE id = $2', [users.doctor.id, cons.id]);
    const res = await callToken('doctor', cons.id);
    expect(res.status).toBe(403);
    // The patient is equally denied while the request is still routing.
    const resPatient = await callToken('patient', cons.id);
    expect(resPatient.status).toBe(403);
  });

  it('denies a token for a TERMINATED consultation', async () => {
    const cons = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    await query("UPDATE consultations SET status = 'TERMINE' WHERE id = $1", [cons.id]);
    const res = await callToken('patient', cons.id);
    expect(res.status).toBe(403);
  });

  it('denies a token for a REFUSED consultation', async () => {
    const cons = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    await query("UPDATE consultations SET status = 'REFUSE' WHERE id = $1", [cons.id]);
    const res = await callToken('patient', cons.id);
    expect(res.status).toBe(403);
  });

  it('denies a token for an EXPIRED consultation', async () => {
    const cons = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    await query("UPDATE consultations SET status = 'EXPIRE' WHERE id = $1", [cons.id]);
    const res = await callToken('patient', cons.id);
    expect(res.status).toBe(403);
  });
});
