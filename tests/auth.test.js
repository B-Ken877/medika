/**
 * Auth contract tests:
 *  - login/register/admin-login issue JWTs in the legacy response shape
 *  - the legacy "token = user id" bearer is REJECTED (audit C1)
 *  - malformed / missing tokens rejected
 *  - login throttling engages after repeated failures
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users;

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
});

afterAll(async () => {
  await h.closeAll();
});

describe('POST /api/auth/login', () => {
  it('returns { token, user } with a JWT and a safe user object', async () => {
    const res = await r.post('/api/auth/login').send({ username: 't.patient', password: 'Passw0rd!' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    // JWT shape: three dot-separated base64url segments
    expect(res.body.token.split('.')).toHaveLength(3);
    expect(res.body.user.id).toBe('patient_t1');
    expect(res.body.user.role).toBe('patient');
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.body.user.is_available).toBe(1); // legacy int shape
  });

  it('rejects wrong credentials with 401', async () => {
    const res = await r.post('/api/auth/login').send({ username: 't.patient', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects missing fields with 400', async () => {
    const res = await r.post('/api/auth/login').send({ username: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('legacy bearer tokens (user ids) are invalid', () => {
  it('a raw user id as Bearer token is rejected with 401', async () => {
    const res = await r.get('/api/profile').set('Authorization', 'Bearer patient_t1');
    expect(res.status).toBe(401);
  });

  it('a doctor id as Bearer token is rejected (impersonation blocked)', async () => {
    const res = await r.get('/api/consultations').set('Authorization', 'Bearer doctor_t1');
    expect(res.status).toBe(401);
  });

  it('garbage tokens are rejected', async () => {
    const res = await r.get('/api/profile').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
  });

  it('missing header is rejected', async () => {
    const res = await r.get('/api/profile');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/register', () => {
  it('registers a patient and returns a JWT', async () => {
    const res = await r.post('/api/auth/register').send({
      username: 'new.patient', password: 'Passw0rd!', name: 'New Patient', email: 'n@t.ht',
    });
    expect(res.status).toBe(201);
    expect(res.body.token.split('.')).toHaveLength(3);
    expect(res.body.user.role).toBe('patient');
    expect(res.body.user.id).toMatch(/^patient_[0-9a-f]{8}$/);
  });

  it('rejects duplicate usernames with 409', async () => {
    const res = await r.post('/api/auth/register').send({
      username: 'new.patient', password: 'Passw0rd!', name: 'Dup',
    });
    expect(res.status).toBe(409);
  });

  it('rejects short passwords with 400 (Android-compat minimum)', async () => {
    const res = await r.post('/api/auth/register').send({
      username: 'x.patient', password: 'abc', name: 'X',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/auth/login', () => {
  it('issues a JWT for the admin account', async () => {
    const res = await r.post('/api/admin/auth/login').send({ username: 't.admin', password: 'Passw0rd!' });
    expect(res.status).toBe(200);
    expect(res.body.token.split('.')).toHaveLength(3);
    expect(res.body.user.role).toBe('admin');
  });

  it('rejects non-admin accounts with 401', async () => {
    const res = await r.post('/api/admin/auth/login').send({ username: 't.patient', password: 'Passw0rd!' });
    expect(res.status).toBe(401);
  });
});

describe('login throttling (best-effort per instance)', () => {
  it('engages 429 after repeated failures from one client', async () => {
    let saw429 = false;
    for (let i = 0; i < 15; i++) {
      const res = await r.post('/api/auth/login').send({ username: 't.patient2', password: 'nope' });
      if (res.status === 429) { saw429 = true; break; }
      expect(res.status).toBe(401);
    }
    expect(saw429).toBe(true);
  });
});
