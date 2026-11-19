/**
 * POST /api/consultations/call-center — the express call-center intake
 * ("New consultation → call center agent").
 *
 * The contract: the patient supplies NOTHING. No body fields are read, no
 * payment is required, the consultation is created on the Medecine Generale
 * defaults with channel='CALL_CENTER' (migration 014) and enters the SAME
 * routing queue as a manual request. The one-active invariant (issue #60)
 * applies identically.
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.admin = await h.loginToken(r, 't.admin');
});

afterAll(async () => {
  await h.closeAll();
});

describe('call-center express intake', () => {
  it('401 without a bearer token', async () => {
    const res = await r.post('/api/consultations/call-center').send({});
    expect(res.status).toBe(401);
  });

  it('403 for a doctor — this intake is patient-only', async () => {
    const res = await r.post('/api/consultations/call-center')
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('201 with an EMPTY body: Medecine Generale defaults + channel CALL_CENTER', async () => {
    const res = await r.post('/api/consultations/call-center')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      patient_id: users.patient.id,
      patient_name: 'Pat Test',
      description: '',
      specialty_needed: 'Medecine Generale',
      urgency_level: 'Moyenne',
      status: 'RECHERCHE_MEDECIN',
      channel: 'CALL_CENTER',
    });
  });

  it('409 while the patient already has an active consultation (existing_id)', async () => {
    const res = await r.post('/api/consultations/call-center')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.existing_id).toBeTruthy();
    expect(res.body.error).toMatch(/konsiltasyon aktif/);
  });

  it('the manual intake keeps channel SELF (untouched path)', async () => {
    // A second patient (t.patient2, no open consultation) exercises the
    // manual POST: nothing changed for the classic form flow.
    const t2 = await h.loginToken(r, 't.patient2');
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${t2}`)
      .send({ description: 'Manual intake', specialtyNeeded: 'Medecine Generale', urgencyLevel: 'Moyenne' });
    expect(res.status).toBe(201);
    expect(res.body.channel).toBe('SELF');
  });
});
