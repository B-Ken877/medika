/**
 * MonCash payment routes — mounted at BOTH legacy paths:
 *   /api/payment/*            (canonical)
 *   /payment/api/payment/*    (Android PAYMENT_SERVER = https://…/payment and the
 *                              web PWA default NEXT_PUBLIC_PAYMENT_BASE_URL=/payment)
 *
 * Contract (from PaymentActivity.kt + medika-web/lib/payment.ts):
 *   POST /create {orderId, amount} → { success: true, redirectUrl }
 *   POST /verify {orderId} → { success, payment: { status: "completed", transactionId } }
 *   (Android requires payment.status === "completed" and reads
 *    payment.transactionId; the web client also accepts a top-level
 *    transactionId — both shapes are returned.)
 *
 * Verification ALWAYS goes through the provider (or the strictly isolated
 * simulation). Client-supplied success flags or transaction ids are ignored.
 */
'use strict';

/** Deterministic simulated transaction id — full encoding (no truncation: a
 *  truncated base64 prefix collides across similar order ids). */
function simulatedTransactionId(orderId) {
  return 'SIM-' + Buffer.from(String(orderId)).toString('base64url');
}

const express = require('express');
const paymentsRepo = require('../repos/payments');
const moncash = require('../moncash');
const { config, simulationAllowed } = require('../config');
const { authenticate } = require('../auth');
const { badRequest, conflict, serviceUnavailable } = require('../errors');

const router = express.Router();

function providerUnavailable(res) {
  return res
    .status(503)
    .json({ success: false, error: 'Serveur de paiement non configure (MONCASH_CLIENT_ID/SECRET requis)' });
}

// ─── POST /create ────────────────────────────────────────────────────────────

router.post('/create', authenticate, (req, res, next) => {
  (async () => {
    const { orderId, amount } = req.body || {};
    if (!orderId || !String(orderId).trim()) {
      return res.status(400).json({ success: false, error: 'orderId requis' });
    }
    const amountInt = parseInt(amount, 10);
    if (!Number.isFinite(amountInt) || amountInt <= 0) {
      return res.status(400).json({ success: false, error: 'Montant invalide' });
    }

    // Register the intent first (unique order_id → idempotent creates).
    const row = await paymentsRepo.create({
      order_id: String(orderId).trim(),
      patient_id: req.user.id,
      amount: amountInt,
      simulated: simulationAllowed(),
    });
    if (!row) {
      return res.status(409).json({ success: false, error: 'orderId deja utilise' });
    }

    if (simulationAllowed()) {
      // Simulation is only reachable outside production (config boot guard).
      return res.json({
        success: true,
        redirectUrl: `/payment/simulated?orderId=${encodeURIComponent(row.order_id)}`,
      });
    }
    if (!moncash.moncashConfigured()) {
      return providerUnavailable(res);
    }

    const { redirectUrl } = await moncash.createPayment({ amount: amountInt, orderId: row.order_id });
    res.json({ success: true, redirectUrl });
  })().catch((err) => {
    if (String(err.message || '').startsWith('moncash_')) {
      // Provider-side failure — user-safe message, no internals.
      return res.status(502).json({ success: false, error: 'Le serveur de paiement est injoignable. Reessayez.' });
    }
    next(err);
  });
});

// ─── POST /verify ────────────────────────────────────────────────────────────

router.post('/verify', authenticate, (req, res, next) => {
  (async () => {
    const { orderId } = req.body || {};
    if (!orderId || !String(orderId).trim()) {
      return res.status(400).json({ success: false, error: 'orderId requis' });
    }
    const row = await paymentsRepo.findByOrderId(String(orderId).trim());
    if (!row || (row.patient_id && row.patient_id !== req.user.id)) {
      return res.status(404).json({ success: false, error: 'Paiement introuvable' });
    }

    let verified = null;
    if (simulationAllowed() && row.simulated) {
      verified = {
        reference: row.order_id,
        transactionId: simulatedTransactionId(row.order_id),
        amount: row.amount,
        status: 'completed',
        raw: { simulated: true },
      };
    } else {
      if (!moncash.moncashConfigured()) return providerUnavailable(res);
      verified = await moncash.retrieveByOrderId(row.order_id); // null = not found / unpaid
    }

    if (!verified || verified.status !== 'completed') {
      // Keep the row PENDING (payment may complete later) — never mark paid.
      return res.json({ success: false, payment: { status: verified?.status || 'failed', transactionId: null } });
    }
    if (verified.reference && String(verified.reference) !== String(row.order_id)) {
      return res.json({ success: false, payment: { status: 'failed', transactionId: null } });
    }

    const updated = await paymentsRepo.markVerified(row.id, {
      transaction_id: verified.transactionId,
      verified_amount: verified.amount,
      provider_raw: verified.raw,
      simulated: Boolean(simulationAllowed() && row.simulated),
    });

    // Android shape + web-friendly top-level alias.
    res.json({
      success: true,
      transactionId: updated.transaction_id,
      payment: { status: 'completed', transactionId: updated.transaction_id, amount: updated.verified_amount ?? updated.amount },
    });
  })().catch((err) => {
    if (String(err.message || '').startsWith('moncash_')) {
      return res.status(502).json({ success: false, error: 'Le serveur de paiement est injoignable. Reessayez.' });
    }
    next(err);
  });
});

// ─── GET /payment/simulated (dev/sandbox-only page) ──────────────────────────
// A trivial page so the WebView/browser flow works end-to-end in simulation.
// Unreachable in production (config.assertProductionSafety refuses to boot).

router.get('/simulated', (req, res) => {
  if (!simulationAllowed()) {
    return res.status(404).json({ error: 'Not found' });
  }
  const orderId = String(req.query.orderId || '').replace(/[<>&"']/g, '');
  res.type('html').send(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Paiement simule</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f0fdf4;color:#14532d}main{text-align:center}</style></head>` +
    `<body><main><h1>Mode simulation</h1><p>Ceci est un paiement <strong>simule</strong> (developpement / sandbox uniquement).</p>` +
    `<p>Commande : <code>${orderId}</code></p><p>Vous pouvez fermer cet onglet et revenir a l'application.</p></main></body></html>`
  );
});

module.exports = router;
