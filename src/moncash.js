/**
 * MonCash (Digicel Haiti) REST API client — server-side only.
 *
 * Endpoints implemented per the official MonCash REST API
 * (https://[sandbox.]moncashbutton.digicelgroup.com/Api):
 *   POST /oauth/token                    client_credentials + HTTP Basic
 *   POST /v1/CreatePayment               { amount, orderId } → payment_token
 *   POST /v1/RetrieveOrderPayment        { orderId }  → payment details
 *   POST /v1/RetrieveTransactionPayment  { transactionId } → payment details
 * Redirect: {base}/Moncash-middleware/Payment/Redirect?token=<token>
 * Currency: HTG only.
 *
 * Status vocabulary note: the provider's `status` field on retrieved payments
 * is matched case-insensitively against known success values. Android's
 * PaymentActivity expects OUR verify endpoint to answer
 *   { success: true, payment: { status: "completed", transactionId } }
 * so this module normalizes provider status → 'completed' | 'failed' | 'pending'.
 * The exact raw provider status is preserved in the payments.provider_raw column.
 */
'use strict';

const { config, moncashConfigured, simulationAllowed } = require('./config');

const BASE = (mode) =>
  mode === 'production'
    ? 'https://moncashbutton.digicelgroup.com'
    : 'https://sandbox.moncashbutton.digicelgroup.com';

const SUCCESS_STATUSES = ['successful', 'success', 'completed', 'complete', 'paid', 'paid_successfully'];

let cachedToken = { token: null, expiresAt: 0 }; // per function instance

async function fetchAccessToken() {
  if (cachedToken.token && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const body = new URLSearchParams({ scope: 'read,write', grant_type: 'client_credentials' });
  const auth = Buffer.from(`${config.moncashClientId}:${config.moncashClientSecret}`).toString('base64');
  const res = await fetch(`${BASE(config.moncashMode)}/Api/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw Object.assign(new Error(`moncash_auth_failed_${res.status}`), { expose: false });
  }
  const data = await res.json();
  if (!data?.access_token) throw new Error('moncash_auth_no_token');
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (parseInt(data.expires_in || '3600', 10) - 60) * 1000,
  };
  return cachedToken.token;
}

async function apiPost(path, jsonBody) {
  const token = await fetchAccessToken();
  const res = await fetch(`${BASE(config.moncashMode)}/Api${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(jsonBody),
    signal: AbortSignal.timeout(20_000),
  });
  // MonCash answers 404 (or non-200) when the transaction does not exist /
  // has not been paid yet — normalize to null rather than throwing so callers
  // can treat it as "not verified".
  if (res.status === 404) return null;
  if (!res.ok) {
    throw Object.assign(new Error(`moncash_request_failed_${res.status}`), { expose: false });
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeStatus(rawStatus) {
  const s = String(rawStatus || '').toLowerCase().trim();
  if (SUCCESS_STATUSES.includes(s)) return 'completed';
  if (['failed', 'cancelled', 'canceled', 'rejected', 'expired'].includes(s)) return 'failed';
  if (['pending', 'processing', 'in_progress'].includes(s)) return 'pending';
  return 'failed'; // fail closed on unknown values
}

/** Map a Retrieve response into our internal verified-payment shape. */
function mapRetrieveResponse(data) {
  if (!data) return null;
  const payment = data.payment || data;
  const reference = payment.reference ?? payment.orderId ?? null;
  const transactionId = payment.transaction_id ?? payment.transactionId ?? null;
  const cost = Number(payment.cost ?? payment.amount ?? 0);
  const status = normalizeStatus(payment.status ?? data.status);
  return {
    reference,
    transactionId,
    amount: Number.isFinite(cost) ? cost : 0,
    status, // completed | failed | pending
    payer: payment.payer ?? null,
    message: payment.message ?? null,
    raw: data,
  };
}

module.exports = {
  moncashConfigured,
  simulationAllowed,

  /** Create a payment → { redirectUrl } (throws on failure). */
  async createPayment({ amount, orderId }) {
    const data = await apiPost('/v1/CreatePayment', { amount, orderId });
    const token = data?.payment_token?.token;
    if (!token) throw new Error('moncash_create_no_token');
    return {
      redirectUrl: `${BASE(config.moncashMode)}/Moncash-middleware/Payment/Redirect?token=${encodeURIComponent(token)}`,
    };
  },

  async retrieveByOrderId(orderId) {
    return mapRetrieveResponse(await apiPost('/v1/RetrieveOrderPayment', { orderId }));
  },

  async retrieveByTransactionId(transactionId) {
    return mapRetrieveResponse(await apiPost('/v1/RetrieveTransactionPayment', { transactionId }));
  },
};
