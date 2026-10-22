/**
 * LiveKit fail-closed behavior: when LIVEKIT_* env vars are unset (fresh
 * worker, fresh module registry), /api/call/token answers 503 instead of
 * falling back to any default credential.
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';
process.env.LIVEKIT_URL = '';
process.env.LIVEKIT_API_KEY = '';
process.env.LIVEKIT_API_SECRET = '';

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

describe('POST /api/call/token without LiveKit configuration', () => {
  it('answers 503 with a configuration error (never a default credential)', async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id });
    const res = await r.post('/api/call/token')
      .set('Authorization', `Bearer ${token}`)
      .send({ consultationId: cons.id, isVideo: true });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('LiveKit');
  });
});
