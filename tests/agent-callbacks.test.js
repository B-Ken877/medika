/**
 * Agent operations — callback management (brief #8): idempotent creation,
 * atomic claim (two agents, one winner), retry policy (configurable max,
 * no infinite retries), connected → normal ACTIVE session.
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.REQUIRE_PAYMENT = 'true';
process.env.JWT_SECRET = 'agent-cb-test-secret-0123456789abcdef0123456789abcdef';
process.env.CALLBACK_MAX_ATTEMPTS = '2';
process.env.CALLBACK_RETRY_MINUTES = '30';

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
  token.agent2 = await h.loginToken(r, 't.agent2');
  for (const [name, t] of [['t.agent', token.agent], ['t.agent2', token.agent2]]) {
    await r.post('/api/agent/shift/start').set('Authorization', `Bearer ${t}`);
    await r.post('/api/agent/presence').set('Authorization', `Bearer ${t}`).send({ availability: 'available' });
    await r.post('/api/agent/presence/heartbeat').set('Authorization', `Bearer ${t}`).send({});
  }
});

afterAll(async () => {
  await h.closeAll();
});

describe('callback creation (brief #8)', () => {
  it('a patient requests a callback with their saved number (verified)', async () => {
    const res = await r.post('/api/assist/callbacks')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ phoneNumber: '+509 1', reason: 'Les pou m pran randevou' });
    expect(res.status).toBe(201);
    expect(res.body.phoneVerified).toBe(true);
    expect(res.body.maxRetries).toBe(2); // from CALLBACK_MAX_ATTEMPTS
  });

  it('repeated clicks are idempotent — no duplicate callbacks', async () => {
    const again = await r.post('/api/assist/callbacks')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ phoneNumber: '+509 1' });
    expect(again.status).toBe(200);
    expect(again.body.existing).toBe(true);
  });

  it('a NEW number is stored UNVERIFIED (never assumed owned)', async () => {
    const res = await r.post('/api/assist/callbacks')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ phoneNumber: '+509 37 00 0000' });
    expect(res.status).toBe(201);
    expect(res.body.phoneVerified).toBe(false);
  });

  it('an invalid number is refused', async () => {
    const res = await r.post('/api/assist/callbacks')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ phoneNumber: 'call-me' });
    expect(res.status).toBe(400);
  });

  it('the agent sees the pending callback pool with attempts', async () => {
    const res = await r.get('/api/agent/callbacks').set('Authorization', `Bearer ${token.agent}`);
    expect(res.status).toBe(200);
    expect(res.body.pool.length).toBeGreaterThanOrEqual(2);
    expect(res.body.pool[0].patientName).toBeTruthy();
  });
});

describe('callback claim + retry policy', () => {
  let callbackId;

  it('claim is ATOMIC: two agents claim, exactly one wins', async () => {
    const pool = await r.get('/api/agent/callbacks').set('Authorization', `Bearer ${token.agent}`);
    callbackId = pool.body.pool[0].callbackId;
    const [a, b] = await Promise.all([
      r.post(`/api/agent/callbacks/${callbackId}/claim`).set('Authorization', `Bearer ${token.agent}`),
      r.post(`/api/agent/callbacks/${callbackId}/claim`).set('Authorization', `Bearer ${token.agent2}`),
    ]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]);
  });

  it('no-answer follows the CONFIGURED retry policy, not infinite retries', async () => {
    // Attempt 1: no answer → back to requested, next_attempt scheduled.
    const first = await r.post(`/api/agent/callbacks/${callbackId}/result`)
      .set('Authorization', `Bearer ${token.agent}`).send({ result: 'no_answer', note: 'Pa reponn' });
    expect(first.body.connected).toBe(false);
    expect(first.body.retryCount).toBe(1);
    const view = await r.get('/api/assist/callbacks/current').set('Authorization', `Bearer ${token.patient}`);
    expect(view.body.status).toBe('requested');
    expect(view.body.retryCount).toBe(1);

    // Re-claim + attempt 2 hits the max (2) → FAILED honestly.
    const claim = await r.post(`/api/agent/callbacks/${callbackId}/claim`)
      .set('Authorization', `Bearer ${token.agent2}`);
    expect(claim.status).toBe(200);
    const second = await r.post(`/api/agent/callbacks/${callbackId}/result`)
      .set('Authorization', `Bearer ${token.agent2}`).send({ result: 'no_answer' });
    expect(second.body.connected).toBe(false);
    // The patient's CURRENT view shows only OPEN callbacks — after the max
    // retries the callback is CLOSED, so the honest answer is 'none' and a
    // NEW callback request can be created without conflict.
    const closed = await r.get('/api/assist/callbacks/current').set('Authorization', `Bearer ${token.patient}`);
    expect(closed.body.status).toBe('none');
    const fresh = await r.post('/api/assist/callbacks')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ phoneNumber: '+509 1' });
    expect(fresh.status).toBe(201);
  });

  it('a CONNECTED callback continues into a normal ACTIVE session', async () => {
    const res = await r.post('/api/assist/callbacks')
      .set('Authorization', `Bearer ${token.patient3}`)
      .send({ phoneNumber: '+509 1', reason: 'Dezyèm demann' });
    expect([200, 201]).toContain(res.status);
    const pool = await r.get('/api/agent/callbacks').set('Authorization', `Bearer ${token.agent}`);
    // Select by patient id — the pool is FIFO across patients.
    const target = pool.body.pool.find((c) => c.patientId === users.patient3.id);
    expect(target).toBeTruthy();
    const id = target.callbackId;
    await r.post(`/api/agent/callbacks/${id}/claim`).set('Authorization', `Bearer ${token.agent}`);
    const done = await r.post(`/api/agent/callbacks/${id}/result`)
      .set('Authorization', `Bearer ${token.agent}`).send({ result: 'connected' });
    expect(done.body.connected).toBe(true);
    expect(done.body.sessionId).toBeTruthy();
    // The session is ACTIVE — the agent sees it in their workspace.
    const queue = await r.get('/api/agent/queue').set('Authorization', `Bearer ${token.agent}`);
    expect(queue.body.activeSession.sessionId).toBe(done.body.sessionId);
    // Attempt history is persisted (brief #8 step 7) and the callback is
    // closed (completed) — the patient's current view honestly shows none.
    const closed = await r.get('/api/assist/callbacks/current').set('Authorization', `Bearer ${token.patient3}`);
    expect(['none', 'completed']).toContain(closed.body.status);
  });
});
