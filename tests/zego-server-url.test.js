/**
 * ZEGOCLOUD_SERVER_URL fail-closed format gate (issue #68).
 *
 * The browser builds `new ZegoExpressEngine(appId, server)` from the token
 * response's `url` field. A non-WebSocket value (an https:// console page, a
 * dashboard URL, a typo) would otherwise mint a token the engine cannot use
 * and fail opaquely at runtime — the issue requires an invalid configuration
 * to produce a CLEAR SAFE ERROR instead. These tests lock that behavior:
 * 503 with an actionable message naming the env var, no token minted, no
 * fallback provider.
 *
 * This file's module registry is fresh (vitest worker isolation), so the
 * intentionally WRONG `ZEGOCLOUD_SERVER_URL` set below is what the server
 * snapshot sees — mirroring how tests/zego-unset.test.js covers the
 * missing-configuration case. Values are throwaway test values, never
 * production credentials.
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';
process.env.ZEGOCLOUD_APP_ID = '123456789';
// WRONG SCHEME on purpose: an https:// endpoint is a valid URL but is NOT a
// WebSocket endpoint the engine can connect to.
process.env.ZEGOCLOUD_SERVER_URL = 'https://webliveroom-test.example.com/ws';
process.env.ZEGOCLOUD_SERVER_SECRET = '0123456789abcdef0123456789abcdef';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');
const callRoutes = (await import('../src/routes/call.js')).default;
const zegoServerUrlProblem = callRoutes.zegoServerUrlProblem;

let r, users, token;

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token = await h.loginToken(r, 't.patient');
});

afterAll(async () => {
  await h.closeAll();
});

describe('zegoServerUrlProblem (fail-closed format gate)', () => {
  it('accepts the official wss:// console endpoint form', () => {
    expect(zegoServerUrlProblem('wss://webliveroom1234567-api.zegocloud.com/ws')).toBeNull();
  });

  it('accepts ws:// for local development only', () => {
    expect(zegoServerUrlProblem('ws://localhost:8787/ws')).toBeNull();
  });

  it('rejects an https:// endpoint with a clear actionable error', () => {
    const problem = zegoServerUrlProblem('https://webliveroom-test.example.com/ws');
    expect(problem).toContain('ZEGOCLOUD_SERVER_URL');
    expect(problem).toContain('wss://');
  });

  it('rejects a value with no scheme at all', () => {
    expect(zegoServerUrlProblem('webliveroom1234567-api.zegocloud.com/ws')).toContain(
      'ZEGOCLOUD_SERVER_URL',
    );
  });

  it('rejects unrelated garbage without echoing the value', () => {
    const problem = zegoServerUrlProblem('not a url at all');
    expect(problem).toContain('ZEGOCLOUD_SERVER_URL');
    expect(problem).not.toContain('not a url at all');
  });
});

describe('POST /api/call/token with a non-WebSocket ZEGOCLOUD_SERVER_URL', () => {
  it('answers 503 with the clear configuration error after membership passes', async () => {
    const cons = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    const res = await r.post('/api/call/token')
      .set('Authorization', `Bearer ${token}`)
      .send({ consultationId: cons.id, isVideo: true });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('ZEGOCLOUD_SERVER_URL');
    expect(res.body.error).toContain('wss://');
  });

  it('never mints a token and never falls back to another provider', async () => {
    const cons = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    const res = await r.post('/api/call/token')
      .set('Authorization', `Bearer ${token}`)
      .send({ consultationId: cons.id, isVideo: true });
    expect(res.body.token).toBeUndefined();
    expect(res.body.provider).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('livekit');
  });
});
