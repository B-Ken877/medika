/**
 * Agent-initiated payment requests — END-TO-END (migration 017, owner brief).
 *
 * The agent answers the call, fills the intake ON BEHALF of the member
 * (reason, what they feel, urgency), searches the member's PREFERRED doctor
 * by name, clicks "Submit Payment" — and the member's device receives the
 * payment request (amount + phone + 4-digit PIN, MonCash-style, SIMULATED).
 * On Pay: the payment verifies through the strictly isolated simulation, the
 * consultation is created FOR THE MEMBER from the agent-captured intake,
 * linked to the session, and both sides are notified. The call is never
 * touched. Covers: validation, idempotent replay, one-active conflict,
 * cancel, expiry, and the admin workforce endpoints.
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.REQUIRE_PAYMENT = 'true';
process.env.PAYMENT_SIMULATION_OPEN = 'true'; // beta: everyone can simulate
process.env.JWT_SECRET = 'agent-payment-test-secret-0123456789abcdef0123456789abcdef';

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
  token.supervisor = await h.loginToken(r, 't.supervisor');
  token.admin = await h.loginToken(r, 't.admin');
  // Authorize the agent profile (reports join agent_profiles).
  await r.post('/api/agent/ops/agents')
    .set('Authorization', `Bearer ${token.admin}`).send({ username: 't.agent', employeeRef: 'EMP-9' });
  // One fully routable agent.
  await r.post('/api/agent/shift/start').set('Authorization', `Bearer ${token.agent}`);
  await r.post('/api/agent/presence').set('Authorization', `Bearer ${token.agent}`).send({ availability: 'available' });
  await r.post('/api/agent/presence/heartbeat').set('Authorization', `Bearer ${token.agent}`).send({});
});

afterAll(async () => {
  await h.closeAll();
});

/** Walk a session from assist request to an ACTIVE session for a patient. */
async function openActiveSession(patientToken) {
  const reqRes = await r.post('/api/assist/requests')
    .set('Authorization', `Bearer ${patientToken}`).send({ language: 'ht' });
  expect(reqRes.status).toBe(201);
  const sessionId = reqRes.body.sessionId;
  const queue = await r.get('/api/agent/queue').set('Authorization', `Bearer ${token.agent}`);
  const offer = queue.body.offers.find((o) => o.sessionId === sessionId);
  expect(offer).toBeTruthy();
  const accept = await r.post(`/api/agent/assignments/${offer.assignmentId}/accept`)
    .set('Authorization', `Bearer ${token.agent}`);
  expect(accept.body.status).toBe('active');
  return sessionId;
}

describe('agent-initiated payment request journey (migration 017)', () => {
  let sessionId, requestId, consultationId, price;

  it('live session: assist request → offer → accept (the call is answered)', async () => {
    sessionId = await openActiveSession(token.patient);
    const detail = await r.get(`/api/agent/sessions/${sessionId}`).set('Authorization', `Bearer ${token.agent}`);
    expect(detail.status).toBe(200);
    expect(detail.body.paymentRequest).toBeNull();
    expect(detail.body.session.intake.description).toBe('');
  });

  it('intake ON BEHALF of the member: reason + symptoms + urgency persist', async () => {
    const intake = await r.post(`/api/agent/sessions/${sessionId}/intake`)
      .set('Authorization', `Bearer ${token.agent}`)
      .send({
        reason: 'Vizit jeneral — pasyan an rele sèvi',
        description: 'Lè sistem nan fè mal depi de jou, ak lafyèv.',
        urgencyLevel: 'Haute',
      });
    expect(intake.status).toBe(200);
    expect(intake.body.intake.urgencyLevel).toBe('Haute');
    const detail = await r.get(`/api/agent/sessions/${sessionId}`).set('Authorization', `Bearer ${token.agent}`);
    expect(detail.body.session.intake.description).toContain('lafyèv');
    expect(detail.body.session.intake.urgencyLevel).toBe('Haute');
    expect(detail.body.session.intake.reason).toContain('Vizit jeneral');
    expect(detail.body.events.map((e) => e.type)).toContain('intake_recorded');
  });

  it('urgency validation: only the raw internal values are accepted', async () => {
    const bad = await r.post(`/api/agent/sessions/${sessionId}/intake`)
      .set('Authorization', `Bearer ${token.agent}`).send({ urgencyLevel: 'Extremely urgent' });
    expect(bad.status).toBe(400);
    // No description → nothing overwritten by the failed call.
    const detail = await r.get(`/api/agent/sessions/${sessionId}`).set('Authorization', `Bearer ${token.agent}`);
    expect(detail.body.session.intake.description).toContain('lafyèv');
  });

  it('specialty + PREFERRED-doctor search by name + doctor pick', async () => {
    const specialties = await r.get('/api/agent/specialties').set('Authorization', `Bearer ${token.agent}`);
    const cardio = specialties.body.find((s) => s.name === 'Cardiologie');
    expect(cardio).toBeTruthy();
    price = cardio.price;
    const sel = await r.post(`/api/agent/sessions/${sessionId}/specialty`)
      .set('Authorization', `Bearer ${token.agent}`).send({ specialty: 'Cardiologie' });
    expect(sel.body.price).toBe(price);

    // Preferred doctor: the member names the doctor; the agent searches by
    // name across ALL specialties.
    const search = await r.get('/api/agent/doctors?q=deux').set('Authorization', `Bearer ${token.agent}`);
    expect(search.status).toBe(200);
    expect(search.body.some((d) => d.id === users.doctor2.id)).toBe(true);
    const scopedMiss = await r.get('/api/agent/doctors?specialty=Cardiologie&q=zzz-inconnu')
      .set('Authorization', `Bearer ${token.agent}`);
    expect(scopedMiss.body.length).toBe(0);

    const pick = await r.post(`/api/agent/sessions/${sessionId}/doctor`)
      .set('Authorization', `Bearer ${token.agent}`).send({ doctorId: users.doctor2.id });
    expect(pick.status).toBe(200);
  });

  it('agent clicks Submit Payment → pending request with the specialty price', async () => {
    const created = await r.post(`/api/agent/sessions/${sessionId}/payment-request`)
      .set('Authorization', `Bearer ${token.agent}`).send({});
    expect(created.status).toBe(201);
    requestId = created.body.id;
    expect(created.body.status).toBe('pending');
    expect(created.body.amount).toBe(price);
    expect(created.body.currency).toBe('HTG');
    expect(created.body.doctorId).toBe(users.doctor2.id);
    expect(created.body.expiresAt).toBeTruthy();
    // Only ONE pending request per member (the device popup is unambiguous).
    const dup = await r.post(`/api/agent/sessions/${sessionId}/payment-request`)
      .set('Authorization', `Bearer ${token.agent}`).send({});
    expect(dup.status).toBe(409);
    // The session detail carries the live payment state.
    const detail = await r.get(`/api/agent/sessions/${sessionId}`).set('Authorization', `Bearer ${token.agent}`);
    expect(detail.body.paymentRequest.id).toBe(requestId);
    expect(detail.body.paymentRequest.status).toBe('pending');
  });

  it('the member sees the pending request on their device', async () => {
    const current = await r.get('/api/assist/payment-requests/current')
      .set('Authorization', `Bearer ${token.patient}`);
    expect(current.status).toBe(200);
    expect(current.body.id).toBe(requestId);
    expect(current.body.status).toBe('pending');
    expect(current.body.amount).toBe(price);
    expect(current.body.specialty).toBe('Cardiologie');
    expect(current.body.doctorName).toBe('Dr Deux');
    expect(current.body.agentName).toBeTruthy();
    expect(current.body.expiresAt).toBeTruthy();
  });

  it('another member can neither see nor pay someone else’s request', async () => {
    const other = await r.get('/api/assist/payment-requests/current')
      .set('Authorization', `Bearer ${token.patient2}`);
    expect(other.body.status).toBe('none');
    const foreign = await r.post(`/api/assist/payment-requests/${requestId}/confirm`)
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ phoneNumber: '+509 3712 0000', pin: '1234' });
    expect(foreign.status).toBe(404);
  });

  it('validation: 4-digit PIN + phone format enforced', async () => {
    const shortPin = await r.post(`/api/assist/payment-requests/${requestId}/confirm`)
      .set('Authorization', `Bearer ${token.patient}`).send({ phoneNumber: '+509 3712 3456', pin: '12' });
    expect(shortPin.status).toBe(400);
    const badPhone = await r.post(`/api/assist/payment-requests/${requestId}/confirm`)
      .set('Authorization', `Bearer ${token.patient}`).send({ phoneNumber: 'appa', pin: '1234' });
    expect(badPhone.status).toBe(400);
  });

  it('member pays → consultation created FOR THE MEMBER, session linked, agent notified', async () => {
    const confirm = await r.post(`/api/assist/payment-requests/${requestId}/confirm`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ phoneNumber: '+509 3712 3456', pin: '1234' });
    expect(confirm.status).toBe(201);
    expect(confirm.body.success).toBe(true);
    expect(confirm.body.transactionId).toMatch(/^SIM-/);
    consultationId = confirm.body.consultationId;
    expect(consultationId).toBeTruthy();

    // The consultation belongs to the member and carries the AGENT-captured
    // intake + the picked doctor + the AGENT channel.
    const cons = await r.get(`/api/consultations/${consultationId}`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(cons.status).toBe(200);
    expect(cons.body.patient_id).toBe('patient_t1');
    expect(cons.body.description).toContain('lafyèv');
    expect(cons.body.urgency_level).toBe('Haute');
    expect(cons.body.specialty_needed).toBe('Cardiologie');
    expect(cons.body.doctor_id).toBe(users.doctor2.id);
    expect(cons.body.channel).toBe('AGENT');

    // The request is paid, the session is linked, the consult state advanced.
    const detail = await r.get(`/api/agent/sessions/${sessionId}`).set('Authorization', `Bearer ${token.agent}`);
    expect(detail.body.paymentRequest.status).toBe('paid');
    expect(detail.body.paymentRequest.consultationId).toBe(consultationId);
    expect(detail.body.session.consultState).toBe('awaiting_doctor');
    expect(detail.body.session.consultationId).toBe(consultationId);
    const types = detail.body.events.map((e) => e.type);
    for (const expected of ['intake_recorded', 'payment_request_created', 'consultation_linked']) {
      expect(types).toContain(expected);
    }
  });

  it('idempotent: paying again replays the SAME consultation', async () => {
    const again = await r.post(`/api/assist/payment-requests/${requestId}/confirm`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ phoneNumber: '+509 3712 3456', pin: '1234' });
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.consultationId).toBe(consultationId);
  });

  it('call end → wrap-up → complete → the agent is routable again', async () => {
    const end = await r.post(`/api/agent/sessions/${sessionId}/call/end`)
      .set('Authorization', `Bearer ${token.agent}`).send({});
    expect(end.body.status).toBe('wrap_up');
    const done = await r.post(`/api/agent/sessions/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token.agent}`)
      .send({ outcome: 'consultation_initiated', outcomeNote: 'Peman asiste pa ajan konfime' });
    expect(done.status).toBe(200);
    const me = await r.get('/api/agent/me').set('Authorization', `Bearer ${token.agent}`);
    expect(me.body.presence.availability).toBe('available');
  });

  it('conflict journey: intake-less request refused, then one-active 409, cancel, expiry', async () => {
    // Second live session (the agent is routable again).
    const s2 = await openActiveSession(token.patient3);

    // Submit Payment WITHOUT intake → refused (the form must be filled first).
    const noIntake = await r.post(`/api/agent/sessions/${s2}/payment-request`)
      .set('Authorization', `Bearer ${token.agent}`).send({});
    expect(noIntake.status).toBe(409);
    expect(noIntake.body.error).toMatch(/entèvyou/i);

    // Intake + specialty, but the member ALREADY has a blocking consultation.
    await r.post(`/api/agent/sessions/${s2}/intake`)
      .set('Authorization', `Bearer ${token.agent}`)
      .send({ description: 'Tèt li fè mal', urgencyLevel: 'Moyenne' });
    await r.post(`/api/agent/sessions/${s2}/specialty`)
      .set('Authorization', `Bearer ${token.agent}`).send({ specialty: 'Medecine Generale' });
    await h.createConsultationFixture({ patientId: 'patient_t3' });

    const req2 = await r.post(`/api/agent/sessions/${s2}/payment-request`)
      .set('Authorization', `Bearer ${token.agent}`).send({});
    expect(req2.status).toBe(201);
    const confirm2 = await r.post(`/api/assist/payment-requests/${req2.body.id}/confirm`)
      .set('Authorization', `Bearer ${token.patient3}`)
      .send({ phoneNumber: '+509 3812 0000', pin: '4321' });
    expect(confirm2.status).toBe(409);
    expect(confirm2.body.existing_id).toBeTruthy();

    // The request stays pending (the verified payment is kept for
    // reconciliation) → the agent cancels it, the member's popup clears.
    const cancel = await r.post(`/api/agent/sessions/${s2}/payment-request/cancel`)
      .set('Authorization', `Bearer ${token.agent}`).send({});
    expect(cancel.status).toBe(200);
    const afterCancel = await r.get('/api/assist/payment-requests/current')
      .set('Authorization', `Bearer ${token.patient3}`);
    expect(afterCancel.body.status).toBe('none');

    // Re-request works after cancel; an expired request cannot be paid.
    const req3 = await r.post(`/api/agent/sessions/${s2}/payment-request`)
      .set('Authorization', `Bearer ${token.agent}`).send({});
    expect(req3.status).toBe(201);
    const { query } = await import('../src/db.js');
    await query(`UPDATE agent_payment_requests SET expires_at = now() - interval '1 second' WHERE id = $1`, [req3.body.id]);
    const expired = await r.post(`/api/assist/payment-requests/${req3.body.id}/confirm`)
      .set('Authorization', `Bearer ${token.patient3}`)
      .send({ phoneNumber: '+509 3812 0000', pin: '4321' });
    expect(expired.status).toBe(409);
    expect(expired.body.status).toBe('expired');

    // Clean up this journey: end + complete so the board sees the agent free.
    await r.post(`/api/agent/sessions/${s2}/call/end`).set('Authorization', `Bearer ${token.agent}`).send({});
    await r.post(`/api/agent/sessions/${s2}/complete`)
      .set('Authorization', `Bearer ${token.agent}`)
      .send({ outcome: 'patient_cancelled' });
  });

  it('admin: creates NEW agent accounts, duplicates refused, live workforce board', async () => {
    const create = await r.post('/api/admin/agents')
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ username: 'new.agent', name: 'Nouvo Ajan', password: 'Passw0rd!23', employeeRef: 'EMP-77' });
    expect(create.status).toBe(201);
    expect(create.body.role).toBe('agent');

    // The new account can actually log in and reach the agent API.
    const login = await r.post('/api/auth/login').send({ username: 'new.agent', password: 'Passw0rd!23' });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('agent');
    const me = await r.get('/api/agent/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);

    const dup = await r.post('/api/admin/agents')
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ username: 'new.agent', name: 'X', password: 'Passw0rd!23' });
    expect(dup.status).toBe(409);
    const weak = await r.post('/api/admin/agents')
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ username: 'weak.pw', name: 'X', password: '123' });
    expect(weak.status).toBe(400);
    const forbidden = await r.post('/api/admin/agents')
      .set('Authorization', `Bearer ${token.agent}`)
      .send({ username: 'nope.agent', name: 'X', password: 'Passw0rd!23' });
    expect(forbidden.status).toBe(403);

    const board = await r.get('/api/admin/agents').set('Authorization', `Bearer ${token.admin}`);
    expect(board.status).toBe(200);
    const row = board.body.find((a) => a.agentId === 'agent_t1');
    expect(row).toBeTruthy();
    expect(row.availability).toBe('available');
    expect(row.onCall).toBe(false);
    expect(row.todayCompleted).toBeGreaterThanOrEqual(2);
    expect(board.body.some((a) => a.username === 'new.agent')).toBe(true);
  });

  it('supervisor ops view still works end-to-end (regression guard)', async () => {
    const overview = await r.get('/api/agent/ops/overview').set('Authorization', `Bearer ${token.supervisor}`);
    expect(overview.status).toBe(200);
    const sessions = await r.get('/api/agent/ops/sessions').set('Authorization', `Bearer ${token.supervisor}`);
    const mine = sessions.body.find((s) => s.sessionId === sessionId);
    expect(mine.outcome).toBe('consultation_initiated');
  });
});
