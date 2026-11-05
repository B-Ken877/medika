/**
 * Issue #82 — Medika-owned delivery operations (complete medication journey).
 *
 * Coverage (spec §7 + §11 Delivery):
 *  - explicit DB-driven coverage: patient zone list = ACTIVE zones only;
 *    admin zone create/activate/deactivate; fail-closed order creation;
 *  - delivery-employee accounts: admin-only provisioning, validation,
 *    duplicate username, availability toggle; no public employee registration;
 *  - assignment: PAID orders only, valid available employee, active matching
 *    zone, Friday scheduling server-side, urgent exception requires an
 *    audited reason, single delivery per order (sequential + concurrent);
 *  - employee portal isolation: an employee sees ONLY own deliveries;
 *    unassigned employees get 404 on transition attempts;
 *  - chain of custody: full happy path, invalid transitions rejected,
 *    idempotency-key duplicates are no-ops, failure reasons required,
 *    recovery paths, patient confirmation is the ONLY path to DELIVERED;
 *  - patient tracking ownership and French notifications (assignment +
 *    custody updates, no medical content);
 *  - internal expense ledger (integer HTG, admin-only) and the strict money
 *    boundary: delivery is always free to the patient (0 HTG);
 *  - reports: weekly/monthly rows, cost per successful delivery, budget and
 *    alert threshold; explicit period validation; admin-only access.
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';
process.env.MONCASH_CLIENT_ID = 'test-medika-client';
process.env.MONCASH_CLIENT_SECRET = 'test-medika-secret';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
const h = await import('./helpers');

let r, users, token = {};
let db;
let employeeSeq = 0;

const ITEMS = [
  { name: 'Paracétamol', strength: '500 mg', form: 'comprimé', dose: '1 comprimé', frequency: '3 fois par jour', duration: '5 jours', quantity: '15 comprimés' },
  { name: 'Ibuprofène', strength: '200 mg', dose: '1 comprimé', frequency: '2 fois par jour', duration: '3 jours', quantity: '6 comprimés' },
];

let patientSeq = 0;

async function freshPatient() {
  patientSeq += 1;
  const usersRepo = await import('../src/repos/users.js').then((m) => m.default ?? m);
  const { hashPassword, issueToken } = await import('../src/auth.js').then((m) => m.default ?? m);
  const id = `patient_dlv_${patientSeq}`;
  const username = `t.dlv_${patientSeq}`;
  await usersRepo.create({
    id, username, password_hash: hashPassword('Passw0rd!'),
    role: 'patient', name: `Pat DLV ${patientSeq}`, age: 30,
  });
  return { id, name: `Pat DLV ${patientSeq}`, token: issueToken({ id, role: 'patient', username, name: `Pat DLV ${patientSeq}` }) };
}

async function consultationWithPrescription({ patient: pat } = {}) {
  const p = pat || (await freshPatient());
  const created = await r.post('/api/consultations')
    .set('Authorization', `Bearer ${p.token}`)
    .send({
      description: 'Douleurs abdominales', specialtyNeeded: 'Medecine Generale',
      urgencyLevel: 'Moyenne', doctorId: users.doctor.id, patientAge: 30,
    });
  expect(created.status).toBe(201);
  const consId = created.body.id;
  const accepted = await r.put(`/api/consultations/${consId}/accept`)
    .set('Authorization', `Bearer ${token.doctor}`);
  expect(accepted.status).toBe(200);
  const issued = await r.put(`/api/consultations/${consId}/prescription`)
    .set('Authorization', `Bearer ${token.doctor}`)
    .send({ items: ITEMS, general_instructions: 'Repos et hydratation.' });
  expect(issued.status).toBe(200);
  return { consId, patient: p };
}

async function createOrder(patient, consId, extra = {}) {
  return r.post(`/api/consultations/${consId}/medication-order`)
    .set('Authorization', `Bearer ${patient.token}`)
    .send({
      delivery_address: '12, rue Ka o, Port-au-Prince',
      delivery_phone: '+50937142536',
      delivery_city: 'Port-au-Prince',
      delivery_zone_id: 'ZONE_TEST_CENTRE',
      ...extra,
    });
}

async function createPharmacy(extra = {}) {
  const res = await r.post('/api/admin/pharmacies')
    .set('Authorization', 'Bearer ' + token.admin)
    .send({ name: 'Pharmacie Test DLV', whatsapp_number: '+509 37 14 25 36', location: 'Port-au-Prince', ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

function quotePayload(pharmacyId, overrides = {}) {
  return {
    pharmacy_id: pharmacyId,
    items: [
      { prescription_index: 0, availability: 'AVAILABLE', unit_price_htg: 25, quantity: 15 },
      { prescription_index: 1, availability: 'AVAILABLE', unit_price_htg: 50, quantity: 6 },
    ],
    expires_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    ...overrides,
  };
}

/** Drive an order to server-verified PAID through the real API with mocked
 *  MonCash provider responses (no sleeps, no production provider calls). */
async function paidOrderFixture({ patient: pat } = {}) {
  const { consId, patient } = await consultationWithPrescription({ patient: pat });
  const created = await createOrder(patient, consId);
  expect(created.status).toBe(201);
  const order = created.body;
  const pharmacy = await createPharmacy();
  const quote = await r.post('/api/admin/medication-orders/' + order.id + '/quotes')
    .set('Authorization', 'Bearer ' + token.admin)
    .send(quotePayload(pharmacy.id));
  expect(quote.status).toBe(201);
  const accepted = await r.post('/api/medication-orders/' + order.id + '/accept')
    .set('Authorization', 'Bearer ' + patient.token);
  expect(accepted.status).toBe(200);

  const moncash = createRequire(import.meta.url)('../src/moncash.js');
  // NOTE: the app resolves modules through Node's CJS require cache — mocking
  // via `await import()` would patch a separate vite-node instance and the
  // route would call the real provider. (Same fix as the issue-83 suite.)
  const createSpy = vi.spyOn(moncash, 'createPayment').mockResolvedValue({
    redirectUrl: 'https://moncash.example/checkout',
  });
  const start = await r.post('/api/medication-orders/' + order.id + '/payment/create')
    .set('Authorization', 'Bearer ' + patient.token)
    .send({});
  expect(start.status).toBe(200);
  createSpy.mockRestore();

  const verifySpy = vi.spyOn(moncash, 'retrieveByOrderId').mockResolvedValue({
    reference: start.body.payment.payment_reference,
    transactionId: 'TX_DLV_' + order.id,
    amount: start.body.payment.amount_htg,
    status: 'completed',
    raw: { status: 'successful' },
  });
  const verified = await r.post('/api/medication-orders/' + order.id + '/payment/verify')
    .set('Authorization', 'Bearer ' + patient.token)
    .send({});
  expect(verified.status).toBe(200);
  expect(verified.body.payment.status).toBe('PAID');
  verifySpy.mockRestore();
  return { consId, patient, order, quote: quote.body, total: start.body.payment.amount_htg };
}

/** Admin-provisioned delivery employee. Tokens are minted directly by
 *  default (the login endpoint is throttled per-IP: 10/min across the whole
 *  file); pass viaHttp to verify the real login path in a single test. */
async function createDeliveryEmployee({ available = true, viaHttp = false } = {}) {
  employeeSeq += 1;
  const username = `livreur.dlv.${employeeSeq}`;
  const res = await r.post('/api/admin/delivery-employees')
    .set('Authorization', 'Bearer ' + token.admin)
    .send({
      username,
      password: 'Livraison#2026!',
      name: `Livreur DLV ${employeeSeq}`,
      phone: '+5093714000' + String(employeeSeq).padStart(1, '0'),
    });
  expect(res.status).toBe(201);
  const employee = res.body;
  if (!available) {
    const off = await r.patch('/api/admin/delivery-employees/' + employee.id + '/availability')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ is_available: false });
    expect(off.status).toBe(200);
  }
  if (viaHttp) {
    const login = await r.post('/api/auth/login').send({ username, password: 'Livraison#2026!' });
    expect(login.status).toBe(200);
    return { ...employee, token: login.body.token, password: 'Livraison#2026!' };
  }
  const { issueToken } = await import('../src/auth.js').then((m) => m.default ?? m);
  return {
    ...employee,
    token: issueToken({ id: employee.id, role: 'delivery', username, name: employee.name }),
    password: 'Livraison#2026!',
  };
}

function nextFriday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const d = new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 5);
  return d.toISOString().slice(0, 10);
}

function nextNonFriday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const d = new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 5);
  return d.toISOString().slice(0, 10);
}

async function assign(orderId, employee, { scheduledFor = nextFriday(), zone = null, urgent = false, urgentReason = '' } = {}) {
  const res = await r.post('/api/admin/deliveries/assign')
    .set('Authorization', 'Bearer ' + token.admin)
    .send({
      medication_order_id: orderId,
      employee_id: employee.id,
      zone_id: zone || 'ZONE_TEST_CENTRE',
      scheduled_for: scheduledFor,
      urgent,
      urgent_reason: urgentReason,
    });
  if (![201, 409].includes(res.status)) {
    console.error('[debug] assign ->', res.status, JSON.stringify(res.body), '| employee:', employee.id);
  }
  return res;
}

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.admin = await h.loginToken(r, 't.admin');
  db = await import('../src/db.js').then((m) => m.default ?? m);
  // Distinctly-named active zone (does NOT collide with the migration-013
  // seed row ZONE_PAP — ON CONFLICT would keep the original id and this
  // file's fixture id would not exist).
  await db.query(`DELETE FROM delivery_zones WHERE city = 'Port-au-Prince' AND zone_name = 'Centre-ville'`);
  await db.query(
    `INSERT INTO delivery_zones (id, city, zone_name, active)
     VALUES ('ZONE_TEST_CENTRE', 'Port-au-Prince', 'Centre-ville', TRUE)`
  );
});

afterAll(async () => {
  // Leave the shared delivery_zones table in the state the issue-83 suite
  // expects (only ZONE_PAP active). Rows referenced by test orders cannot be
  // deleted (FK) — deactivating them is enough: the patient zone picker only
  // exposes ACTIVE records.
  if (db) {
    await db.query(`UPDATE delivery_zones SET active = FALSE WHERE id LIKE 'ZONE_TEST%' OR zone_name = 'Delmas'`);
    await db.query(`UPDATE delivery_zones SET active = TRUE WHERE id = 'ZONE_PAP'`);
  }
  await h.closeAll();
});

describe('issue #82 — coverage zones (DB-driven, fail-closed)', () => {
  it('lists only ACTIVE zones to patients; anonymous access is rejected', async () => {
    await db.query(
      `INSERT INTO delivery_zones (id, city, zone_name, active)
       VALUES ('ZONE_TEST_INACTIVE', 'Port-au-Prince', 'Pétion-Ville', FALSE)
       ON CONFLICT (city, zone_name) DO UPDATE SET active = FALSE`
    );
    const res = await r.get('/api/delivery-zones').set('Authorization', 'Bearer ' + token.patient);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.zones)).toBe(true);
    const names = res.body.zones.map((z) => z.zone_name);
    expect(names).toContain('Centre-ville');
    expect(names).not.toContain('Pétion-Ville');
    expect(res.body.zones.every((z) => z.city && z.zone_name && z.id)).toBe(true);
    expect(res.body.zones.every((z) => !('active' in z))).toBe(true); // public projection

    const anon = await r.get('/api/delivery-zones');
    expect([401, 403]).toContain(anon.status);
  });

  it('admin creates, re-activates and deactivates zones without code changes; non-admins refused', async () => {
    const created = await r.post('/api/admin/delivery-zones')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ city: 'Port-au-Prince', zone_name: 'Delmas', active: true });
    expect(created.status).toBe(201);
    expect(created.body.active).toBe(true);

    // Upsert on the same (city, zone) toggles activation without duplicating.
    const off = await r.post('/api/admin/delivery-zones')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ city: 'Port-au-Prince', zone_name: 'Delmas', active: false });
    expect(off.status).toBe(201);
    expect(off.body.active).toBe(false);

    const dupes = await db.query(
      `SELECT COUNT(*)::int AS n FROM delivery_zones WHERE city = 'Port-au-Prince' AND zone_name = 'Delmas'`
    );
    expect(dupes.rows[0].n).toBe(1);

    const invalid = await r.post('/api/admin/delivery-zones')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ city: '', zone_name: '' });
    expect(invalid.status).toBe(400);

    const patientTry = await r.post('/api/admin/delivery-zones')
      .set('Authorization', 'Bearer ' + token.patient)
      .send({ city: 'Port-au-Prince', zone_name: 'Hack', active: true });
    expect([401, 403]).toContain(patientTry.status);

    // A deactivated zone is immediately unusable for new orders (fail closed).
    const { consId, patient } = await consultationWithPrescription();
    const blocked = await createOrder(patient, consId, { delivery_zone_id: 'ZONE_DELMAS' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('DELIVERY_ZONE_NOT_SUPPORTED');
  });
});

describe('issue #82 — delivery employee accounts', () => {
  it('admin provisions employees; patients/doctors cannot; public registration stays patient-only', async () => {
    const employee = await createDeliveryEmployee();
    expect(employee.role).toBeUndefined(); // safe projection — no role leak
    expect(employee.is_available).toBe(true);

    const dup = await r.post('/api/admin/delivery-employees')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ username: employee.username, password: 'Livraison#2026!', name: 'Double' });
    expect(dup.status).toBe(409);

    const weak = await r.post('/api/admin/delivery-employees')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ username: 'livreur.faible', password: 'court', name: 'Faible' });
    expect(weak.status).toBe(400);

    const patientTry = await r.post('/api/admin/delivery-employees')
      .set('Authorization', 'Bearer ' + token.patient)
      .send({ username: 'livreur.hack', password: 'Livraison#2026!', name: 'Hack' });
    expect([401, 403]).toContain(patientTry.status);

    // Public registration is hardcoded patient-only.
    const pub = await r.post('/api/auth/register').send({
      username: 't.public.dlv', password: 'Passw0rd!', name: 'Public',
    });
    expect(pub.status).toBe(201);
    const me = await r.get('/api/profile').set('Authorization', 'Bearer ' + pub.body.token);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('patient');
  });

  it('employee logs in through the normal login and availability toggle blocks assignment', async () => {
    // One real HTTP login proves the delivery role uses the normal path.
    const employee = await createDeliveryEmployee({ viaHttp: true });
    expect(employee.token).toBeTruthy();
    const off = await r.patch('/api/admin/delivery-employees/' + employee.id + '/availability')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ is_available: false });
    expect(off.status).toBe(200);
    expect(off.body.is_available).toBe(false);

    const { order } = await paidOrderFixture();
    const rejected = await assign(order.id, employee);
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe('INVALID_EMPLOYEE');
  });
});

describe('issue #82 — assignment rules', () => {
  it('assigns a PAID order on a Friday with an available employee and matching active zone', async () => {
    const employee = await createDeliveryEmployee();
    const { consId, patient, order, total } = await paidOrderFixture();
    const res = await assign(order.id, employee);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    // Patient was notified (generic French copy, no medical content).
    const notifs = await db.query(
      `SELECT body FROM notifications WHERE user_id = $1 AND event_type = 'medication:delivery-assigned'`,
      [patient.id]
    );
    expect(notifs.rows.length).toBe(1);
    expect(notifs.rows[0].body).toMatch(/vendredi/i);
    expect(notifs.rows[0].body).not.toMatch(/Parac|Ibupro|douleur/i);

    // The employee sees the delivery with fulfilment data only.
    const mine = await r.get('/api/delivery/my').set('Authorization', 'Bearer ' + employee.token);
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    const delivery = mine.body[0];
    expect(delivery.reference).toBe(order.reference);
    expect(delivery.status).toBe('ASSIGNED');
    // Minimum fulfilment data — never diagnosis/notes/prescription content.
    expect(JSON.stringify(delivery)).not.toMatch(/Douleurs abdominales|Paracétamol|Ibuprofène|general_instructions/i);
    expect([delivery.patient_name, delivery.delivery_address, delivery.delivery_phone, delivery.pickup_pharmacy_name, delivery.pickup_reference].every(Boolean)).toBe(true);
  });

  it('refuses unpaid orders, invalid zones, and missing quotes', async () => {
    const employee = await createDeliveryEmployee();
    // NOT_PAID: an ACCEPTED but unpaid order.
    const { consId, patient } = await consultationWithPrescription();
    const created = await createOrder(patient, consId);
    const pharmacy = await createPharmacy();
    await r.post('/api/admin/medication-orders/' + created.body.id + '/quotes')
      .set('Authorization', 'Bearer ' + token.admin)
      .send(quotePayload(pharmacy.id));
    await r.post('/api/medication-orders/' + created.body.id + '/accept')
      .set('Authorization', 'Bearer ' + patient.token);
    const unpaid = await assign(created.body.id, employee);
    expect(unpaid.status).toBe(409);
    expect(unpaid.body.code).toBe('NOT_PAID');

    // NO_ACTIVE_QUOTE + PAID: pay an order whose quote was later removed.
    const { order } = await paidOrderFixture();
    await db.query(`UPDATE pharmacy_quotes SET superseded_at = now() WHERE order_id = $1`, [order.id]);
    const noQuote = await assign(order.id, employee);
    expect(noQuote.status).toBe(409);
    expect(noQuote.body.code).toBe('NO_ACTIVE_QUOTE');

    // INVALID_ZONE: inactive zone not matching the order.
    const { order: order2 } = await paidOrderFixture();
    const wrongZone = await assign(order2.id, employee, { zone: 'ZONE_TEST_INACTIVE' });
    expect(wrongZone.status).toBe(400);
    expect(wrongZone.body.code).toBe('INVALID_ZONE');
  });

  it('enforces Friday scheduling server-side; urgent requires an audited reason', async () => {
    const employee = await createDeliveryEmployee();
    const { order } = await paidOrderFixture();

    const nonFriday = await assign(order.id, employee, { scheduledFor: nextNonFriday() });
    expect(nonFriday.status).toBe(400);
    expect(nonFriday.body.code).toBe('FRIDAY_ONLY');

    const urgentNoReason = await assign(order.id, employee, {
      scheduledFor: nextNonFriday(), urgent: true, urgentReason: 'court',
    });
    expect(urgentNoReason.status).toBe(400);
    expect(urgentNoReason.body.code).toBe('URGENT_REASON_REQUIRED');

    const pastDate = await assign(order.id, employee, { scheduledFor: '2020-01-03' });
    expect(pastDate.status).toBe(400);
    expect(pastDate.body.code).toBe('INVALID_DATE');

    const urgent = await assign(order.id, employee, {
      scheduledFor: nextNonFriday(), urgent: true,
      urgentReason: 'Patient sans médicaments critiques cette semaine',
    });
    expect(urgent.status).toBe(201);

    const events = await db.query(
      `SELECT event_type, reason, actor_role FROM medication_delivery_events WHERE delivery_id = $1 ORDER BY created_at`,
      [urgent.body.delivery_id]
    );
    expect(events.rows[0]).toMatchObject({ event_type: 'ASSIGNED', actor_role: 'admin' });
    expect(events.rows[0].reason).toContain('médicaments critiques');
  });

  it('one delivery per order — sequential AND concurrent assignment', async () => {
    const employee = await createDeliveryEmployee();
    const { order } = await paidOrderFixture();
    const first = await assign(order.id, employee);
    expect(first.status).toBe(201);
    const second = await assign(order.id, employee);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('ALREADY_ASSIGNED');

    const { order: order2 } = await paidOrderFixture();
    const results = await Promise.all([
      assign(order2.id, employee),
      assign(order2.id, employee),
    ]);
    const createdCount = results.filter((res) => res.status === 201).length;
    expect(createdCount).toBe(1);
    expect(results.every((res) => [201, 409].includes(res.status))).toBe(true);
  });
});

describe('issue #82 — employee portal isolation and custody chain', () => {
  async function assignedDelivery({ urgent = false } = {}) {
    const employee = await createDeliveryEmployee();
    const { consId, patient, order } = await paidOrderFixture();
    const res = await assign(order.id, employee, urgent ? {
      scheduledFor: nextNonFriday(), urgent: true, urgentReason: 'Traitement urgent requis par le médecin',
    } : {});
    expect(res.status).toBe(201);
    const mine = await r.get('/api/delivery/my').set('Authorization', 'Bearer ' + employee.token);
    const delivery = mine.body.find((d) => d.id === res.body.delivery_id);
    expect(delivery).toBeTruthy();
    return { employee, patient, order, delivery, consId };
  }

  it('employee sees only own deliveries; another employee gets 404 on transition', async () => {
    const { employee, delivery } = await assignedDelivery();
    const other = await createDeliveryEmployee();

    const otherMine = await r.get('/api/delivery/my').set('Authorization', 'Bearer ' + other.token);
    expect(otherMine.status).toBe(200);
    expect(otherMine.body.some((d) => d.id === delivery.id)).toBe(false);

    const hijack = await r.post('/api/delivery/' + delivery.id + '/events')
      .set('Authorization', 'Bearer ' + other.token)
      .set('Idempotency-Key', 'hijack-attempt-001')
      .send({ event_type: 'PHARMACY_PREPARING' });
    expect(hijack.status).toBe(404);

    // Delivery role required — a patient token cannot call the portal.
    const patientTry = await r.get('/api/delivery/my').set('Authorization', 'Bearer ' + token.patient);
    expect([401, 403]).toContain(patientTry.status);

    const ok = await r.post('/api/delivery/' + delivery.id + '/events')
      .set('Authorization', 'Bearer ' + employee.token)
      .set('Idempotency-Key', 'custody-pp-001')
      .send({ event_type: 'PHARMACY_PREPARING' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('PHARMACY_PREPARING');
  });

  it('walks the full happy path to AWAITING_CONFIRMATION; patient confirmation is the only path to DELIVERED', async () => {
    const { employee, patient, order, delivery } = await assignedDelivery();
    const steps = ['PHARMACY_PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'AWAITING_CONFIRMATION'];
    let keySeq = 0;
    for (const step of steps) {
      keySeq += 1;
      const res = await r.post('/api/delivery/' + delivery.id + '/events')
        .set('Authorization', 'Bearer ' + employee.token)
        .set('Idempotency-Key', 'happy-' + delivery.id + '-' + keySeq)
        .send({ event_type: step });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(step);
    }

    // An employee CANNOT mark DELIVERED — not a valid employee transition.
    const fakeDelivery = await r.post('/api/delivery/' + delivery.id + '/events')
      .set('Authorization', 'Bearer ' + employee.token)
      .set('Idempotency-Key', 'fake-delivered-001')
      .send({ event_type: 'DELIVERED' });
    expect(fakeDelivery.status).toBe(400);

    // Patient confirms — the only DELIVERED path.
    const confirm = await r.post('/api/medication-orders/' + order.id + '/delivery/confirm')
      .set('Authorization', 'Bearer ' + patient.token)
      .send({});
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe('DELIVERED');

    const tracking = await r.get('/api/medication-orders/' + order.id + '/delivery')
      .set('Authorization', 'Bearer ' + patient.token);
    expect(tracking.status).toBe(200);
    expect(tracking.body.status).toBe('DELIVERED');
    const types = tracking.body.events.map((e) => e.event_type);
    expect(types).toEqual(['ASSIGNED', ...steps, 'DELIVERED']);
    expect(tracking.body.events[tracking.body.events.length - 1].actor_role).toBe('patient');
  });

  it('rejects invalid transitions, requires failure reasons, and supports recovery', async () => {
    const { employee, delivery } = await assignedDelivery();
    const post = (eventType, reason = '', key = 'inv-' + eventType + '-1') =>
      r.post('/api/delivery/' + delivery.id + '/events')
        .set('Authorization', 'Bearer ' + employee.token)
        .set('Idempotency-Key', key)
        .send({ event_type: eventType, reason });

    // ASSIGNED -> OUT_FOR_DELIVERY is not a legal jump.
    const skip = await post('OUT_FOR_DELIVERY');
    expect(skip.status).toBe(409);
    expect(skip.body.error).toMatch(/statut/i);

    const unknown = await post('TELEPORTED');
    expect(unknown.status).toBe(400);

    const noKey = await r.post('/api/delivery/' + delivery.id + '/events')
      .set('Authorization', 'Bearer ' + employee.token)
      .send({ event_type: 'PHARMACY_PREPARING' });
    expect(noKey.status).toBe(400);

    await post('PHARMACY_PREPARING');
    await post('READY_FOR_PICKUP');
    await post('PICKED_UP');
    await post('OUT_FOR_DELIVERY');

    // FAILED_ATTEMPT without a reason is refused.
    const failNoReason = await post('FAILED_ATTEMPT');
    expect(failNoReason.status).toBe(400);
    expect(failNoReason.body.error).toMatch(/raison/i);

    const fail = await post('FAILED_ATTEMPT', 'Patient absent à l’adresse indiquée', 'fail-reason-001');
    expect(fail.status).toBe(200);
    expect(fail.body.status).toBe('FAILED_ATTEMPT');

    // Recovery: retry then escalate to returned.
    const retry = await post('OUT_FOR_DELIVERY', '', 'retry-after-fail-001');
    expect(retry.status).toBe(200);
    const fail2 = await post('FAILED_ATTEMPT', 'Adresse introuvable, contact sans réponse', 'fail-reason-002');
    expect(fail2.status).toBe(200);
    const returned = await post('RETURNED_ESCALATED', 'Colis retourné à Medika pour reprogrammation', 'return-001');
    expect(returned.status).toBe(200);
    expect(returned.body.status).toBe('RETURNED_ESCALATED');

    // Terminal: no further employee transitions.
    const after = await post('OUT_FOR_DELIVERY', '', 'after-terminal-001');
    expect(after.status).toBe(409);
  });

  it('duplicate idempotency keys are safe no-ops (idempotent retries)', async () => {
    const { employee, delivery } = await assignedDelivery();
    const payload = {
      event_type: 'PHARMACY_PREPARING',
    };
    const first = await r.post('/api/delivery/' + delivery.id + '/events')
      .set('Authorization', 'Bearer ' + employee.token)
      .set('Idempotency-Key', 'dup-key-stable-001')
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeUndefined();

    const retry = await r.post('/api/delivery/' + delivery.id + '/events')
      .set('Authorization', 'Bearer ' + employee.token)
      .set('Idempotency-Key', 'dup-key-stable-001')
      .send(payload);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.status).toBe('PHARMACY_PREPARING');

    const events = await db.query(
      'SELECT COUNT(*)::int AS n FROM medication_delivery_events WHERE delivery_id = $1',
      [delivery.id]
    );
    expect(events.rows[0].n).toBe(2); // ASSIGNED + one PHARMACY_PREPARING
  });

  it('patient tracking enforces ownership (cross-patient 404) and confirms only at the right stage', async () => {
    const { employee, patient, order, delivery } = await assignedDelivery();
    const stranger = await freshPatient();
    const strangerView = await r.get('/api/medication-orders/' + order.id + '/delivery')
      .set('Authorization', 'Bearer ' + stranger.token);
    expect(strangerView.status).toBe(404);

    const tooEarly = await r.post('/api/medication-orders/' + order.id + '/delivery/confirm')
      .set('Authorization', 'Bearer ' + patient.token)
      .send({});
    expect(tooEarly.status).toBe(409);

    for (const [i, step] of ['PHARMACY_PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'AWAITING_CONFIRMATION'].entries()) {
      await r.post('/api/delivery/' + delivery.id + '/events')
        .set('Authorization', 'Bearer ' + employee.token)
        .set('Idempotency-Key', 'track-' + delivery.id + '-' + i)
        .send({ event_type: step });
    }
    // Stranger still cannot confirm.
    const strangerConfirm = await r.post('/api/medication-orders/' + order.id + '/delivery/confirm')
      .set('Authorization', 'Bearer ' + stranger.token)
      .send({});
    expect([403, 404]).toContain(strangerConfirm.status);

    const confirm = await r.post('/api/medication-orders/' + order.id + '/delivery/confirm')
      .set('Authorization', 'Bearer ' + patient.token)
      .send({});
    expect(confirm.status).toBe(200);
  });

  it('notifies the patient in French on custody updates without any medical content', async () => {
    const { employee, patient, delivery } = await assignedDelivery();
    await r.post('/api/delivery/' + delivery.id + '/events')
      .set('Authorization', 'Bearer ' + employee.token)
      .set('Idempotency-Key', 'notify-out-001')
      .send({ event_type: 'PHARMACY_PREPARING' });
    await r.post('/api/delivery/' + delivery.id + '/events')
      .set('Authorization', 'Bearer ' + employee.token)
      .set('Idempotency-Key', 'notify-out-002')
      .send({ event_type: 'READY_FOR_PICKUP' });
    await r.post('/api/delivery/' + delivery.id + '/events')
      .set('Authorization', 'Bearer ' + employee.token)
      .set('Idempotency-Key', 'notify-out-003')
      .send({ event_type: 'PICKED_UP' });
    await r.post('/api/delivery/' + delivery.id + '/events')
      .set('Authorization', 'Bearer ' + employee.token)
      .set('Idempotency-Key', 'notify-out-004')
      .send({ event_type: 'OUT_FOR_DELIVERY' });

    // PHARMACY_PREPARING / READY_FOR_PICKUP are internal steps — no patient
    // notification; PICKED_UP and OUT_FOR_DELIVERY notify the patient.
    const notifs = await db.query(
      `SELECT body FROM notifications
        WHERE user_id = $1 AND event_type = 'medication:delivery-update'
        ORDER BY created_at`,
      [patient.id]
    );
    expect(notifs.rows).toHaveLength(2);
    const bodies = notifs.rows.map((n) => n.body).join(' | ');
    expect(bodies).toContain('récupérée à la pharmacie');
    expect(bodies).toContain('en route vers votre adresse');
    expect(bodies).not.toMatch(/Parac|Ibupro|Douleurs/i);
  });
});

describe('issue #82 — expenses, money boundary, reports and budget', () => {
  it('records internal expenses (integer HTG, admin-only) — never billed to the patient', async () => {
    const employee = await createDeliveryEmployee();
    const { patient, order } = await paidOrderFixture();
    const assigned = await assign(order.id, employee);
    expect(assigned.status).toBe(201);

    const ok = await r.post('/api/admin/deliveries/' + assigned.body.delivery_id + '/expenses')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ amount_htg: 250, category: 'TRANSPORT', notes: 'Taxi vers Delmas' });
    expect(ok.status).toBe(201);

    const fractional = await r.post('/api/admin/deliveries/' + assigned.body.delivery_id + '/expenses')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ amount_htg: 12.5 });
    expect(fractional.status).toBe(400);

    const negative = await r.post('/api/admin/deliveries/' + assigned.body.delivery_id + '/expenses')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ amount_htg: -5 });
    expect(negative.status).toBe(400);

    const patientTry = await r.post('/api/admin/deliveries/' + assigned.body.delivery_id + '/expenses')
      .set('Authorization', 'Bearer ' + token.patient)
      .send({ amount_htg: 1 });
    expect([401, 403]).toContain(patientTry.status);

    // Money boundary: patient paid the medication total only — the expense is
    // Medika-internal and never surfaces in the patient's delivery tracking.
    expect(ok.body.expense.amount_htg).toBe(250);
    const view = await r.get('/api/medication-orders/' + order.id + '/delivery')
      .set('Authorization', 'Bearer ' + patient.token);
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.body)).not.toMatch(/expense|250/);
  });

  it('delivery is always 0 HTG for the patient: payment amount equals medication total, no fee field exists', async () => {
    const { consId, patient, order, total } = await paidOrderFixture();
    const employee = await createDeliveryEmployee();
    await assign(order.id, employee);
    expect(total).toBe(675); // 25*15 + 50*6 — medication only

    const schemaQuotes = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'pharmacy_quotes' AND column_name LIKE '%delivery%'`
    );
    expect(schemaQuotes.rows).toHaveLength(0);
    const schemaPayments = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'medication_payments' AND column_name LIKE '%delivery%'`
    );
    expect(schemaPayments.rows).toHaveLength(0);

    // The patient's own order view carries no delivery charge whatsoever.
    const view = await r.get('/api/consultations/' + consId + '/medication-order')
      .set('Authorization', 'Bearer ' + patient.token);
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.body)).not.toMatch(/delivery_fee|frais de livraison/i);
  });

  it('reports weekly/monthly counts, cost per successful delivery, budget threshold alert; admin-only', async () => {
    const employee = await createDeliveryEmployee();
    const { patient, order } = await paidOrderFixture();
    const assigned = await assign(order.id, employee);
    // Walk to DELIVERED.
    let keySeq = 0;
    for (const step of ['PHARMACY_PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'AWAITING_CONFIRMATION']) {
      keySeq += 1;
      await r.post('/api/delivery/' + assigned.body.delivery_id + '/events')
        .set('Authorization', 'Bearer ' + employee.token)
        .set('Idempotency-Key', 'report-' + assigned.body.delivery_id + '-' + keySeq)
        .send({ event_type: step });
    }
    await r.post('/api/medication-orders/' + order.id + '/delivery/confirm')
      .set('Authorization', 'Bearer ' + patient.token).send({});
    await r.post('/api/admin/deliveries/' + assigned.body.delivery_id + '/expenses')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ amount_htg: 150, category: 'TRANSPORT', notes: 'Rapport' });

    const budget = await r.put('/api/admin/delivery-budget')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ monthly_budget_htg: 150, alert_threshold_percent: 100 });
    expect(budget.status).toBe(200);

    const today = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const get = (t) => today.find((p) => p.type === t).value;
    const to = `${get('year')}-${get('month')}-${get('day')}`;
    const from = to.slice(0, 7) + '-01';

    const report = await r.get('/api/admin/delivery-reports?from=' + from + '&to=' + to)
      .set('Authorization', 'Bearer ' + token.admin);
    expect(report.status).toBe(200);
    expect(report.body.delivered).toBeGreaterThanOrEqual(1);
    expect(report.body.expense_htg).toBeGreaterThanOrEqual(150);
    expect(report.body.cost_per_successful_delivery_htg).toBeTypeOf('number');
    expect(report.body.budget.monthly_budget_htg).toBe(150);
    expect(report.body.current_month_expense_htg).toBeGreaterThanOrEqual(150);
    // Month expense >= 100% of the 150 HTG budget -> alert must fire.
    expect(report.body.budget_alert).toBe(true);
    expect(Array.isArray(report.body.weekly)).toBe(true);
    expect(Array.isArray(report.body.monthly)).toBe(true);

    // A comfortable budget does not alert (threshold semantics, both sides).
    await r.put('/api/admin/delivery-budget')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ monthly_budget_htg: 10_000_000, alert_threshold_percent: 1 });
    const calm = await r.get('/api/admin/delivery-reports?from=' + from + '&to=' + to)
      .set('Authorization', 'Bearer ' + token.admin);
    expect(calm.body.budget_alert).toBe(false);
    expect(calm.body.cost_per_successful_delivery_htg).toBe(
      Math.round(calm.body.expense_htg / calm.body.delivered)
    );

    const badPeriod = await r.get('/api/admin/delivery-reports?from=2026-13-99&to=' + to)
      .set('Authorization', 'Bearer ' + token.admin);
    expect(badPeriod.status).toBe(400);

    const patientTry = await r.get('/api/admin/delivery-reports')
      .set('Authorization', 'Bearer ' + token.patient);
    expect([401, 403]).toContain(patientTry.status);
  });
});
