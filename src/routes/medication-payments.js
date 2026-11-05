'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../auth');
const { simulationAllowed } = require('../config');
const moncash = require('../moncash');
const payments = require('../repos/medication-payments');
const notifications = require('../notifications/emit');

function emitPaidNotification(userId, orderId) {
  notifications.emit({
    userId,
    eventType: 'medication:paid',
    idempotencyKey: `medication-order:${orderId}:payment-verified`,
    title: 'Medika',
    body: 'Votre paiement a été confirmé. Votre commande est transmise à notre équipe.',
    url: '/app/consultations',
  });
}

const router = express.Router();

router.post('/medication-orders/:id/payment/create', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const result = await payments.createIntent({
      orderId: req.params.id,
      patientId: req.user.id,
      simulated: simulationAllowed(req.user),
    });
    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Demande introuvable.' });
    if (result.outcome === 'INVALID_STATE') return res.status(409).json({ error: 'Le devis doit être accepté avant le paiement.', code: 'QUOTE_NOT_ACCEPTED' });
    if (result.outcome === 'QUOTE_EXPIRED') return res.status(409).json({ error: 'Ce devis a expiré. Demandez un devis actualisé.', code: 'QUOTE_EXPIRED' });
    if (result.outcome === 'INVALID_AMOUNT') return res.status(409).json({ error: 'Le montant du devis ne peut pas être payé.', code: 'INVALID_AMOUNT' });
    if (result.outcome === 'AMOUNT_CHANGED') return res.status(409).json({ error: 'Le montant du devis a changé. Contactez Medika pour obtenir un nouveau devis.', code: 'AMOUNT_CHANGED' });
    if (result.outcome === 'PAID') return res.json({ success: true, paid: true, payment: result.payment });
    if (result.outcome === 'FAILED') return res.status(409).json({ error: 'Ce paiement a échoué. Contactez Medika pour réinitialiser le paiement.', code: 'PAYMENT_FAILED' });

    const payment = result.payment;
    if (payment.simulated && simulationAllowed(req.user)) {
      return res.json({
        success: true, simulated: true, payment,
        redirectUrl: '/payment/simulated?orderId=' + encodeURIComponent(payment.payment_reference),
      });
    }
    if (!moncash.moncashConfigured()) {
      return res.status(503).json({ error: 'Le service MonCash n’est pas configuré.', code: 'MONCASH_UNAVAILABLE' });
    }
    const gateway = await moncash.createPayment({
      amount: payment.amount_htg,
      orderId: payment.payment_reference,
    });
    return res.json({ success: true, simulated: false, payment, redirectUrl: gateway.redirectUrl });
  } catch (err) {
    if (String(err.message || '').startsWith('moncash_')) {
      return res.status(502).json({ error: 'Le service MonCash est temporairement inaccessible. Réessayez.', code: 'MONCASH_PROVIDER_ERROR' });
    }
    next(err);
  }
});

router.post('/medication-orders/:id/payment/verify', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const row = await payments.findByOrderId(req.params.id);
    if (!row || row.patient_id !== req.user.id) return res.status(404).json({ error: 'Paiement introuvable.' });
    if (row.status === 'PAID') {
      emitPaidNotification(req.user.id, row.medication_order_id);
      return res.json({ success: true, payment: payments.toApi(row) });
    }
    if (row.status !== 'PENDING') return res.status(409).json({ error: 'Ce paiement n’est plus vérifiable.', code: 'PAYMENT_NOT_PENDING' });

    let verified;
    if (row.simulated && simulationAllowed(req.user)) {
      verified = {
        reference: row.payment_reference,
        transactionId: 'SIM-' + Buffer.from(row.payment_reference).toString('base64url'),
        amount: row.amount_htg,
        status: 'completed',
        raw: { simulated: true },
      };
    } else {
      if (!moncash.moncashConfigured()) {
        return res.status(503).json({ error: 'Le service MonCash n’est pas configuré.', code: 'MONCASH_UNAVAILABLE' });
      }
      verified = await moncash.retrieveByOrderId(row.payment_reference);
    }

    if (!verified || verified.status !== 'completed') {
      return res.json({
        success: false,
        payment: { status: verified?.status || 'pending', transactionId: null },
      });
    }

    if (String(verified.reference || '') !== String(row.payment_reference) ||
        !verified.transactionId || Number(verified.amount) !== Number(row.amount_htg)) {
      await payments.markFailed(row.id, verified.raw || { reason: 'verification_mismatch' });
      return res.status(409).json({ error: 'La vérification du paiement n’a pas abouti. Aucun paiement n’a été confirmé.', code: 'PAYMENT_VERIFICATION_MISMATCH' });
    }

    const saved = await payments.markVerified({
      paymentId: row.id,
      patientId: req.user.id,
      transactionId: String(verified.transactionId),
      verifiedAmount: Number(verified.amount),
      providerRaw: verified.raw,
      simulated: Boolean(row.simulated && simulationAllowed(req.user)),
    });
    if (saved.outcome === 'DUPLICATE_TRANSACTION' || saved.outcome === 'TRANSACTION_CONFLICT') {
      return res.status(409).json({ error: 'Cette transaction MonCash est déjà associée à un autre paiement.', code: 'DUPLICATE_TRANSACTION' });
    }
    if (saved.outcome !== 'PAID') return res.status(409).json({ error: 'Le paiement n’a pas pu être confirmé.', code: 'PAYMENT_NOT_CONFIRMED' });
    emitPaidNotification(req.user.id, row.medication_order_id);
    return res.json({ success: true, payment: saved.payment });
  } catch (err) {
    if (String(err.message || '').startsWith('moncash_')) {
      return res.status(502).json({ error: 'Le service MonCash est temporairement inaccessible. Réessayez la vérification.', code: 'MONCASH_PROVIDER_ERROR' });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cette transaction MonCash est déjà utilisée.', code: 'DUPLICATE_TRANSACTION' });
    }
    next(err);
  }
});

module.exports = router;
