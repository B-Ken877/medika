/**
 * Issue #79 regression tests — "simulated payment succeeds but consultation
 * is not created".
 *
 * Worker env mirrors the reported production condition (beta allowlist on a
 * TRUE production deployment, no MonCash credentials):
 *   NODE_ENV=production, VERCEL_ENV=production, PAYMENT_SIMULATION=true,
 *   MONCASH_MODE=sandbox, PAYMENT_SIMULATION_TEST_USERNAME=t.patient,
 *   PAYMENT_SIMULATION_BETA_USERNAMES=t.patient2.
 *
 * The web client (app/app/consult/page.tsx createTheConsultation) sends
 * EXACTLY this shape after a SERVER-verified payment:
 *   { description, specialtyNeeded, urgencyLevel, aiSummary: "",
 *     aiExplanation: "", doctorId, patientAge: number|null,
 *     transactionId: <from verify>|null, paymentAmount, orderId }
 * — and auto-submits once. These tests mirror that payload verbatim and
 * prove every acceptance criterion:
 *   - fresh booking with the exact client payload → 201, persisted, visible
 *     to patient AND doctor, payment consumed by exactly that consultation;
 *   - orderId-only variant (the simulated UI never needs a transaction id);
 *   - doctor-busy 409 → payment stays PAID + UNATTACHED → the SAME payment
 *     completes the booking later (money never lost);
 *   - already-active 409 (with existing_id) → same recovery;
 *   - underpayment 402 → clear error, payment untouched;
 *   - double-submit → idempotent replay, no duplicate consultation;
 *   - a POST-commit routing failure returns 201 with the persisted
 *     consultation (parked in the retryable waiting state) — never a false
 *     500 "failed" response after the booking already exists.
 */
'use strict';

process.env.PAYMENT_SIMULATION = 'true';
process.env.MONCASH_MODE = 'sandbox';
process.env.REQUIRE_PAYMENT = 'true';
process.env.MONCASH_CLIENT_ID = '';
process.env.MONCASH_CLIENT_SECRET = '';
process.env.NODE_ENV = 'production';
process.env.VERCEL_ENV = 'production';
process.env.PAYMENT_SIMULATION_TEST_USERNAME = 't.patient';
process.env.PAYMENT_SIMULATION_BETA_USERNAMES = 't.patient2';
process.env.JWT_SECRET = 'issue79-test-secret-0123456789abcdef0123456789abcdef';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const h = await import('./helpers');

const __dirname79 = path.dirname(fileURLToPath(import.meta.url));
// The route does `require('../consultation-lifecycle')` natively (vitest
// externalizes CJS) — patch THAT instance, the same object the route holds.
const nativeRequire = createRequire(path.resolve(__dirname79, '../src/routes/consultations.js'));
const nativeLifecycle = nativeRequire('../consultation-lifecycle.js');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.patient2 = await h.loginToken(r, 't.patient2');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.doctor2 = await h.loginToken(r, 't.doctor2');
});

afterAll(async () => {
  await h.closeAll();
});

// Release every active consultation slot (the one-active invariant is
// DB-enforced; tests that need a clean slate terminate current bookings).
async function terminateActiveConsultations() {
  const { query } = await import('../src/db.js').then((m) => (m.default ?? m));
  await query(`UPDATE consultations SET status = 'TERMINE', updated_at = now()
                WHERE status IN ('RECHERCHE_MEDECIN','EN_COURS')`);
}

afterEach(async () => {
  await terminateActiveConsultations();
});

const paymentsRepo = () => import('../src/repos/payments.js').then((m) => m.default ?? m);
const specialtiesRepo = () => import('../src/repos/specialties.js').then((m) => m.default ?? m);

/** Drive the exact web-client journey: create → verify → consultation POST
 * with the exact createTheConsultation payload. Returns all three responses
 * plus the paid amount (server price). */
async function betaBooking({ patient = token.patient2, doctorId, specialtyNeeded = 'Medecine Generale', withTransactionId = true, payAmount = null }) {
  const price = await specialtiesRepo().then((s) => s.priceFor(specialtyNeeded));
  const amount = payAmount ?? price;
  const orderId = `MC_79_${Math.random().toString(36).slice(2, 10)}`;
  const createRes = await r.post('/api/payment/create')
    .set('Authorization', `Bearer ${patient}`)
    .send({ orderId, amount });
  const verifyRes = await r.post('/api/payment/verify')
    .set('Authorization', `Bearer ${patient}`)
    .send({ orderId });
  const body = {
    description: 'vètij, tout room an vire',
    specialtyNeeded,
    urgencyLevel: 'Moyenne',
    aiSummary: '',
    aiExplanation: '',
    doctorId,
    patientAge: 34,
    transactionId: withTransactionId ? (verifyRes.body?.transactionId ?? null) : null,
    paymentAmount: amount,
    orderId,
  };
  const consultRes = await r.post('/api/consultations')
    .set('Authorization', `Bearer ${patient}`)
    .send(body);
  return { createRes, verifyRes, consultRes, orderId, price, amount };
}

describe('complete beta booking flow with the exact web-client payload', () => {
  it('create → verify → consultation 201 with transactionId + orderId (exact payload)', async () => {
    const { createRes, verifyRes, consultRes, orderId } = await betaBooking({ doctorId: users.doctor.id });
    expect(createRes.status).toBe(200);
    expect(createRes.body.simulated).toBe(true);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.payment.transactionId).toMatch(/^SIM-/);

    expect(consultRes.status).toBe(201);
    expect(consultRes.body.status).toBe('RECHERCHE_MEDECIN');
    const consultationId = consultRes.body.id;

    // Persisted + associated + distinguishable.
    const row = await paymentsRepo().then((p) => p.findByOrderId(orderId));
    expect(row.consultation_id).toBe(consultationId);
    expect(row.simulated).toBe(true);
    expect(row.status).toBe('PAID');

    // Visible in the patient workflow…
    const mine = await r.get('/api/consultations').set('Authorization', `Bearer ${token.patient2}`);
    expect((mine.body || []).some((c) => c.id === consultationId)).toBe(true);
    // …and in the doctor workflow.
    const docList = await r.get('/api/consultations').set('Authorization', `Bearer ${token.doctor}`);
    expect((docList.body || []).some((c) => c.id === consultationId)).toBe(true);
  });

  it('orderId-only variant (no transactionId — simulated UI state) still books', async () => {
    const { consultRes, orderId } = await betaBooking({ doctorId: users.doctor.id, withTransactionId: false });
    expect(consultRes.status).toBe(201);
    const row = await paymentsRepo().then((p) => p.findByOrderId(orderId));
    expect(row.consultation_id).toBe(consultRes.body.id);
  });

  it('patientAge null (client sends null when age is unknown) still books', async () => {
    const price = await specialtiesRepo().then((s) => s.priceFor('Medecine Generale'));
    const orderId = `MC_79_age_${Math.random().toString(36).slice(2, 8)}`;
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient2}`).send({ orderId, amount: price });
    await r.post('/api/payment/verify').set('Authorization', `Bearer ${token.patient2}`).send({ orderId });
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({
        description: 'tès laj null', specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Faible', aiSummary: '', aiExplanation: '',
        doctorId: users.doctor.id, patientAge: null,
        transactionId: null, paymentAmount: price, orderId,
      });
    expect(res.status).toBe(201);
  });
});

describe('failure paths stay recoverable and legible (no lost payments)', () => {
  it('doctor-busy 409 leaves the payment PAID + UNATTACHED; the SAME payment books later', async () => {
    // First patient occupies the doctor.
    const first = await betaBooking({ doctorId: users.doctor.id });
    expect(first.consultRes.status).toBe(201);

    // Second patient pays, then picks the SAME (now busy) doctor.
    const price = await specialtiesRepo().then((s) => s.priceFor('Medecine Generale'));
    const orderId = `MC_79_busy_${Math.random().toString(36).slice(2, 8)}`;
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient}`).send({ orderId, amount: price });
    await r.post('/api/payment/verify').set('Authorization', `Bearer ${token.patient}`).send({ orderId });

    const rejected = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({
        description: 'tès doktè okipe', specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne', aiSummary: '', aiExplanation: '',
        doctorId: users.doctor.id, patientAge: 30,
        transactionId: null, paymentAmount: price, orderId,
      });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error).toContain('okipe');

    // The payment was NOT consumed: PAID, no consultation attached.
    let row = await paymentsRepo().then((p) => p.findByOrderId(orderId));
    expect(row.status).toBe('PAID');
    expect(row.consultation_id).toBeNull();

    // The doctor frees up → the SAME payment completes the booking.
    await terminateActiveConsultations();
    const retry = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({
        description: 'tès doktè okipe', specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne', aiSummary: '', aiExplanation: '',
        doctorId: users.doctor.id, patientAge: 30,
        transactionId: null, paymentAmount: price, orderId,
      });
    expect(retry.status).toBe(201);
    row = await paymentsRepo().then((p) => p.findByOrderId(orderId));
    expect(row.consultation_id).toBe(retry.body.id);
  });

  it('already-active 409 carries existing_id and the payment books once the slot frees', async () => {
    const active = await betaBooking({ doctorId: users.doctor.id });
    expect(active.consultRes.status).toBe(201);

    // A NEW payment while a consultation is still active → 409 + existing_id.
    const price = await specialtiesRepo().then((s) => s.priceFor('Medecine Generale'));
    const orderId = `MC_79_active_${Math.random().toString(36).slice(2, 8)}`;
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient2}`).send({ orderId, amount: price });
    await r.post('/api/payment/verify').set('Authorization', `Bearer ${token.patient2}`).send({ orderId });
    const rejected = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({
        description: 'dezyèm demann', specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne', aiSummary: '', aiExplanation: '',
        doctorId: users.doctor2.id, patientAge: 34,
        transactionId: null, paymentAmount: price, orderId,
      });
    expect(rejected.status).toBe(409);
    expect(rejected.body.existing_id).toBe(active.consultRes.body.id);

    await terminateActiveConsultations();
    const retry = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({
        description: 'dezyèm demann', specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne', aiSummary: '', aiExplanation: '',
        doctorId: users.doctor2.id, patientAge: 34,
        transactionId: null, paymentAmount: price, orderId,
      });
    expect(retry.status).toBe(201);
  });

  it('underpayment is rejected with the exact required amount (402) and consumes nothing', async () => {
    const price = await specialtiesRepo().then((s) => s.priceFor('Medecine Generale'));
    const { consultRes, orderId } = await betaBooking({ doctorId: users.doctor.id, payAmount: price - 1 });
    expect(consultRes.status).toBe(402);
    expect(consultRes.body.error).toContain(String(price));
    const row = await paymentsRepo().then((p) => p.findByOrderId(orderId));
    expect(row.consultation_id).toBeNull();
  });

  it('double-submit of the SAME payment replays one consultation (no duplicates)', async () => {
    const price = await specialtiesRepo().then((s) => s.priceFor('Medecine Generale'));
    const orderId = `MC_79_dup_${Math.random().toString(36).slice(2, 8)}`;
    await r.post('/api/payment/create').set('Authorization', `Bearer ${token.patient2}`).send({ orderId, amount: price });
    await r.post('/api/payment/verify').set('Authorization', `Bearer ${token.patient2}`).send({ orderId });

    const payload = {
      description: 'doub-klik', specialtyNeeded: 'Medecine Generale',
      urgencyLevel: 'Moyenne', aiSummary: '', aiExplanation: '',
      doctorId: users.doctor.id, patientAge: 34,
      transactionId: null, paymentAmount: price, orderId,
    };
    const first = await r.post('/api/consultations').set('Authorization', `Bearer ${token.patient2}`).send(payload);
    expect(first.status).toBe(201);
    const second = await r.post('/api/consultations').set('Authorization', `Bearer ${token.patient2}`).send(payload);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.payment_replayed).toBe(true);
  });
});

describe('post-commit routing failure never falsifies a persisted booking (issue #79 fix)', () => {
  it('routeNewConsultation throwing → still 201, consultation persisted + parked in waiting state', async () => {
    const original = nativeLifecycle.routeNewConsultation;
    nativeLifecycle.routeNewConsultation = async () => {
      throw Object.assign(new Error('simulated routing outage'), { code: 'ROUTING_DOWN' });
    };
    try {
      const { consultRes, orderId } = await betaBooking({ doctorId: users.doctor.id });
      // The consultation EXISTS and the API says so — never a false 500.
      expect(consultRes.status).toBe(201);
      expect(consultRes.body.status).toBe('RECHERCHE_MEDECIN');
      expect(consultRes.body.doctor_id).toBeNull(); // parked, offer pending retry

      // Persisted + payment attached.
      const row = await paymentsRepo().then((p) => p.findByOrderId(orderId));
      expect(row.consultation_id).toBe(consultRes.body.id);
      expect(row.status).toBe('PAID');

      // Parked in the retryable waiting state (reroute_after set).
      const { query } = await import('../src/db.js').then((m) => (m.default ?? m));
      const { rows } = await query(`SELECT reroute_after FROM consultations WHERE id = $1`, [consultRes.body.id]);
      expect(rows[0].reroute_after).not.toBeNull();
    } finally {
      nativeLifecycle.routeNewConsultation = original;
    }
  });

  it('routing failure with a patient-chosen doctor frees the slot semantics: booking still 201', async () => {
    const original = nativeLifecycle.routeNewConsultation;
    nativeLifecycle.routeNewConsultation = async () => {
      throw Object.assign(new Error('simulated routing outage 2'), { code: 'ROUTING_DOWN' });
    };
    try {
      const { consultRes } = await betaBooking({ doctorId: users.doctor2.id });
      expect(consultRes.status).toBe(201);
      expect(consultRes.body.doctor_id).toBeNull(); // waiting, NOT bound to the doctor
    } finally {
      nativeLifecycle.routeNewConsultation = original;
    }
  });
});
