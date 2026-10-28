/**
 * Doctor wallet + admin payout tests (issue #24):
 *   * eligibility: only TERMINE consultations with VERIFIED (PAID) payments
 *     become earnings — exactly once (idempotent materialization)
 *   * integer money math (gross − platform fee snapshot = net)
 *   * doctor wallet view is read-only, own-data-only
 *   * admin "Payé" settlement: correct amounts, idempotent retries, safe
 *     under concurrency, arbitrary/future cycles rejected, non-admins 403
 *   * cycle assignment respects the 15th/30th (Feb = last day) windows
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};
let query, paymentsRepo, consultationsRepo, cycles;

const FEE = 250; // PLATFORM_FEE default

// Order ids must differ within their first 9 bytes: the payment fixture
// derives transaction_id from base64(orderId).slice(0,12) (payments has a
// UNIQUE transaction_id), and 12 base64 chars encode exactly 9 bytes.
let orderSeq = 0;
function nextOrderId() {
  orderSeq += 1;
  return `MCW${orderSeq}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a completed consultation with a PAID payment attached → earning. */
async function completedPaidConsultation({ patientId, doctorId, amount = 750, specialty = 'Medecine Generale' }) {
  const cons = await h.createConsultationFixture({ patientId, doctorId, status: 'EN_COURS', specialty });
  const orderId = nextOrderId();
  const payment = await h.createPaidPaymentFixture({ patientId, orderId, amount });
  await paymentsRepo.attachToConsultation(payment.id, cons.id);
  const done = await consultationsRepo.prescribe(cons.id, doctorId, 'Ordonnance test');
  expect(done.status).toBe('TERMINE');
  return { cons, payment };
}

beforeAll(async () => {
  ({ request: r } = await h.setup());
  query = await import('../src/db.js').then((m) => (m.default ?? m).query);
  paymentsRepo = await import('../src/repos/payments.js').then((m) => m.default ?? m);
  consultationsRepo = await import('../src/repos/consultations.js').then((m) => m.default ?? m);
  cycles = await import('../src/payout-cycles.js').then((m) => m.default ?? m);

  await h.resetDb();
  users = await h.createFixtureUsers();
  for (const [k, u] of Object.entries({
    patient: 't.patient', patient2: 't.patient2',
    doctor: 't.doctor', doctor2: 't.doctor2', admin: 't.admin',
  })) {
    token[k] = await h.loginToken(r, u);
  }
});

afterAll(async () => {
  await h.closeAll();
});

describe('earning eligibility (completed + verified payment, exactly once)', () => {
  it('a completed consultation with a verified payment becomes an available earning', async () => {
    const { cons } = await completedPaidConsultation({ patientId: users.patient.id, doctorId: users.doctor.id, amount: 750 });
    const walletRepo = await import('../src/repos/wallet.js').then((m) => m.default ?? m);
    await walletRepo.materializeEarnings(); // the sweep trigger (cron / wallet views)

    const rows = (await query(`SELECT * FROM doctor_earnings WHERE consultation_id = $1`, [cons.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].gross_amount).toBe(750);
    expect(rows[0].platform_fee).toBe(FEE);
    expect(rows[0].net_amount).toBe(500);
    expect(rows[0].status).toBe('AVAILABLE');
    expect(rows[0].doctor_id).toBe(users.doctor.id);
  });

  it('materialization is idempotent (sweep + wallet views never double-count)', async () => {
    const { cons } = await completedPaidConsultation({ patientId: users.patient.id, doctorId: users.doctor.id, amount: 750 });
    const walletRepo = await import('../src/repos/wallet.js').then((m) => m.default ?? m);
    await walletRepo.materializeEarnings();
    await walletRepo.walletFor(users.doctor.id);
    await walletRepo.payoutOverview();
    const rows = (await query(`SELECT * FROM doctor_earnings WHERE consultation_id = $1`, [cons.id])).rows;
    expect(rows).toHaveLength(1);
  });

  it('EN_COURS / REFUSE / EXPIRE consultations never become earnings', async () => {
    const active = await h.createConsultationFixture({ patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS' });
    const orderId = 'MC_noearn_1';
    const pay = await h.createPaidPaymentFixture({ patientId: users.patient.id, orderId, amount: 750 });
    await paymentsRepo.attachToConsultation(pay.id, active.id); // paid but NOT completed

    // Issue #60: the patient1+doctor slots are held by `active` — the extra
    // RECHERCHE_MEDECIN fixture belongs to patient2 so `active` stays EN_COURS.
    await h.createConsultationFixture({ patientId: users.patient2.id }); // RECHERCHE_MEDECIN
    await query(
      `INSERT INTO consultations (id, patient_id, patient_name, doctor_id, status, description, specialty_needed, urgency_level, ai_summary, ai_explanation)
       VALUES ('cons_refused_w', $1, 'Pat Test', $2, 'REFUSE', 'x', 'Medecine Generale', 'Moyenne', '', '')`,
      [users.patient.id, users.doctor.id]);
    await query(
      `INSERT INTO consultations (id, patient_id, patient_name, doctor_id, status, description, specialty_needed, urgency_level, ai_summary, ai_explanation)
       VALUES ('cons_expired_w', $1, 'Pat Test', $2, 'EXPIRE', 'x', 'Medecine Generale', 'Moyenne', '', '')`,
      [users.patient.id, users.doctor.id]);

    const walletRepo = await import('../src/repos/wallet.js').then((m) => m.default ?? m);
    await walletRepo.materializeEarnings();
    const rows = (await query(
      `SELECT consultation_id FROM doctor_earnings WHERE consultation_id IN ($1, 'cons_refused_w', 'cons_expired_w')`,
      [active.id])).rows;
    expect(rows).toHaveLength(0);
  });

  it('completed consultations with unverified/failed payments are NOT payable (pending bucket only)', async () => {
    // PENDING payment (created, never verified)
    const cons1 = await h.createConsultationFixture({ patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS' });
    const pending = await paymentsRepo.create({ order_id: 'MC_pending_w', patient_id: users.patient.id, amount: 750, simulated: true });
    await paymentsRepo.attachToConsultation(pending.id, cons1.id);
    await consultationsRepo.prescribe(cons1.id, users.doctor.id, 'rx');

    // FAILED payment (explicitly rejected by the provider flow)
    const cons2 = await h.createConsultationFixture({ patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS' });
    const failed = await paymentsRepo.create({ order_id: 'MC_failed_w', patient_id: users.patient.id, amount: 750, simulated: true });
    await paymentsRepo.markFailed(failed.id, { raw: null });
    await paymentsRepo.attachToConsultation(failed.id, cons2.id);
    await consultationsRepo.prescribe(cons2.id, users.doctor.id, 'rx');

    const walletRepo = await import('../src/repos/wallet.js').then((m) => m.default ?? m);
    await walletRepo.materializeEarnings();

    const wallet = await walletRepo.walletFor(users.doctor.id);
    const pendingForThese = wallet.pendingPayment;
    expect(pendingForThese.count).toBeGreaterThanOrEqual(2); // 2 unverified completions (estimate at current pricing − fee)
    const earnRows = (await query(
      `SELECT id FROM doctor_earnings WHERE consultation_id IN ($1, $2)`, [cons1.id, cons2.id])).rows;
    expect(earnRows).toHaveLength(0); // nothing payable from unverified money
  });

  it('the platform fee is snapshotted per earning (later fee changes never rewrite history)', async () => {
    const { cons } = await completedPaidConsultation({ patientId: users.patient.id, doctorId: users.doctor.id, amount: 900 });
    const walletRepo = await import('../src/repos/wallet.js').then((m) => m.default ?? m);
    await walletRepo.materializeEarnings();
    const row = (await query(`SELECT platform_fee, net_amount FROM doctor_earnings WHERE consultation_id = $1`, [cons.id])).rows[0];
    expect(row.platform_fee).toBe(FEE); // value at materialization time
    expect(row.net_amount).toBe(900 - FEE);
  });
});

describe('doctor wallet (GET /api/doctor/wallet)', () => {
  it('shows available/paid breakdown, recent earnings with patient context, and payout history', async () => {
    const res = await r.get('/api/doctor/wallet').set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('HTG');
    expect(res.body.available.count).toBeGreaterThanOrEqual(2);
    expect(res.body.available.amount).toBeGreaterThanOrEqual(1000); // 500+500 from the fixtures above
    expect(res.body.paidOut.amount).toBe(0);
    expect(res.body.currentCycle).toHaveProperty('endDate');
    expect(Array.isArray(res.body.unpaidCycles)).toBe(true);
    expect(res.body.earnings.length).toBeGreaterThanOrEqual(2);
    expect(res.body.earnings[0]).toHaveProperty('patient_name');
    expect(res.body.earnings[0]).toHaveProperty('specialty');
    expect(Array.isArray(res.body.payouts)).toBe(true);
  });

  it('is role-restricted and per-doctor', async () => {
    expect((await r.get('/api/doctor/wallet').set('Authorization', `Bearer ${token.patient}`)).status).toBe(403);
    expect((await r.get('/api/doctor/wallet').set('Authorization', `Bearer ${token.admin}`)).status).toBe(403);
    expect((await r.get('/api/doctor/wallet')).status).toBe(401);

    // doctor2 has no earnings → zero wallet, isolated from doctor1's data.
    const res = await r.get('/api/doctor/wallet').set('Authorization', `Bearer ${token.doctor2}`);
    expect(res.status).toBe(200);
    expect(res.body.available.amount).toBe(0);
    expect(res.body.available.count).toBe(0);
    expect(res.body.earnings).toHaveLength(0);
  });
});

describe('admin payout overview (GET /api/admin/payouts)', () => {
  it('groups eligible amounts per cycle × doctor with due flags', async () => {
    const res = await r.get('/api/admin/payouts').set('Authorization', `Bearer ${token.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('HTG');
    expect(res.body.currentCycle).toHaveProperty('endDate');
    expect(Array.isArray(res.body.cycles)).toBe(true);
    expect(Array.isArray(res.body.payouts)).toBe(true);

    const currentCycleEntry = res.body.cycles.find((c) => c.endDate === res.body.currentCycle.endDate);
    expect(currentCycleEntry).toBeTruthy();
    expect(currentCycleEntry.due).toBe(false); // current cycle is not settleable yet
    const doc = currentCycleEntry.doctors.find((d) => d.doctorId === users.doctor.id);
    expect(doc.amount).toBeGreaterThanOrEqual(1000);
    expect(doc.earningCount).toBeGreaterThanOrEqual(2);
  });

  it('non-admins are rejected', async () => {
    expect((await r.get('/api/admin/payouts').set('Authorization', `Bearer ${token.doctor}`)).status).toBe(403);
    expect((await r.get('/api/admin/payouts').set('Authorization', `Bearer ${token.patient}`)).status).toBe(403);
    expect((await r.get('/api/admin/payouts')).status).toBe(401);
  });
});

describe('settlement (POST /api/admin/payouts/settle)', () => {
  /** A due (past) cycle and one older than it. */
  let dueCycle, olderCycle;

  beforeAll(() => {
    const list = cycles.settleableCycles(new Date(), 2); // oldest → newest, all ended
    dueCycle = list[list.length - 1];   // most recent closed cycle
    olderCycle = list[list.length - 2]; // the one before it
  });

  it('rejects invalid input', async () => {
    const base = { doctorId: users.doctor.id };
    // A strictly FUTURE cycle pair (real boundaries, not yet ended).
    const current = cycles.cycleForInstant(new Date());
    const future = cycles.cycleForInstant(new Date(current.windowEndInclusive.getTime() + 1));
    expect((await r.post('/api/admin/payouts/settle').set('Authorization', `Bearer ${token.admin}`).send(base)).status).toBe(400);
    expect((await r.post('/api/admin/payouts/settle').set('Authorization', `Bearer ${token.admin}`)
      .send({ ...base, cycleStart: '2026-10-16', cycleEnd: '2026-10-29' })).status).toBe(400); // not a real cycle end
    expect((await r.post('/api/admin/payouts/settle').set('Authorization', `Bearer ${token.admin}`)
      .send({ ...base, cycleStart: future.startDate, cycleEnd: future.endDate })).status).toBe(400); // real pair, but not due yet
    expect((await r.post('/api/admin/payouts/settle').set('Authorization', `Bearer ${token.admin}`)
      .send({ ...base, cycleStart: dueCycle.startDate, cycleEnd: dueCycle.endDate, moncashReference: 'x'.repeat(201) })).status).toBe(400);
    expect((await r.post('/api/admin/payouts/settle').set('Authorization', `Bearer ${token.admin}`)
      .send({ doctorId: 'nope', cycleStart: dueCycle.startDate, cycleEnd: dueCycle.endDate })).status).toBe(404);
  });

  it('settles a due cycle: payout recorded, earnings flip to PAID, doctor wallet updates', async () => {
    // Move ALL of this doctor's current earnings INTO the due cycle's window
    // (window start + 1ms — the boundary instant itself belongs to the older
    // cycle's inclusive end).
    await query(
      `UPDATE doctor_earnings SET available_at = $1 WHERE doctor_id = $2 AND status = 'AVAILABLE'`,
      [new Date(dueCycle.windowStartExclusive.getTime() + 1), users.doctor.id]);
    // ...plus one older-cycle earning (a straggler) that must be swept in too.
    const { cons } = await completedPaidConsultation({ patientId: users.patient.id, doctorId: users.doctor.id, amount: 750 });
    const walletRepo = await import('../src/repos/wallet.js').then((m) => m.default ?? m);
    await walletRepo.materializeEarnings();
    await query(`UPDATE doctor_earnings SET available_at = $1 WHERE consultation_id = $2`,
      [new Date(olderCycle.windowStartExclusive.getTime() + 1), cons.id]);

    const availableBefore = (await query(
      `SELECT COALESCE(sum(net_amount),0)::int AS total, count(*)::int AS n FROM doctor_earnings
        WHERE doctor_id = $1 AND status = 'AVAILABLE'`, [users.doctor.id])).rows[0];

    const res = await r.post('/api/admin/payouts/settle')
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ doctorId: users.doctor.id, cycleStart: dueCycle.startDate, cycleEnd: dueCycle.endDate, moncashReference: 'MC-TRF-20261030-01' });
    expect(res.status).toBe(201);
    expect(res.body.alreadyPaid).toBe(false);
    expect(res.body.payout.amount).toBe(availableBefore.total);
    expect(res.body.payout.earning_count).toBe(availableBefore.n);
    expect(res.body.payout.moncash_reference).toBe('MC-TRF-20261030-01');
    expect(res.body.payout.doctor_name).toBe('Dr Test');
    expect(res.body.payout.paid_by_admin_name).toBe('Admin Test');
    expect(res.body.payout.cycle_start).toBe(dueCycle.startDate);
    expect(res.body.payout.cycle_end).toBe(dueCycle.endDate);
    // The settlement detail lists the underlying earnings (reconciliation).
    expect(res.body.earnings).toHaveLength(availableBefore.n);

    // Every earning of this doctor is now PAID and attached to the payout
    // (payout_id is a BIGINT → pg returns a string; the API exposes a number).
    const after = (await query(
      `SELECT count(*)::int AS n FROM doctor_earnings WHERE doctor_id = $1 AND status = 'AVAILABLE'`, [users.doctor.id])).rows[0];
    expect(after.n).toBe(0);
    const paid = (await query(
      `SELECT * FROM doctor_earnings WHERE doctor_id = $1 AND status = 'PAID'`, [users.doctor.id])).rows;
    expect(paid.every((e) => String(e.payout_id) === String(res.body.payout.id))).toBe(true);

    // The doctor's wallet reflects the payout.
    const wallet = await r.get('/api/doctor/wallet').set('Authorization', `Bearer ${token.doctor}`);
    expect(wallet.body.available.amount).toBe(0);
    expect(wallet.body.paidOut.amount).toBe(availableBefore.total);
    expect(wallet.body.payouts[0].moncash_reference).toBe('MC-TRF-20261030-01');
  });

  it('repeated settlement of the same doctor/cycle is idempotent (alreadyPaid)', async () => {
    // Determine the settled cycle's stored boundaries.
    const payouts = (await query(`SELECT * FROM payouts WHERE doctor_id = $1`, [users.doctor.id])).rows;
    expect(payouts).toHaveLength(1);
    const p = payouts[0];
    const start = p.cycle_start.toISOString().slice(0, 10);
    const end = p.cycle_end.toISOString().slice(0, 10);

    const again = await r.post('/api/admin/payouts/settle')
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ doctorId: users.doctor.id, cycleStart: start, cycleEnd: end });
    expect(again.status).toBe(200);
    expect(again.body.alreadyPaid).toBe(true);
    expect(String(again.body.payout.id)).toBe(String(p.id));

    const count = (await query(`SELECT count(*)::int AS n FROM payouts WHERE doctor_id = $1`, [users.doctor.id])).rows[0].n;
    expect(count).toBe(1); // no duplicate payout record
  });

  it('concurrent settlements produce exactly one payout (advisory lock + unique)', async () => {
    // New earnings for doctor2 in the older (still unpaid) cycle.
    const { cons } = await completedPaidConsultation({ patientId: users.patient2.id, doctorId: users.doctor2.id, amount: 1500 });
    const walletRepo = await import('../src/repos/wallet.js').then((m) => m.default ?? m);
    await walletRepo.materializeEarnings();
    await query(`UPDATE doctor_earnings SET available_at = $1 WHERE consultation_id = $2`,
      [new Date(olderCycle.windowStartExclusive.getTime() + 1), cons.id]);

    const results = await Promise.all([1, 2, 3].map(() =>
      r.post('/api/admin/payouts/settle')
        .set('Authorization', `Bearer ${token.admin}`)
        .send({ doctorId: users.doctor2.id, cycleStart: olderCycle.startDate, cycleEnd: olderCycle.endDate })));
    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    expect(results.filter((res) => res.status === 200 && res.body.alreadyPaid)).toHaveLength(2);

    const rows = (await query(`SELECT * FROM payouts WHERE doctor_id = $1`, [users.doctor2.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(1500 - FEE);
    expect(rows[0].earning_count).toBe(1);
  });

  it('settling with no eligible earnings → 409, and future cycles → 400', async () => {
    const none = await r.post('/api/admin/payouts/settle')
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ doctorId: users.doctor.id, cycleStart: olderCycle.startDate, cycleEnd: olderCycle.endDate });
    expect(none.status).toBe(409); // doctor1 has no AVAILABLE earnings left

    const future = cycles.cycleForInstant(new Date());
    const tooEarly = await r.post('/api/admin/payouts/settle')
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ doctorId: users.doctor2.id, cycleStart: future.startDate, cycleEnd: future.endDate });
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.error).toContain('pas encore termine');
  });

  it('only admins may settle', async () => {
    for (const tok of [token.doctor, token.patient]) {
      const res = await r.post('/api/admin/payouts/settle')
        .set('Authorization', `Bearer ${tok}`)
        .send({ doctorId: users.doctor.id, cycleStart: dueCycle.startDate, cycleEnd: dueCycle.endDate });
      expect(res.status).toBe(403);
    }
  });
});

describe('cycle assignment of earnings (window boundaries)', () => {
  it('an earning at the last instant of a cycle end day belongs to that cycle; one instant later → next', async () => {
    const list = cycles.settleableCycles(new Date(), 1); // oldest → newest
    const cycle = list[list.length - 1]; // LATEST due cycle

    const edge = await completedPaidConsultation({ patientId: users.patient.id, doctorId: users.doctor2.id, amount: 750 });
    const walletRepo = await import('../src/repos/wallet.js').then((m) => m.default ?? m);
    await walletRepo.materializeEarnings();
    await query(`UPDATE doctor_earnings SET available_at = $1 WHERE consultation_id = $2`,
      [cycle.windowEndInclusive, edge.cons.id]);
    const after = await completedPaidConsultation({ patientId: users.patient2.id, doctorId: users.doctor2.id, amount: 750 });
    await walletRepo.materializeEarnings();
    await query(`UPDATE doctor_earnings SET available_at = $1 WHERE consultation_id = $2`,
      [new Date(cycle.windowEndInclusive.getTime() + 1), after.cons.id]);

    const overview = await walletRepo.payoutOverview();
    const inCycle = overview.cycles.find((c) => c.endDate === cycle.endDate);
    const docEdge = inCycle.doctors.find((d) => d.doctorId === users.doctor2.id);
    expect(docEdge.amount).toBe(750 - FEE); // the boundary earning is IN the cycle

    // The +1ms earning lands in the NEXT cycle (still accumulating → not due).
    const nextCycle = overview.cycles.find((c) => c.endDate === cycles.cycleForInstant(new Date()).endDate);
    const docAfter = nextCycle.doctors.find((d) => d.doctorId === users.doctor2.id);
    expect(docAfter.amount).toBe(750 - FEE);
  });
});
