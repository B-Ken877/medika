/**
 * Authorization boundary tests (audit H2 + task requirements):
 *  - patients cannot read other patients' consultations / messages
 *  - doctors act only on consultations they own (prescription/reject)
 *  - accept() is an atomic claim: concurrent doctors → exactly one winner
 *  - admin privileges are enforced everywhere
 *  - medical-history access rules (self / admin / treating doctor)
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
  for (const [k, u] of Object.entries({ patient: 't.patient', patient2: 't.patient2', doctor: 't.doctor', doctor2: 't.doctor2', admin: 't.admin' })) {
    token[k] = await h.loginToken(r, u);
  }
});

afterAll(async () => {
  await h.closeAll();
});

describe('consultation read boundaries', () => {
  let consA, consB;

  beforeAll(async () => {
    consA = await h.createConsultationFixture({ patientId: users.patient.id });
    consB = await h.createConsultationFixture({ patientId: users.patient2.id });
  });

  it('patient A cannot read patient B\'s consultation (returns null, 200)', async () => {
    const res = await r.get(`/api/consultations/${consB.id}`).set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('patient A cannot read patient B\'s messages', async () => {
    const res = await r.get(`/api/consultations/${consB.id}/messages`).set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(404);
  });

  it('listing only shows own consultations', async () => {
    const res = await r.get('/api/consultations').set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body.every((c) => c.patient_id === users.patient.id)).toBe(true);
  });

  it('admin can read any consultation', async () => {
    const res = await r.get(`/api/consultations/${consA.id}`).set('Authorization', `Bearer ${token.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(consA.id);
  });

  it('doctors see unassigned consultations in their queue', async () => {
    const res = await r.get('/api/consultations').set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    expect(res.body.some((c) => c.id === consA.id)).toBe(true);
  });
});

describe('doctor action boundaries', () => {
  let assigned;

  beforeAll(async () => {
    assigned = await h.createConsultationFixture({ patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS' });
  });

  it('another doctor cannot reject a consultation they do not own', async () => {
    const res = await r.put(`/api/consultations/${assigned.id}/reject`).set('Authorization', `Bearer ${token.doctor2}`);
    expect(res.status).toBe(404);
  });

  it('another doctor cannot prescribe on a consultation they do not own', async () => {
    const res = await r.put(`/api/consultations/${assigned.id}/prescription`)
      .set('Authorization', `Bearer ${token.doctor2}`)
      .send({ prescription: 'Paracetamol 500mg' });
    expect(res.status).toBe(404);
  });

  it('the assigned doctor can prescribe and it closes the consultation', async () => {
    const res = await r.put(`/api/consultations/${assigned.id}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ prescription: 'Paracetamol 500mg x3/jour' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('TERMINE');
    expect(res.body.prescription).toContain('Paracetamol');
  });

  it('patients cannot accept/reject/prescribe', async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id });
    for (const path of ['accept', 'reject', 'prescription']) {
      const res = await r.put(`/api/consultations/${cons.id}/${path}`)
        .set('Authorization', `Bearer ${token.patient}`)
        .send({ prescription: 'x' });
      expect(res.status).toBe(403);
    }
  });

  it('a doctor cannot steal a consultation already assigned to a colleague', async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS' });
    const res = await r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor2}`);
    expect(res.status).toBe(404);
    const check = await r.get(`/api/consultations/${cons.id}`).set('Authorization', `Bearer ${token.admin}`);
    expect(check.body.doctor_id).toBe(users.doctor.id);
  });

  it('concurrent accepts: exactly ONE doctor wins', async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id });
    const attempts = await Promise.all([
      r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`),
      r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor2}`),
      r.put(`/api/consultations/${cons.id}/accept`).set('Authorization', `Bearer ${token.doctor}`),
    ]);
    const winners = attempts.filter((res) => res.status === 200);
    expect(winners).toHaveLength(1);
    const check = await r.get(`/api/consultations/${cons.id}`).set('Authorization', `Bearer ${token.admin}`);
    expect(check.body.status).toBe('EN_COURS');
    expect([users.doctor.id, users.doctor2.id]).toContain(check.body.doctor_id);
  });
});

describe('medical history access boundaries', () => {
  it('patient reads own history (created on demand)', async () => {
    const res = await r.get(`/api/medical-history/${users.patient.id}`).set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body.patient_id).toBe(users.patient.id);
    expect(Array.isArray(res.body.allergies)).toBe(true);
  });

  it('another patient cannot read it (null)', async () => {
    const res = await r.get(`/api/medical-history/${users.patient.id}`).set('Authorization', `Bearer ${token.patient2}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('a doctor WITHOUT a consultation with the patient cannot read it', async () => {
    const res = await r.get(`/api/medical-history/${users.patient2.id}`).set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('a doctor WITH a consultation with the patient can read it', async () => {
    await h.createConsultationFixture({ patientId: users.patient2.id, doctorId: users.doctor.id, status: 'EN_COURS' });
    const res = await r.get(`/api/medical-history/${users.patient2.id}`).set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    expect(res.body.patient_id).toBe(users.patient2.id);
  });

  it('only the patient can update their history', async () => {
    const update = { allergies: [{ name: 'Penicilline', severity: 'elevee', reaction: 'urticaire', notedAt: null }] };
    const resSelf = await r.put(`/api/medical-history/${users.patient.id}`)
      .set('Authorization', `Bearer ${token.patient}`).send(update);
    expect(resSelf.status).toBe(200);
    expect(resSelf.body.allergies[0].name).toBe('Penicilline');

    const resDoctor = await r.put(`/api/medical-history/${users.patient.id}`)
      .set('Authorization', `Bearer ${token.doctor}`).send(update);
    expect(resDoctor.status).toBe(403);
  });
});

describe('admin endpoint boundaries', () => {
  it('patients/doctors get 403 on admin endpoints', async () => {
    for (const tok of [token.patient, token.doctor]) {
      const res = await r.get('/api/admin/stats').set('Authorization', `Bearer ${tok}`);
      expect(res.status).toBe(403);
    }
  });

  it('admin stats respond with the legacy shape', async () => {
    const res = await r.get('/api/admin/stats').set('Authorization', `Bearer ${token.admin}`);
    expect(res.status).toBe(200);
    for (const key of ['totalDoctors', 'totalPatients', 'totalConsultations', 'totalRevenue', 'monthlyBreakdown', 'doctorEarnings']) {
      expect(res.body).toHaveProperty(key);
    }
  });

  it('patient-facing doctor list strips email/phone', async () => {
    const res = await r.get('/api/doctors').set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    for (const d of res.body) {
      expect(d.email).toBeUndefined();
      expect(d.phone).toBeUndefined();
      expect(d.license_number).toBeDefined(); // shown on Android profile cards
    }
  });
});
