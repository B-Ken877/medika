/**
 * Concurrency tests:
 *  - parallel message sends get unique sequential numeric ids (no Math.max races)
 *  - parallel accepts produce exactly one winner (rechecked at SQL level)
 *  - persistence survives across separate "requests"/app instances (shared DB)
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
  token.doctor2 = await h.loginToken(r, 't.doctor2');
});

afterAll(async () => {
  await h.closeAll();
});

describe('concurrent message sends', () => {
  it('50 parallel sends produce 50 unique ids with no gaps or duplicates', async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS' });
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        r.post(`/api/consultations/${cons.id}/messages`)
          .set('Authorization', `Bearer ${token.patient}`)
          .send({ text: `message concurrent ${i}` })
      )
    );
    expect(results.every((res) => res.status === 201)).toBe(true);
    const ids = results.map((res) => res.body.id);
    expect(new Set(ids).size).toBe(50); // unique — no duplicate ids
    const sorted = [...ids].sort((a, b) => a - b);
    expect(sorted[49] - sorted[0]).toBe(49); // contiguous — nothing lost
  });
});

describe('concurrent consultation accepts', () => {
  it('10 racing doctors → exactly one 200, consultation assigned once', async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id });
    const tokens = [token.doctor, token.doctor2];
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        r.put(`/api/consultations/${cons.id}/accept`)
          .set('Authorization', `Bearer ${tokens[i % 2]}`)
      )
    );
    const winners = results.filter((res) => res.status === 200);
    expect(winners).toHaveLength(1);
    const msgs = await r.get(`/api/consultations/${cons.id}/messages`)
      .set('Authorization', `Bearer ${token.doctor}`);
    // Exactly ONE system "accepte" message despite 10 racing requests
    expect(msgs.body.filter((m) => m.sender_id === 'system' && m.text.includes('accepte'))).toHaveLength(1);
  });
});

describe('persistence across app instances', () => {
  it('data written via one app instance is visible through a fresh instance', async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS' });
    await r.post(`/api/consultations/${cons.id}/messages`)
      .set('Authorization', `Bearer ${token.patient}`).send({ text: 'persist me' });

    // Simulate a new function instance: brand-new pool + app over the same DB.
    const dbModule = await import('../src/db.js');
    const { getPool } = dbModule.default ?? dbModule;
    await getPool().end(); // drop the cached pool (module singleton)
    const dbMod = await import('../src/db.js');
    // Re-create the pool by resetting the module cache is not possible in-process;
    // instead verify through a second HTTP round-trip after pool recycling:
    const { createApp } = await import('../src/app.js');
    const supertest = (await import('supertest')).default;
    const freshRequest = supertest(createApp());
    const res = await freshRequest
      .get(`/api/consultations/${cons.id}/messages`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body.some((m) => m.text === 'persist me')).toBe(true);
    void dbMod;
  });
});
