'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../auth');
const deliveries = require('../repos/deliveries');
const notifications = require('../notifications/emit');
const { query } = require('../db');

const router = express.Router();

router.get('/delivery-zones', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const { query } = require('../db');
    const { rows } = await query('SELECT id, city, zone_name FROM delivery_zones WHERE active = TRUE ORDER BY city, zone_name');
    res.json(rows);
  } catch (err) { next(err); }
});

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

    if (['PICKED_UP', 'OUT_FOR_DELIVERY', 'AWAITING_CONFIRMATION', 'FAILED_ATTEMPT', 'RETURNED_ESCALATED'].includes(eventType)) {
      const tracking = await deliveries.listForEmployee(req.user.id);
      const delivery = tracking.find((item) => item.id === req.params.id);
      // Patient notification is generic; no diagnosis or medication details.
      const { query } = require('../db');
      const { rows } = await query('SELECT patient_id FROM medication_orders WHERE id = $1', [delivery?.medication_order_id]);
      if (rows[0]?.patient_id) {
        notifications.emit({
          userId: rows[0].patient_id,
          eventType: 'medication:delivery-update',
          idempotencyKey: 'delivery:' + req.params.id + ':' + eventType + ':' + String(req.get('Idempotency-Key')),
          title: 'Medika',
          body: ({
            PICKED_UP: 'Votre commande a été récupérée à la pharmacie.',
            OUT_FOR_DELIVERY: 'Votre commande est en route vers votre adresse.',
            AWAITING_CONFIRMATION: 'Votre commande est arrivée. Confirmez sa réception dans Medika.',
            FAILED_ATTEMPT: 'La tentative de livraison n’a pas abouti. Notre équipe vous contactera.',
            RETURNED_ESCALATED: 'Votre commande est retournée à notre équipe pour traitement.',
          })[eventType],
          url: '/app/consultations',
        });
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
    if (result.outcome === 'INVALID_TRANSITION') return res.status(409).json({ error: 'La réception ne peut pas encore être confirmée.', status: result.status });
    if (result.outcome === 'DELIVERED') {
      const key = 'delivery:' + req.params.id + ':patient-confirmed';
      notifications.emit({
        userId: req.user.id, eventType: 'medication:delivery-delivered', idempotencyKey: key + ':patient',
        title: 'Medika', body: 'Vous avez confirmé la réception de votre commande. Merci de faire confiance à Medika.',
        url: '/app/consultations',
      });
      const { rows } = await query('SELECT id FROM users WHERE role = $1', ['admin']);
      for (const admin of rows) notifications.emit({
        userId: admin.id, eventType: 'medication:delivery-delivered', idempotencyKey: key + ':admin:' + admin.id,
        title: 'Medika', body: 'Un patient a confirmé la réception de sa livraison.',
        url: '/admin/livraisons',
      });
    }
    res.json({ success: true, status: 'DELIVERED' });
  } catch (err) { next(err); }
});

module.exports = router;
