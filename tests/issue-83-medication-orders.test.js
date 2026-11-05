/**
 * Issue #83 — medication orders and manual pharmacy quote operations.
 *
 * Covers the acceptance criteria end to end:
 *  - order creation on an issued prescription (patient ownership, invalid
 *    prescription, duplicate request — sequential AND concurrent);
 *  - admin-only pharmacy operations (patient/doctor/anonymous rejected);
 *  - quote recording: server-recomputed totals, item-level stock status,
 *    explicit price change (re-quote supersedes), unreachable attempts;
 *  - the 30-minute SLA computed from the REQUEST timestamp (exact 1800 s)
 *    and the escalation/expiry sweeps with BACKDATED fixtures — never sleeps;
 *  - server-side transition validation (no client-supplied status);
 *  - the prescription record is never modified by quote entry;
 *  - no pharmacy credentials/portal: schema allowlist + route probes.
 */
'use strict';

// The integration suite uses one explicitly configured test zone. Production
// must set MEDIKA_MEDICATION_DELIVERY_ZONES to its approved exact allowlist.
process.env.MEDIKA_MEDICATION_DELIVERY_ZONES = 'Port-au-Prince';

process.env.REQUIRE_PAYMENT = 'false';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};
let db;

const ITEMS = [
  { name: 'Paracétamol', strength: '500 mg', form: 'comprimé', dose: '1 comprimé', frequency: '3 fois par jour', duration: '5 jours', quantity: '15 comprimés' },
  { name: 'Ibuprofène', strength: '200 mg', dose: '1 comprimé', frequency: '2 fois par jour', duration: '3 jours', quantity: '6 comprimés' },
];

let patientSeq = 0;

/** Fresh patient user + token (issue #60: one active consultation per
 *  patient — every scenario needs its own fixture). */
async function freshPatient() {
  patientSeq += 1;
  const usersRepo = await import('../src/repos/users.js').then((m) => m.default ?? m);
  const { hashPassword, issueToken } = await import('../src/auth.js').then((m) => m.default ?? m);
  const id = `patient_m83_${patientSeq}`;
  const username = `t.m83_${patientSeq}`;
  await usersRepo.create({
    id, username, password_hash: hashPassword('Passw0rd!'),
    role: 'patient', name: `Pat M83 ${patientSeq}`, age: 30,
  });
  return { id, name: `Pat M83 ${patientSeq}`, token: issueToken({ id, role: 'patient', username, name: `Pat M83 ${patientSeq}` }) };
}

/** Consultation accepted by doctor_t1 with an ISSUED structured prescription. */
async function consultationWithPrescription({ patient: pat, items = ITEMS } = {}) {
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
    .send({ items, general_instructions: 'Repos et hydratation.' });
  expect(issued.status).toBe(200);
  return { consId, patient: p, document: issued.body };
}

/** Doctor rejects a consultation — releases the issue-#60 doctor slot
 *  (terminal REFUSE state) so the next scenario can book doctor_t1 again. */
async function releaseConsultation(consId) {
  const res = await r.put(`/api/consultations/${consId}/reject`)
    .set('Authorization', `Bearer ${token.doctor}`);
  expect(res.status).toBe(200);
}

async function createOrder(patient, consId, extra = {}) {
  return r.post(`/api/consultations/${consId}/medication-order`)
    .set('Authorization', `Bearer ${patient.token}`)
    .send({
      delivery_address: '12, rue Ka o, Port-au-Prince',
      delivery_phone: '+50937142536',
      delivery_zone: 'Port-au-Prince',
      ...extra,
    });
}

async function createPharmacy(extra = {}) {
  const res = await r.post('/api/admin/pharmacies')
    .set('Authorization', `Bearer ${token.admin}`)
    .send({ name: 'Pharmacie du Centre', whatsapp_number: '+509 37 14 25 36', location: 'Port-au-Prince', ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

/** A quote payload covering both prescription items (index-mapped). */
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

/** Backdate helpers (direct SQL — controllable clock without sleeps). */
async function backdateOrderSla(orderId, minutesAgo) {
  await db.query(
    `UPDATE medication_orders
        SET requested_at = now() - ($2 || ' minutes')::interval,
            sla_deadline_at = now() - ($2 || ' minutes')::interval + interval '30 minutes'
      WHERE id = $1`,
    [orderId, String(minutesAgo)]
  );
}

async function backdateQuoteExpiry(quoteId, minutesAgo) {
  await db.query(
    `UPDATE pharmacy_quotes SET expires_at = now() - ($2 || ' minutes')::interval WHERE id = $1`,
    [quoteId, String(minutesAgo)]
  );
}

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.patient2 = await h.loginToken(r, 't.patient2');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.doctor2 = await h.loginToken(r, 't.doctor2');
  token.admin = await h.loginToken(r, 't.admin');
  db = await import('../src/db.js').then((m) => m.default ?? m);
});

afterAll(async () => {
  await h.closeAll();
});

describe('issue #83 — order creation', () => {
  it('patient creates a request on an issued prescription; SLA is exactly 30 minutes from the request', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const res = await createOrder(patient, consId, { delivery_address: '12 rue Ka o', delivery_phone: '+50912345678', delivery_zone: 'Port-au-Prince' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('REQUESTED');
    expect(res.body.reference).toMatch(/^CMD-\d{4}-[0-9A-F]{10}$/);
    expect(res.body.sla_state).toBe('PENDING');
    expect(res.body.delivery_address).toBe('12 rue Ka o');
    expect(res.body.delivery_phone).toBe('+50912345678');
    expect(res.body.delivery_zone).toBe('Port-au-Prince');
    // Exact SLA math: deadline − request = 1800 s (controllable-clock test:
    // pure arithmetic assertion, no sleeps).
    expect(res.body.sla_deadline_at - res.body.requested_at).toBe(1800);
  });

  it('invalid prescription: no issued document → 409; unknown consultation → 404', async () => {
    const p = await freshPatient();
    const created = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${p.token}`)
      .send({ description: 'Toux', specialtyNeeded: 'Medecine Generale', urgencyLevel: 'Faible', doctorId: users.doctor.id, patientAge: 30 });
    expect(created.status).toBe(201);
    const noRx = await createOrder(p, created.body.id);
    expect(noRx.status).toBe(409);
    expect(noRx.body.code).toBe('PRESCRIPTION_NOT_ISSUED');

    const ghost = await createOrder(p, 'cons_does_not_exist');
    expect(ghost.status).toBe(404);

    // Release the doctor slot (issue #60) — the consultation stays open here.
    await releaseConsultation(created.body.id);
  });

  it('patient ownership: another patient → 404 (no leak), doctor → 403, anonymous → 401', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const stranger = await freshPatient();
    expect((await createOrder(stranger, consId)).status).toBe(404);
    expect((await createOrder(patient, consId)).status).toBe(201); // owner OK
    const docRes = await r.post(`/api/consultations/${consId}/medication-order`)
      .set('Authorization', `Bearer ${token.doctor}`).send({});
    expect(docRes.status).toBe(403);
    const anon = await r.post(`/api/consultations/${consId}/medication-order`).send({});
    expect(anon.status).toBe(401);
  });

  it('duplicate request while active → 409; concurrent double-submit creates exactly ONE order', async () => {
    const { consId, patient } = await consultationWithPrescription();
    expect((await createOrder(patient, consId)).status).toBe(201);
    const dup = await createOrder(patient, consId);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('MEDICATION_ORDER_ALREADY_EXISTS');

    // Race: two simultaneous POSTs — the DB partial unique index referees.
    const { consId: consId2, patient: p2 } = await consultationWithPrescription();
    const [a, b] = await Promise.all([createOrder(p2, consId2), createOrder(p2, consId2)]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([201, 409]);
    const list = await db.query(`SELECT count(*)::int AS n FROM medication_orders WHERE consultation_id = $1`, [consId2]);
    expect(list.rows[0].n).toBe(1);
  });

  it('read: owner sees the order with a derived next step; strangers get 404', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const created = await createOrder(patient, consId);
    const mine = await r.get(`/api/consultations/${consId}/medication-order`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.id).toBe(created.body.id);
    expect(mine.body.next_step).toBe('WAITING_MEDIKA');
    const stranger = await freshPatient();
    expect((await r.get(`/api/consultations/${consId}/medication-order`)
      .set('Authorization', `Bearer ${stranger.token}`)).status).toBe(404);
  });
});

describe('issue #83 — pharmacy operations are admin-only', () => {
  it('non-admin tokens cannot access any pharmacy operations API', async () => {
    const paths = [
      ['get', '/api/admin/medication-orders'],
      ['get', '/api/admin/medication-orders/MO_x'],
      ['post', '/api/admin/medication-orders/MO_x/quotes'],
      ['post', '/api/admin/medication-orders/MO_x/unreachable'],
      ['get', '/api/admin/pharmacies'],
      ['post', '/api/admin/pharmacies'],
    ];
    for (const [method, path] of paths) {
      expect((await r[method](path).set('Authorization', `Bearer ${token.patient}`)).status).toBe(403);
      expect((await r[method](path).set('Authorization', `Bearer ${token.doctor}`)).status).toBe(403);
      expect((await r[method](path)).status).toBe(401);
    }
  });

  it('no pharmacy credentials/portal: directory schema has NO credential column and no public pharmacy route exists', async () => {
    const cols = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'partner_pharmacies'`
    );
    const names = cols.rows.map((c) => c.column_name);
    for (const banned of ['password', 'password_hash', 'secret', 'token', 'api_key', 'credentials']) {
      expect(names).not.toContain(banned);
    }
    // Plausible portal/auth paths do not exist (404 JSON from the handler).
    expect((await r.post('/api/pharmacies/login').send({})).status).toBe(404);
    expect((await r.post('/api/pharmacy/login').send({})).status).toBe(404);
    expect((await r.get('/api/pharmacy/portal')).status).toBe(404);
  });

  it('pharmacy directory: create requires name + WhatsApp, normalizes the number, update works', async () => {
    const missing = await r.post('/api/admin/pharmacies')
      .set('Authorization', `Bearer ${token.admin}`).send({ name: 'X' });
    expect(missing.status).toBe(400);
    const ph = await createPharmacy({ name: 'Pharmacie Delmas', whatsapp_number: '+509 37 00 11 22' });
    expect(ph.id).toMatch(/^PH_/);
    expect(ph.whatsapp_number).toBe('50937001122'); // digits only
    const upd = await r.put(`/api/admin/pharmacies/${ph.id}`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ name: 'Pharmacie Delmas 2', whatsapp_number: ph.whatsapp_number, location: 'Delmas', active: false });
    expect(upd.status).toBe(200);
    expect(upd.body.active).toBe(false);
    const list = await r.get('/api/admin/pharmacies').set('Authorization', `Bearer ${token.admin}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    expect(list.body.some((p) => p.id === ph.id)).toBe(true);
  });
});

describe('issue #83 — quote recording (admin ops)', () => {
  it('records the pharmacy response: server-recomputed totals, pharmacy+agent stored, event + notification; prescription UNCHANGED', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;

    // Snapshot the prescription before quote entry.
    const before = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${patient.token}`);

    const ph = await createPharmacy();
    // Client sends bogus totals/subtotals — they MUST be ignored.
    const payload = quotePayload(ph.id);
    payload.items[0].subtotal_htg = 1;
    payload.items[1].subtotal_htg = 2;
    payload.total_htg = 3;
    const res = await r.post(`/api/admin/medication-orders/${order.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`).send(payload);
    expect(res.status).toBe(201);
    expect(res.body.total_htg).toBe(25 * 15 + 50 * 6); // 675 — recomputed
    expect(res.body.items[0].subtotal_htg).toBe(375);
    expect(res.body.items[1].subtotal_htg).toBe(300);
    expect(res.body.pharmacy.name).toBe('Pharmacie du Centre');
    expect(res.body.agent_name).toBe('Admin Test');
    expect(res.body.items[0].name).toBe('Paracétamol'); // snapshot from the prescription

    // Order flipped to QUOTED server-side (no client status input).
    const view = await r.get(`/api/consultations/${consId}/medication-order`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(view.body.status).toBe('QUOTED');
    expect(view.body.next_step).toBe('REVIEW_QUOTE');
    expect(view.body.quote.total_htg).toBe(675);
    expect(view.body.quote.expired).toBe(false);

    // Audit event + notification (in-app history row). emit() is
    // fire-and-forget by contract — poll for it instead of sleeping.
    const events = await db.query(
      `SELECT event_type, actor_role FROM medication_order_events WHERE order_id = $1 ORDER BY id`,
      [order.id]
    );
    expect(events.rows.map((e) => e.event_type)).toEqual(['REQUESTED', 'QUOTE_RECORDED']);
    await vi.waitFor(async () => {
      const notif = await db.query(
        `SELECT * FROM notifications WHERE user_id = $1 AND event_type = 'medication:quoted'`,
        [patient.id]
      );
      expect(notif.rows.length).toBe(1);
    });

    // The prescription record was NEVER modified by quote entry.
    const after = await r.get(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(after.body).toEqual(before.body);
  });

  it('item-level stock: PARTIAL keeps partial quantities explicit; UNAVAILABLE carries no price; every prescribed item covered exactly once', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    const ph = await createPharmacy({ name: 'Pharmacie Stock' });

    const partial = await r.post(`/api/admin/medication-orders/${order.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send(quotePayload(ph.id, {
        items: [
          { prescription_index: 0, availability: 'PARTIAL', unit_price_htg: 25, quantity: 8, offered_quantity: '8 comprimés sur 15' },
          { prescription_index: 1, availability: 'UNAVAILABLE' },
        ],
      }));
    expect(partial.status).toBe(201);
    expect(partial.body.total_htg).toBe(200);
    expect(partial.body.items[0].availability).toBe('PARTIAL');
    expect(partial.body.items[0].offered_quantity).toBe('8 comprimés sur 15');
    expect(partial.body.items[1].availability).toBe('UNAVAILABLE');
    expect(partial.body.items[1].unit_price_htg).toBeUndefined();
    expect(partial.body.items[1].subtotal_htg).toBeUndefined();

    // A price hiding on an UNAVAILABLE line is rejected.
    const { consId: c2, patient: p2 } = await consultationWithPrescription();
    const o2 = (await createOrder(p2, c2)).body;
    const pricedUnavail = await r.post(`/api/admin/medication-orders/${o2.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send(quotePayload(ph.id, {
        items: [
          { prescription_index: 0, availability: 'UNAVAILABLE' },
          { prescription_index: 1, availability: 'UNAVAILABLE', unit_price_htg: 50, quantity: 6 },
        ],
      }));
    expect(pricedUnavail.status).toBe(400);

    // Incomplete coverage (one line for two items) and duplicate/unknown indices.
    const incomplete = await r.post(`/api/admin/medication-orders/${o2.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send(quotePayload(ph.id, { items: [{ prescription_index: 0, availability: 'AVAILABLE', unit_price_htg: 25, quantity: 15 }] }));
    expect(incomplete.status).toBe(400);
    const duplicatedIdx = await r.post(`/api/admin/medication-orders/${o2.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send(quotePayload(ph.id, {
        items: [
          { prescription_index: 0, availability: 'AVAILABLE', unit_price_htg: 25, quantity: 15 },
          { prescription_index: 0, availability: 'AVAILABLE', unit_price_htg: 25, quantity: 15 },
        ],
      }));
    expect(duplicatedIdx.status).toBe(400);
    const unknownIdx = await r.post(`/api/admin/medication-orders/${o2.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send(quotePayload(ph.id, {
        items: [
          { prescription_index: 0, availability: 'AVAILABLE', unit_price_htg: 25, quantity: 15 },
          { prescription_index: 7, availability: 'AVAILABLE', unit_price_htg: 25, quantity: 15 },
        ],
      }));
    expect(unknownIdx.status).toBe(400);
  });

  it('quote expiry is server-validated (past → 400, > 30 days → 400, missing → 400)', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    const ph = await createPharmacy({ name: 'Pharmacie Delais' });
    const post = (expires_at) => r.post(`/api/admin/medication-orders/${order.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send(quotePayload(ph.id, { expires_at }));
    expect((await post(new Date(Date.now() - 60_000).toISOString())).status).toBe(400);
    expect((await post(new Date(Date.now() + 31 * 24 * 3600 * 1000).toISOString())).status).toBe(400);
    expect((await post(undefined)).status).toBe(400);
  });

  it('price change is explicit: a re-quote supersedes, emits QUOTE_REVISED with previous → new totals; both quotes kept', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    const ph = await createPharmacy({ name: 'Pharmacie Prix' });
    const first = await r.post(`/api/admin/medication-orders/${order.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`).send(quotePayload(ph.id));
    expect(first.status).toBe(201);
    const revised = await r.post(`/api/admin/medication-orders/${order.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send(quotePayload(ph.id, { items: [
        { prescription_index: 0, availability: 'AVAILABLE', unit_price_htg: 30, quantity: 15 },
        { prescription_index: 1, availability: 'AVAILABLE', unit_price_htg: 50, quantity: 6 },
      ] }));
    expect(revised.status).toBe(200); // explicit revision, not a fresh 201
    expect(revised.body.total_htg).toBe(30 * 15 + 50 * 6);

    const events = await db.query(
      `SELECT event_type, details FROM medication_order_events WHERE order_id = $1 ORDER BY id`,
      [order.id]
    );
    const revisedEvent = events.rows.find((e) => e.event_type === 'QUOTE_REVISED');
    expect(revisedEvent).toBeTruthy();
    expect(revisedEvent.details.price_changed).toBe(true);
    expect(revisedEvent.details.previous_total_htg).toBe(675);
    expect(revisedEvent.details.total_htg).toBe(750);

    const quotes = await db.query(
      `SELECT superseded_at FROM pharmacy_quotes WHERE order_id = $1 ORDER BY confirmed_at`,
      [order.id]
    );
    expect(quotes.rows.length).toBe(2);
    expect(quotes.rows[0].superseded_at).not.toBeNull(); // old quote archived
    expect(quotes.rows[1].superseded_at).toBeNull();     // latest is active

    // Each quote notifies exactly once (distinct idempotency keys).
    await vi.waitFor(async () => {
      const notifs = await db.query(
        `SELECT idempotency_key FROM notifications WHERE user_id = $1 AND event_type = 'medication:quoted'`,
        [patient.id]
      );
      expect(notifs.rows.length).toBe(2);
    });
  });

  it('unreachable pharmacy: explicit event, status and SLA clock UNCHANGED', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    const ph = await createPharmacy({ name: 'Pharmacie Silence' });
    const res = await r.post(`/api/admin/medication-orders/${order.id}/unreachable`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ pharmacy_id: ph.id, notes: 'Pas de réponse après 2 appels WhatsApp.' });
    expect(res.status).toBe(201);
    const after = await db.query(`SELECT status, sla_deadline_at, requested_at FROM medication_orders WHERE id = $1`, [order.id]);
    expect(after.rows[0].status).toBe('REQUESTED');
    expect(after.rows[0].sla_deadline_at - after.rows[0].requested_at).toBe(1_800_000); // ms
    const events = await db.query(
      `SELECT event_type, details FROM medication_order_events WHERE order_id = $1 ORDER BY id`,
      [order.id]
    );
    expect(events.rows[events.rows.length - 1].event_type).toBe('PHARMACY_UNREACHABLE');
    expect(events.rows[events.rows.length - 1].details.pharmacy_name).toBe('Pharmacie Silence');
  });

  it('legacy free-text prescription (no structured items) cannot be quoted — nothing to source', async () => {
    const p = await freshPatient();
    const created = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${p.token}`)
      .send({ description: 'Grippe', specialtyNeeded: 'Medecine Generale', urgencyLevel: 'Faible', doctorId: users.doctor.id, patientAge: 30 });
    expect(created.status).toBe(201);
    const accepted = await r.put(`/api/consultations/${created.body.id}/accept`)
      .set('Authorization', `Bearer ${token.doctor}`);
    expect(accepted.status).toBe(200);
    const issued = await r.put(`/api/consultations/${created.body.id}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ prescription: 'Paracétamol 500mg x3/j pendant 5 jours' }); // legacy text
    expect(issued.status).toBe(200);
    const order = (await createOrder(p, created.body.id)).body;
    const ph = await createPharmacy({ name: 'Pharmacie Legacy' });
    const res = await r.post(`/api/admin/medication-orders/${order.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send(quotePayload(ph.id, { items: [] }));
    expect(res.status).toBe(400);
  });
});

describe('issue #83 — 30-minute SLA: escalation with a controllable clock (backdated fixtures, no sleeps)', () => {
  it('order past the deadline lands in the overdue bucket and persists ESCALATED with a system event; the sweep is idempotent', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    await backdateOrderSla(order.id, 31); // request 31 minutes ago

    // The ops queue (bucket=overdue) runs the lazy sweep first.
    const queue = await r.get('/api/admin/medication-orders?bucket=overdue')
      .set('Authorization', `Bearer ${token.admin}`);
    expect(queue.status).toBe(200);
    const row = queue.body.find((o) => o.id === order.id);
    expect(row).toBeTruthy();
    expect(row.sla_state).toBe('ESCALATED');

    const persisted = await db.query(`SELECT status FROM medication_orders WHERE id = $1`, [order.id]);
    expect(persisted.rows[0].status).toBe('ESCALATED');
    const events = await db.query(
      `SELECT count(*)::int AS n FROM medication_order_events WHERE order_id = $1 AND event_type = 'ESCALATED'`,
      [order.id]
    );
    expect(events.rows[0].n).toBe(1);

    // Idempotent: a second sweep (cron path) does not duplicate the event.
    const cron = await r.post('/api/crons/medication-deadlines')
      .set('Authorization', `Bearer ${token.admin}`);
    expect(cron.status).toBe(200);
    expect(cron.body.ok).toBe(true);
    const events2 = await db.query(
      `SELECT count(*)::int AS n FROM medication_order_events WHERE order_id = $1 AND event_type = 'ESCALATED'`,
      [order.id]
    );
    expect(events2.rows[0].n).toBe(1);

    // Anonymous cron access stays fail-closed (admin fallback).
    expect((await r.get('/api/crons/medication-deadlines')).status).toBe(401);
  });

  it('an order within its SLA stays REQUESTED and appears in the new-requests bucket', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    const queue = await r.get('/api/admin/medication-orders?bucket=new')
      .set('Authorization', `Bearer ${token.admin}`);
    const row = queue.body.find((o) => o.id === order.id);
    expect(row).toBeTruthy();
    expect(row.status).toBe('REQUESTED');
    expect(row.buckets).toContain('new');
    expect(row.buckets).not.toContain('overdue');
  });
});

describe('issue #83 — quote expiry (backdated fixture, no sleeps)', () => {
  it('patient read persists EXPIRED past the quote validity; the quote is flagged expired', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    const ph = await createPharmacy({ name: 'Pharmacie Tardive' });
    const quote = (await r.post(`/api/admin/medication-orders/${order.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`).send(quotePayload(ph.id))).body;
    await backdateQuoteExpiry(quote.id, 5);

    const view = await r.get(`/api/consultations/${consId}/medication-order`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(view.status).toBe(200);
    expect(view.body.status).toBe('EXPIRED');
    expect(view.body.quote.expired).toBe(true);
    expect(view.body.next_step).toBe('QUOTE_EXPIRED');
    const events = await db.query(
      `SELECT event_type FROM medication_order_events WHERE order_id = $1 ORDER BY id`,
      [order.id]
    );
    expect(events.rows[events.rows.length - 1].event_type).toBe('QUOTE_EXPIRED');
  });
});

describe('issue #83 — server-side transition validation (client status values are never trusted)', () => {
  it('accept/decline require a QUOTED order; cancel is only possible BEFORE a quote', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;

    expect((await r.post(`/api/medication-orders/${order.id}/accept`)
      .set('Authorization', `Bearer ${patient.token}`)).status).toBe(409);
    expect((await r.post(`/api/medication-orders/${order.id}/decline`)
      .set('Authorization', `Bearer ${patient.token}`)).status).toBe(409);
    // Sending a bogus status field changes nothing (server ignores it).
    expect((await r.post(`/api/medication-orders/${order.id}/cancel`)
      .set('Authorization', `Bearer ${patient.token}`).send({ status: 'ACCEPTED' })).status).toBe(200);

    const after = await db.query(`SELECT status FROM medication_orders WHERE id = $1`, [order.id]);
    expect(after.rows[0].status).toBe('CANCELLED');
  });

  it('full happy path: quote → patient accepts → ACCEPTED; decisions are owner-only and single-shot', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    const ph = await createPharmacy({ name: 'Pharmacie Finale' });
    await r.post(`/api/admin/medication-orders/${order.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`).send(quotePayload(ph.id));

    // Strangers cannot decide; admins have no patient decision route.
    const stranger = await freshPatient();
    expect((await r.post(`/api/medication-orders/${order.id}/accept`)
      .set('Authorization', `Bearer ${stranger.token}`)).status).toBe(404);
    expect((await r.post(`/api/medication-orders/${order.id}/accept`)
      .set('Authorization', `Bearer ${token.admin}`)).status).toBe(403);

    const ok = await r.post(`/api/medication-orders/${order.id}/accept`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('ACCEPTED');

    // Single-shot: a second accept is an invalid transition.
    expect((await r.post(`/api/medication-orders/${order.id}/accept`)
      .set('Authorization', `Bearer ${patient.token}`)).status).toBe(409);

    const events = await db.query(
      `SELECT event_type, actor_role FROM medication_order_events WHERE order_id = $1 ORDER BY id`,
      [order.id]
    );
    expect(events.rows.map((e) => e.event_type)).toEqual(['REQUESTED', 'QUOTE_RECORDED', 'ACCEPTED']);
    expect(events.rows[2].actor_role).toBe('patient');
  });

  it('patient declines a quote (with reason) → DECLINED; a NEW request for the same prescription is then allowed', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    const ph = await createPharmacy({ name: 'Pharmacie Refus' });
    await r.post(`/api/admin/medication-orders/${order.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`).send(quotePayload(ph.id));

    const res = await r.post(`/api/medication-orders/${order.id}/decline`)
      .set('Authorization', `Bearer ${patient.token}`)
      .send({ reason: 'Je préfère acheter en personne.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DECLINED');

    // Terminal → the partial unique index frees the prescription.
    const again = await createOrder(patient, consId);
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(order.id);
  });

  it('accepting an EXPIRED quote is rejected (409 QUOTE_EXPIRED) even before the lazy sweep runs', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    const ph = await createPharmacy({ name: 'Pharmacie Expiree' });
    const quote = (await r.post(`/api/admin/medication-orders/${order.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`).send(quotePayload(ph.id))).body;
    await backdateQuoteExpiry(quote.id, 1);

    const res = await r.post(`/api/medication-orders/${order.id}/accept`)
      .set('Authorization', `Bearer ${patient.token}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('QUOTE_EXPIRED');
    // And the expiry transition was persisted at the moment of the attempt.
    const after = await db.query(`SELECT status FROM medication_orders WHERE id = $1`, [order.id]);
    expect(after.rows[0].status).toBe('EXPIRED');
  });

  it('admin ops queue buckets: quoted orders await patient review; exceptions flag unavailable items', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    const ph = await createPharmacy({ name: 'Pharmacie Rupture' });
    await r.post(`/api/admin/medication-orders/${order.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send(quotePayload(ph.id, {
        items: [
          { prescription_index: 0, availability: 'AVAILABLE', unit_price_htg: 25, quantity: 15 },
          { prescription_index: 1, availability: 'UNAVAILABLE' },
        ],
      }));

    const quotes = await r.get('/api/admin/medication-orders?bucket=quotes')
      .set('Authorization', `Bearer ${token.admin}`);
    const row = quotes.body.find((o) => o.id === order.id);
    expect(row).toBeTruthy();
    expect(row.quote.pharmacy_name).toBe('Pharmacie Rupture');
    expect(row.attention).toBe(true); // unavailable item → ops attention
    expect(row.buckets).toContain('exceptions');

    const exceptions = await r.get('/api/admin/medication-orders?bucket=exceptions')
      .set('Authorization', `Bearer ${token.admin}`);
    expect(exceptions.body.some((o) => o.id === order.id)).toBe(true);
  });

  it('admin detail exposes the read-only prescription snapshot, quote history, events and the WhatsApp handoff', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    const ph = await createPharmacy({ name: 'Pharmacie WhatsApp' });
    await r.post(`/api/admin/medication-orders/${order.id}/quotes`)
      .set('Authorization', `Bearer ${token.admin}`).send(quotePayload(ph.id));

    const detail = await r.get(`/api/admin/medication-orders/${order.id}?pharmacy_id=${ph.id}`)
      .set('Authorization', `Bearer ${token.admin}`);
    expect(detail.status).toBe(200);
    expect(detail.body.prescription.items).toHaveLength(2); // read-only snapshot
    expect(detail.body.prescription.items[0].name).toBe('Paracétamol');
    expect(detail.body.quotes).toHaveLength(1);
    expect(detail.body.events.length).toBeGreaterThanOrEqual(2);
    expect(detail.body.whatsapp.url).toMatch(/^https:\/\/wa\.me\/509\d+\?text=/);
    expect(detail.body.whatsapp.message).toContain('Paracétamol');
    // The handoff never leaks patient identity.
    expect(detail.body.whatsapp.message).not.toContain(patient.name);
  });
});

 
describe('issue #83 — delivery coverage, contact validation, and free delivery', () => {
  it('rejects missing address, missing phone, and malformed Haitian phone numbers', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const missingAddress = await createOrder(patient, consId, { delivery_address: '   ' });
    expect(missingAddress.status).toBe(400);
    expect(missingAddress.body.code).toBe('INVALID_DELIVERY_DETAILS');

    const missingPhone = await createOrder(patient, consId, { delivery_phone: ' ' });
    expect(missingPhone.status).toBe(400);
    expect(missingPhone.body.code).toBe('INVALID_DELIVERY_DETAILS');

    const malformedPhone = await createOrder(patient, consId, { delivery_phone: '+509123' });
    expect(malformedPhone.status).toBe(400);
    expect(malformedPhone.body.code).toBe('INVALID_DELIVERY_DETAILS');

    const overlongAddress = await createOrder(patient, consId, { delivery_address: 'A'.repeat(501) });
    expect(overlongAddress.status).toBe(400);
    const overlongZone = await createOrder(patient, consId, { delivery_zone: 'Z'.repeat(81) });
    expect(overlongZone.status).toBe(400);
  });

  it('fails closed for an unconfigured zone list and rejects zones not explicitly allowlisted', async () => {
    const { consId, patient } = await consultationWithPrescription();
    try {
      await db.query("UPDATE delivery_zones SET active = FALSE WHERE city = 'Port-au-Prince'");
      const notConfigured = await createOrder(patient, consId);
      expect(notConfigured.status).toBe(503);
      expect(notConfigured.body.code).toBe('MEDIKA_DELIVERY_NOT_CONFIGURED');

      await db.query("UPDATE delivery_zones SET active = TRUE WHERE city = 'Port-au-Prince'");
      const unsupported = await createOrder(patient, consId, { delivery_zone: 'Delmas' });
      expect(unsupported.status).toBe(422);
      expect(unsupported.body.code).toBe('DELIVERY_ZONE_NOT_SUPPORTED');
    } finally {
      await db.query("UPDATE delivery_zones SET active = TRUE WHERE city = 'Port-au-Prince'");
    }
  });

  it('never stores or returns a patient delivery fee, even if an admin sends one', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const order = (await createOrder(patient, consId)).body;
    const pharmacy = await createPharmacy();
    const response = await r.post('/api/admin/medication-orders/' + order.id + '/quotes')
      .set('Authorization', 'Bearer ' + token.admin)
      .send(quotePayload(pharmacy.id, { delivery_fee_htg: 999 }));
    expect(response.status).toBe(201);
    expect(response.body).not.toHaveProperty('delivery_fee_htg');
    const patientView = await r.get('/api/consultations/' + consId + '/medication-order')
      .set('Authorization', 'Bearer ' + patient.token);
    expect(patientView.body.quote).not.toHaveProperty('delivery_fee_htg');
    const schema = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'pharmacy_quotes' AND column_name = 'delivery_fee_htg'"
    );
    expect(schema.rows).toHaveLength(0);
  });
});


describe('issue #84 — medication MonCash payments', () => {
  it('prices from the accepted quote, verifies MonCash server-side, and marks the order PAID', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const created = await createOrder(patient, consId);
    expect(created.status).toBe(201);
    const pharmacy = await createPharmacy();
    const quote = await r.post('/api/admin/medication-orders/' + created.body.id + '/quotes')
      .set('Authorization', 'Bearer ' + token.admin)
      .send(quotePayload(pharmacy.id));
    expect(quote.status).toBe(201);
    const accepted = await r.post('/api/medication-orders/' + created.body.id + '/accept')
      .set('Authorization', 'Bearer ' + patient.token);
    expect(accepted.status).toBe(200);

    const moncash = await import('../src/moncash.js').then((m) => m.default ?? m);
    const createSpy = vi.spyOn(moncash, 'createPayment').mockResolvedValue({
      redirectUrl: 'https://moncash.example/checkout',
    });
    const start = await r.post('/api/medication-orders/' + created.body.id + '/payment/create')
      .set('Authorization', 'Bearer ' + patient.token)
      .send({});
    expect(start.status).toBe(200);
    expect(start.body.redirectUrl).toBe('https://moncash.example/checkout');
    expect(start.body.payment.amount_htg).toBe(675);
    expect(createSpy).toHaveBeenCalledWith({
      amount: 675,
      orderId: start.body.payment.payment_reference,
    });

    const verifySpy = vi.spyOn(moncash, 'retrieveByOrderId').mockResolvedValue({
      reference: start.body.payment.payment_reference,
      transactionId: 'TX_MEDICATION_84_001',
      amount: 675,
      status: 'completed',
      raw: { status: 'successful', cost: 675 },
    });
    const verified = await r.post('/api/medication-orders/' + created.body.id + '/payment/verify')
      .set('Authorization', 'Bearer ' + patient.token)
      .send({ success: true, amount: 1, transactionId: 'untrusted-client-value' });
    expect(verified.status).toBe(200);
    expect(verified.body.success).toBe(true);
    expect(verified.body.payment.status).toBe('PAID');
    expect(verifySpy).toHaveBeenCalledWith(start.body.payment.payment_reference);

    const current = await r.get('/api/consultations/' + consId + '/medication-order')
      .set('Authorization', 'Bearer ' + patient.token);
    expect(current.status).toBe(200);
    expect(current.body.status).toBe('PAID');
    createSpy.mockRestore();
    verifySpy.mockRestore();
  });

  it('does not expose or verify another patient medication payment', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const created = await createOrder(patient, consId);
    const pharmacy = await createPharmacy();
    await r.post('/api/admin/medication-orders/' + created.body.id + '/quotes')
      .set('Authorization', 'Bearer ' + token.admin)
      .send(quotePayload(pharmacy.id));
    await r.post('/api/medication-orders/' + created.body.id + '/accept')
      .set('Authorization', 'Bearer ' + patient.token);
    const moncash = await import('../src/moncash.js').then((m) => m.default ?? m);
    vi.spyOn(moncash, 'createPayment').mockResolvedValue({ redirectUrl: 'https://moncash.example/checkout' });
    const other = await freshPatient();
    const response = await r.post('/api/medication-orders/' + created.body.id + '/payment/create')
      .set('Authorization', 'Bearer ' + other.token).send({});
    expect(response.status).toBe(404);
    vi.restoreAllMocks();
  });
});


  it('keeps pending payments unpaid and permits a fresh reference after a verified mismatch', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const created = await createOrder(patient, consId);
    const pharmacy = await createPharmacy();
    await r.post('/api/admin/medication-orders/' + created.body.id + '/quotes')
      .set('Authorization', 'Bearer ' + token.admin).send(quotePayload(pharmacy.id));
    await r.post('/api/medication-orders/' + created.body.id + '/accept')
      .set('Authorization', 'Bearer ' + patient.token);

    const moncash = await import('../src/moncash.js').then((m) => m.default ?? m);
    vi.spyOn(moncash, 'createPayment').mockResolvedValue({ redirectUrl: 'https://moncash.example/checkout' });
    const start = await r.post('/api/medication-orders/' + created.body.id + '/payment/create')
      .set('Authorization', 'Bearer ' + patient.token).send({});
    vi.spyOn(moncash, 'retrieveByOrderId').mockResolvedValueOnce({
      reference: start.body.payment.payment_reference, transactionId: null,
      amount: 675, status: 'pending', raw: { status: 'pending' },
    });
    const pending = await r.post('/api/medication-orders/' + created.body.id + '/payment/verify')
      .set('Authorization', 'Bearer ' + patient.token).send({});
    expect(pending.status).toBe(200);
    expect(pending.body.success).toBe(false);

    vi.spyOn(moncash, 'retrieveByOrderId').mockResolvedValueOnce({
      reference: start.body.payment.payment_reference, transactionId: 'TX_WRONG_AMOUNT',
      amount: 674, status: 'completed', raw: { status: 'successful', cost: 674 },
    });
    const mismatch = await r.post('/api/medication-orders/' + created.body.id + '/payment/verify')
      .set('Authorization', 'Bearer ' + patient.token).send({});
    expect(mismatch.status).toBe(409);
    const retry = await r.post('/api/medication-orders/' + created.body.id + '/payment/create')
      .set('Authorization', 'Bearer ' + patient.token).send({});
    expect(retry.status).toBe(200);
    expect(retry.body.payment.payment_reference).not.toBe(start.body.payment.payment_reference);
    vi.restoreAllMocks();
  });


async function paidMedicationOrderForDelivery() {
  const { consId, patient } = await consultationWithPrescription();
  const created = await createOrder(patient, consId);
  expect(created.status).toBe(201);
  const pharmacy = await createPharmacy();
  const quote = await r.post('/api/admin/medication-orders/' + created.body.id + '/quotes')
    .set('Authorization', 'Bearer ' + token.admin).send(quotePayload(pharmacy.id));
  expect(quote.status).toBe(201);
  const accepted = await r.post('/api/medication-orders/' + created.body.id + '/accept')
    .set('Authorization', 'Bearer ' + patient.token);
  expect(accepted.status).toBe(200);
  const moncash = await import('../src/moncash.js').then((m) => m.default ?? m);
  vi.spyOn(moncash, 'createPayment').mockResolvedValue({ redirectUrl: 'https://moncash.example/checkout' });
  const start = await r.post('/api/medication-orders/' + created.body.id + '/payment/create')
    .set('Authorization', 'Bearer ' + patient.token).send({});
  const ref = start.body.payment.payment_reference;
  vi.spyOn(moncash, 'retrieveByOrderId').mockResolvedValue({
    reference: ref, transactionId: 'TX_DELIVERY_' + Math.random().toString(36).slice(2),
    amount: 675, status: 'completed', raw: { status: 'successful', cost: 675 },
  });
  const verified = await r.post('/api/medication-orders/' + created.body.id + '/payment/verify')
    .set('Authorization', 'Bearer ' + patient.token).send({});
  expect(verified.body.success).toBe(true);
  vi.restoreAllMocks();
  return { orderId: created.body.id, patient };
}

async function createDeliveryEmployeeFixture() {
  const created = await r.post('/api/admin/delivery-employees')
    .set('Authorization', 'Bearer ' + token.admin)
    .send({ name: 'Livreur Test', username: 'livreur.test.' + Math.random().toString(36).slice(2, 8), password: 'LivraisonSecurisee2026!', phone: '+50937142536' });
  expect(created.status).toBe(201);
  const auth = await import('../src/auth.js').then((m) => m.default ?? m);
  return { ...created.body, token: auth.issueToken({ id: created.body.id, role: 'delivery', username: created.body.username, name: created.body.name }) };
}

function nextFridayIso() {
  const d = new Date();
  const delta = ((5 - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function nextMondayIso() {
  const d = new Date();
  const delta = ((1 - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

describe('issue #85 — Medika-owned delivery operations', () => {
  it('assigns only verified-paid orders and enforces Friday unless an admin records an urgent exception', async () => {
    const { orderId } = await paidMedicationOrderForDelivery();
    const employee = await createDeliveryEmployeeFixture();
    const zone = await db.query("SELECT id FROM delivery_zones WHERE city = 'Port-au-Prince' AND zone_name = 'Port-au-Prince' AND active = TRUE");
    expect(zone.rows).toHaveLength(1);

    const invalidDate = await r.post('/api/admin/deliveries/assign')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ medication_order_id: orderId, employee_id: employee.id, zone_id: zone.rows[0].id, scheduled_for: nextMondayIso(), urgent: false });
    expect(invalidDate.status).toBe(400);
    expect(invalidDate.body.code).toBe('FRIDAY_ONLY');

    const urgent = await r.post('/api/admin/deliveries/assign')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ medication_order_id: orderId, employee_id: employee.id, zone_id: zone.rows[0].id, scheduled_for: nextMondayIso(), delivery_window: 'SOIR', urgent: true, urgent_reason: 'Situation médicale nécessitant une livraison rapide.' });
    expect(urgent.status).toBe(201);
    const employeeList = await r.get('/api/delivery/my').set('Authorization', 'Bearer ' + employee.token);
    expect(employeeList.status).toBe(200);
    expect(employeeList.body).toHaveLength(1);
    expect(employeeList.body[0]).not.toHaveProperty('diagnosis');
    expect(employeeList.body[0]).not.toHaveProperty('prescription');
    expect(employeeList.body[0].urgent).toBe(true);
    expect(employeeList.body[0].delivery_window).toBe('SOIR');
  });

  it('enforces employee assignment boundaries and patient-confirmed delivery chain of custody', async () => {
    const { orderId, patient } = await paidMedicationOrderForDelivery();
    const employee = await createDeliveryEmployeeFixture();
    const otherEmployee = await createDeliveryEmployeeFixture();
    const zone = await db.query("SELECT id FROM delivery_zones WHERE city = 'Port-au-Prince' AND zone_name = 'Port-au-Prince' AND active = TRUE");
    const assigned = await r.post('/api/admin/deliveries/assign')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ medication_order_id: orderId, employee_id: employee.id, zone_id: zone.rows[0].id, scheduled_for: nextFridayIso(), delivery_window: 'APRES_MIDI', urgent: false });
    expect(assigned.status).toBe(201);

    const hidden = await r.get('/api/delivery/my').set('Authorization', 'Bearer ' + otherEmployee.token);
    expect(hidden.status).toBe(200);
    expect(hidden.body).toHaveLength(0);

    const steps = ['PHARMACY_PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'AWAITING_CONFIRMATION'];
    for (const [index, eventType] of steps.entries()) {
      const response = await r.post('/api/delivery/' + assigned.body.delivery_id + '/events')
        .set('Authorization', 'Bearer ' + employee.token)
        .set('Idempotency-Key', 'delivery-step-key-' + index + '-' + orderId)
        .send({ event_type: eventType });
      expect(response.status).toBe(200);
    }

    const duplicateEvent = await r.post('/api/delivery/' + assigned.body.delivery_id + '/events')
      .set('Authorization', 'Bearer ' + employee.token)
      .set('Idempotency-Key', 'delivery-step-key-0-' + orderId)
      .send({ event_type: 'PHARMACY_PREPARING' });
    expect(duplicateEvent.status).toBe(200);
    expect(duplicateEvent.body.duplicate).toBe(true);
    const tracking = await r.get('/api/medication-orders/' + orderId + '/delivery')
      .set('Authorization', 'Bearer ' + patient.token);
    expect(tracking.status).toBe(200);
    expect(tracking.body.status).toBe('AWAITING_CONFIRMATION');
    expect(tracking.body.delivery_window).toBe('APRES_MIDI');
    const confirmed = await r.post('/api/medication-orders/' + orderId + '/delivery/confirm')
      .set('Authorization', 'Bearer ' + patient.token).send({});
    expect(confirmed.status).toBe(200);
    const completed = await r.get('/api/medication-orders/' + orderId + '/delivery')
      .set('Authorization', 'Bearer ' + patient.token);
    expect(completed.body.status).toBe('DELIVERED');

    const expense = await r.post('/api/admin/deliveries/' + assigned.body.delivery_id + '/expenses')
      .set('Authorization', 'Bearer ' + token.admin).send({ amount_htg: 85, category: 'TRANSPORT', notes: 'Trajet aller-retour' });
    expect(expense.status).toBe(201);

    const budget = await r.put('/api/admin/delivery-budget').set('Authorization', 'Bearer ' + token.admin)
      .send({ monthly_budget_htg: 100, alert_threshold_percent: 80 });
    expect(budget.status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    const report = await r.get('/api/admin/delivery-reports?from=' + today + '&to=' + today)
      .set('Authorization', 'Bearer ' + token.admin);
    expect(report.status).toBe(200);
    expect(report.body.delivered).toBeGreaterThanOrEqual(1);
    expect(report.body.expense_htg).toBeGreaterThanOrEqual(85);
    expect(report.body.budget_alert).toBe(true);
  });

  it('rejects patient orders in a zone that has not been explicitly activated', async () => {
    const { consId, patient } = await consultationWithPrescription();
    const unsupported = await createOrder(patient, consId, { delivery_zone: 'Zone non configurée' });
    expect(unsupported.status).toBe(422);
    expect(unsupported.body.code).toBe('DELIVERY_ZONE_NOT_SUPPORTED');
  });
});



it('records and notifies when urgent delivery cannot be accommodated', async () => {
  const { orderId, patient } = await paidMedicationOrderForDelivery();
  const response = await r.post('/api/admin/deliveries/urgent-unavailable')
    .set('Authorization', 'Bearer ' + token.admin)
    .send({ medication_order_id: orderId, reason: 'Aucun livreur disponible pour cette demande urgente.' });
  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);

  const duplicate = await r.post('/api/admin/deliveries/urgent-unavailable')
    .set('Authorization', 'Bearer ' + token.admin)
    .send({ medication_order_id: orderId, reason: 'Deuxième notification non nécessaire.' });
  expect(duplicate.status).toBe(409);
  expect(duplicate.body.code).toBe('ALREADY_NOTIFIED');

  const { rows } = await db.query(
    "SELECT event_type FROM medication_order_events WHERE order_id = $1 AND event_type = 'DELIVERY_URGENT_UNAVAILABLE'",
    [orderId]
  );
  expect(rows).toHaveLength(1);
});
