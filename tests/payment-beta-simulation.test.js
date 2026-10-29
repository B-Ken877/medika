/**
 * Beta-payment-simulation tests (issue #77) — allowlisted beta testers on a
 * TRUE production deployment.
 *
 * Worker env mirrors the reported production condition exactly:
 *   NODE_ENV=production, VERCEL_ENV=production (a real production deploy),
 *   PAYMENT_SIMULATION=true, MONCASH_MODE=sandbox, NO MonCash credentials,
 *   PAYMENT_SIMULATION_TEST_USERNAME=t.patient   (legacy single test account)
 *   PAYMENT_SIMULATION_BETA_USERNAMES=t.patient2 (reversible beta allowlist)
 *
 * This is the exact configuration under which the reported bug happened:
 * every beta tester OUTSIDE the single test username fell through to the real
 * MonCash branch and got an honest-but-useless 503 ("payment service
 * unavailable"). These tests prove:
 *   - allowlisted beta testers complete create → verify → consultation
 *     continuation on production without MonCash credentials;
 *   - the legacy single test username still works;
 *   - NON-allowlisted users still fail closed (503) — client-supplied flags,
 *     forged usernames-in-body, or stale simulated rows cannot flip them;
 *   - simulated rows stay distinguishable (simulated=true, SIM- ids);
 *   - the boot guard refuses a production deployment with simulation but NO
 *     allowlisted account, and accepts either mechanism alone;
 *   - the rollback path (revoking the allowlist at runtime) restores
 *     fail-closed immediately.
 */
'use strict';

// These MUST be set before src/config.js loads in this worker (static imports
// are hoisted — src modules are only loaded through the dynamic helpers).
process.env.PAYMENT_SIMULATION = 'true';
process.env.MONCASH_MODE = 'sandbox';
process.env.REQUIRE_PAYMENT = 'true';
process.env.MONCASH_CLIENT_ID = ''; // no real credentials → provider path fails closed
process.env.NODE_ENV = 'production';
process.env.VERCEL_ENV = 'production'; // TRUE production deployment (issue #77 surface)
process.env.PAYMENT_SIMULATION_TEST_USERNAME = 't.patient';
// Spacing + duplicate-entry tolerance: t.patient is in BOTH variables.
process.env.PAYMENT_SIMULATION_BETA_USERNAMES = ' t.patient2 , t.patient,';
process.env.JWT_SECRET = 'beta-sim-test-secret-0123456789abcdef0123456789abcdef';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  // A third patient who is NOT in any simulation allowlist (the doctors get
  // 403 from /consultations before the payment gate even runs).
  const usersRepo = await import('../src/repos/users.js').then((m) => m.default ?? m);
  const { hashPassword } = await import('../src/auth.js').then((m) => m.default ?? m);
  await usersRepo.create({
    id: 'patient_t3', username: 't.patient3', role: 'patient',
    password_hash: hashPassword('Passw0rd!'), name: 'Pat Three',
    age: 30, gender: 'Homme',
  });
  users.patient3 = { id: 'patient_t3', username: 't.patient3' };
  token.patient = await h.loginToken(r, 't.patient'); // legacy test username
  token.patient2 = await h.loginToken(r, 't.patient2'); // beta allowlist
  token.patient3 = await h.loginToken(r, 't.patient3'); // NOT allowlisted
  token.doctor = await h.loginToken(r, 't.doctor'); // NOT allowlisted
});

afterAll(async () => {
  await h.closeAll();
});

const configModule = () => import('../src/config.js').then((m) => m.default ?? m);
const paymentsRepo = () => import('../src/repos/payments.js').then((m) => m.default ?? m);

describe('mode discovery on production honors the beta allowlist', () => {
  it('allowlisted beta tester: GET /config → { simulated: true }', async () => {
    const res = await r.get('/api/payment/config').set('Authorization', `Bearer ${token.patient2}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ simulated: true });
  });

  it('legacy single test username still works (backward compatible)', async () => {
    const res = await r.get('/api/payment/config').set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ simulated: true });
  });

  it('non-allowlisted user: GET /config → { simulated: false } (fail closed)', async () => {
    const res = await r.get('/api/payment/config').set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ simulated: false });
  });
});

describe('POST /create on production', () => {
  it('allowlisted beta tester gets the simulated path (no MonCash needed)', async () => {
    const res = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ orderId: 'MC_beta_1', amount: 750 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.simulated).toBe(true);
    expect(res.body.redirectUrl).toContain('/payment/simulated?orderId=MC_beta_1');

    const row = await paymentsRepo().then((p) => p.findByOrderId('MC_beta_1'));
    expect(row.simulated).toBe(true);
    expect(row.status).toBe('PENDING');
    expect(row.patient_id).toBe(users.patient2.id);
  });

  it('non-allowlisted user still fails closed with 503 (root-cause regression guard)', async () => {
    const res = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ orderId: 'MC_beta_denied_1', amount: 750 });
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.simulated).toBeUndefined();
    expect(res.body.redirectUrl).toBeUndefined();
  });

  it('client-supplied simulation flags NEVER authorize a non-allowlisted user', async () => {
    const res = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({
        orderId: 'MC_beta_denied_2',
        amount: 750,
        simulated: true,
        test: true,
        forceSimulation: true,
        sandbox: true,
        username: 't.patient2', // forging the username in the body changes nothing
        betaUser: true,
      });
    expect(res.status).toBe(503);
    expect(res.body.simulated).toBeUndefined();
  });

  it('invalid amounts are rejected for authorized testers too', async () => {
    for (const amount of [0, -5, 'abc']) {
      const res = await r.post('/api/payment/create')
        .set('Authorization', `Bearer ${token.patient2}`)
        .send({ orderId: `MC_beta_bad_${String(amount)}`, amount });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
  });

  it('duplicate orderId stays idempotent (409, no double row)', async () => {
    const first = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ orderId: 'MC_beta_dup', amount: 750 });
    expect(first.status).toBe(200);

    const second = await r.post('/api/payment/create')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ orderId: 'MC_beta_dup', amount: 750 });
    expect(second.status).toBe(409);

    const all = await paymentsRepo().then((p) => p.findByOrderId('MC_beta_dup'));
    expect(all.patient_id).toBe(users.patient2.id);
  });
});

describe('POST /verify on production', () => {
  it('allowlisted beta tester verifies with a SIM- id and the row stays distinguishable', async () => {
    const res = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ orderId: 'MC_beta_1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payment.status).toBe('completed');
    expect(res.body.payment.transactionId).toMatch(/^SIM-/);

    const row = await paymentsRepo().then((p) => p.findByOrderId('MC_beta_1'));
    expect(row.status).toBe('PAID');
    expect(row.simulated).toBe(true);
    expect(row.transaction_id).toMatch(/^SIM-/);
  });

  it('a simulated-flagged row CANNOT be verified by a non-allowlisted owner (fail closed)', async () => {
    // A row flagged simulated=true exists (e.g. created while the user was
    // still allowlisted, then revoked — the rollback scenario). Verify must
    // NOT auto-confirm it once the user is no longer authorized.
    await paymentsRepo().then((p) =>
      p.create({ order_id: 'MC_beta_revoked', patient_id: users.doctor.id, amount: 750, simulated: true })
    );
    const res = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ orderId: 'MC_beta_revoked' });
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);

    const row = await paymentsRepo().then((p) => p.findByOrderId('MC_beta_revoked'));
    expect(row.status).toBe('PENDING'); // never silently marked paid
  });

  it('ownership is enforced: another account cannot verify someone else’s order', async () => {
    const res = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ orderId: 'MC_beta_1' }); // owned by patient2
    expect(res.status).toBe(404);
  });

  it('a REAL (simulated=false) row never takes the simulated branch — even for a beta tester', async () => {
    await paymentsRepo().then((p) =>
      p.create({ order_id: 'MC_beta_real_row', patient_id: users.patient2.id, amount: 750, simulated: false })
    );
    const res = await r.post('/api/payment/verify')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ orderId: 'MC_beta_real_row' });
    // The row flag and the user authorization must BOTH agree; the real
    // branch runs instead → no credentials → fail closed.
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });
});

describe('consultation continuation (the full beta journey, issue #77 acceptance)', () => {
  it('beta tester completes create → verify → consultation, payment consumed by exactly one consultation', async () => {
    const orderId = 'MC_beta_journey_1';
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient2}`).send({ orderId, amount: 750 });
    const verified = await r.post('/api/payment/verify').set('Authorization', `Bearer ${token.patient2}`).send({ orderId });
    expect(verified.body.success).toBe(true);

    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({
        description: 'koulè nan tèt, depi yè maten',
        specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne',
        doctorId: users.doctor.id,
        transactionId: verified.body.transactionId,
        paymentAmount: 750,
        orderId,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('RECHERCHE_MEDECIN');
    const consultationId = res.body.id;

    const row = await paymentsRepo().then((p) => p.findByOrderId(orderId));
    expect(row.consultation_id).toBe(consultationId);
    expect(row.simulated).toBe(true);
    expect(row.status).toBe('PAID');

    // The doctor sees the consultation through the existing workflow.
    const docList = await r.get('/api/consultations').set('Authorization', `Bearer ${token.doctor}`);
    expect((docList.body || []).some((c) => c.id === consultationId)).toBe(true);
  });

  it('retrying the same payment replays the SAME consultation (issue #40 semantics intact)', async () => {
    const { query } = await import('../src/db.js').then((m) => (m.default ?? m));
    await query(`UPDATE consultations SET status = 'TERMINE', updated_at = now()
                  WHERE status IN ('RECHERCHE_MEDECIN','EN_COURS')`);

    const orderId = 'MC_beta_journey_2';
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient2}`).send({ orderId, amount: 750 });
    await r.post('/api/payment/verify').set('Authorization', `Bearer ${token.patient2}`).send({ orderId });
    const first = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ description: 'a', specialtyNeeded: 'Medecine Generale', doctorId: users.doctor.id, orderId });
    expect(first.status).toBe(201);
    const second = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ description: 'b', specialtyNeeded: 'Medecine Generale', doctorId: users.doctor.id, orderId });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.payment_replayed).toBe(true);
  });

  it('a PENDING simulated row is verified at consultation creation for an allowlisted tester (RC4 fix)', async () => {
    // Crash-recovery path: the app died between /create and /verify; the
    // patient retries consultation creation with the order id. The per-user
    // simulation gate must complete the verification server-side.
    const { query } = await import('../src/db.js').then((m) => (m.default ?? m));
    await query(`UPDATE consultations SET status = 'TERMINE', updated_at = now()
                  WHERE status IN ('RECHERCHE_MEDECIN','EN_COURS')`);

    const orderId = 'MC_beta_pending_1';
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient2}`).send({ orderId, amount: 750 });
    // NO /verify call — straight to consultation creation.
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ description: 'la fièv', specialtyNeeded: 'Medecine Generale', doctorId: users.doctor.id, orderId });
    expect(res.status).toBe(201);

    const row = await paymentsRepo().then((p) => p.findByOrderId(orderId));
    expect(row.status).toBe('PAID');
    expect(row.simulated).toBe(true);
    expect(row.consultation_id).toBe(res.body.id);
  });

  it('a non-allowlisted patient with only a fabricated transaction id still fails closed (503)', async () => {
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient3}`)
      .send({
        description: 'ezzay',
        specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne',
        transactionId: 'SANDBOX_TEST_1234567890',
        paymentAmount: 750,
        orderId: 'MC_beta_fabricated',
      });
    expect(res.status).toBe(503);
  });

  it('an allowlisted beta tester CANNOT buy a consultation with a bare client transaction id', async () => {
    // Release the active consultation held by the previous test (issue #60
    // one-active invariant is DB-enforced and would mask the payment gate).
    const { query } = await import('../src/db.js').then((m) => (m.default ?? m));
    await query(`UPDATE consultations SET status = 'TERMINE', updated_at = now()
                  WHERE status IN ('RECHERCHE_MEDECIN','EN_COURS')`);
    // The transactionId-only registration path is server-authoritative: the
    // simulated retrieval has no provider reference, so the payment is
    // rejected (402) — never registered, never marked paid.
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({
        description: 'tès tx sèlman',
        specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne',
        transactionId: 'SIM-ForgeD',
        paymentAmount: 750,
      });
    expect(res.status).toBe(402);
    const row = await paymentsRepo().then((p) => p.findByTransactionId('SIM-ForgeD'));
    expect(row).toBeNull();
  });
});

describe('simulated vs real separation + rollback (safe default preserved)', () => {
  it('MONCASH_MODE=production disables simulation for EVERYONE (live payments preserved)', async () => {
    const { simulationAllowed, config } = await configModule();
    const prevMode = config.moncashMode;
    try {
      config.moncashMode = 'production';
      expect(simulationAllowed({ username: 't.patient2' })).toBe(false);
      expect(simulationAllowed({ username: 't.patient' })).toBe(false);
    } finally {
      config.moncashMode = prevMode;
    }
  });

  it('revoking the beta allowlist at runtime immediately fails closed (rollback path)', async () => {
    const { simulationAllowed, config } = await configModule();
    const prev = [...config.paymentSimulationBetaUsernames];
    try {
      config.paymentSimulationBetaUsernames.length = 0;
      expect(simulationAllowed({ username: 't.patient2' })).toBe(false);
      // The legacy test username is unaffected by a beta-list rollback.
      expect(simulationAllowed({ username: 't.patient' })).toBe(true);
    } finally {
      config.paymentSimulationBetaUsernames.splice(0, 0, ...prev);
    }
  });

  it('boot guard REFUSES production simulation with NO allowlisted account', async () => {
    const { assertProductionSafety, config } = await configModule();
    const prevTest = config.paymentSimulationTestUsername;
    const prevBeta = [...config.paymentSimulationBetaUsernames];
    try {
      config.paymentSimulationTestUsername = '';
      config.paymentSimulationBetaUsernames.length = 0;
      expect(() => assertProductionSafety()).toThrow(/PAYMENT_SIMULATION/);
    } finally {
      config.paymentSimulationTestUsername = prevTest;
      config.paymentSimulationBetaUsernames.splice(0, 0, ...prevBeta);
    }
  });

  it('boot guard ACCEPTS production simulation with only the beta allowlist set', async () => {
    const { assertProductionSafety, config } = await configModule();
    const prevTest = config.paymentSimulationTestUsername;
    try {
      config.paymentSimulationTestUsername = ''; // beta list alone suffices
      expect(() => assertProductionSafety()).not.toThrow();
    } finally {
      config.paymentSimulationTestUsername = prevTest;
    }
  });
});
