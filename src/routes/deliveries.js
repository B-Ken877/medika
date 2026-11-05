'use strict';

/**
 * Delivery routes — patient tracking + delivery-employee portal
 * (consolidated issue #82 §7).
 *
 * Authorization:
 *  * /api/delivery/my + /api/delivery/:id/events — role 'delivery' ONLY, and
 *    every repo query filters on assigned_to = the authenticated employee
 *    (a delivery employee can never see or update a colleague's delivery).
 *  * /api/medication-orders/:id/delivery(+)/confirm — the ORDER's patient
 *    only.
 *  * The coverage zones endpoint lives in routes/medication-orders.js
 *    (GET /api/delivery-zones) — no duplicate here.
 *
 * Notifications: French, generic (no diagnosis, no medication contents),
 * emitted AFTER the business transaction committed and fire-and-forget — a
 * notification failure can never fail or roll back a committed transition.
 */

const express = require('express');
const { authenticate, requireRole } = require('../auth');
const { query } = require('../db');
const deliveries = require('../repos/deliveries');
const notifications = require('../notifications/emit');

const router = express.Router();

const DELIVERY_UPDATE_COPY = {
  PICKED_UP: 'Votre commande a été récupérée à la pharmacie.',
  OUT_FOR_DELIVERY: 'Votre commande est en route vers votre adresse.',
  AWAITING_CONFIRMATION: 'Votre commande est arrivée. Confirmez sa réception dans Medika.',
  FAILED_ATTEMPT: 'La tentative de livraison n’a pas abouti. Notre équipe vous contactera.',
  RETURNED_ESCALATED: 'Votre commande est retournée à notre équipe pour traitement.',
};

router.get('/delivery/my', authenticate, requireRole('delivery'), async (req, res, next) => {
  try {
    res.json(await deliveries.listForEmployee(req.user.id));
  } catch (err) { next(err); }
});

router.post('/delivery/:id/events', authenticate, requireRole('delivery'), async (req, res, next) => {
  try {
    const eventType = String(req.body?.event_type || '');
    const result = await deliveries.transition({
      deliveryId: req.params.id,
      employeeId: req.user.id,
      employeeName: req.user.name,
      eventType,
      reason: req.body?.reason,
      idempotencyKey: req.get('Idempotency-Key'),
    });
    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Livraison introuvable.' });
    if (result.outcome === 'INVALID_EVENT') return res.status(400).json({ error: 'Étape de livraison non reconnue.' });
    if (result.outcome === 'INVALID_IDEMPOTENCY_KEY') return res.status(400).json({ error: 'Clé de soumission invalide.' });
    if (result.outcome === 'FAILURE_REASON_REQUIRED') return res.status(400).json({ error: 'Veuillez préciser la raison de la tentative échouée.' });
    if (result.outcome === 'INVALID_TRANSITION') return res.status(409).json({ error: 'Cette étape ne correspond pas au statut actuel.', status: result.status });
    if (result.outcome === 'DUPLICATE') return res.json({ success: true, duplicate: true, status: result.status });

    // Committed transition → notify the patient (fire-and-forget; the
    // idempotency of the notification reuses the transition's key).
    if (result.patientId && DELIVERY_UPDATE_COPY[eventType]) {
      notifications.emit({
        userId: result.patientId,
        eventType: 'medication:delivery-update',
        idempotencyKey: 'delivery:' + req.params.id + ':' + eventType + ':' + String(req.get('Idempotency-Key')),
        title: 'Medika',
        body: DELIVERY_UPDATE_COPY[eventType],
        url: '/app/consultations',
      });
    }
    res.json({ success: true, status: result.status });
  } catch (err) { next(err); }
});

router.get('/medication-orders/:id/delivery', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const tracking = await deliveries.trackingForPatient(req.params.id, req.user.id);
    if (!tracking) return res.status(404).json({ error: 'Suivi de livraison introuvable.' });
    res.json(tracking);
  } catch (err) { next(err); }
});

router.post('/medication-orders/:id/delivery/confirm', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const result = await deliveries.confirmByPatient({
      orderId: req.params.id,
      patientId: req.user.id,
      patientName: req.user.name,
    });
    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Suivi de livraison introuvable.' });
    if (result.outcome === 'INVALID_TRANSITION') return res.status(409).json({ error: 'La réception ne peut pas encore être confirmée.', status: result.status });
    res.json({ success: true, status: 'DELIVERED' });
  } catch (err) { next(err); }
});

module.exports = router;
