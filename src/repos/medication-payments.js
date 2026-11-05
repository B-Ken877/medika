'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db');

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    medication_order_id: row.medication_order_id,
    quote_id: row.quote_id || null,
    payment_reference: row.payment_reference,
    amount_htg: Number(row.amount_htg),
    verified_amount_htg: row.verified_amount_htg == null ? null : Number(row.verified_amount_htg),
    currency: row.currency,
    status: row.status,
    transaction_id: row.transaction_id,
    simulated: Boolean(row.simulated),
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
    verified_at: row.verified_at ? Math.floor(new Date(row.verified_at).getTime() / 1000) : null,
  };
}

/** Create or resume the one payment intent for an accepted, unexpired quote. */
async function createIntent({ orderId, patientId, simulated = false }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM medication_orders WHERE id = $1 FOR UPDATE', [orderId]
    );
    const order = rows[0];
    if (!order || order.patient_id !== patientId) return { outcome: 'NOT_FOUND' };
    if (order.status === 'PAID') {
      const { rows: paid } = await client.query(
        'SELECT * FROM medication_payments WHERE medication_order_id = $1', [orderId]
      );
      return { outcome: 'PAID', payment: toApi(paid[0]) };
    }
    if (order.status !== 'ACCEPTED') return { outcome: 'INVALID_STATE', status: order.status };

    const { rows: quotes } = await client.query(
      `SELECT * FROM pharmacy_quotes WHERE order_id = $1 AND superseded_at IS NULL
       ORDER BY confirmed_at DESC LIMIT 1 FOR UPDATE`, [orderId]
    );
    const quote = quotes[0];
    if (!quote) return { outcome: 'QUOTE_EXPIRED' };
    if (new Date(quote.expires_at).getTime() <= Date.now()) {
      await client.query("UPDATE medication_orders SET status = 'EXPIRED', updated_at = now() WHERE id = $1", [orderId]);
      await client.query("INSERT INTO medication_order_events (order_id,event_type,actor_name,actor_role,details) VALUES ($1,'QUOTE_EXPIRED','Système','system',$2::jsonb)", [orderId, JSON.stringify({ reason: 'DEVIS_EXPIRE_AVANT_PAIEMENT', quote_id: quote.id })]);
      return { outcome: 'QUOTE_EXPIRED' };
    }
    const amount = Number(quote.total_htg);
    if (!Number.isSafeInteger(amount) || amount <= 0) return { outcome: 'INVALID_AMOUNT' };

    const { rows: existing } = await client.query(
      'SELECT * FROM medication_payments WHERE medication_order_id = $1 FOR UPDATE', [orderId]
    );
    if (existing[0]) {
      if (existing[0].amount_htg !== amount || (existing[0].quote_id && existing[0].quote_id !== quote.id)) return { outcome: 'QUOTE_CHANGED' };
      if (existing[0].status === 'FAILED') {
        const reference = 'MED_' + crypto.randomUUID().replace(/-/g, '');
        const { rows: retried } = await client.query(
          `UPDATE medication_payments
              SET quote_id = $2, payment_reference = $3, amount_htg = $4,
                  status = 'PENDING', transaction_id = NULL, verified_amount_htg = NULL,
                  provider_raw = NULL, simulated = $5, verified_at = NULL,
                  redirect_url = NULL, create_started_at = NULL, updated_at = now()
            WHERE id = $1 RETURNING *`,
          [existing[0].id, quote.id, reference, amount, simulated]
        );
        await client.query("INSERT INTO medication_order_events (order_id,event_type,actor_id,actor_name,actor_role,details) VALUES ($1,'PAYMENT_PENDING',$2,'Patient','patient',$3::jsonb)", [orderId, patientId, JSON.stringify({ quote_id: quote.id, amount_htg: amount, retry: true })]);
        return { outcome: 'PENDING', payment: toApi(retried[0]), redirectUrl: null };
      }
      return { outcome: existing[0].status, payment: toApi(existing[0]), redirectUrl: existing[0].redirect_url || null };
    }

    const paymentId = 'MP_' + crypto.randomUUID();
    const reference = 'MED_' + crypto.randomUUID().replace(/-/g, '');
    const { rows: inserted } = await client.query(
      `INSERT INTO medication_payments
        (id, medication_order_id, quote_id, patient_id, payment_reference, amount_htg, simulated)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [paymentId, orderId, quote.id, patientId, reference, amount, simulated]
    );
    await client.query("INSERT INTO medication_order_events (order_id,event_type,actor_id,actor_name,actor_role,details) VALUES ($1,'PAYMENT_PENDING',$2,'Patient','patient',$3::jsonb)", [orderId, patientId, JSON.stringify({ quote_id: quote.id, amount_htg: amount })]);
    return { outcome: 'PENDING', payment: toApi(inserted[0]), redirectUrl: null };
  });
}

async function claimProviderCreation(orderId, patientId) {
  const { rows } = await query(
    "UPDATE medication_payments p SET create_started_at = now(), updated_at = now() FROM medication_orders o WHERE p.medication_order_id = $1 AND o.id = p.medication_order_id AND o.patient_id = $2 AND p.status = 'PENDING' AND p.redirect_url IS NULL AND (p.create_started_at IS NULL OR p.create_started_at < now() - interval '2 minutes') RETURNING p.*",
    [orderId, patientId]
  );
  return rows[0] || null;
}
async function saveRedirectUrl(orderId, patientId, redirectUrl) {
  const { rows } = await query(
    "UPDATE medication_payments p SET redirect_url = $3, create_started_at = NULL, updated_at = now() FROM medication_orders o WHERE p.medication_order_id = $1 AND o.id = p.medication_order_id AND o.patient_id = $2 AND p.status = 'PENDING' RETURNING p.id",
    [orderId, patientId, redirectUrl]
  );
  return rows.length > 0;
}
async function releaseProviderCreation(orderId, patientId) {
  await query(
    "UPDATE medication_payments p SET create_started_at = NULL, updated_at = now() FROM medication_orders o WHERE p.medication_order_id = $1 AND o.id = p.medication_order_id AND o.patient_id = $2 AND p.status = 'PENDING' AND p.redirect_url IS NULL",
    [orderId, patientId]
  );
}

async function findByOrderId(orderId) {
  const { rows } = await query(
    'SELECT * FROM medication_payments WHERE medication_order_id = $1', [orderId]
  );
  return rows[0] || null;
}

/** Commit payment and order state together, only after server-side MonCash verification. */
async function markVerified({ paymentId, patientId, transactionId, verifiedAmount, providerRaw, simulated = false }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM medication_payments WHERE id = $1 FOR UPDATE', [paymentId]
    );
    const payment = rows[0];
    if (!payment || payment.patient_id !== patientId) return { outcome: 'NOT_FOUND' };
    if (payment.status === 'PAID') {
      return payment.transaction_id === transactionId
        ? { outcome: 'PAID', payment: toApi(payment) }
        : { outcome: 'TRANSACTION_CONFLICT' };
    }
    if (payment.status !== 'PENDING') return { outcome: 'INVALID_STATE' };
    if (!transactionId || !Number.isSafeInteger(Number(verifiedAmount)) ||
        Number(verifiedAmount) !== Number(payment.amount_htg)) {
      await client.query(
        `UPDATE medication_payments SET status = 'FAILED', provider_raw = $2::jsonb, updated_at = now()
         WHERE id = $1`,
        [paymentId, JSON.stringify(providerRaw || {})]
      );
      return { outcome: 'VERIFICATION_MISMATCH' };
    }
    const { rows: collision } = await client.query(
      'SELECT id FROM medication_payments WHERE transaction_id = $1 AND id <> $2',
      [transactionId, paymentId]
    );
    if (collision.length) return { outcome: 'DUPLICATE_TRANSACTION' };

    const { rows: updated } = await client.query(
      `UPDATE medication_payments
          SET status = 'PAID', transaction_id = $2, provider_raw = $3::jsonb,
              simulated = $4, verified_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'PENDING' RETURNING *`,
      [paymentId, transactionId, JSON.stringify(providerRaw || {}), simulated]
    );
    if (!updated[0]) return { outcome: 'INVALID_STATE' };

    const { rows: orders } = await client.query(
      `UPDATE medication_orders SET status = 'PAID', updated_at = now()
        WHERE id = $1 AND patient_id = $2 AND status = 'ACCEPTED' RETURNING id`,
      [payment.medication_order_id, patientId]
    );
    if (!orders.length) throw new Error('medication_payment_order_transition_failed');

    await client.query(
      `INSERT INTO medication_order_events
        (order_id, event_type, actor_id, actor_name, actor_role, details)
       VALUES ($1, 'PAYMENT_VERIFIED', $2, 'Patient', 'patient', $3::jsonb)`,
      [payment.medication_order_id, patientId, JSON.stringify({
        payment_reference: payment.payment_reference,
        transaction_id: transactionId,
        amount_htg: payment.amount_htg,
      })]
    );
    return { outcome: 'PAID', payment: toApi(updated[0]) };
  });
}

async function markFailed(paymentId, providerRaw) {
  const { rows } = await query(
    `UPDATE medication_payments SET status = 'FAILED', provider_raw = $2::jsonb, updated_at = now()
      WHERE id = $1 AND status = 'PENDING' RETURNING *`,
    [paymentId, JSON.stringify(providerRaw || {})]
  );
  return rows[0] || null;
}

module.exports = { toApi, createIntent, claimProviderCreation, saveRedirectUrl, releaseProviderCreation, findByOrderId, markVerified, markFailed };
