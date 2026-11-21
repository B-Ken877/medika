/**
 * NO PHANTOM CONSULTATIONS — regression lock for the owner's fix.
 *
 * Historically, "Rele yon ajan" (the call-center express intake,
 * POST /api/consultations/call-center) created a REAL consultation the
 * moment the member called: empty symptoms, a hardcoded specialty, no
 * payment, no doctor — and when the member hung up before validating
 * anything, that orphan consultation sat on their dashboard. Owner ruling:
 * a consultation exists ONLY when the member validates their payment in the
 * agent-guided flow. This file pins exactly that:
 *   - the express call-center endpoint is GONE (404);
 *   - requesting assistance creates NO consultation;
 *   - hanging up (call-end → wrap-up → completed session) still creates NO
 *     consultation;
 *   - the member's own manual intake path is untouched;
 *   - the agent's combined member-form submit (symptoms + urgency +
 *     specialty) is validated in the same pass.
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.REQUIRE_PAYMENT = 'false';
process.env.JWT_SECRET = 'no-phantom-test-secret-0123456789abcdef0123456789abcdef';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.patient2 = await h.loginToken(r, 't.patient2');
  token.patient3 = await h.loginToken(r, 't.patient3');
  token.agent = await h.loginToken(r, 't.agent');
  token.admin = await h.loginToken(r, 't.admin');
  await r.post('/api/agent/ops/agents')
    .set('Authorization', `Bearer ${token.admin}`).send({ username: 't.agent', employeeRef: 'EMP-NP' });
  // One fully routable agent.
  await r.post('/api/agent/shift/start').set('Authorization', `Bearer ${token.agent}`);
  await r.post('/api/agent/presence').set('Authorization', `Bearer ${token.agent}`).send({ availability: 'available' });
  await r.post('/api/agent/presence/heartbeat').set('Authorization', `Bearer ${token.agent}`).send({});
});

afterAll(async () => {
  await h.closeAll();
});

async function consultationCount(patientToken) {
  const res = await r.get('/api/consultations').set('Authorization', `Bearer ${patientToken}`);
  expect(res.status).toBe(200);
  return Array.isArray(res.body) ? res.body.length : 0;
}

describe('the call-center express intake is GONE', () => {
  it('POST /api/consultations/call-center → 404 (the phantom-consultation generator is removed)', async () => {
    const res = await r.post('/api/consultations/call-center')
      .set('Authorization', `Bearer ${token.patient}`).send({});
    expect(res.status).toBe(404);
  });
});

describe('hanging up NEVER creates a consultation', () => {
  it('assist request → active session → still zero consultations', async () => {
    const before = await consultationCount(token.patient);
    expect(before).toBe(0);
    const reqRes = await r.post('/api/assist/requests')
      .set('Authorization', `Bearer ${token.patient}`).send({ language: 'ht' });
    expect(reqRes.status).toBe(201);
    const sessionId = reqRes.body.sessionId;
    const queue = await r.get('/api/agent/queue').set('Authorization', `Bearer ${token.agent}`);
    const offer = queue.body.offers.find((o) => o.sessionId === sessionId);
    expect(offer).toBeTruthy();
    const accept = await r.post(`/api/agent/assignments/${offer.assignmentId}/accept`)
      .set('Authorization', `Bearer ${token.agent}`);
    expect(accept.body.status).toBe('active');
    expect(await consultationCount(token.patient)).toBe(0);
  });

  it('the member hangs up before validating anything → wrap-up, still zero consultations', async () => {
    const current = await r.get('/api/assist/requests/current').set('Authorization', `Bearer ${token.patient}`);
    expect(current.body.status).toBe('connected');
    const hangUp = await r.post(`/api/assist/sessions/${current.body.sessionId}/call-end`)
      .set('Authorization', `Bearer ${token.patient}`).send({});
    expect(hangUp.status).toBe(200);
    expect(hangUp.body.status).toBe('wrap_up');
    expect(await consultationCount(token.patient)).toBe(0);
  });

  it('the agent completes the session as patient_disconnected → STILL zero consultations', async () => {
    const current = await r.get('/api/assist/requests/current').set('Authorization', `Bearer ${token.patient}`);
    const done = await r.post(`/api/agent/sessions/${current.body.sessionId}/complete`)
      .set('Authorization', `Bearer ${token.agent}`)
      .send({ outcome: 'patient_disconnected', outcomeNote: 'Moun nan dekonekte anvan peman an' });
    expect(done.status).toBe(200);
    expect(await consultationCount(token.patient)).toBe(0);
  });
});

describe('the agent submits THE MEMBER\'S FORM (symptoms + urgency + specialty in one call)', () => {
  it('the combined form submit persists the specialty and returns its price', async () => {
    // Fresh session for the second fixture patient.
    const t2 = await h.loginToken(r, 't.patient2');
    const reqRes = await r.post('/api/assist/requests')
      .set('Authorization', `Bearer ${t2}`)
      .send({ language: 'ht' });
    expect([200, 201]).toContain(reqRes.status);
    const sessionId = reqRes.body.sessionId;
    const queue = await r.get('/api/agent/queue').set('Authorization', `Bearer ${token.agent}`);
    const offer = queue.body.offers.find((o) => o.sessionId === sessionId);
    expect(offer).toBeTruthy();
    await r.post(`/api/agent/assignments/${offer.assignmentId}/accept`).set('Authorization', `Bearer ${token.agent}`);

    const intake = await r.post(`/api/agent/sessions/${sessionId}/intake`)
      .set('Authorization', `Bearer ${token.agent}`)
      .send({ description: 'Lè sistem nan fè mal depi de jou.', urgencyLevel: 'Haute', specialty: 'Cardiologie' });
    expect(intake.status).toBe(200);
    expect(intake.body.intake.urgencyLevel).toBe('Haute');
    expect(intake.body.specialty).toBe('Cardiologie');
    expect(intake.body.price).toBeGreaterThan(0);

    const detail = await r.get(`/api/agent/sessions/${sessionId}`).set('Authorization', `Bearer ${token.agent}`);
    expect(detail.body.session.specialty).toBe('Cardiologie');
    expect(detail.body.session.intake.description).toContain('sistem nan');

    // No consultation was created — only the member's validated payment does.
    expect(await consultationCount(t2)).toBe(0);
    // Close the session so the agent is routable again for the next test.
    const done = await r.post(`/api/agent/sessions/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token.agent}`)
      .send({ outcome: 'payment_pending', outcomeNote: 'E2E: fòm lan sove, peman poko fèt' });
    expect(done.status).toBe(200);
  });

  it('an unknown specialty is refused — never stored as free text', async () => {
    const t3 = await h.loginToken(r, 't.patient3');
    const reqRes = await r.post('/api/assist/requests')
      .set('Authorization', `Bearer ${t3}`).send({ language: 'ht' });
    const sessionId = reqRes.body.sessionId;
    const queue = await r.get('/api/agent/queue').set('Authorization', `Bearer ${token.agent}`);
    const offer = queue.body.offers.find((o) => o.sessionId === sessionId);
    await r.post(`/api/agent/assignments/${offer.assignmentId}/accept`).set('Authorization', `Bearer ${token.agent}`);
    const bad = await r.post(`/api/agent/sessions/${sessionId}/intake`)
      .set('Authorization', `Bearer ${token.agent}`)
      .send({ description: 'Ti malèt', urgencyLevel: 'Moyenne', specialty: 'Astroloji' });
    expect(bad.status).toBe(400);
  });
});

describe('the member\'s own manual intake path is untouched', () => {
  it('POST /api/consultations keeps channel SELF', async () => {
    const t2 = await h.loginToken(r, 't.patient2');
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${t2}`)
      .send({ description: 'Manual intake', specialtyNeeded: 'Medecine Generale', urgencyLevel: 'Moyenne' });
    expect(res.status).toBe(201);
    expect(res.body.channel).toBe('SELF');
  });
});
