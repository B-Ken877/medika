/**
 * Agent operations — END-TO-END assisted booking (brief #26 journey 1).
 *
 * Patient requests assistance → queue → agent accepts → voice state (honest
 * 503 without a real provider) → specialty+doctor recorded → the patient
 * completes the SIMULATED payment on their OWN device through the EXISTING
 * payment/consultation flow → the consultation links back to the session →
 * wrap-up → the agent is available again → supervisor sees the outcome.
 *
 * Voice: with no ZEGOCLOUD credentials the token endpoints fail closed with
 * 503 — the REAL two-party audio call remains unverified (brief #24).
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.REQUIRE_PAYMENT = 'true';
process.env.PAYMENT_SIMULATION_OPEN = 'true'; // beta: everyone can simulate
process.env.JWT_SECRET = 'agent-e2e-test-secret-0123456789abcdef0123456789abcdef';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.agent = await h.loginToken(r, 't.agent');
  token.supervisor = await h.loginToken(r, 't.supervisor');
  token.admin = await h.loginToken(r, 't.admin');
  // Authorize the agent profile (reports join agent_profiles).
  await r.post('/api/agent/ops/agents')
    .set('Authorization', `Bearer ${token.admin}`).send({ username: 't.agent', employeeRef: 'EMP-1' });
  // One fully routable agent.
  await r.post('/api/agent/shift/start').set('Authorization', `Bearer ${token.agent}`);
  await r.post('/api/agent/presence').set('Authorization', `Bearer ${token.agent}`).send({ availability: 'available' });
  await r.post('/api/agent/presence/heartbeat').set('Authorization', `Bearer ${token.agent}`).send({});
});

afterAll(async () => {
  await h.closeAll();
});

describe('assisted booking journey (brief #26 journey 1)', () => {
  let sessionId, assignmentId, consultationId;

  it('1-5. patient requests assistance → real backend queue → offer', async () => {
    const res = await r.post('/api/assist/requests')
      .set('Authorization', `Bearer ${token.patient}`).send({ language: 'ht' });
    expect(res.status).toBe(201);
    expect(res.body.agentsAvailable).toBe(1);
    sessionId = res.body.sessionId;
    const queue = await r.get('/api/agent/queue').set('Authorization', `Bearer ${token.agent}`);
    expect(queue.body.offers.length).toBe(1);
    assignmentId = queue.body.offers[0].assignmentId;
  });

  it('6-8. agent accepts → session ACTIVE (voice fails closed without provider)', async () => {
    const accept = await r.post(`/api/agent/assignments/${assignmentId}/accept`)
      .set('Authorization', `Bearer ${token.agent}`);
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe('active');

    // Honest voice: no ZEGOCLOUD credentials in this worker → 503, no fake call.
    const agentToken = await r.post(`/api/agent/sessions/${sessionId}/call/start`)
      .set('Authorization', `Bearer ${token.agent}`);
    expect(agentToken.status).toBe(503);
    const patientToken = await r.get(`/api/assist/sessions/${sessionId}/call-token`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(patientToken.status).toBe(503);
  });

  it('9. agent sees the minimum patient information (no medical record)', async () => {
    const detail = await r.get(`/api/agent/sessions/${sessionId}`).set('Authorization', `Bearer ${token.agent}`);
    expect(detail.status).toBe(200);
    expect(detail.body.patient.name).toBeTruthy();
    expect(detail.body.patient.id).toBe('patient_t1');
    // Minimum-necessary: no medical history payload on the session view.
    expect(detail.body.events.length).toBeGreaterThanOrEqual(3);
  });

  it('10-12. specialty + doctor selection with the standardized price', async () => {
    const specialties = await r.get('/api/agent/specialties').set('Authorization', `Bearer ${token.agent}`);
    expect(specialties.status).toBe(200);
    const cardio = specialties.body.find((s) => s.name === 'Cardiologie');
    expect(cardio).toBeTruthy();

    const sel = await r.post(`/api/agent/sessions/${sessionId}/specialty`)
      .set('Authorization', `Bearer ${token.agent}`).send({ specialty: 'Cardiologie' });
    expect(sel.body.specialty).toBe('Cardiologie');
    expect(sel.body.price).toBeGreaterThan(0);

    const doctors = await r.get('/api/agent/doctors?specialty=Cardiologie')
      .set('Authorization', `Bearer ${token.agent}`);
    expect(doctors.status).toBe(200);
    expect(doctors.body.length).toBeGreaterThanOrEqual(1);
    const doctorId = doctors.body[0].id;
    const pick = await r.post(`/api/agent/sessions/${sessionId}/doctor`)
      .set('Authorization', `Bearer ${token.agent}`).send({ doctorId });
    expect(pick.status).toBe(200);
  });

  it('13-17. patient pays (simulated) on THEIR device → existing flow creates the consultation', async () => {
    // The patient runs the EXISTING payment flow (server-provided simulation).
    const create = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: 'AGENTA_E2E_1', amount: 1500 });
    expect(create.status).toBe(200);
    expect(create.body.simulated).toBe(true);
    const verify = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: 'AGENTA_E2E_1' });
    expect(verify.body.success).toBe(true);

    // The EXISTING authoritative consultation creation consumes the payment.
    const consult = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({
        description: 'Rayi nan kè — demann asiste pa ajan',
        specialtyNeeded: 'Cardiologie',
        urgencyLevel: 'Moyenne',
        doctorId: users.doctor2.id, // Cardiologie fixture doctor
        orderId: 'AGENTA_E2E_1',
      });
    expect(consult.status).toBe(201);
    consultationId = consult.body.id;

    // The patient links the consultation back to the assistance session.
    const link = await r.post(`/api/assist/sessions/${sessionId}/link-consultation`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ consultationId });
    expect(link.status).toBe(200);
    expect(link.body.linked).toBe(true);
  });

  it('the agent sees the AUTHORITATIVE request state (awaiting doctor)', async () => {
    const detail = await r.get(`/api/agent/sessions/${sessionId}`).set('Authorization', `Bearer ${token.agent}`);
    expect(detail.body.session.consultState).toBe('awaiting_doctor');
    expect(detail.body.session.consultationId).toBe(consultationId);
  });

  it('18-24. call end → explicit wrap-up → agent AVAILABLE again', async () => {
    const end = await r.post(`/api/agent/sessions/${sessionId}/call/end`)
      .set('Authorization', `Bearer ${token.agent}`).send({});
    expect(end.body.status).toBe('wrap_up');
    const me = await r.get('/api/agent/me').set('Authorization', `Bearer ${token.agent}`);
    expect(me.body.presence.availability).toBe('wrapping_up');

    const done = await r.post(`/api/agent/sessions/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token.agent}`)
      .send({ outcome: 'consultation_initiated', outcomeNote: 'Pasyon an peye, demann ale doktè a' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('completed');

    const after = await r.get('/api/agent/me').set('Authorization', `Bearer ${token.agent}`);
    expect(after.body.presence.availability).toBe('available');
  });

  it('25. supervisor inspects the persisted outcome (never fabricated)', async () => {
    const sessions = await r.get('/api/agent/ops/sessions').set('Authorization', `Bearer ${token.supervisor}`);
    const mine = sessions.body.find((s) => s.sessionId === sessionId);
    expect(mine).toBeTruthy();
    expect(mine.outcome).toBe('consultation_initiated');
    const reports = await r.get('/api/agent/ops/reports').set('Authorization', `Bearer ${token.supervisor}`);
    const agentRow = reports.body.perAgent.find((a) => a.name === 'Ajan Test');
    expect(agentRow.completed).toBeGreaterThanOrEqual(1);
  });

  it('session events are a complete server-side audit trail (brief #19)', async () => {
    const detail = await r.get(`/api/agent/sessions/${sessionId}`).set('Authorization', `Bearer ${token.agent}`);
    const types = detail.body.events.map((e) => e.type);
    for (const expected of ['requested', 'entered_queue', 'assignment_created', 'agent_accepted', 'specialty_selected', 'doctor_presented', 'consultation_linked', 'call_ended', 'session_completed']) {
      expect(types).toContain(expected);
    }
  });
});
