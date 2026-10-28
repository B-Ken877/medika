/**
 * Payment flow tests (simulation mode — strictly dev/sandbox only).
 *
 * Covers: MonCash contract shapes (Android PaymentActivity + web payment.ts),
 * idempotent verify, payment-gated consultation creation, amount validation,
 * double-spend prevention, fail-closed behavior without credentials, and the
 * production boot guard for simulation.
 */
'use strict';

// These MUST be set before src/config.js loads in this worker.
process.env.PAYMENT_SIMULATION = 'true';
process.env.MONCASH_MODE = 'sandbox';
process.env.REQUIRE_PAYMENT = 'true';
process.env.MONCASH_CLIENT_ID = ''; // no real credentials → provider path fails closed

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
});

afterAll(async () => {
  await h.closeAll();
});

// Issue #60: the database enforces ONE blocking consultation per patient —
// each test starts from released slots so creation tests are independent.
// The invariant itself is exercised in tests/consultation-uniqueness.test.js.
beforeEach(async () => {
  const { query } = await import('../src/db.js').then((m) => (m.default ?? m));
  await query(`UPDATE consultations SET status = 'TERMINE', updated_at = now()
                WHERE status IN ('RECHERCHE_MEDECIN','EN_COURS')`);
});

const ORDER = 'MC_1770000000000_doctor_t1';

describe('POST /payment/api/payment/create (legacy Android path)', () => {
  it('accepts the legacy mount path and returns { success, redirectUrl }', async () => {
    const res = await r.post('/payment/api/payment/create')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: ORDER, amount: 750 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.redirectUrl).toContain('/payment/simulated?orderId=');
  });

  it('also serves the canonical /api/payment/create path', async () => {
    const res = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: 'MC_other_1', amount: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects duplicate orderIds (409)', async () => {
    const res = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: ORDER, amount: 750 });
    expect(res.status).toBe(409);
  });

  it('requires authentication', async () => {
    const res = await r.post('/api/payment/create').send({ orderId: 'MC_x', amount: 100 });
    expect(res.status).toBe(401);
  });

  it('rejects invalid amounts', async () => {
    for (const amount of [0, -5, 'abc', null]) {
      const res = await r.post('/api/payment/create')
        .set('Authorization', `Bearer ${token.patient}`)
        .send({ orderId: `MC_bad_${String(Math.random())}`, amount });
      expect(res.status).toBe(400);
    }
  });
});

describe('POST /api/payment/verify (Android contract)', () => {
  it('returns { success:true, payment:{ status:"completed", transactionId } }', async () => {
    const res = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: ORDER });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payment.status).toBe('completed'); // Android checks this exact value
    expect(res.body.payment.transactionId).toMatch(/^SIM-/);
    expect(res.body.transactionId).toBe(res.body.payment.transactionId); // web alias
  });

  it('is idempotent — verifying twice returns the same transaction', async () => {
    const first = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.patient}`).send({ orderId: ORDER });
    const second = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.patient}`).send({ orderId: ORDER });
    expect(second.body.success).toBe(true);
    expect(second.body.payment.transactionId).toBe(first.body.payment.transactionId);
  });

  it('404 for unknown orders', async () => {
    const res = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.patient}`).send({ orderId: 'MC_does_not_exist' });
    expect(res.status).toBe(404);
  });

  it('a different patient cannot verify someone else\'s order', async () => {
    token.patient2 = token.patient2 || await h.loginToken(r, 't.patient2');
    const res = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.patient2}`).send({ orderId: ORDER });
    expect(res.status).toBe(404);
  });
});

describe('payment-gated consultation creation (REQUIRE_PAYMENT=true)', () => {
  it('rejects creation without payment (402)', async () => {
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ description: 'mal de tete', specialtyNeeded: 'Medecine Generale', urgencyLevel: 'Moyenne' });
    expect(res.status).toBe(402);
  });

  it('creates a consultation with a verified payment (201) and links it', async () => {
    const orderId = 'MC_gated_1';
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient}`).send({ orderId, amount: 750 });
    await r.post('/api/payment/verify').set('Authorization', `Bearer ${token.patient}`).send({ orderId });

    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ description: 'fièvre', specialtyNeeded: 'Medecine Generale', urgencyLevel: 'Moyenne', orderId, transactionId: 'SIM-x' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('RECHERCHE_MEDECIN');
    expect(res.body.id).toMatch(/^cons_/);
  });

  it('rejects an UNDERPAID verified payment (amount < specialty price)', async () => {
    const orderId = 'MC_gated_2';
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient}`).send({ orderId, amount: 100 });
    await r.post('/api/payment/verify').set('Authorization', `Bearer ${token.patient}`).send({ orderId });
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ description: 'douleur', specialtyNeeded: 'Cardiologie', urgencyLevel: 'Moyenne', orderId });
    expect(res.status).toBe(402);
    expect(res.body.error).toContain('insuffisant');
  });

  it('replays a payment already consumed by the SAME patient (issue #40 idempotency)', async () => {
    const orderId = 'MC_gated_3';
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient}`).send({ orderId, amount: 750 });
    await r.post('/api/payment/verify').set('Authorization', `Bearer ${token.patient}`).send({ orderId });
    const first = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ description: 'a', specialtyNeeded: 'Medecine Generale', orderId });
    expect(first.status).toBe(201);
    // The same logical intent retried (double-click/refresh) replays the
    // consultation that payment bought — no duplicate, no confusing 409.
    const second = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ description: 'b', specialtyNeeded: 'Medecine Generale', orderId });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.payment_replayed).toBe(true);
  });

  it('rejects a payment belonging to another patient', async () => {
    token.patient2 = token.patient2 || await h.loginToken(r, 't.patient2');
    const orderId = 'MC_gated_4';
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient2}`).send({ orderId, amount: 750 });
    await r.post('/api/payment/verify').set('Authorization', `Bearer ${token.patient2}`).send({ orderId });
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ description: 'vol', specialtyNeeded: 'Medecine Generale', orderId });
    expect(res.status).toBe(402);
    expect(res.body.error).toContain('compte');
  });

  it('doctors cannot create consultations (403)', async () => {
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ description: 'x', specialtyNeeded: 'Medecine Generale', orderId: 'whatever' });
    expect(res.status).toBe(403);
  });
});

describe('production boot guard for simulation', () => {
  it('PAYMENT_SIMULATION + NODE_ENV=production refuses to boot', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      // Re-import config in isolation is not possible in the same worker —
      // assert the guard function directly with production env.
      const configModule = await import('../src/config.js');
      const { assertProductionSafety } = configModule.default ?? configModule;
      expect(() => assertProductionSafety()).toThrow(/PAYMENT_SIMULATION/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
