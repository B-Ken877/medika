/**
 * Issue #84 — medication-specific MonCash payment integration.
 * Uses the existing non-production simulation allowlist; no real payment is
 * simulated in production and no consultation payment row is reused.
 */
'use strict';
process.env.PAYMENT_SIMULATION = 'true';
process.env.PAYMENT_SIMULATION_BETA_USERNAMES = 't.patient';
process.env.MONCASH_MODE = 'sandbox';
process.env.MONCASH_CLIENT_ID = '';
process.env.MONCASH_CLIENT_SECRET = '';
process.env.MEDIKA_MEDICATION_DELIVERY_ZONES = 'Port-au-Prince';
process.env.REQUIRE_PAYMENT = 'false';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const h = await import('./helpers');
let r, users, token = {}, db;

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.admin = await h.loginToken(r, 't.admin');
  const dbModule = await import('../src/db.js').then((m) => m.default ?? m);
  db = dbModule;
});
beforeEach(async () => {
  await db.query("UPDATE consultations SET status = 'TERMINE', updated_at = now() WHERE status IN ('RECHERCHE_MEDECIN','EN_COURS')");
});
afterAll(async () => { await h.closeAll(); });

async function setupAcceptedQuote() {
  const created = await r.post('/api/consultations')
    .set('Authorization', 'Bearer ' + token.patient)
    .send({ description: 'Suivi médical', specialtyNeeded: 'Medecine Generale',
      urgencyLevel: 'Moyenne', doctorId: users.doctor.id, patientAge: 30 });
  expect(created.status).toBe(201);
  const id = created.body.id;
  expect((await r.put('/api/consultations/' + id + '/accept')
    .set('Authorization', 'Bearer ' + token.doctor)).status).toBe(200);
  const issued = await r.put('/api/consultations/' + id + '/prescription')
    .set('Authorization', 'Bearer ' + token.doctor)
    .send({ items: [{ name: 'Paracétamol', strength: '500 mg', dose: '1 comprimé',
      frequency: '2 fois par jour', duration: '5 jours', quantity: '10 comprimés' }] });
  expect(issued.status).toBe(200);
  const orderRes = await r.post('/api/consultations/' + id + '/medication-order')
    .set('Authorization', 'Bearer ' + token.patient)
    .send({ delivery_address: '12 rue A, Port-au-Prince', delivery_phone: '+50937142536', delivery_zone: 'Port-au-Prince' });
  expect(orderRes.status).toBe(201);
  const pharmacy = await r.post('/api/admin/pharmacies')
    .set('Authorization', 'Bearer ' + token.admin)
    .send({ name: 'Pharmacie Test', whatsapp_number: '+50937142536', location: 'Port-au-Prince' });
  expect(pharmacy.status).toBe(201);
  const quote = await r.post('/api/admin/medication-orders/' + orderRes.body.id + '/quotes')
    .set('Authorization', 'Bearer ' + token.admin)
    .send({ pharmacy_id: pharmacy.body.id,
      items: [{ prescription_index: 0, availability: 'AVAILABLE', unit_price_htg: 35, quantity: 10 }],
      expires_at: new Date(Date.now() + 3600000).toISOString() });
  expect(quote.status).toBe(201);
  expect((await r.post('/api/medication-orders/' + orderRes.body.id + '/accept')
    .set('Authorization', 'Bearer ' + token.patient)).status).toBe(200);
  return { id: orderRes.body.id, consultationId: id };
}

describe('medication MonCash payments', () => {
  it('derives amount from the accepted quote and marks the order paid only after server verification', async () => {
    const { id } = await setupAcceptedQuote();
    const created = await r.post('/api/medication-orders/' + id + '/payment/create')
      .set('Authorization', 'Bearer ' + token.patient).send({});
    expect(created.status).toBe(200);
    expect(created.body.simulated).toBe(true);
    expect(created.body.payment.amount_htg).toBe(350);
    expect(created.body.payment.reference).toMatch(/^MED-[A-F0-9]{36}$/);

    const verified = await r.post('/api/medication-orders/' + id + '/payment/verify')
      .set('Authorization', 'Bearer ' + token.patient).send({ success: true, amount: 1, transaction_id: 'forged' });
    expect(verified.status).toBe(200);
    expect(verified.body.status).toBe('PAID');
    expect(verified.body.payment.verified_amount_htg).toBe(350);

    const { rows } = await db.query('SELECT status FROM medication_orders WHERE id = $1', [id]);
    expect(rows[0].status).toBe('PAID');
    const consultationPayment = await db.query('SELECT COUNT(*)::int AS n FROM payments');
    expect(consultationPayment.rows[0].n).toBe(0);
  });

  it('does not allow a different patient to create or verify a payment', async () => {
    const { id } = await setupAcceptedQuote();
    const wrong = await h.loginToken(r, 't.patient2');
    const create = await r.post('/api/medication-orders/' + id + '/payment/create')
      .set('Authorization', 'Bearer ' + wrong).send({});
    expect(create.status).toBe(404);
    const verify = await r.post('/api/medication-orders/' + id + '/payment/verify')
      .set('Authorization', 'Bearer ' + wrong).send({});
    expect(verify.status).toBe(404);
  });

  it('refuses payment until the patient has accepted the active quote', async () => {
    const { id } = await setupAcceptedQuote();
    await db.query("UPDATE medication_orders SET status = 'QUOTED' WHERE id = $1", [id]);
    const response = await r.post('/api/medication-orders/' + id + '/payment/create')
      .set('Authorization', 'Bearer ' + token.patient).send({});
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('INVALID_PAYMENT_STATE');
  });
});
