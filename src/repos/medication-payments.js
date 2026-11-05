'use strict';
const crypto = require('crypto');
const { query, withTransaction } = require('../db');

function api(row) {
  if (!row) return null;
  return {
    id: Number(row.id), order_id: row.order_id, quote_id: row.quote_id,
    reference: row.reference, amount_htg: Number(row.amount_htg), currency: row.currency,
    status: row.status, transaction_id: row.transaction_id || null,
    verified_amount_htg: row.verified_amount_htg == null ? null : Number(row.verified_amount_htg),
    simulated: Boolean(row.simulated),
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
    verified_at: row.verified_at ? Math.floor(new Date(row.verified_at).getTime() / 1000) : null,
  };
}

async function createIntent({ orderId, patient, simulated }) {
  return withTransaction(async (client) => {
    const { rows: orders } = await client.query('SELECT * FROM medication_orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = orders[0];
    if (!order || order.patient_id !== patient.id) return { outcome: 'NOT_FOUND' };
    if (order.status === 'PAID') {
      const { rows } = await client.query('SELECT * FROM medication_payments WHERE order_id = $1 ORDER BY id DESC LIMIT 1', [orderId]);
      return { outcome: 'ALREADY_PAID', payment: api(rows[0]) };
    }
    if (order.status !== 'ACCEPTED') return { outcome: 'INVALID_STATE', status: order.status };

    const { rows: quotes } = await client.query(
      'SELECT * FROM pharmacy_quotes WHERE order_id = $1 AND superseded_at IS NULL ORDER BY confirmed_at DESC LIMIT 1 FOR UPDATE',
      [orderId]
    );
    const quote = quotes[0];
    if (!quote) return { outcome: 'NO_QUOTE' };
    if (new Date(quote.expires_at).getTime() <= Date.now()) {
      await client.query("UPDATE medication_orders SET status = 'EXPIRED', updated_at = now() WHERE id = $1", [orderId]);
      await client.query(
        "INSERT INTO medication_order_events (order_id,event_type,actor_id,actor_name,actor_role,details) VALUES ($1,'QUOTE_EXPIRED',NULL,'Système','system',$2::jsonb)",
        [orderId, JSON.stringify({ reason: 'DEVIS_EXPIRE_AVANT_PAIEMENT', quote_id: quote.id })]
      );
      return { outcome: 'QUOTE_EXPIRED' };
    }
    const amount = Number(quote.total_htg);
    if (!Number.isSafeInteger(amount) || amount <= 0) return { outcome: 'INVALID_AMOUNT' };

    const { rows: existingRows } = await client.query(
      'SELECT * FROM medication_payments WHERE order_id = $1 AND quote_id = $2 FOR UPDATE',
      [orderId, quote.id]
    );
    if (existingRows[0]) {
      const existing = existingRows[0];
      if (existing.status === 'PAID') return { outcome: 'ALREADY_PAID', payment: api(existing) };
      if (existing.status === 'EXPIRED') return { outcome: 'QUOTE_EXPIRED' };
      if (existing.status === 'FAILED') {
        const { rows } = await client.query(
          "UPDATE medication_payments SET status = 'PENDING', simulated = $2, redirect_url = NULL, create_started_at = NULL, provider_raw = NULL, updated_at = now() WHERE id = $1 RETURNING *",
          [existing.id, Boolean(simulated)]
        );
        return { outcome: 'READY', payment: api(rows[0]), redirectUrl: null };
      }
      return { outcome: 'READY', payment: api(existing), redirectUrl: existing.redirect_url || null };
    }
    const reference = 'MED-' + crypto.randomBytes(18).toString('hex').toUpperCase();
    const { rows } = await client.query(
      'INSERT INTO medication_payments (order_id, quote_id, patient_id, reference, amount_htg, simulated) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [orderId, quote.id, patient.id, reference, amount, Boolean(simulated)]
    );
    await client.query(
      "INSERT INTO medication_order_events (order_id,event_type,actor_id,actor_name,actor_role,details) VALUES ($1,'PAYMENT_PENDING',$2,$3,'patient',$4::jsonb)",
      [orderId, patient.id, String(patient.name || ''), JSON.stringify({ quote_id: quote.id, amount_htg: amount })]
    );
    return { outcome: 'READY', payment: api(rows[0]) };
  });
}

async function claimProviderCreation(orderId, patientId) {
  const { rows } = await query(
    "UPDATE medication_payments p SET create_started_at = now(), updated_at = now() FROM medication_orders o WHERE p.order_id = $1 AND o.id = p.order_id AND o.patient_id = $2 AND p.status = 'PENDING' AND p.redirect_url IS NULL AND (p.create_started_at IS NULL OR p.create_started_at < now() - interval '2 minutes') RETURNING p.*",
    [orderId, patientId]
  );
  return rows[0] || null;
}

async function saveRedirectUrl(orderId, patientId, redirectUrl) {
  const { rows } = await query(
    "UPDATE medication_payments p SET redirect_url = $3, create_started_at = NULL, updated_at = now() FROM medication_orders o WHERE p.order_id = $1 AND o.id = p.order_id AND o.patient_id = $2 AND p.status = 'PENDING' RETURNING p.id",
    [orderId, patientId, redirectUrl]
  );
  return rows.length > 0;
}

async function releaseProviderCreation(orderId, patientId) {
  await query(
    "UPDATE medication_payments p SET create_started_at = NULL, updated_at = now() FROM medication_orders o WHERE p.order_id = $1 AND o.id = p.order_id AND o.patient_id = $2 AND p.status = 'PENDING' AND p.redirect_url IS NULL",
    [orderId, patientId]
  );
}

async function getIntentForPatient(orderId, patientId) {
  const { rows } = await query(
    'SELECT p.* FROM medication_payments p JOIN medication_orders o ON o.id = p.order_id WHERE p.order_id = $1 AND o.patient_id = $2 ORDER BY p.id DESC LIMIT 1',
    [orderId, patientId]
  );
  return api(rows[0]);
}

async function verifyIntent({ orderId, patient, verified }) {
  return withTransaction(async (client) => {
    const { rows: orders } = await client.query('SELECT * FROM medication_orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = orders[0];
    if (!order || order.patient_id !== patient.id) return { outcome: 'NOT_FOUND' };
    const { rows: payments } = await client.query('SELECT * FROM medication_payments WHERE order_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE', [orderId]);
    const payment = payments[0];
    if (!payment) return { outcome: 'NOT_FOUND' };
    if (payment.status === 'PAID' && order.status === 'PAID') return { outcome: 'PAID', payment: api(payment) };
    if (order.status !== 'ACCEPTED' || payment.status !== 'PENDING') return { outcome: 'INVALID_STATE' };

    const { rows: quotes } = await client.query(
      'SELECT * FROM pharmacy_quotes WHERE id = $1 AND order_id = $2 AND superseded_at IS NULL FOR UPDATE',
      [payment.quote_id, orderId]
    );
    const quote = quotes[0];
    if (!quote || new Date(quote.expires_at).getTime() <= Date.now()) {
      await client.query("UPDATE medication_payments SET status = 'EXPIRED', updated_at = now() WHERE id = $1", [payment.id]);
      await client.query("UPDATE medication_orders SET status = 'EXPIRED', updated_at = now() WHERE id = $1", [orderId]);
      return { outcome: 'QUOTE_EXPIRED' };
    }
    if (!verified || verified.status !== 'completed') {
      if (verified && verified.status === 'failed') {
        await client.query(
          "UPDATE medication_payments SET status = 'FAILED', provider_raw = $2::jsonb, updated_at = now() WHERE id = $1",
          [payment.id, JSON.stringify(verified.raw || {})]
        );
        await client.query(
          "INSERT INTO medication_order_events (order_id,event_type,actor_id,actor_name,actor_role,details) VALUES ($1,'PAYMENT_FAILED',$2,$3,'patient',$4::jsonb)",
          [orderId, patient.id, String(patient.name || ''), JSON.stringify({ payment_id: payment.id })]
        );
        return { outcome: 'FAILED' };
      }
      return { outcome: 'PENDING' };
    }
    if (!verified.reference || String(verified.reference) !== String(payment.reference)) return { outcome: 'REFERENCE_MISMATCH' };
    if (!verified.transactionId) return { outcome: 'PENDING' };
    if (!Number.isSafeInteger(Number(verified.amount)) || Number(verified.amount) !== Number(payment.amount_htg)) return { outcome: 'AMOUNT_MISMATCH' };

    const { rows: updatedRows } = await client.query(
      "UPDATE medication_payments SET status = 'PAID', transaction_id = $2, verified_amount_htg = $3, provider_raw = $4::jsonb, verified_at = now(), updated_at = now() WHERE id = $1 AND status = 'PENDING' RETURNING *",
      [payment.id, String(verified.transactionId), Number(verified.amount), JSON.stringify(verified.raw || {})]
    );
    if (!updatedRows[0]) return { outcome: 'INVALID_STATE' };
    await client.query("UPDATE medication_orders SET status = 'PAID', updated_at = now() WHERE id = $1 AND status = 'ACCEPTED'", [orderId]);
    await client.query(
      "INSERT INTO medication_order_events (order_id,event_type,actor_id,actor_name,actor_role,details) VALUES ($1,'PAYMENT_VERIFIED',$2,$3,'patient',$4::jsonb)",
      [orderId, patient.id, String(patient.name || ''), JSON.stringify({
        payment_id: payment.id, quote_id: payment.quote_id, amount_htg: payment.amount_htg,
        transaction_id: verified.transactionId,
      })]
    );
    return { outcome: 'PAID', payment: api(updatedRows[0]) };
  });
}
module.exports = { api, createIntent, getIntentForPatient, claimProviderCreation, saveRedirectUrl, releaseProviderCreation, verifyIntent };
