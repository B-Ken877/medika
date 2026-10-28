/**
 * Doctor earnings ledger + payout settlement repository (issue #24).
 *
 * Invariants enforced here and at the database level:
 *   * an earning row exists ONLY for a TERMINE consultation with a PAID
 *     (verified) payment — materialization is idempotent via
 *     UNIQUE (consultation_id), so sweeps/retries/backfills can never
 *     double-count;
 *   * amounts are INTEGER gourdes (HTG): net = gross − platform_fee, with
 *     the fee snapshotted per earning (later PLATFORM_FEE changes never
 *     rewrite history) and never exceeding the gross amount;
 *   * a payout row is created ONLY inside settle()'s transaction and only
 *     in the PAID state; UNIQUE (doctor_id, cycle_start, cycle_end) plus a
 *     transaction-scoped advisory lock make duplicate settlement impossible
 *     even under concurrent admin clicks;
 *   * settlement flips every included earning AVAILABLE→PAID in the SAME
 *     transaction — partial states cannot persist.
 */
'use strict';

const { query, withTransaction } = require('../db');
const { config } = require('../config');
const notifications = require('../notifications/emit');
const cycles = require('../payout-cycles');

function earningToApi(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    doctor_id: row.doctor_id,
    doctor_name: row.doctor_name,
    consultation_id: row.consultation_id,
    payment_id: row.payment_id === null ? null : Number(row.payment_id),
    gross_amount: row.gross_amount,
    platform_fee: row.platform_fee,
    net_amount: row.net_amount,
    status: row.status,
    available_at: row.available_at ? Math.floor(new Date(row.available_at).getTime() / 1000) : null,
    payout_id: row.payout_id === null ? null : Number(row.payout_id),
    patient_name: row.patient_name ?? null,
    specialty: row.specialty ?? null,
  };
}

function payoutToApi(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    doctor_id: row.doctor_id,
    doctor_name: row.doctor_name,
    cycle_start: typeof row.cycle_start === 'string' ? row.cycle_start : row.cycle_start.toISOString().slice(0, 10),
    cycle_end: typeof row.cycle_end === 'string' ? row.cycle_end : row.cycle_end.toISOString().slice(0, 10),
    amount: row.amount,
    earning_count: row.earning_count,
    status: row.status,
    moncash_reference: row.moncash_reference ?? null,
    paid_at: row.paid_at ? Math.floor(new Date(row.paid_at).getTime() / 1000) : null,
    paid_by_admin_id: row.paid_by_admin_id,
    paid_by_admin_name: row.paid_by_admin_name,
  };
}

/**
 * Idempotent ledger materialization: one INSERT..SELECT turns every
 * (TERMINE consultation, PAID payment) pair without an earning row into
 * exactly one earning. available_at = the consultation's completion time,
 * so an earning always belongs to the cycle containing its completion
 * (backfilled history lands in its original cycle, never the current one).
 * Safe to run concurrently (ON CONFLICT DO NOTHING) and repeatedly.
 */
async function materializeEarnings() {
  const { rows } = await query(
    `INSERT INTO doctor_earnings
       (doctor_id, doctor_name, consultation_id, payment_id,
        gross_amount, platform_fee, net_amount, status, available_at)
     SELECT c.doctor_id, u.name, c.id, p.id,
            COALESCE(p.verified_amount, p.amount),
            LEAST($1, COALESCE(p.verified_amount, p.amount)),
            COALESCE(p.verified_amount, p.amount) - LEAST($1, COALESCE(p.verified_amount, p.amount)),
            'AVAILABLE',
            c.updated_at
       FROM consultations c
       JOIN payments p ON p.consultation_id = c.id AND p.status = 'PAID'
       JOIN users u ON u.id = c.doctor_id
      WHERE c.status = 'TERMINE'
        AND c.doctor_id IS NOT NULL
      ON CONFLICT (consultation_id) DO NOTHING
      RETURNING id, doctor_id, consultation_id`,
    [config.platformFee]
  );
  // Issue #36: notify each doctor whose earnings just became AVAILABLE —
  // the single authoritative transition point, fired exactly once per
  // earning (RETURNING yields only NEW rows, so duplicate cron runs and the
  // prescribe-route materialization can never double-notify). Fire-and-
  // forget: emit never throws and never breaks the wallet flow.
  for (const row of rows) {
    notifications.emit({
      userId: row.doctor_id,
      eventType: 'wallet:earnings',
      idempotencyKey: `wallet:earning:${Number(row.id)}`,
      ...notifications.COPY.walletEarnings,
    });
  }
  return rows.length;
}

/** Doctor's own wallet view (read-only for doctors by construction). */
async function walletFor(doctorId) {
  await materializeEarnings();

  const [totals, pendingRes, earningsRes, payoutsRes] = await Promise.all([
    query(
      `SELECT
         COALESCE(sum(net_amount) FILTER (WHERE status = 'AVAILABLE'), 0)::int AS available_total,
         COALESCE(count(*) FILTER (WHERE status = 'AVAILABLE'), 0)::int AS available_count,
         COALESCE(sum(net_amount) FILTER (WHERE status = 'PAID'), 0)::int AS paid_total,
         COALESCE(count(*) FILTER (WHERE status = 'PAID'), 0)::int AS paid_count
       FROM doctor_earnings WHERE doctor_id = $1`,
      [doctorId]
    ),
    // Completed consultations whose payment is NOT verified yet → the
    // "pending / not yet payable" bucket (estimate at current pricing).
    query(
      `SELECT count(*)::int AS n,
              COALESCE(sum(GREATEST(s.price - $2, 0)), 0)::int AS total
         FROM consultations c
         JOIN specialties s ON s.name = c.specialty_needed
        WHERE c.doctor_id = $1
          AND c.status = 'TERMINE'
          AND NOT EXISTS (
            SELECT 1 FROM payments p WHERE p.consultation_id = c.id AND p.status = 'PAID'
          )`,
      [doctorId, config.platformFee]
    ),
    query(
      `SELECT e.*, c.patient_name, c.specialty_needed
         FROM doctor_earnings e
         LEFT JOIN consultations c ON c.id = e.consultation_id
        WHERE e.doctor_id = $1
        ORDER BY e.available_at DESC, e.id DESC
        LIMIT 20`,
      [doctorId]
    ),
    query(
      `SELECT * FROM payouts WHERE doctor_id = $1 ORDER BY paid_at DESC, id DESC LIMIT 20`,
      [doctorId]
    ),
  ]);

  // Group the unpaid earnings by payout cycle (the cycle whose window
  // contains each earning's available_at — windows tile with no overlap).
  const availableRows = await query(
    `SELECT id, net_amount, available_at FROM doctor_earnings
      WHERE doctor_id = $1 AND status = 'AVAILABLE'
      ORDER BY available_at ASC`,
    [doctorId]
  );
  const byCycle = new Map();
  for (const row of availableRows.rows) {
    const cycle = cycles.cycleForInstant(row.available_at);
    const bucket = byCycle.get(cycle.endDate) || { ...cycle, amount: 0, count: 0 };
    bucket.amount += row.net_amount;
    bucket.count += 1;
    byCycle.set(cycle.endDate, bucket);
  }
  const now = new Date();
  const current = cycles.cycleForInstant(now);
  const latestDueEnd = cycles.latestDueCycleEndIso(now);
  const unpaidCycles = [...byCycle.values()]
    .sort((a, b) => (a.endDate < b.endDate ? -1 : 1))
    .map((c) => ({ ...c, due: c.endDate <= latestDueEnd }));

  const t = totals.rows[0];
  return {
    currency: 'HTG',
    available: { amount: t.available_total, count: t.available_count },
    pendingPayment: { amount: pendingRes.rows[0].total, count: pendingRes.rows[0].n },
    paidOut: { amount: t.paid_total, count: t.paid_count },
    currentCycle: current,
    unpaidCycles,
    earnings: earningsRes.rows.map(earningToApi),
    payouts: payoutsRes.rows.map(payoutToApi),
  };
}

/**
 * Admin payout overview: per-cycle × per-doctor eligible amounts (oldest
 * cycle first), the accumulating current cycle, and full payout history.
 */
async function payoutOverview() {
  await materializeEarnings();

  const [availableRes, payoutsRes, doctorTotals] = await Promise.all([
    query(
      `SELECT e.doctor_id, e.doctor_name, e.net_amount, e.available_at, e.id
         FROM doctor_earnings e
        WHERE e.status = 'AVAILABLE' AND e.doctor_id IS NOT NULL
        ORDER BY e.available_at ASC`
    ),
    query(`SELECT * FROM payouts ORDER BY paid_at DESC, id DESC LIMIT 200`),
    query(
      `SELECT COALESCE(sum(net_amount), 0)::int AS total, count(*)::int AS n
         FROM doctor_earnings WHERE status = 'AVAILABLE'`
    ),
  ]);

  const now = new Date();
  const current = cycles.cycleForInstant(now);
  const latestDueEnd = cycles.latestDueCycleEndIso(now);

  const cycleMap = new Map(); // endDate → { cycle, doctors: Map }
  for (const row of availableRes.rows) {
    const cycle = cycles.cycleForInstant(row.available_at);
    let entry = cycleMap.get(cycle.endDate);
    if (!entry) {
      entry = { ...cycle, doctors: new Map(), total: 0, count: 0 };
      cycleMap.set(cycle.endDate, entry);
    }
    let doc = entry.doctors.get(row.doctor_id);
    if (!doc) {
      doc = { doctorId: row.doctor_id, doctorName: row.doctor_name, amount: 0, earningCount: 0 };
      entry.doctors.set(row.doctor_id, doc);
    }
    doc.amount += row.net_amount;
    doc.earningCount += 1;
    entry.total += row.net_amount;
    entry.count += 1;
  }

  const cyclesWithDoctors = [...cycleMap.values()]
    .sort((a, b) => (a.endDate < b.endDate ? -1 : 1))
    .map((c) => ({
      startDate: c.startDate,
      endDate: c.endDate,
      label: c.label,
      due: c.endDate <= latestDueEnd,
      total: c.total,
      count: c.count,
      doctors: [...c.doctors.values()].sort((a, b) => b.amount - a.amount),
    }));

  return {
    currency: 'HTG',
    currentCycle: current,
    totalAvailable: doctorTotals.rows[0].total,
    totalAvailableCount: doctorTotals.rows[0].n,
    cycles: cyclesWithDoctors,
    payouts: payoutsRes.rows.map(payoutToApi),
  };
}

/**
 * Settle one doctor's payout for a validated cycle. Entirely inside one
 * transaction guarded by an advisory lock on (doctor, cycle):
 *   * existing payout → { alreadyPaid: true, payout } (idempotent retry);
 *   * no eligible earnings → { error: 'no_earnings' };
 *   * otherwise: insert the PAID payout (with the admin actor + optional
 *     MonCash reference) and flip every included earning to PAID — the
 *     count is asserted so a partial flip rolls the whole thing back.
 *
 * Eligibility rule: every still-AVAILABLE earning with
 * available_at <= cycle end. Earnings from the cycle's own window are
 * included, plus any older stragglers that materialized after their
 * original cycle was already settled (each earning is settled exactly once
 * — the status flip is the single-inclusion guarantee).
 */
async function settle({ doctorId, cycle, adminId, adminName, moncashReference = null }) {
  return withTransaction(async (client) => {
    // Serialize settles for the same (doctor, cycle) even before any row exists.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${doctorId}|${cycle.startDate}|${cycle.endDate}`]);

    const existing = await client.query(
      `SELECT * FROM payouts WHERE doctor_id = $1 AND cycle_start = $2 AND cycle_end = $3`,
      [doctorId, cycle.startDate, cycle.endDate]
    );
    if (existing.rows[0]) {
      return { alreadyPaid: true, payout: payoutToApi(existing.rows[0]) };
    }

    const eligible = await client.query(
      `SELECT id, net_amount FROM doctor_earnings
        WHERE doctor_id = $1 AND status = 'AVAILABLE' AND available_at <= $2
        ORDER BY available_at ASC
        FOR UPDATE`,
      [doctorId, cycle.windowEndInclusive]
    );
    if (eligible.rows.length === 0) {
      return { error: 'no_earnings' };
    }

    const amount = eligible.rows.reduce((sum, r) => sum + r.net_amount, 0);
    const earningIds = eligible.rows.map((r) => r.id);

    const inserted = await client.query(
      `INSERT INTO payouts
         (doctor_id, doctor_name, cycle_start, cycle_end, amount, earning_count,
          status, moncash_reference, paid_by_admin_id, paid_by_admin_name)
       SELECT $1, u.name, $2::date, $3::date, $4, $5, 'PAID', $6, $7, u2.name
         FROM users u, users u2
        WHERE u.id = $1 AND u2.id = $7
       RETURNING *`,
      [doctorId, cycle.startDate, cycle.endDate, amount, earningIds.length,
       moncashReference, adminId]
    );
    const payout = inserted.rows[0];
    if (!payout) {
      // The doctor (or admin actor) vanished mid-flight — nothing settled.
      return { error: 'actor_not_found' };
    }

    const flipped = await client.query(
      `UPDATE doctor_earnings
          SET status = 'PAID', payout_id = $2, updated_at = now()
        WHERE id = ANY($1) AND status = 'AVAILABLE'`,
      [earningIds, payout.id]
    );
    if (flipped.rowCount !== earningIds.length) {
      throw new Error('payout_settlement_count_mismatch'); // triggers ROLLBACK
    }

    const details = await client.query(
      `SELECT id, consultation_id, net_amount, available_at FROM doctor_earnings
        WHERE id = ANY($1) ORDER BY available_at ASC`,
      [earningIds]
    );

    return {
      alreadyPaid: false,
      payout: payoutToApi(payout),
      earnings: details.rows.map((r) => ({
        id: Number(r.id),
        consultation_id: r.consultation_id,
        net_amount: r.net_amount,
        available_at: Math.floor(new Date(r.available_at).getTime() / 1000),
      })),
    };
  });
}

module.exports = {
  materializeEarnings,
  walletFor,
  payoutOverview,
  settle,
  earningToApi,
  payoutToApi,
};
