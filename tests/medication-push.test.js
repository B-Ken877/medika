/**
 * Medication push delivery (owner request, Nov 2026) — the medication
 * lifecycle must reach the SAME push pipeline as consultation events:
 *
 *  - every required lifecycle event creates a PUSH-ELIGIBLE outbox row
 *    (order submitted → ops admins, quote → patient, payment verified →
 *    patient + admins, payment manual review → patient + admins, delivery
 *    assigned → patient);
 *  - the dispatcher is EVENT-AGNOSTIC: medication rows are delivered by the
 *    same drain that delivers consultation rows (web-push stubbed; a 201
 *    from the push service is the documented "accepted for delivery" level —
 *    real-device display stays a manual test, per PUSH_NOTIFICATIONS.md);
 *  - category preferences suppress medication delivery at dispatch time;
 *  - consultation request rows keep flowing through the SAME dispatcher
 *    (regression guard);
 *  - privacy: generic copy only — never medication names, patient names or
 *    any medical data in notification payloads.
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';
process.env.MONCASH_CLIENT_ID = 'test-medika-client';
process.env.MONCASH_CLIENT_SECRET = 'test-medika-secret';
// VAPID pair generated for CI use only (same pair as notifications.test.js).
process.env.VAPID_PUBLIC_KEY = 'BGY3TmF6Yf1mZTKqkCJ0pXG0vXEEoSTq7FVGGhVQ7lHSSsqQ8adlWgfZqcv-OH2FQ6XlOYMfKKSZhUJfh6S-gxE';
process.env.VAPID_PRIVATE_KEY = 'SfK9aVd4Wk2Hq8mNpC3xT7yLbE5rU1jZ6cX0oIgDfAw';

import { afterAll, beforeAll, describe, expect, it, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const h = await import('./helpers');

const __dirnameMPush = path.dirname(fileURLToPath(import.meta.url));
// The payment routes do `require('../moncash')` natively (vitest
// externalizes CJS) — patch THAT instance, the same object the routes hold.
const nativeRequire = createRequire(path.resolve(__dirnameMPush, '../src/routes/medication-payments.js'));
const moncash = nativeRequire('../moncash.js');

let r, users, token = {}, db;

const ITEMS = [
  { name: 'Paracétamol', strength: '500 mg', form: 'comprimé', dose: '1 comprimé', frequency: '3 fois par jour', duration: '5 jours', quantity: '15 comprimés' },
  { name: 'Ibuprofène', strength: '200 mg', dose: '1 comprimé', frequency: '2 fois par jour', duration: '3 jours', quantity: '6 comprimés' },
];

let patientSeq = 0;
async function freshPatient() {
  patientSeq += 1;
  const usersRepo = await import('../src/repos/users.js').then((m) => m.default ?? m);
  const { hashPassword, issueToken } = await import('../src/auth.js').then((m) => m.default ?? m);
  const id = `patient_mpush_${patientSeq}`;
  const username = `t.mpush_${patientSeq}`;
  await usersRepo.create({
    id, username, password_hash: hashPassword('Passw0rd!'),
    role: 'patient', name: `Pat MPush ${patientSeq}`, age: 30,
  });
  return { id, name: `Pat MPush ${patientSeq}`, token: issueToken({ id, role: 'patient', username, name: `Pat MPush ${patientSeq}` }) };
}

/** Consultation accepted by doctor_t1 with an ISSUED structured prescription. */
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

async function createPharmacy() {
  const res = await r.post('/api/admin/pharmacies')
    .set('Authorization', `Bearer ${token.admin}`)
    .send({ name: 'Pharmacie Push ' + Math.random().toString(36).slice(2, 7), whatsapp_number: '+509 37 14 25 36', location: 'Port-au-Prince' });
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

async function outboxRows(userId) {
  const { rows } = await db.query(
    `SELECT * FROM notification_outbox WHERE user_id = $1 ORDER BY id`,
    [userId]
  );
  return rows;
}

async function waitForOutbox(userId, key, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    const row = (await outboxRows(userId)).find((x) => x.idempotency_key === key);
    if (row) return row;
    if (Date.now() - start > timeoutMs) return null;
    await new Promise((res) => setTimeout(res, 25));
  }
}

let endpointSeq = 0;
function subFixture() {
  endpointSeq += 1;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/mpush-${endpointSeq}`,
    keys: {
      p256dh: 'BEl62iUYgUivxIkvDFy2UUi2M6HxL1lzC2JmVVjKHaCXXrJBCxD5L0FqFfRlFpVbF',
      auth: 'aBcDeFgHiJkLmNoP',
    },
    userAgent: 'vitest',
  };
}

async function subscribe(bearer) {
  const res = await r.post('/api/notifications/subscriptions')
    .set('Authorization', `Bearer ${bearer}`).send(subFixture());
  expect(res.status).toBe(201);
}

/** Force every queued row of these users due NOW (bypasses any grace window
 *  and any backoff) without touching status. */
async function forceDue(userIds) {
  await db.query(
    `UPDATE notification_outbox
        SET next_attempt_at = now() - interval '1 second'
      WHERE status IN ('queued', 'retryable') AND user_id = ANY($1::text[])`,
    [userIds]
  );
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('medication lifecycle → push-eligible notification records', () => {
  it('order submission notifies the OPS ADMINS (in-app + outbox), privacy-safe', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const created = await createOrder(patient, consId);
    expect(created.status).toBe(201);
    const orderId = created.body.id;

    const adminRow = await waitForOutbox(users.admin.id, `medication-order:${orderId}:submitted:admin:${users.admin.id}`);
    expect(adminRow).toBeTruthy();
    expect(adminRow.event_type).toBe('medication:order-submitted');
    expect(adminRow.category).toBe('consultations');
    expect(adminRow.status).toBe('queued'); // push-ELIGIBLE (not suppressed)
    expect(adminRow.url).toBe('/admin/medicaments');
    // PRIVACY: no medication name, no patient name, no prescription content.
    const payload = `${adminRow.title} ${adminRow.body} ${adminRow.url}`;
    for (const secret of ['Paracétamol', 'Ibuprofène', patient.name, 'Douleurs abdominales']) {
      expect(payload).not.toContain(secret);
    }
    // In-app record exists too (same idempotency family, one coherent record).
    const { rows } = await db.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND event_type = 'medication:order-submitted'`,
      [users.admin.id]
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('quote recorded notifies the PATIENT (push-eligible outbox row)', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const created = await createOrder(patient, consId);
    expect(created.status).toBe(201);
    const pharmacy = await createPharmacy();
    const quote = await r.post('/api/admin/medication-orders/' + created.body.id + '/quotes')
      .set('Authorization', `Bearer ${token.admin}`)
      .send(quotePayload(pharmacy.id));
    expect(quote.status).toBe(201);

    const row = await waitForOutbox(patient.id, `medication-order:${created.body.id}:quote:${quote.body.id}`);
    expect(row).toBeTruthy();
    expect(row.event_type).toBe('medication:quoted');
    expect(row.status).toBe('queued');
    expect(`${row.title} ${row.body}`).not.toContain('Paracétamol');
    expect(`${row.title} ${row.body}`).not.toContain(String(quote.body.total_htg ?? ''));
  });

  it('payment verified notifies the PATIENT and the ADMINS (push-eligible)', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const created = await createOrder(patient, consId);
    const pharmacy = await createPharmacy();
    const quote = await r.post('/api/admin/medication-orders/' + created.body.id + '/quotes')
      .set('Authorization', `Bearer ${token.admin}`)
      .send(quotePayload(pharmacy.id));
    expect(quote.status).toBe(201);
    const accepted = await r.post('/api/medication-orders/' + created.body.id + '/accept')
      .set('Authorization', `Bearer ${patient.token}`);
    expect(accepted.status).toBe(200);

    vi.spyOn(moncash, 'createPayment').mockResolvedValue({ redirectUrl: 'https://moncash.example/checkout' });
    const start = await r.post('/api/medication-orders/' + created.body.id + '/payment/create')
      .set('Authorization', `Bearer ${patient.token}`)
      .send({});
    expect(start.status).toBe(200);
    const total = start.body.payment.amount_htg;
    vi.spyOn(moncash, 'retrieveByOrderId').mockResolvedValue({
      reference: start.body.payment.payment_reference,
      transactionId: 'TX_MPUSH_PAID_1',
      amount: total,
      status: 'completed',
      raw: { status: 'successful', cost: total },
    });
    const verified = await r.post('/api/medication-orders/' + created.body.id + '/payment/verify')
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ success: true, amount: total });
    expect(verified.status).toBe(200);

    const patientRow = await waitForOutbox(patient.id, `medication-order:${created.body.id}:payment-verified:patient`);
    expect(patientRow).toBeTruthy();
    expect(patientRow.event_type).toBe('medication:paid');
    expect(patientRow.status).toBe('queued');
    const adminRow = await waitForOutbox(users.admin.id, `medication-order:${created.body.id}:payment-verified:admin:${users.admin.id}`);
    expect(adminRow).toBeTruthy();
    expect(adminRow.event_type).toBe('medication:paid');
  });

  it('payment requiring MANUAL REVIEW notifies patient + admins (push-eligible)', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const created = await createOrder(patient, consId);
    const pharmacy = await createPharmacy();
    const quote = await r.post('/api/admin/medication-orders/' + created.body.id + '/quotes')
      .set('Authorization', `Bearer ${token.admin}`)
      .send(quotePayload(pharmacy.id));
    expect(quote.status).toBe(201);
    const accepted = await r.post('/api/medication-orders/' + created.body.id + '/accept')
      .set('Authorization', `Bearer ${patient.token}`);
    expect(accepted.status).toBe(200);

    vi.spyOn(moncash, 'createPayment').mockResolvedValue({ redirectUrl: 'https://moncash.example/checkout' });
    const start = await r.post('/api/medication-orders/' + created.body.id + '/payment/create')
      .set('Authorization', `Bearer ${patient.token}`)
      .send({});
    expect(start.status).toBe(200);
    // The quote expires DURING checkout → the completed payment is held for
    // manual review (the documented PAYMENT_REVIEW_REQUIRED rule).
    await db.query(
      `UPDATE pharmacy_quotes SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [quote.body.id]
    );
    vi.spyOn(moncash, 'retrieveByOrderId').mockResolvedValue({
      reference: start.body.payment.payment_reference,
      transactionId: 'TX_MPUSH_REVIEW_1',
      amount: start.body.payment.amount_htg,
      status: 'completed',
      raw: { status: 'successful', cost: start.body.payment.amount_htg },
    });
    const review = await r.post('/api/medication-orders/' + created.body.id + '/payment/verify')
      .set('Authorization', `Bearer ${patient.token}`)
      .send({});
    expect(review.status).toBe(409);
    expect(review.body.code).toBe('PAYMENT_REVIEW_REQUIRED');

    const patientRow = await waitForOutbox(patient.id, `medication-order:${created.body.id}:payment-review:${start.body.payment.id}:patient`);
    expect(patientRow).toBeTruthy();
    expect(patientRow.event_type).toBe('medication:payment-review');
    expect(patientRow.status).toBe('queued');
    const adminRow = await waitForOutbox(users.admin.id, `medication-order:${created.body.id}:payment-review:${start.body.payment.id}:admin:${users.admin.id}`);
    expect(adminRow).toBeTruthy();
  });

  it('delivery assignment notifies the PATIENT (push-eligible)', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const created = await createOrder(patient, consId);
    expect(created.status).toBe(201);
    const employee = await r.post('/api/admin/delivery-employees')
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ username: 'livreur.mpush1', password: 'Livraison#2026!', name: 'Livreur MPush', phone: '+50937140001' });
    expect(employee.status).toBe(201);
    // next Friday (the scheduler's weekly delivery day)
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const d = new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`);
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 5);
    const assigned = await r.post('/api/admin/deliveries/assign')
      .set('Authorization', `Bearer ${token.admin}`)
      .send({
        medication_order_id: created.body.id,
        employee_id: employee.body.id,
        zone_id: 'ZONE_PAP',
        scheduled_for: d.toISOString().slice(0, 10),
        urgent: false,
        urgent_reason: '',
      });
    expect([201, 409]).toContain(assigned.status);
    if (assigned.status === 201) {
      const row = await waitForOutbox(patient.id, `delivery:${assigned.body.delivery_id}:assigned`);
      expect(row).toBeTruthy();
      expect(row.event_type).toBe('medication:delivery-assigned');
      expect(row.status).toBe('queued');
      expect(`${row.title} ${row.body}`).not.toContain('Paracétamol');
    }
  });
});

describe('dispatcher delivers medication rows like consultation rows', () => {
  it('ONE dispatcher run delivers medication AND consultation rows (no event-type filtering)', async () => {
    // Recipients subscribed: doctor (consultation:offer), patient, admin.
    await subscribe(await h.loginToken(r, 't.doctor'));
    const { consId, patient } = await consultationWithPrescription();
    await subscribe(patient.token);
    await subscribe(await h.loginToken(r, 't.admin'));
    const created = await createOrder(patient, consId);
    expect(created.status).toBe(201);

    const webpush = (await import('web-push')).default ?? (await import('web-push'));
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201 });

    await forceDue([users.doctor.id, patient.id, users.admin.id]);
    const dispatch = await import('../src/notifications/dispatch.js').then((m) => m.default ?? m);
    const counts = await dispatch.dispatchDueNotifications({ limit: 50 });

    expect(counts.delivered).toBeGreaterThan(0);
    expect(send).toHaveBeenCalled();
    // Every sent payload was addressed to one of the three recipients' endpoints.
    // Terminal states: the fixture rows for these users are all delivered.
    // Scoped to THIS test's records: earlier describe-blocks queued rows for
    // the same users (their lookup by event_type alone would find stale rows
    // drained to 'suppressed' before the recipient subscribed).
    const offerRow = (await outboxRows(users.doctor.id)).find((x) => x.idempotency_key === `consultation:${consId}:offer:${users.doctor.id}`);
    expect(offerRow?.status).toBe('delivered');
    const patientSubmitted = (await outboxRows(patient.id)).find((x) => x.idempotency_key === `consultation:${consId}:submitted`);
    expect(patientSubmitted?.status).toBe('delivered');
    const adminRow = (await outboxRows(users.admin.id)).find((x) => x.idempotency_key === `medication-order:${created.body.id}:submitted:admin:${users.admin.id}`);
    expect(adminRow?.status).toBe('delivered');
    // The web-push stub saw both event families in the same run.
    const payloads = send.mock.calls.map((c) => JSON.parse(c[1]));
    expect(payloads.some((p) => p.tag === 'medika:consultations')).toBe(true);
  });

  it('category preference OFF suppresses medication delivery at dispatch time', async () => {
    const pat = await freshPatient();
    // No subscription for this patient either — but the preference check
    // must win deterministically, so subscribe them first.
    await subscribe(pat.token);
    const prefs = await r.put('/api/notifications/preferences')
      .set('Authorization', `Bearer ${pat.token}`)
      .send({ consultations: false });
    expect(prefs.status).toBe(200);

    const emit = await import('../src/notifications/emit.js').then((m) => m.default ?? m);
    await emit.emit({
      userId: pat.id,
      eventType: 'medication:paid',
      idempotencyKey: `mpush-pref-check:${pat.id}`,
      title: 'Medika',
      body: 'Votre paiement a été confirmé. Votre commande est transmise à notre équipe.',
      url: '/app/consultations',
    });
    await forceDue([pat.id]);
    const dispatch = await import('../src/notifications/dispatch.js').then((m) => m.default ?? m);
    const counts = await dispatch.dispatchDueNotifications({ limit: 50 });
    expect(counts.suppressed).toBeGreaterThan(0);

    const row = (await outboxRows(pat.id)).find((x) => x.idempotency_key === `mpush-pref-check:${pat.id}`);
    expect(row?.status).toBe('suppressed');
    expect(row?.last_error_code).toBe('preference_off');
    // The in-app record is UNAFFECTED (preferences suppress delivery, not the record).
    const { rows } = await db.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND idempotency_key = $2`,
      [pat.id, `mpush-pref-check:${pat.id}`]
    );
    expect(rows.length).toBe(1);
  });

  it('a retryable push-service failure follows the existing retry behavior (backoff, then dead)', async () => {
    const pat = await freshPatient();
    await subscribe(pat.token);
    const emit = await import('../src/notifications/emit.js').then((m) => m.default ?? m);
    await emit.emit({
      userId: pat.id,
      eventType: 'medication:delivery-update',
      idempotencyKey: `mpush-retry:${pat.id}`,
      title: 'Medika',
      body: 'Votre livraison est en cours.',
      url: '/app/consultations',
    });
    const webpush = (await import('web-push')).default ?? (await import('web-push'));
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));
    await forceDue([pat.id]);
    const dispatch = await import('../src/notifications/dispatch.js').then((m) => m.default ?? m);
    await dispatch.dispatchDueNotifications({ limit: 50 });
    const row = (await outboxRows(pat.id)).find((x) => x.idempotency_key === `mpush-retry:${pat.id}`);
    expect(row?.status).toBe('retryable');
    expect(row?.attempts).toBe(1);
    // And a 410 revokes + terminates (the documented gone-path).
    vi.restoreAllMocks();
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
    await forceDue([pat.id]);
    await dispatch.dispatchDueNotifications({ limit: 50 });
    const revoked = (await outboxRows(pat.id)).find((x) => x.idempotency_key === `mpush-retry:${pat.id}`);
    expect(revoked?.status).toBe('revoked');
    const { rows: subs } = await db.query(
      `SELECT 1 FROM push_subscriptions WHERE user_id = $1 AND revoked_at IS NULL`,
      [pat.id]
    );
    expect(subs.length).toBe(0);
  });
});
