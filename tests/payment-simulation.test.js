/**
 * Simulated-payment mode tests — authorized Vercel PREVIEW deployment env.
 *
 * Worker env mirrors a real Vercel Preview build exactly:
 *   NODE_ENV=production  (previews build with production NODE_ENV!)
 *   VERCEL_ENV=preview   (platform-injected stage signal — the ONLY reliable
 *                         way to distinguish Preview from Production)
 *   PAYMENT_SIMULATION=true, MONCASH_MODE=sandbox, no MonCash credentials.
 *
 * Covers: preview boots with simulation enabled, mode discovery endpoint,
 * simulated create/verify contract, distinguishable payment records, the full
 * patient → doctor workflow without MonCash, duplicate-submission safety,
 * runtime fail-closed when the deployment stage flips to production, client
 * flag distrust, and the assertProductionSafety boot-guard matrix.
 */
'use strict';

// These MUST be set before src/config.js loads in this worker (static imports
// are hoisted — src modules are only loaded through the dynamic helpers).
process.env.PAYMENT_SIMULATION = 'true';
process.env.MONCASH_MODE = 'sandbox';
process.env.REQUIRE_PAYMENT = 'true';
process.env.MONCASH_CLIENT_ID = ''; // no real credentials → provider path fails closed
process.env.NODE_ENV = 'production'; // exactly like a Vercel Preview build
process.env.VERCEL_ENV = 'preview';
process.env.JWT_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // satisfies the production checks

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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

// Keep VERCEL_ENV at the worker default after tests that flip it.
afterEach(() => {
  process.env.VERCEL_ENV = 'preview';
});

describe('authorized preview deployment boots with simulation enabled', () => {
  it('assertProductionSafety does NOT refuse PAYMENT_SIMULATION on a preview (NODE_ENV=production + VERCEL_ENV=preview)', async () => {
    const configModule = await import('../src/config.js');
    const { assertProductionSafety } = configModule.default ?? configModule;
    expect(() => assertProductionSafety()).not.toThrow();
  });

  it('simulationAllowed() is true on a preview deployment', async () => {
    const configModule = await import('../src/config.js');
    const { simulationAllowed } = configModule.default ?? configModule;
    expect(simulationAllowed()).toBe(true);
  });
});

describe('GET /api/payment/config (mode discovery)', () => {
  it('reports { simulated: true } on the canonical path', async () => {
    const res = await r.get('/api/payment/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ simulated: true });
  });

  it('also serves the legacy Android mount path', async () => {
    const res = await r.get('/payment/api/payment/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ simulated: true });
  });
});

describe('simulated create + verify (no MonCash call)', () => {
  it('POST /create returns simulated:true + the /payment/simulated redirect', async () => {
    const res = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: 'MC_sim_1', amount: 750 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.simulated).toBe(true);
    expect(res.body.redirectUrl).toContain('/payment/simulated?orderId=MC_sim_1');
  });

  it('records the order as a distinguishable SIMULATED payment (PENDING until verify)', async () => {
    const paymentsRepo = await import('../src/repos/payments.js').then((m) => m.default ?? m);
    const row = await paymentsRepo.findByOrderId('MC_sim_1');
    expect(row).not.toBeNull();
    expect(row.simulated).toBe(true);
    expect(row.status).toBe('PENDING');
    expect(row.patient_id).toBe(users.patient.id);
  });

  it('POST /verify confirms with a SIM- transaction id and marks the row PAID', async () => {
    const res = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: 'MC_sim_1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payment.status).toBe('completed'); // Android contract value
    expect(res.body.payment.transactionId).toMatch(/^SIM-/);

    const paymentsRepo = await import('../src/repos/payments.js').then((m) => m.default ?? m);
    const row = await paymentsRepo.findByOrderId('MC_sim_1');
    expect(row.status).toBe('PAID');
    expect(row.simulated).toBe(true);
    expect(row.transaction_id).toMatch(/^SIM-/);
  });

  it('requires an authenticated patient', async () => {
    const res = await r.post('/api/payment/create').send({ orderId: 'MC_sim_auth', amount: 750 });
    expect(res.status).toBe(401);
  });
});

describe('complete patient → doctor workflow with a simulated payment', () => {
  it('creates the consultation through the existing pathway and the doctor can see it', async () => {
    const orderId = 'MC_flow_1';
    // 1. Simulated create + verify (what "Simile peman an" does in the web UI).
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient}`).send({ orderId, amount: 750 });
    const verified = await r.post('/api/payment/verify').set('Authorization', `Bearer ${token.patient}`).send({ orderId });
    expect(verified.body.success).toBe(true);
    const txId = verified.body.transactionId;

    // 2. Consultation creation through the EXISTING endpoint + contract.
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({
        description: 'tèt fè mal depi de jou',
        specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne',
        doctorId: users.doctor.id,
        transactionId: txId,
        paymentAmount: 750,
        orderId,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('RECHERCHE_MEDECIN'); // valid existing state — not auto-completed
    const consultationId = res.body.id;

    // 3. The payment is consumed by exactly this consultation, still flagged simulated.
    const paymentsRepo = await import('../src/repos/payments.js').then((m) => m.default ?? m);
    const row = await paymentsRepo.findByOrderId(orderId);
    expect(row.consultation_id).toBe(consultationId);
    expect(row.simulated).toBe(true);
    expect(row.status).toBe('PAID');

    // 4. The doctor sees the consultation through the existing doctor workflow.
    const docList = await r.get('/api/consultations').set('Authorization', `Bearer ${token.doctor}`);
    expect(docList.status).toBe(200);
    const seen = (docList.body || []).some((c) => c.id === consultationId);
    expect(seen).toBe(true);
  });

  it('rejects a repeated submission for the same payment (409) — no duplicate consultations', async () => {
    const orderId = 'MC_flow_2';
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient}`).send({ orderId, amount: 750 });
    await r.post('/api/payment/verify').set('Authorization', `Bearer ${token.patient}`).send({ orderId });

    const first = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ description: 'a', specialtyNeeded: 'Medecine Generale', doctorId: users.doctor.id, orderId });
    expect(first.status).toBe(201);

    const second = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ description: 'b', specialtyNeeded: 'Medecine Generale', doctorId: users.doctor.id, orderId });
    expect(second.status).toBe(409);
  });

  it('GET /payment/simulated serves the legacy WebView test page', async () => {
    const res = await r.get('/payment/simulated?orderId=MC_flow_2');
    expect(res.status).toBe(200);
    expect(res.text).toContain('peman simile');
  });
});

describe('runtime fail-closed when the deployment stage is production', () => {
  it('flipping VERCEL_ENV to production disables simulation for every route', async () => {
    process.env.VERCEL_ENV = 'production';
    try {
      const cfg = await r.get('/api/payment/config');
      expect(cfg.body).toEqual({ simulated: false });

      // The real branch runs instead → without credentials it fails closed 503.
      const res = await r.post('/api/payment/create')
        .set('Authorization', `Bearer ${token.patient}`)
        .send({ orderId: 'MC_prod_1', amount: 750 });
      expect(res.status).toBe(503);
      expect(res.body.simulated).toBeUndefined();
      expect(res.body.redirectUrl).toBeUndefined();
    } finally {
      process.env.VERCEL_ENV = 'preview';
    }
  });

  it('never trusts client-supplied simulation flags (body fields are ignored)', async () => {
    process.env.VERCEL_ENV = 'production';
    try {
      const res = await r.post('/api/payment/create')
        .set('Authorization', `Bearer ${token.patient}`)
        .send({ orderId: 'MC_prod_2', amount: 750, simulated: true, test: true, forceSimulation: true, sandbox: true });
      expect(res.status).toBe(503); // real branch, no credentials → fail closed
      expect(res.body.success).toBe(false);
      expect(res.body.simulated).toBeUndefined();
    } finally {
      process.env.VERCEL_ENV = 'preview';
    }
  });

  it('an unknown VERCEL_ENV value fails CLOSED (treated as production)', async () => {
    process.env.VERCEL_ENV = 'staging-unknown-value';
    try {
      const cfg = await r.get('/api/payment/config');
      expect(cfg.body).toEqual({ simulated: false });
    } finally {
      process.env.VERCEL_ENV = 'preview';
    }
  });
});

describe('boot-guard matrix (assertProductionSafety with PAYMENT_SIMULATION=true)', () => {
  const configModule = () => import('../src/config.js').then((m) => m.default ?? m);

  it('VERCEL_ENV=production refuses to boot', async () => {
    const { assertProductionSafety } = await configModule();
    process.env.VERCEL_ENV = 'production';
    expect(() => assertProductionSafety()).toThrow(/PAYMENT_SIMULATION/);
  });

  it('no VERCEL_ENV (legacy VPS, NODE_ENV=production) refuses to boot', async () => {
    const { assertProductionSafety } = await configModule();
    const prev = process.env.VERCEL_ENV;
    delete process.env.VERCEL_ENV;
    try {
      expect(() => assertProductionSafety()).toThrow(/PAYMENT_SIMULATION/);
    } finally {
      process.env.VERCEL_ENV = prev;
    }
  });

  it('an empty VERCEL_ENV string refuses to boot (blank is not a stage)', async () => {
    const { assertProductionSafety } = await configModule();
    process.env.VERCEL_ENV = '';
    expect(() => assertProductionSafety()).toThrow(/PAYMENT_SIMULATION/);
  });

  it('VERCEL_ENV=development (vercel dev) boots fine', async () => {
    const { assertProductionSafety } = await configModule();
    process.env.VERCEL_ENV = 'development';
    expect(() => assertProductionSafety()).not.toThrow();
  });
});
