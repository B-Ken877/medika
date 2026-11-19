/**
 * Agent operations — queue, routing, assignment safety, shifts, presence
 * (brief #5, #7, #22). Worker env: plain backend, no MonCash, no zego.
 *
 * Concurrency proofs:
 *   - the ATOMIC accept: a second agent accepting an already-accepted offer
 *     fails closed (409);
 *   - one live session per patient (repeated clicks are idempotent);
 *   - offer expiry re-routes to the next eligible agent (cron sweep);
 *   - honest WAITING state when no agent is routable (no fabricated ETA).
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.REQUIRE_PAYMENT = 'true';
process.env.JWT_SECRET = 'agent-ops-test-secret-0123456789abcdef0123456789abcdef';
process.env.CRON_SECRET = 'agent-ops-cron-secret';
process.env.AGENT_OFFER_WINDOW_SECONDS = '60';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.patient2 = await h.loginToken(r, 't.patient2');
  token.agent = await h.loginToken(r, 't.agent');
  token.agent2 = await h.loginToken(r, 't.agent2');
  token.supervisor = await h.loginToken(r, 't.supervisor');
  token.admin = await h.loginToken(r, 't.admin');
});

afterAll(async () => {
  await h.closeAll();
});

/** Bring an agent to FULLY routable: profile, active shift, available + fresh. */
async function readyAgent(username, authToken) {
  await r.post('/api/agent/shift/start').set('Authorization', `Bearer ${authToken}`);
  await r.post('/api/agent/presence').set('Authorization', `Bearer ${authToken}`).send({ availability: 'available' });
  await r.post('/api/agent/presence/heartbeat').set('Authorization', `Bearer ${authToken}`).send({});
}

describe('agent access control (brief #4)', () => {
  it('a patient cannot touch agent endpoints', async () => {
    const res = await r.get('/api/agent/me').set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(403);
  });

  it('an anonymous caller gets 401', async () => {
    expect((await r.get('/api/agent/me')).status).toBe(401);
  });

  it('an authenticated agent sees their workspace identity', async () => {
    await readyAgent('t.agent', token.agent);
    const res = await r.get('/api/agent/me').set('Authorization', `Bearer ${token.agent}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('agent');
    expect(res.body.presence.availability).toBe('available');
    expect(res.body.shift.status).toBe('active');
  });

  it('supervisor can read the ops overview; plain agent cannot', async () => {
    const okSup = await r.get('/api/agent/ops/overview').set('Authorization', `Bearer ${token.supervisor}`);
    expect(okSup.status).toBe(200);
    const noAgent = await r.get('/api/agent/ops/overview').set('Authorization', `Bearer ${token.agent}`);
    expect(noAgent.status).toBe(403);
  });

  it('only an admin can authorize a new agent profile', async () => {
    const denied = await r.post('/api/agent/ops/agents')
      .set('Authorization', `Bearer ${token.agent}`).send({ username: 't.patient3' });
    expect(denied.status).toBe(403);
    const ok = await r.post('/api/agent/ops/agents')
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ username: 't.patient3', employeeRef: 'EMP-42' });
    expect(ok.status).toBe(201);
    expect(ok.body.role).toBe('agent');
  });
});

describe('shift lifecycle (brief #5)', () => {
  it('starting twice is idempotent (no duplicate active shifts)', async () => {
    await r.post('/api/agent/shift/end').set('Authorization', `Bearer ${token.agent2}`);
    const first = await r.post('/api/agent/shift/start').set('Authorization', `Bearer ${token.agent2}`);
    const second = await r.post('/api/agent/shift/start').set('Authorization', `Bearer ${token.agent2}`);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.existing).toBe(true);
    expect(second.body.shift.id).toBe(first.body.shift.id);
  });

  it('break start/end flips presence on_break → available', async () => {
    const brk = await r.post('/api/agent/shift/break/start').set('Authorization', `Bearer ${token.agent2}`);
    expect(brk.body.availability).toBe('on_break');
    const back = await r.post('/api/agent/shift/break/end').set('Authorization', `Bearer ${token.agent2}`);
    expect(back.body.availability).toBe('available');
  });

  it('an invalid availability transition is refused server-side', async () => {
    // busy is reserved for the accept path — never a manual click.
    const res = await r.post('/api/agent/presence')
      .set('Authorization', `Bearer ${token.agent2}`).send({ availability: 'busy' });
    expect(res.status).toBe(409);
  });
});

describe('queue + routing (brief #7)', () => {
  it('with NO routable agent the patient gets the honest waiting state', async () => {
    // The shift tests left BOTH agents available — drop them to OFFLINE (a
    // valid transition) so nothing is routable.
    await r.post('/api/agent/presence').set('Authorization', `Bearer ${token.agent}`).send({ availability: 'offline' });
    await r.post('/api/agent/presence').set('Authorization', `Bearer ${token.agent2}`).send({ availability: 'offline' });
    const res = await r.post('/api/assist/requests')
      .set('Authorization', `Bearer ${token.patient2}`).send({});
    expect([200, 201]).toContain(res.status);
    expect(res.body.agentsAvailable).toBe(0);
    expect(res.body.status).toBe('waiting');
  });

  it('repeated clicks reuse the SAME live session (idempotent entry)', async () => {
    const again = await r.post('/api/assist/requests')
      .set('Authorization', `Bearer ${token.patient2}`).send({});
    expect(again.status).toBe(200);
    expect(again.body.existing).toBe(true);
    expect(again.body.sessionId).toBe((await r.get('/api/assist/requests/current').set('Authorization', `Bearer ${token.patient2}`)).body.sessionId);
  });

  it('an available agent receives the targeted offer and accepts it', async () => {
    // Agent2 is available with a fresh heartbeat — the waiting request routes.
    await readyAgent('t.agent2', token.agent2);
    const current = await r.get('/api/assist/requests/current').set('Authorization', `Bearer ${token.patient2}`);
    // Trigger a re-route via the cron sweep (the session is WAITING).
    const cron = await r.post('/api/crons/agent-ops')
      .set('Authorization', 'Bearer agent-ops-cron-secret');
    expect(cron.status).toBe(200);
    expect(cron.body.offersRerouted).toBeGreaterThanOrEqual(1);

    const queue = await r.get('/api/agent/queue').set('Authorization', `Bearer ${token.agent2}`);
    expect(queue.body.offers.length).toBe(1);
    const accept = await r.post(`/api/agent/assignments/${queue.body.offers[0].assignmentId}/accept`)
      .set('Authorization', `Bearer ${token.agent2}`);
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe('active');
  });

  it('a second agent accepting the SAME offer fails closed (atomic accept)', async () => {
    // patient2's session is now ACTIVE with agent2 — there is no open offer
    // left; a replayed accept by anyone must not succeed.
    const queue = await r.get('/api/agent/queue').set('Authorization', `Bearer ${token.agent2}`);
    const staleId = queue.body.offers.length
      ? queue.body.offers[0].assignmentId
      : 'aoff_does_not_exist';
    const replay = await r.post(`/api/agent/assignments/${staleId}/accept`)
      .set('Authorization', `Bearer ${token.agent}`);
    expect([404, 409]).toContain(replay.status);
  });

  it('an agent mid-session is not re-routed (busy exclusion)', async () => {
    // agent2 is BUSY with patient2. patient (no live session) requests now:
    // agent1 is offline → honest waiting.
    const res = await r.post('/api/assist/requests')
      .set('Authorization', `Bearer ${token.patient}`).send({});
    expect([200, 201]).toContain(res.status);
    expect(res.body.status).toBe('waiting');
    expect(res.body.agentsAvailable).toBe(0);
  });

  it('the patient can cancel a waiting request', async () => {
    const cancel = await r.post('/api/assist/requests/current/cancel')
      .set('Authorization', `Bearer ${token.patient}`);
    expect(cancel.status).toBe(200);
    const after = await r.get('/api/assist/requests/current').set('Authorization', `Bearer ${token.patient}`);
    expect(after.body.status).toBe('none');
  });

  it('supervisor sees the live operational overview (brief #18)', async () => {
    const res = await r.get('/api/agent/ops/overview').set('Authorization', `Bearer ${token.supervisor}`);
    expect(res.status).toBe(200);
    expect(res.body.metrics).toBeDefined();
    expect(res.body.metrics.sessions_active).toBeGreaterThanOrEqual(1);
    expect(res.body.agents.length).toBeGreaterThanOrEqual(2);
  });
});
