/**
 * Payments repository — new entity (server-side MonCash verification).
 *
 * Lifecycle: PENDING → PAID (only after provider verification or explicitly
 * isolated simulation) / FAILED / EXPIRED. A payment row is *consumed* by
 * exactly one consultation via the UNIQUE consultation_id column, which is set
 * atomically at consultation creation — the same payment can never buy two
 * consultations, and concurrent double-use attempts lose the race safely.
 */
'use strict';

const { query } = require('../db');

function toApi(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    order_id: row.order_id,
    patient_id: row.patient_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    transaction_id: row.transaction_id,
    verified_amount: row.verified_amount,
    consultation_id: row.consultation_id,
    provider: row.provider,
    simulated: row.simulated,
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
    verified_at: row.verified_at ? Math.floor(new Date(row.verified_at).getTime() / 1000) : null,
  };
}

async function create({ order_id, patient_id, amount, simulated = false }) {
  const { rows } = await query(
    `INSERT INTO payments (order_id, patient_id, amount, simulated)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (order_id) DO NOTHING
     RETURNING *`,
    [order_id, patient_id, amount, simulated]
  );
  return rows[0] || null; // null → order_id already exists (client reuse → 409)
}

async function findByOrderId(orderId) {
  const { rows } = await query(`SELECT * FROM payments WHERE order_id = $1`, [orderId]);
  return rows[0] || null;
}

async function findByTransactionId(transactionId) {
  const { rows } = await query(`SELECT * FROM payments WHERE transaction_id = $1`, [transactionId]);
  return rows[0] || null;
}

/**
 * Persist a successful verification. Idempotent: re-verifying an already-PAID
 * row only refreshes provider_raw / verified_at. Setting transaction_id uses
 * ON CONFLICT semantics via COALESCE so a later differing id never overwrites.
 */
async function markVerified(id, { transaction_id, verified_amount, provider_raw, simulated = false }) {
  const { rows } = await query(
    `UPDATE payments SET
       status = 'PAID',
       transaction_id = COALESCE($2, transaction_id),
       verified_amount = COALESCE($3, verified_amount),
       provider_raw = COALESCE($4::jsonb, provider_raw),
       simulated = $5,
       verified_at = now(),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, transaction_id ?? null, verified_amount ?? null,
     provider_raw ? JSON.stringify(provider_raw) : null, simulated]
  );
  return rows[0] || null;
}

async function markFailed(id, provider_raw) {
  const { rows } = await query(
    `UPDATE payments SET status = 'FAILED', provider_raw = COALESCE($2::jsonb, provider_raw),
       updated_at = now() WHERE id = $1 RETURNING *`,
    [id, provider_raw ? JSON.stringify(provider_raw) : null]
  );
  return rows[0] || null;
}

/**
 * Atomically attach a PAID payment to a freshly created consultation.
 * Returns true when this call won the attachment; false when the payment was
 * already consumed by another consultation (or the row vanished).
 */
async function attachToConsultation(paymentId, consultationId) {
  const { rowCount } = await query(
    `UPDATE payments SET consultation_id = $2, updated_at = now()
     WHERE id = $1 AND consultation_id IS NULL AND status = 'PAID'`,
    [paymentId, consultationId]
  );
  return rowCount > 0;
}

module.exports = { toApi, create, findByOrderId, findByTransactionId, markVerified, markFailed, attachToConsultation };
