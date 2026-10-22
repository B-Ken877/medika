/**
 * Consultation lifecycle + messaging + consultation notes (RECONSTRUCTED
 * endpoint) + medical-history auto-update from notes.
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

describe('consultation lifecycle', () => {
  let consId;

  it('patient creates a consultation (legacy shape preserved)', async () => {
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({
        description: 'Douleurs abdominales', specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Haute', aiSummary: 'resume IA', doctorId: users.doctor.id, patientAge: 30,
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      patient_id: users.patient.id,
      patient_name: 'Pat Test',
      patient_age: 30,
      doctor_id: users.doctor.id,
      specialty_needed: 'Medecine Generale',
      urgency_level: 'Haute',
      status: 'RECHERCHE_MEDECIN',
      prescription: null,
    });
    expect(typeof res.body.created_at).toBe('number'); // unix seconds (Android *1000)
    consId = res.body.id;
  });

  it('doctor accepts → status EN_COURS + system message', async () => {
    const res = await r.put(`/api/consultations/${consId}/accept`).set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EN_COURS');
    const msgs = await r.get(`/api/consultations/${consId}/messages`).set('Authorization', `Bearer ${token.doctor}`);
    expect(msgs.status).toBe(200);
    expect(msgs.body.some((m) => m.sender_id === 'system' && m.text.includes('accepte'))).toBe(true);
    expect(typeof msgs.body[0].id).toBe('number'); // BIGSERIAL — Android Long
  });

  it('REST message send (additive endpoint) persists + returns snake_case shape', async () => {
    const res = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'Bonjour docteur' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      consultation_id: consId,
      sender_id: users.patient.id,
      sender_name: 'Pat Test',
      text: 'Bonjour docteur',
      message_type: 'text',
    });
    expect(typeof res.body.created_at).toBe('number');
  });

  it('doctor prescribes → TERMINE + system message', async () => {
    const res = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ prescription: 'Repos 3 jours' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('TERMINE');
  });
});

describe('consultation notes (RECONSTRUCTED) + dossier auto-update', () => {
  let consId;

  beforeAll(async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS' });
    consId = cons.id;
  });

  it('GET notes returns null before saving', async () => {
    const res = await r.get(`/api/consultations/${consId}/notes`).set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('doctor saves notes (camelCase request → snake_case response)', async () => {
    const res = await r.put(`/api/consultations/${consId}/notes`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({
        diagnosis: 'Hypertension arterielle legere',
        symptoms: 'maux de tete',
        notes: 'surveillance tension',
        prescriptions: [{ medication: 'Amlodipine', dosage: '5mg', duration: '30 jours' }],
        followUp: 'dans 2 semaines',
        flagAllergy: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.consultation_id).toBe(consId);
    expect(res.body.follow_up).toBe('dans 2 semaines');
    expect(res.body.prescriptions).toEqual([{ medication: 'Amlodipine', dosage: '5mg', duration: '30 jours' }]);
    expect(res.body.doctor_name).toBe('Dr Test');
  });

  it('notes auto-update the patient dossier (medications + chronic conditions)', async () => {
    const history = await r.get(`/api/medical-history/${users.patient.id}`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(history.status).toBe(200);
    expect(history.body.current_medications.some((m) => m.name === 'Amlodipine')).toBe(true);
    expect(history.body.chronic_conditions.some((c) => /Hypertension/i.test(c.name))).toBe(true);
    expect(history.body.consultation_timeline.some((t) => t.consultation_id === consId)).toBe(true);
  });

  it('saving notes twice does not duplicate medications (idempotent auto-update)', async () => {
    await r.put(`/api/consultations/${consId}/notes`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ diagnosis: 'Hypertension arterielle legere', prescriptions: [{ medication: 'Amlodipine', dosage: '5mg', duration: '30 jours' }] });
    const history = await r.get(`/api/medical-history/${users.patient.id}`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(history.body.current_medications.filter((m) => m.name === 'Amlodipine')).toHaveLength(1);
  });

  it('snapshot returns the lightweight doctor card', async () => {
    const res = await r.get(`/api/medical-history/${users.patient.id}/snapshot`)
      .set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('has_allergies');
    expect(res.body).toHaveProperty('recent_consultations');
    expect(res.body.patient_id).toBe(users.patient.id);
  });
});

describe('specialty pricing endpoints', () => {
  it('public prices list matches the seeded specialties.json', async () => {
    const res = await r.get('/api/specialties/prices');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(20);
    expect(res.body.find((s) => s.name === 'Medecine Generale').price).toBe(750);
  });

  it('single price endpoint answers the Android payment flow', async () => {
    const res = await r.get('/api/specialties/price').query({ specialty: 'Cardiologie' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ specialty: 'Cardiologie', price: 1500 });
  });

  it('admin can update a price', async () => {
    const res = await r.put('/api/admin/specialties/cardiologie')
      .set('Authorization', `Bearer ${token.admin}`).send({ price: 1600 });
    expect(res.status).toBe(200);
    expect(res.body.specialty.price).toBe(1600);
  });
});

describe('health + profile', () => {
  it('health is public', async () => {
    const res = await r.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('profile update works and keeps the safe shape', async () => {
    const res = await r.put('/api/profile')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ name: 'Pat Renomme', phone: '+509 2' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Pat Renomme');
    expect(res.body.password_hash).toBeUndefined();
  });

  it('doctor availability toggle', async () => {
    const res = await r.put('/api/doctor/availability')
      .set('Authorization', `Bearer ${token.doctor}`).send({ isAvailable: false });
    expect(res.status).toBe(200);
    expect(res.body.isAvailable).toBe(false);
  });
});
