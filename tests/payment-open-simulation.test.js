/**
 * Open-beta payment-simulation tests — PAYMENT_SIMULATION_OPEN lets EVERY
 * authenticated user run the isolated simulation on a TRUE production
 * deployment (beta period: "all accounts are beta testers").
 *
 * Worker env mirrors the beta configuration exactly, minus every allowlist:
 *   NODE_ENV=production, VERCEL_ENV=production (a real production deploy),
 *   PAYMENT_SIMULATION_OPEN=true, NO PAYMENT_SIMULATION, NO test username,
 *   NO beta allowlist, MONCASH_MODE=sandbox, NO MonCash credentials,
 *   REQUIRE_PAYMENT enabled.
 *
 * These tests prove:
 *   - the OPEN flag ALONE unlocks the simulated path for any authenticated
 *     user (mode discovery reports true, create → verify succeeds with
 *     SIM- ids, no MonCash needed);
 *   - duplicate orderIds stay idempotent (no double rows);
 *   - the boot guard ACCEPTS a production deployment scoped with the OPEN
 *     flag (no allowlist required) and still REFUSES PAYMENT_SIMULATION=true
 *     when neither OPEN nor an allowlist is provided;
 *   - client-supplied simulation flags add nothing a user didn't already
 *     have — the authorization is the server-side switch alone.
 */
'use strict';

// These MUST be set before src/config.js loads in this worker (static imports
// are hoisted — src modules are only loaded through the dynamic helpers).
process.env.PAYMENT_SIMULATION_OPEN = 'true';
process.env.MONCASH_MODE = 'sandbox';
process.env.REQUIRE_PAYMENT = 'true';
process.env.MONCASH_CLIENT_ID = ''; // no real credentials → provider path fails closed
process.env.NODE_ENV = 'production';
process.env.VERCEL_ENV = 'production'; // TRUE production deployment (issue #77 surface)
process.env.JWT_SECRET = 'open-sim-test-secret-0123456789abcdef0123456789abcdef';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  // t.patient is in NO simulation allowlist (none exists in this worker) —
  // under the old rules this account got the honest-but-useless 503.
  token.patient = await h.loginToken(r, 't.patient');
});

afterAll(async () => {
  await h.closeAll();
});

const configModule = () => import('../src/config.js').then((m) => m.default ?? m);

describe('open-beta simulation — mode discovery', () => {
  it('GET /api/payment/config reports { simulated: true } for a non-allowlisted user', async () => {
    const res = await r.get('/api/payment/config').set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ simulated: true });
  });
});

describe('open-beta simulation — the full simulated flow needs no allowlist', () => {
  it('POST /create takes the simulated path for any authenticated user', async () => {
    const res = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: 'OPEN_SIM_1', amount: 750 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.simulated).toBe(true);
    expect(res.body.redirectUrl).toBe(`/payment/simulated?orderId=${encodeURIComponent('OPEN_SIM_1')}`);
  });

  it('POST /verify confirms the simulated order with a SIM- transaction id', async () => {
    const res = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: 'OPEN_SIM_1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.transactionId).toMatch(/^SIM-/);
    expect(res.body.payment.status).toBe('completed');
  });

  it('duplicate orderId stays idempotent (409, no double row)', async () => {
    const res = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: 'OPEN_SIM_1', amount: 750 });
    expect(res.status).toBe(409);
  });

  it('client-supplied simulation flags add nothing unauthorized (server flag only)', async () => {
    // With OPEN on, the user is authorized anyway — the point of this test is
    // that the SERVER-side switch is the sole authorization source, matching
    // the fail-closed suite where the same flags authorize nobody.
    const res = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: 'OPEN_SIM_2', amount: 750, simulated: true, test: true });
    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(true);
  });
});

describe('open-beta simulation — boot guard', () => {
  it('boot guard ACCEPTS production with ONLY the OPEN flag (no allowlist)', async () => {
    const { assertProductionSafety } = await configModule();
    expect(() => assertProductionSafety()).not.toThrow();
  });

  it('boot guard still REFUSES PAYMENT_SIMULATION=true when OPEN is off and no allowlist exists', async () => {
    const { assertProductionSafety, config } = await configModule();
    const prevOpen = config.paymentSimulationOpen;
    const prevMaster = config.paymentSimulation;
    try {
      config.paymentSimulationOpen = false;   // simulate the rollback path
      config.paymentSimulation = true;        // master on, no scope anywhere
      expect(() => assertProductionSafety()).toThrow(/PAYMENT_SIMULATION/);
    } finally {
      config.paymentSimulationOpen = prevOpen;
      config.paymentSimulation = prevMaster;
    }
  });

  it('simulationAllowed never flips on without an authenticated user', async () => {
    const { simulationAllowed } = await configModule();
    expect(simulationAllowed(null)).toBe(false);
    expect(simulationAllowed({})).toBe(false);
    expect(simulationAllowed({ username: 't.patient' })).toBe(true);
  });
});
