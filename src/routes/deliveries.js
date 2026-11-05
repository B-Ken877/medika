'use strict';

/**
 * Delivery routes (issue #82 — delivery scope).
 *
 *  - GET  /api/delivery/my                        (delivery employee): only the
 *    deliveries assigned to this account — isolation enforced in SQL.
 *  - POST /api/delivery/:id/events                (delivery employee): custody
 *    transitions, idempotent via the Idempotency-Key header.
 *  - GET  /api/medication-orders/:id/delivery     (patient): own tracking.
 *  - POST /api/medication-orders/:id/delivery/confirm (patient): receipt
 *    confirmation — the only path to DELIVERED.
 *
 * GET /api/delivery-zones lives in src/routes/medication-orders.js (active
 * zone records for the patient order form).
 *
 * Notification privacy: bodies are generic French copy; never diagnosis,
 * medication contents, names or addresses.
 */

const express = require('express');
const { query } = require('../db');
const { authenticate, requireRole } = require('../auth');
const deliveries = require('../repos/deliveries');
const notifications = require('../notifications/emit');

const router = express.Router();

const PATIENT_DELIVERY_NOTIFICATIONS = {
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
    const idempotencyKey = req.get('Idempotency-Key');
    const eventType = String(req.body?.event_type || '');
    const result = await deliveries.transition({
      deliveryId: req.params.id,
      employeeId: req.user.id,
      employeeName: req.user.name,
      eventType,
      reason: req.body?.reason,
      idempotencyKey,
    });
    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Livraison introuvable.' });
    if (result.outcome === 'INVALID_EVENT') return res.status(400).json({ error: 'Étape de livraison non reconnue.' });
    if (result.outcome === 'INVALID_IDEMPOTENCY_KEY') return res.status(400).json({ error: 'Clé de soumission invalide.' });
    if (result.outcome === 'FAILURE_REASON_REQUIRED') {
      return res.status(400).json({ error: 'Veuillez préciser la raison de la tentative échouée.' });
    }
    if (result.outcome === 'INVALID_TRANSITION') {
      return res.status(409).json({ error: 'Cette étape ne correspond pas au statut actuel.', status: result.status });
    }
    if (result.outcome === 'DUPLICATE') {
      return res.json({ success: true, duplicate: true, status: result.status });
    }

    // Patient notification after the committed transition (fire-and-forget —
    // a notification failure never rolls the delivery back).
    if (PATIENT_DELIVERY_NOTIFICATIONS[eventType]) {
      try {
        const { rows } = await query(
          `SELECT o.patient_id FROM medication_deliveries d
            JOIN medication_orders o ON o.id = d.medication_order_id
           WHERE d.id = $1`,
          [req.params.id]
        );
        if (rows[0]?.patient_id) {
          notifications.emit({
            userId: rows[0].patient_id,
            eventType: 'medication:delivery-update',
            idempotencyKey: 'delivery:' + req.params.id + ':' + eventType + ':' + String(idempotencyKey),
            title: 'Medika',
            body: PATIENT_DELIVERY_NOTIFICATIONS[eventType],
            url: '/app/consultations',
          });
        }
      } catch (notifyErr) {
        console.error('delivery notification failed (committed transition kept):', notifyErr?.code || notifyErr?.message);
      }
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
    const result = await deliveries.confirmByPatient({ orderId: req.params.id, patientId: req.user.id });
    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Suivi de livraison introuvable.' });
    if (result.outcome === 'INVALID_TRANSITION') {
      return res.status(409).json({ error: 'La réception ne peut pas encore être confirmée.', status: result.status });
    }
    res.json({ success: true, status: 'DELIVERED' });
  } catch (err) { next(err); }
});

module.exports = router;
