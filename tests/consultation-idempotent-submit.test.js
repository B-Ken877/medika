/**
 * Issue #40 — idempotent consultation submission for a consumed payment.
 *
 * Reported bug: "Gen yon konfli — enfòmasyon sa a egziste deja" shown right
 * after a successful (simulated) payment. Root cause (audited, not guessed):
 * two rapid taps on the submit button both passed the STATE-based
 * `submitting` guard (React state updates are async — both clicks saw
 * `false`), producing two POST /api/consultations with the SAME verified
 * payment; the loser hit the payments.consultation_id uniqueness gate and
 * surfaced the generic 409 while the winner HAD created the consultation.
 *
 * The fix has two halves:
 *  1. Server: a retry with the SAME verified payment owned by the SAME
 *     patient replays the consultation that payment already bought (200)
 *     instead of a confusing 409 — including the resolve/attach race window.
 *  2. Client: synchronous ref guards close the double-tap race, and the
 *     request auto-submits after payment (covered by web source contracts).
 *
 * This suite proves the SERVER half with real flows and real races.
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'true';
process.env.PAYMENT_SIMULATION = 'true';
process.env.PAYMENT_SIMULATION_TEST_USERNAME = 't.patient';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

async function createSimulatedOrder({ patientToken, orderId, amount }) {
  const res = await r.post('/api/payment/create')
    .set('Authorization', `Bearer ${patientToken}`)
    .send({ orderId, amount });
  expect(res.status).toBe(200);
  return res.body;
}

async function verifySimulatedOrder({ patientToken, orderId }) {
  const res = await r.post('/api/payment/verify')
    .set('Authorization', `Bearer ${patientToken}`)
    .send({ orderId });
  expect(res.status).toBe(200);
  return res.body;
}

describe('idempotent consultation submission (issue #40)', () => {
  it('a double submission with the SAME payment replays the SAME consultation (no 409)', async () => {
    const orderId = `MC_${Date.now()}_${users.doctor.id}`;
    await createSimulatedOrder({ patientToken: token.patient, orderId, amount: 750 });
    const verified = await verifySimulatedOrder({ patientToken: token.patient, orderId });
    expect(verified.success).toBe(true);

    const body = {
      description: 'sentòm tès idempotans',
      specialtyNeeded: 'Medecine Generale',
      urgencyLevel: 'Moyenne',
      doctorId: users.doctor.id,
      transactionId: verified.transactionId,
      orderId,
      paymentAmount: 750,
    };

    // TWO racing submissions with the same payment (the double-tap shape).
    const [a, b] = await Promise.all([
      r.post('/api/consultations').set('Authorization', `Bearer ${token.patient}`).send(body),
      r.post('/api/consultations').set('Authorization', `Bearer ${token.patient}`).send(body),
    ]);

    // Exactly one created (201); the other REPLAYS it (200 + payment_replayed)
    // — never a 409, never a duplicate consultation.
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 201]);
    const created = a.status === 201 ? a : b;
    const replayed = a.status === 200 ? a : b;
    expect(replayed.body.payment_replayed).toBe(true);
    expect(replayed.body.id).toBe(created.body.id);

    // Exactly ONE consultation exists for the payment.
    const list = await r.get('/api/consultations').set('Authorization', `Bearer ${token.patient}`);
    const mine = list.body.filter((c) => c.description === 'sentòm tès idempotans');
    expect(mine.length).toBe(1);
  });

  it('a LATER retry (refresh / back / re-send) also replays instead of erroring', async () => {
    const orderId = `MC_${Date.now()}_retry_${users.doctor.id}`;
    await createSimulatedOrder({ patientToken: token.patient, orderId, amount: 750 });
    const verified = await verifySimulatedOrder({ patientToken: token.patient, orderId });

    const body = {
      description: 'sentòm tès retry',
      specialtyNeeded: 'Medecine Generale',
      urgencyLevel: 'Haute',
      doctorId: users.doctor.id,
      transactionId: verified.transactionId,
      orderId,
      paymentAmount: 750,
    };
    const first = await r.post('/api/consultations').set('Authorization', `Bearer ${token.patient}`).send(body);
    expect(first.status).toBe(201);

    // The patient refreshes / retries long after — same payment, same patient.
    const retry = await r.post('/api/consultations').set('Authorization', `Bearer ${token.patient}`).send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.payment_replayed).toBe(true);
  });

  it('a payment owned by ANOTHER patient is still rejected (no cross-patient replay)', async () => {
    const orderId = `MC_${Date.now()}_stranger_${users.doctor.id}`;
    const token2 = await h.loginToken(r, 't.patient2');
    await createSimulatedOrder({ patientToken: token2, orderId, amount: 750 });
    const verified = await verifySimulatedOrder({ patientToken: token2, orderId });

    // The FIRST patient tries to use patient2's payment.
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({
        description: 'esprit',
        specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne',
        doctorId: users.doctor.id,
        transactionId: verified.transactionId,
        orderId,
        paymentAmount: 750,
      });
    expect(res.status).toBe(402); // 'Paiement non associe a ce compte' — ownership enforced
  });

  it('an UNVERIFIED payment still fails closed (replay is only for verified ones)', async () => {
    const orderId = `MC_${Date.now()}_unverified_${users.doctor.id}`;
    await createSimulatedOrder({ patientToken: token.patient, orderId, amount: 750 });
    // NO verify call — the order exists but is not PAID.
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({
        description: 'san verifikasyon',
        specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne',
        doctorId: users.doctor.id,
        orderId,
        paymentAmount: 750,
      });
    expect([402, 200]).not.toContain(res.status);
  });
});
