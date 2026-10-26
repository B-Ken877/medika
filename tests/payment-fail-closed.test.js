/**
 * Payment fail-closed tests — simulation DISABLED (the default everywhere).
 *
 * Worker env: NO PAYMENT_SIMULATION, no MonCash credentials, REQUIRE_PAYMENT
 * enabled. Proves the ordinary flow is preserved and that nothing a client
 * sends can flip the server into simulation mode.
 *
 * Covers: mode discovery reports false, client-supplied simulation flags are
 * ignored (the REAL MonCash branch runs — 503 without credentials, never a
 * simulated success), the /payment/simulated page is unreachable, a simulated
 * payment row cannot be verified while simulation is off, fabricated
 * transaction ids cannot buy a consultation, and the boot guard stays silent
 * when PAYMENT_SIMULATION is simply unset.
 */
'use strict';

// These MUST be set before src/config.js loads in this worker.
process.env.REQUIRE_PAYMENT = 'true';
process.env.MONCASH_CLIENT_ID = '';
process.env.MONCASH_CLIENT_SECRET = '';
// PAYMENT_SIMULATION deliberately NOT set — simulation disabled (the default).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
});

afterAll(async () => {
  await h.closeAll();
});

describe('simulation disabled (default) — mode discovery', () => {
  it('GET /api/payment/config reports { simulated: false }', async () => {
    const res = await r.get('/api/payment/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ simulated: false });
  });
});

describe('client-supplied simulation flags are never trusted', () => {
  it('POST /create with simulated/test flags still takes the REAL branch (503, no credentials)', async () => {
    const res = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({
        orderId: 'MC_real_1',
        amount: 750,
        simulated: true,
        test: true,
        forceSimulation: true,
        sandbox: true,
        preview: true,
      });
    // The real branch ran: without MonCash credentials it fails closed with
    // the provider-unavailable response — and NEVER a simulated success.
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.simulated).toBeUndefined();
    expect(res.body.redirectUrl).toBeUndefined();
  });

  it('a simulated payment row cannot be VERIFIED while simulation is disabled (fail closed)', async () => {
    // A row flagged simulated=true exists (e.g. created earlier on a preview
    // deployment). With simulation off, verify must NOT auto-confirm it.
    const paymentsRepo = await import('../src/repos/payments.js').then((m) => m.default ?? m);
    await paymentsRepo.create({ order_id: 'MC_stale_sim', patient_id: users.patient.id, amount: 750, simulated: true });

    const res = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: 'MC_stale_sim' });
    expect(res.status).toBe(503); // falls through to the real branch → no credentials → fail closed
    expect(res.body.success).toBe(false); // never a verified/simulated confirmation
  });

  it('GET /payment/simulated is unreachable (404)', async () => {
    const res = await r.get('/payment/simulated?orderId=whatever');
    expect(res.status).toBe(404);
  });
});

describe('payment gating stays intact without simulation', () => {
  it('a fabricated client-side transaction id cannot buy a consultation (fail closed)', async () => {
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({
        description: 'ezzay',
        specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne',
        transactionId: 'SANDBOX_TEST_1234567890', // the removed client-side fake pattern
        paymentAmount: 750,
        orderId: 'MC_fabricated',
      });
    // Unknown order + client-supplied transaction id → the server tries the
    // provider path (never trusts the client) → no credentials → 503.
    expect(res.status).toBe(503);
    // And no consultation was created for the patient.
    const list = await r.get('/api/consultations').set('Authorization', `Bearer ${token.patient}`);
    expect(list.status).toBe(200);
    expect((list.body || []).some((c) => c.description === 'ezzay')).toBe(false);
  });

  it('consultation without any payment metadata is still rejected (402)', async () => {
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ description: 'mal de tete', specialtyNeeded: 'Medecine Generale', urgencyLevel: 'Moyenne' });
    expect(res.status).toBe(402);
  });
});

describe('boot guard stays silent when PAYMENT_SIMULATION is unset', () => {
  it('NODE_ENV=production + no simulation flag raises no PAYMENT_SIMULATION problem', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevJwt = process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';
    // Satisfy the unrelated production checks (JWT strength; DATABASE_URL
    // comes from the global setup) so ONLY the simulation flag is exercised.
    process.env.JWT_SECRET = 'fail-closed-test-secret-0123456789abcdef';
    try {
      const configModule = await import('../src/config.js');
      const { assertProductionSafety } = configModule.default ?? configModule;
      // PAYMENT_SIMULATION is unset in this worker → the guard must not
      // refuse to boot.
      expect(() => assertProductionSafety()).not.toThrow();
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevJwt;
    }
  });
});
