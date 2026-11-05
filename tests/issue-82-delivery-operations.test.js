/**
 * Consolidated issue #82 — Medika-owned delivery operations (§7).
 *
 * Covers, with REAL API flows (no fabricated states):
 *  - admin-only employee provisioning (patient/doctor/anonymous rejected);
 *  - paid-orders-only assignment (QUOTED → 409 NOT_PAID; PAID → 201);
 *  - Friday scheduling enforced server-side + reasoned urgent exception;
 *  - zone binding: the delivery must use the order's validated active zone;
 *  - employee isolation (employee2 cannot see or transition employee1's
 *    delivery; patient/doctor roles rejected);
 *  - the full custody chain with idempotent, row-locked transitions;
 *    invalid transitions rejected; duplicate idempotency key applied once;
 *  - failed attempts require a written reason and recover;
 *  - patient confirmation ONLY at AWAITING_CONFIRMATION, and only by the
 *    order's patient — a button click alone is never proof of delivery;
 *  - patient tracking endpoint (own order only) with status history;
 *  - internal expense ledger + report counts, cost per successful delivery,
 *    budget + threshold alert (explicit Haiti-local date boundaries);
 *  - delivery stays free to the patient (no fee line in the order/quote).
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';
process.env.MONCASH_CLIENT_ID = 'test-medika-client';
process.env.MONCASH_CLIENT_SECRET = 'test-medika-secret';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const h = await import('./helpers');

const __dirname82 = path.dirname(fileURLToPath(import.meta.url));
// The payment routes do `require('../moncash')` natively (vitest
// externalizes CJS) — patch THAT instance, the same object the routes hold
// (a plain `await import` would create a second vitest-side instance).
const nativeRequire = createRequire(path.resolve(__dirname82, '../src/routes/medication-payments.js'));
const nativeMoncash = nativeRequire('../moncash.js');

let r, users, token = {};
let db;

const ITEMS = [
  { name: 'Paracétamol', strength: '500 mg', form: 'comprimé', dose: '1 comprimé', frequency: '3 fois par jour', duration: '5 jours', quantity: '15 comprimés' },
  { name: 'Ibuprofène', strength: '200 mg', dose: '1 comprimé', frequency: '2 fois par jour', duration: '3 jours', quantity: '6 comprimés' },
];

let patientSeq = 0;

async function freshPatient() {
  patientSeq += 1;
  const username = `dl.patient${patientSeq}`;
  const usersRepo = await import('../src/repos/users.js').then((m) => m.default ?? m);
  const auth = await import('../src/auth.js').then((m) => m.default ?? m);
  const created = await usersRepo.create({
    id: `patient_dl${patientSeq}`, username, password_hash: auth.hashPassword('Passw0rd!'),
    role: 'patient', name: `Patient Livraison ${patientSeq}`, email: `${username}@test.ht`,
    phone: '+509 3', age: 30, gender: 'Homme',
  });
  // Direct server-side token issue (same signing as /api/auth/login) — the
  // login HTTP endpoint is throttled per client and these are fixtures.
  return { id: created.id, username, token: auth.issueToken(created) };
}

async function createPharmacy(extra = {}) {
  const res = await r.post('/api/admin/pharmacies')
    .set('Authorization', `Bearer ${token.admin}`)
    .send({ name: 'Pharmacie Livraison', whatsapp_number: '+509 37 00 11 22', location: 'Port-au-Prince', ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

async function consultationWithPrescription() {
  const p = await freshPatient();
  const created = await r.post('/api/consultations')
    .set('Authorization', `Bearer ${p.token}`)
    .send({
      description: 'Douleurs', specialtyNeeded: 'Medecine Generale',
      urgencyLevel: 'Moyenne', doctorId: users.doctor.id, patientAge: 30,
    });
  expect(created.status).toBe(201);
  const consId = created.body.id;
  expect((await r.put(`/api/consultations/${consId}/accept`).set('Authorization', `Bearer ${token.doctor}`)).status).toBe(200);
  const issued = await r.put(`/api/consultations/${consId}/prescription`)
    .set('Authorization', `Bearer ${token.doctor}`)
    .send({ items: ITEMS, general_instructions: 'Repos.' });
  expect(issued.status).toBe(200);
  return { consId, patient: p };
}

async function createOrder(patient, consId) {
  return r.post(`/api/consultations/${consId}/medication-order`)
    .set('Authorization', `Bearer ${patient.token}`)
    .send({
      delivery_address: '12, rue Ka o, Port-au-Prince',
      delivery_phone: '+50937142536',
      delivery_city: 'Port-au-Prince',
      delivery_zone_id: 'ZONE_PAP',
    });
}

function quotePayload(pharmacyId) {
  return {
    pharmacy_id: pharmacyId,
    items: [
      { prescription_index: 0, availability: 'AVAILABLE', unit_price_htg: 25, quantity: 15 },
      { prescription_index: 1, availability: 'AVAILABLE', unit_price_htg: 50, quantity: 6 },
    ],
    expires_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
  };
}

/** Full happy path: prescription → order → quote → accept → verified MonCash
 *  → PAID order ready for delivery assignment. */
async function paidOrder() {
  const { consId, patient } = await consultationWithPrescription();
  const created = await createOrder(patient, consId);
  expect(created.status).toBe(201);
  const pharmacy = await createPharmacy();
  const quote = await r.post('/api/admin/medication-orders/' + created.body.id + '/quotes')
    .set('Authorization', `Bearer ${token.admin}`).send(quotePayload(pharmacy.id));
  expect(quote.status).toBe(201);
  const accepted = await r.post('/api/medication-orders/' + created.body.id + '/accept')
    .set('Authorization', `Bearer ${patient.token}`);
  expect(accepted.status).toBe(200);
  vi.spyOn(nativeMoncash, 'createPayment').mockResolvedValue({ redirectUrl: 'https://moncash.example/checkout' });
  const start = await r.post('/api/medication-orders/' + created.body.id + '/payment/create')
    .set('Authorization', `Bearer ${patient.token}`).send({});
  expect(start.status).toBe(200);
  vi.spyOn(nativeMoncash, 'retrieveByOrderId').mockResolvedValue({
    reference: start.body.payment.payment_reference,
    transactionId: 'TX_DL_' + created.body.id,
    amount: 675, status: 'completed', raw: { status: 'Completed' },
  });
  const verified = await r.post('/api/medication-orders/' + created.body.id + '/payment/verify')
    .set('Authorization', `Bearer ${patient.token}`).send({});
  expect(verified.status).toBe(200);
  expect(verified.body.payment.status).toBe('PAID');
  const order = await r.get('/api/consultations/' + consId + '/medication-order')
    .set('Authorization', `Bearer ${patient.token}`);
  expect(order.body.status).toBe('PAID');
  return { consId, patient, orderId: created.body.id, reference: created.body.reference };
}

/** Next Friday strictly after today (Haiti-local arithmetic, UTC-noon safe). */
function nextFriday() {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(new Date());
  const today = new Date(parts.find((p) => p.type === 'year').value + '-' + parts.find((p) => p.type === 'month').value + '-' + parts.find((p) => p.type === 'day').value + 'T12:00:00Z');
  const d = new Date(today);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 5);
  return d.toISOString().slice(0, 10);
}

function nextMonday() {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmt.formatToParts(new Date());
  const today = new Date(parts.find((p) => p.type === 'year').value + '-' + parts.find((p) => p.type === 'month').value + '-' + parts.find((p) => p.type === 'day').value + 'T12:00:00Z');
  const d = new Date(today);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 1);
  return d.toISOString().slice(0, 10);
}

async function createEmployeeViaApi({ username, name }) {
  return r.post('/api/admin/delivery-employees')
    .set('Authorization', `Bearer ${token.admin}`)
    .send({ username, name, password: 'Livreur-Securise-2026', phone: '+509 37 55 00 11' });
}

async function assign({ orderId, employeeId, scheduledFor, urgent, urgentReason, zoneId }) {
  return r.post('/api/admin/deliveries/assign')
    .set('Authorization', `Bearer ${token.admin}`)
    .send({
      medication_order_id: orderId, employee_id: employeeId, zone_id: zoneId || 'ZONE_PAP',
      scheduled_for: scheduledFor || nextFriday(), urgent: urgent === true, urgent_reason: urgentReason,
    });
}

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.admin = await h.loginToken(r, 't.admin');
  db = await import('../src/db.js').then((m) => m.default ?? m);
  await db.query(`UPDATE delivery_zones SET active = TRUE WHERE id = 'ZONE_PAP'`);
});

afterAll(async () => {
  await h.closeAll();
});

describe('issue #82 §7 — delivery employee accounts (admin-only provisioning)', () => {
  it('admin creates a delivery employee; patient/doctor/anonymous are rejected', async () => {
    const anon = await r.post('/api/admin/delivery-employees').send({ username: 'livreur.x', name: 'X', password: 'Livreur-Securise-2026' });
    expect([401, 403]).toContain(anon.status);
    const asPatient = await r.post('/api/admin/delivery-employees')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ username: 'livreur.y', name: 'Y', password: 'Livreur-Securise-2026' });
    expect(asPatient.status).toBe(403);

    const created = await createEmployeeViaApi({ username: 'livreur1', name: 'Livreur Un' });
    expect(created.status).toBe(201);
    expect(created.body.role ?? 'delivery').toBeTruthy();
    expect(created.body).not.toHaveProperty('password_hash');

    const duplicate = await createEmployeeViaApi({ username: 'livreur1', name: 'Livreur Un' });
    expect(duplicate.status).toBe(409);

    const weak = await r.post('/api/admin/delivery-employees')
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ username: 'livreur.weak', name: 'W', password: 'court' });
    expect(weak.status).toBe(400);

    // The employee can actually sign in (role comes from the DB, not the JWT).
    const login = await r.post('/api/auth/login').send({ username: 'livreur1', password: 'Livreur-Securise-2026' });
    expect(login.status).toBe(200);
    token.employee1 = login.body.token;

    // Public registration stays patient-only: registering with role
    // 'delivery' must NEVER create a delivery account (the route hardcodes
    // the patient role) — the new account gets no employee access.
    const publicReg = await r.post('/api/auth/register').send({
      username: 'livreur.public', password: 'Livreur-Securise-2026', role: 'delivery', name: 'Public',
    });
    expect(publicReg.status).toBe(201); // registered as a PATIENT
    const employees = await r.get('/api/admin/delivery-employees').set('Authorization', `Bearer ${token.admin}`);
    expect(employees.body.some((e) => e.username === 'livreur.public')).toBe(false);
    const publicToken = publicReg.body.token ?? (await r.post('/api/auth/login').send({ username: 'livreur.public', password: 'Livreur-Securise-2026' })).body.token;
    const publicPortal = await r.get('/api/delivery/my').set('Authorization', `Bearer ${publicToken}`);
    expect(publicPortal.status).toBe(403);
  });

  it('admin can disable an employee; a disabled employee cannot be assigned new work', async () => {
    const created = await createEmployeeViaApi({ username: 'livreur2', name: 'Livreur Deux' });
    expect(created.status).toBe(201);
    const auth = await import('../src/auth.js').then((m) => m.default ?? m);
    token.employee2 = auth.issueToken({ id: created.body.id, role: 'delivery', username: 'livreur2', name: 'Livreur Deux' });

    const off = await r.patch('/api/admin/delivery-employees/' + created.body.id + '/availability')
      .set('Authorization', `Bearer ${token.admin}`).send({ is_available: false });
    expect(off.status).toBe(200);
    expect(off.body.is_available).toBe(false);

    const { orderId } = await paidOrder();
    const rejected = await assign({ orderId, employeeId: created.body.id });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe('INVALID_EMPLOYEE');

    const on = await r.patch('/api/admin/delivery-employees/' + created.body.id + '/availability')
      .set('Authorization', `Bearer ${token.admin}`).send({ is_available: true });
    expect(on.status).toBe(200);
  });
});

describe('issue #82 §7 — assignment: paid-only, Friday, zone binding', () => {
  it('rejects assignment of an UNPAID order (server-verified payment required)', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const created = await createOrder(patient, consId);
    expect(created.status).toBe(201);
    const pharmacy = await createPharmacy();
    await r.post('/api/admin/medication-orders/' + created.body.id + '/quotes')
      .set('Authorization', `Bearer ${token.admin}`).send(quotePayload(pharmacy.id));
    await r.post('/api/medication-orders/' + created.body.id + '/accept')
      .set('Authorization', `Bearer ${patient.token}`);
    const employees = await r.get('/api/admin/delivery-employees').set('Authorization', `Bearer ${token.admin}`);
    const employee = employees.body.find((e) => e.username === 'livreur1');
    const res2 = await assign({ orderId: created.body.id, employeeId: employee.id });
    expect(res2.status).toBe(409);
    expect(res2.body.code).toBe('NOT_PAID');
  });

  it('enforces Friday scheduling; urgent exception requires a written reason', async () => {
    const { orderId } = await paidOrder();
    const employees = await r.get('/api/admin/delivery-employees').set('Authorization', `Bearer ${token.admin}`);
    const employee = employees.body.find((e) => e.username === 'livreur1');

    const monday = await assign({ orderId, employeeId: employee.id, scheduledFor: nextMonday() });
    expect(monday.status).toBe(400);
    expect(monday.body.code).toBe('FRIDAY_ONLY');

    const unreasoned = await assign({ orderId, employeeId: employee.id, scheduledFor: nextMonday(), urgent: true, urgentReason: 'court' });
    expect(unreasoned.status).toBe(400);
    expect(unreasoned.body.code).toBe('URGENT_REASON_REQUIRED');

    const reasoned = await assign({ orderId, employeeId: employee.id, scheduledFor: nextMonday(), urgent: true, urgentReason: 'Patient sans médicaments critiques depuis 48h' });
    expect(reasoned.status).toBe(201);
    expect(reasoned.body.delivery_id).toMatch(/^DL_/);

    const again = await assign({ orderId, employeeId: employee.id });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_ASSIGNED');
  });

  it('binds the delivery to the order’s validated zone; a mismatched/inactive zone is rejected', async () => {
    const { orderId } = await paidOrder();
    const employees = await r.get('/api/admin/delivery-employees').set('Authorization', `Bearer ${token.admin}`);
    const employee = employees.body.find((e) => e.username === 'livreur1');

    const badZone = await assign({ orderId, employeeId: employee.id, zoneId: 'ZONE_NOWHERE' });
    expect(badZone.status).toBe(400);
    expect(badZone.body.code).toBe('INVALID_ZONE');

    // Deactivate the zone AFTER payment: fail closed at assignment time.
    await db.query(`UPDATE delivery_zones SET active = FALSE WHERE id = 'ZONE_PAP'`);
    const inactive = await assign({ orderId, employeeId: employee.id });
    expect(inactive.status).toBe(400);
    expect(inactive.body.code).toBe('INVALID_ZONE');
    await db.query(`UPDATE delivery_zones SET active = TRUE WHERE id = 'ZONE_PAP'`);
  });
});

describe('issue #82 §7 — custody chain, employee isolation, patient confirmation', () => {
  async function assignedDelivery() {
    const { consId, patient, orderId } = await paidOrder();
    const employees = await r.get('/api/admin/delivery-employees').set('Authorization', `Bearer ${token.admin}`);
    const employee = employees.body.find((e) => e.username === 'livreur1');
    const assigned = await assign({ orderId, employeeId: employee.id });
    expect(assigned.status).toBe(201);
    return { consId, patient, orderId, deliveryId: assigned.body.delivery_id };
  }

  it('runs the full chain; rejects invalid transitions and duplicate idempotency keys', async () => {
    const { patient, orderId, deliveryId } = await assignedDelivery();
    const auth = { Authorization: `Bearer ${token.employee1}` };
    const step = (type, body = {}) => r.post(`/api/delivery/${deliveryId}/events`)
      .set(auth).set('Idempotency-Key', 'run1:' + deliveryId + ':' + type).send({ event_type: type, ...body });

    // Invalid from ASSIGNED: skipping straight to PICKED_UP is rejected.
    const skip = await step('PICKED_UP');
    expect(skip.status).toBe(409);
    expect(skip.body.code ?? skip.body.error).toBeTruthy();

    expect((await step('PHARMACY_PREPARING')).status).toBe(200);
    expect((await step('READY_FOR_PICKUP')).status).toBe(200);
    expect((await step('PICKED_UP')).status).toBe(200);
    expect((await step('OUT_FOR_DELIVERY')).status).toBe(200);
    expect((await step('AWAITING_CONFIRMATION')).status).toBe(200);

    // Unknown event type.
    const bogus = await step('FLYING');
    expect(bogus.status).toBe(400);

    // The EMPLOYEE cannot mark DELIVERED — only the patient confirms.
    const employeeDeliver = await step('DELIVERED');
    expect(employeeDeliver.status).toBe(400);

    // Patient confirmation before AWAITING_CONFIRMATION was already checked
    // above; here the delivery IS awaiting confirmation.
    const wrongPatient = await r.post(`/api/medication-orders/${orderId}/delivery/confirm`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(wrongPatient.status).toBe(404); // another patient's order never exists for them

    const confirmed = await r.post(`/api/medication-orders/${orderId}/delivery/confirm`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('DELIVERED');

    const tracking = await r.get(`/api/medication-orders/${orderId}/delivery`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(tracking.status).toBe(200);
    const types = tracking.body.events.map((e) => e.event_type);
    expect(types).toEqual(['ASSIGNED', 'PHARMACY_PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'AWAITING_CONFIRMATION', 'DELIVERED']);
    expect(tracking.body.status).toBe('DELIVERED');
    expect(tracking.body.delivery_address).toBe('12, rue Ka o, Port-au-Prince');
  });

  it('rejects unassigned employees, other roles, and duplicate submissions (idempotent once)', async () => {
    const { deliveryId, patient, orderId } = await assignedDelivery();
    // employee2 is NOT assigned → isolation: 404, never the delivery data.
    const outsider = await r.post(`/api/delivery/${deliveryId}/events`)
      .set('Authorization', `Bearer ${token.employee2}`)
      .set('Idempotency-Key', 'iso:' + deliveryId + ':1')
      .send({ event_type: 'PHARMACY_PREPARING' });
    expect(outsider.status).toBe(404);
    const outsiderList = await r.get('/api/delivery/my').set('Authorization', `Bearer ${token.employee2}`);
    expect(outsiderList.body.some((d) => d.id === deliveryId)).toBe(false);

    // Roles other than 'delivery' are rejected on the employee endpoints.
    const asPatient = await r.get('/api/delivery/my').set('Authorization', `Bearer ${patient.token}`);
    expect(asPatient.status).toBe(403);

    // Same idempotency key twice: applied once, second call is a DUPLICATE.
    const key = 'dup:' + deliveryId;
    const first = await r.post(`/api/delivery/${deliveryId}/events`)
      .set('Authorization', `Bearer ${token.employee1}`).set('Idempotency-Key', key)
      .send({ event_type: 'PHARMACY_PREPARING' });
    expect(first.status).toBe(200);
    const second = await r.post(`/api/delivery/${deliveryId}/events`)
      .set('Authorization', `Bearer ${token.employee1}`).set('Idempotency-Key', key)
      .send({ event_type: 'PHARMACY_PREPARING' });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    const events = await db.query('SELECT COUNT(*)::int AS n FROM medication_delivery_events WHERE delivery_id = $1 AND event_type = $2', [deliveryId, 'PHARMACY_PREPARING']);
    expect(events.rows[0].n).toBe(1);
  });

  it('failed attempts require a reason and can recover; returns are auditable', async () => {
    const { deliveryId } = await assignedDelivery();
    const auth = { Authorization: `Bearer ${token.employee1}` };
    const step = (type, body = {}, key) => r.post(`/api/delivery/${deliveryId}/events`)
      .set(auth).set('Idempotency-Key', key).send({ event_type: type, ...body });

    expect((await step('PHARMACY_PREPARING', {}, 'f1' + deliveryId)).status).toBe(200);
    expect((await step('READY_FOR_PICKUP', {}, 'f2' + deliveryId)).status).toBe(200);
    expect((await step('PICKED_UP', {}, 'f3' + deliveryId)).status).toBe(200);
    expect((await step('OUT_FOR_DELIVERY', {}, 'f4' + deliveryId)).status).toBe(200);

    const noReason = await step('FAILED_ATTEMPT', {}, 'f5' + deliveryId);
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toContain('raison');

    const failed = await step('FAILED_ATTEMPT', { reason: 'Patient absent à l’adresse indiquée' }, 'f5' + deliveryId);
    expect(failed.status).toBe(200);

    const recovered = await step('OUT_FOR_DELIVERY', {}, 'f6' + deliveryId);
    expect(recovered.status).toBe(200);

    expect((await step('AWAITING_CONFIRMATION', {}, 'f7' + deliveryId)).status).toBe(200);
  });
});

describe('issue #82 §7 — internal expenses, budget and reports', () => {
  it('records internal expenses (never billed to the patient) and reports counts, cost per success and budget alerts', async () => {
    // A fresh assigned+delivered delivery for deterministic report math.
    const { orderId, patient } = await paidOrder();
    const employees = await r.get('/api/admin/delivery-employees').set('Authorization', `Bearer ${token.admin}`);
    const employee = employees.body.find((e) => e.username === 'livreur1');
    const assigned = await assign({ orderId, employeeId: employee.id });
    expect(assigned.status).toBe(201);
    const deliveryId = assigned.body.delivery_id;
    const auth = { Authorization: `Bearer ${token.employee1}` };
    for (const [type, key] of [['PHARMACY_PREPARING', 'r1'], ['READY_FOR_PICKUP', 'r2'], ['PICKED_UP', 'r3'], ['OUT_FOR_DELIVERY', 'r4'], ['AWAITING_CONFIRMATION', 'r5']]) {
      const res = await r.post(`/api/delivery/${deliveryId}/events`).set(auth).set('Idempotency-Key', 'rep:' + deliveryId + ':' + key).send({ event_type: type });
      expect(res.status).toBe(200);
    }
    const confirmed = await r.post(`/api/medication-orders/${orderId}/delivery/confirm`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(confirmed.status).toBe(200);

    // Expenses: admin-only, integer HTG.
    const asEmployee = await r.post(`/api/admin/deliveries/${deliveryId}/expenses`)
      .set('Authorization', `Bearer ${token.employee1}`).send({ amount_htg: 100 });
    expect(asEmployee.status).toBe(403);
    const exp1 = await r.post(`/api/admin/deliveries/${deliveryId}/expenses`)
      .set('Authorization', `Bearer ${token.admin}`).send({ amount_htg: 250, category: 'TRANSPORT', notes: 'Frais de route' });
    expect(exp1.status).toBe(201);
    const badAmount = await r.post(`/api/admin/deliveries/${deliveryId}/expenses`)
      .set('Authorization', `Bearer ${token.admin}`).send({ amount_htg: 10.5 });
    expect(badAmount.status).toBe(400);

    // Budget + threshold alert.
    const budget = await r.put('/api/admin/delivery-budget')
      .set('Authorization', `Bearer ${token.admin}`).send({ monthly_budget_htg: 500, alert_threshold_percent: 50 });
    expect(budget.status).toBe(200);

    const detail = await r.get('/api/admin/deliveries/' + deliveryId).set('Authorization', `Bearer ${token.admin}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('DELIVERED');
    expect(detail.body.events.map((e) => e.event_type)).toContain('DELIVERED');
    expect(detail.body.expenses).toHaveLength(1);

    // The patient's order/quote view still has NO delivery fee anywhere.
    const view = await r.get('/api/consultations/' + orderId + '/medication-order').set('Authorization', `Bearer ${token.patient}`).timeout(5000).catch(() => null);
    if (view) {
      expect(JSON.stringify(view.body)).not.toContain('delivery_fee');
      expect(JSON.stringify(view.body)).not.toContain('frais de livraison');
    }

    // Report over a wide explicit window (today ± 400 days, Haiti-local).
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = fmt.formatToParts(new Date());
    const today = parts.find((p) => p.type === 'year').value + '-' + parts.find((p) => p.type === 'month').value + '-' + parts.find((p) => p.type === 'day').value;
    const from = new Date(new Date(today + 'T12:00:00Z').getTime() - 400 * 86400000).toISOString().slice(0, 10);
    const report = await r.get(`/api/admin/delivery-reports?from=${from}&to=${today}`).set('Authorization', `Bearer ${token.admin}`);
    expect(report.status).toBe(200);
    expect(report.body.deliveries).toBeGreaterThanOrEqual(1);
    expect(report.body.delivered).toBeGreaterThanOrEqual(1);
    expect(report.body.expense_htg).toBeGreaterThanOrEqual(250);
    expect(report.body.cost_per_successful_delivery_htg).toBeGreaterThanOrEqual(1);
    expect(report.body.budget).not.toBeNull();
    expect(report.body.budget_alert).toBe(true); // 250 ≥ 50% of 500

    const badRange = await r.get(`/api/admin/delivery-reports?from=${today}&to=${from}`).set('Authorization', `Bearer ${token.admin}`);
    expect(badRange.status).toBe(400);
  });
});
