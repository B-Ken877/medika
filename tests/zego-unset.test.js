/**
 * ZEGOCLOUD fail-closed behavior (issue #62): when CALL_PROVIDER=zego but
 * the ZEGOCLOUD_* env vars are unset, /api/call/token answers 503 with a
 * ZEGO-specific configuration error — it must NOT silently fall back to
 * LiveKit (a misconfigured preview would otherwise look like a LiveKit
 * outage), and it must NOT leak business-rule rejections (403) when the
 * service itself is not configured.
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';
process.env.CALL_PROVIDER = 'zego';
process.env.ZEGOCLOUD_APP_ID = '';
process.env.ZEGOCLOUD_SERVER_URL = '';
process.env.ZEGOCLOUD_SERVER_SECRET = '';
// LiveKit IS configured — the provider switch must still route to zego and
// fail closed on the missing ZEGO configuration.
process.env.LIVEKIT_URL = 'wss://livekit.example.com';
process.env.LIVEKIT_API_KEY = 'testkey';
process.env.LIVEKIT_API_SECRET = 'testsecret-testsecret-testsecret-testsecret';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

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

describe('POST /api/call/token without ZEGOCLOUD configuration', () => {
  it('answers 503 with a ZEGO configuration error (never a LiveKit fallback)', async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id });
    const res = await r.post('/api/call/token')
      .set('Authorization', `Bearer ${token}`)
      .send({ consultationId: cons.id, isVideo: true });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('ZEGOCLOUD');
  });
});
