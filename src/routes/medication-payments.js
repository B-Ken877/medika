'use strict';
const express = require('express');
const crypto = require('crypto');
const paymentsRepo = require('../repos/medication-payments');
const moncash = require('../moncash');
const { simulationAllowed } = require('../config');
const { authenticate, requireRole } = require('../auth');
const notifications = require('../notifications/emit');
const { query } = require('../db');
const router = express.Router();

function simulatedTransactionId(reference) {
  return 'SIM-' + crypto.createHash('sha256').update(String(reference)).digest('hex');
}

function mapOutcome(res, result) {
  if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Paiement introuvable.' });
  if (result.outcome === 'INVALID_STATE') return res.status(409).json({ error: 'Le devis doit être accepté avant le paiement.', code: 'INVALID_PAYMENT_STATE' });
  if (result.outcome === 'NO_QUOTE') return res.status(409).json({ error: 'Aucun devis actif pour cette demande.' });
  if (result.outcome === 'QUOTE_EXPIRED') return res.status(409).json({ error: 'Ce devis a expiré. Demandez un devis actualisé.', code: 'QUOTE_EXPIRED' });
  if (result.outcome === 'INVALID_AMOUNT') return res.status(409).json({ error: 'Le montant du devis est invalide.' });
  if (result.outcome === 'REFERENCE_MISMATCH') return res.status(409).json({ error: 'La référence MonCash ne correspond pas à cette demande.', code: 'PAYMENT_REFERENCE_MISMATCH' });
  if (result.outcome === 'AMOUNT_MISMATCH') return res.status(409).json({ error: 'Le montant confirmé par MonCash ne correspond pas au devis.', code: 'PAYMENT_AMOUNT_MISMATCH' });
  if (result.outcome === 'FAILED') return res.status(402).json({ success: false, status: 'FAILED', error: 'Le paiement a échoué. Vous pouvez réessayer.' });
  return null;
}

router.post('/medication-orders/:id/payment/create', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const simulated = simulationAllowed(req.user);
    const result = await paymentsRepo.createIntent({ orderId: req.params.id, patient: req.user, simulated });
    const error = mapOutcome(res, result);
    if (error) return error;
    if (result.outcome === 'ALREADY_PAID') return res.json({ success: true, status: 'PAID', payment: result.payment });
    const payment = result.payment;
    if (payment.simulated && simulated) {
      return res.json({
        success: true, simulated: true, status: payment.status,
        payment, redirectUrl: '/payment/simulated?medicationOrderId=' + encodeURIComponent(req.params.id),
      });
    }
    if (!moncash.moncashConfigured()) {
      return res.status(503).json({ success: false, error: 'Le service MonCash est momentanément indisponible. Réessayez plus tard.' });
    }
    const { redirectUrl } = await moncash.createPayment({ amount: payment.amount_htg, orderId: payment.reference });
    return res.json({ success: true, simulated: false, status: payment.status, payment, redirectUrl });
  } catch (err) {
    if (String(err.message || '').startsWith('moncash_')) {
      return res.status(502).json({ success: false, error: 'Impossible de joindre MonCash pour le moment. Votre demande reste en attente; réessayez.' });
    }
    next(err);
  }
});

router.get('/medication-orders/:id/payment', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const payment = await paymentsRepo.getIntentForPatient(req.params.id, req.user.id);
    if (!payment) return res.status(404).json({ error: 'Paiement introuvable.' });
    res.json({ payment });
  } catch (err) { next(err); }
});

router.post('/medication-orders/:id/payment/verify', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const intent = await paymentsRepo.getIntentForPatient(req.params.id, req.user.id);
    if (!intent) return res.status(404).json({ error: 'Paiement introuvable.' });
    if (intent.status === 'PAID') return res.json({ success: true, status: 'PAID', payment: intent });
    let verified = null;
    if (simulationAllowed(req.user) && intent.simulated) {
      verified = {
        reference: intent.reference, transactionId: simulatedTransactionId(intent.reference),
        amount: intent.amount_htg, status: 'completed', raw: { simulated: true },
      };
    } else {
      if (!moncash.moncashConfigured()) {
        return res.status(503).json({ success: false, status: 'PENDING', error: 'Le service MonCash est momentanément indisponible.' });
      }
      verified = await moncash.retrieveByOrderId(intent.reference);
    }
    const result = await paymentsRepo.verifyIntent({ orderId: req.params.id, patient: req.user, verified });
    const error = mapOutcome(res, result);
    if (error) return error;
    if (result.outcome === 'PAID') {
      const notificationKey = 'medication-order:' + req.params.id + ':payment:' + result.payment.id + ':paid';
      notifications.emit({
        userId: req.user.id,
        eventType: 'medication:paid',
        idempotencyKey: notificationKey,
        title: 'Medika',
        body: 'Votre paiement a été confirmé. Votre demande est transmise à notre équipe pour la préparation.',
        url: '/app/consultations',
      });
      // Notify the operations team as well; the event contains no clinical or
      // prescription details and the audit record is already committed.
      const { rows: admins } = await query("SELECT id FROM users WHERE role = 'admin'");
      for (const admin of admins) {
        notifications.emit({
          userId: admin.id,
          eventType: 'medication:paid',
          idempotencyKey: notificationKey + ':admin:' + admin.id,
          title: 'Medika',
          body: 'Un paiement MonCash a été confirmé. Une demande de médicaments est prête pour la préparation.',
          url: '/admin/medicaments',
        });
      }
      return res.json({ success: true, status: 'PAID', payment: result.payment });
    }
    if (result.outcome === 'PENDING') return res.status(202).json({ success: false, status: 'PENDING', error: 'Le paiement n’est pas encore confirmé par MonCash. Réessayez dans quelques instants.' });
    return res.status(409).json({ success: false, error: 'Le paiement n’a pas pu être confirmé. Contactez Medika si le montant a été débité.' });
  } catch (err) {
    if (String(err.message || '').startsWith('moncash_')) {
      return res.status(502).json({ success: false, status: 'PENDING', error: 'MonCash est momentanément injoignable. Réessayez la vérification.' });
    }
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'Cette transaction MonCash a déjà été associée à un paiement.', code: 'DUPLICATE_TRANSACTION' });
    }
    next(err);
  }
});
module.exports = router;
