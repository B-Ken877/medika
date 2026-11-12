/**
 * Medication order routes — PATIENT side (issue #83).
 *
 * The patient of an ISSUED prescription can ask Medika to source its
 * medications (« Demander le prix et la livraison avec Medika »), review the
 * recorded pharmacy quote and decide (accept / decline / cancel). A patient
 * who wants to buy independently never needs to create an order — the
 * prescription download/print path stays completely independent.
 *
 * Authorization: the patient of the consultation ONLY (identity from the JWT
 * + consultation row, never from client input); admins use the ops APIs in
 * src/routes/admin-medication-orders.js. All copy is French (issue #83).
 *
 * Server-side transition validation everywhere: client-supplied status
 * values are ignored; the repo validates every transition under the order
 * row lock. Notification failures can never break order creation (emit() is
 * fire-and-forget by contract and never throws).
 */
'use strict';

const express = require('express');
const ordersRepo = require('../repos/medication-orders');
const medicationPayments = require('../repos/medication-payments');
const { authenticate, requireRole } = require('../auth');
const { query } = require('../db');
const notifications = require('../notifications/emit');
const simulation = require('../medication-simulation');

const router = express.Router();

/**
 * GET /api/delivery-zones — the exact, currently ACTIVE coverage zone records
 * (issue #82 §7). The order form offers ONLY these; anything else fails
 * closed server-side at creation time. Reads from the delivery_zones table
 * (migration 013) — an empty result simply means Medika delivery is not
 * configured yet and the patient keeps the independent-purchase path.
 */
router.get('/delivery-zones', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const zones = await ordersRepo.listActiveZonesPublic();
    res.json({ zones });
  } catch (err) { next(err); }
});

/**
 * POST /api/consultations/:id/medication-order — the patient asks Medika to
 * source the medications of this consultation's issued prescription.
 *
 * Outcomes:
 *   201 CREATED  — order created (status REQUESTED, 30-min ops SLA started)
 *   404          — unknown consultation / not the patient (no existence leak)
 *   403          — authenticated user is not the consultation's patient
 *   409          — no issued prescription (NO_PRESCRIPTION) or an active
 *                  order already exists (MEDICATION_ORDER_ALREADY_EXISTS)
 */
router.post('/consultations/:id/medication-order', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await ordersRepo.createOrder({
      consultationId: req.params.id,
      patient: req.user,
      deliveryAddress: typeof body.delivery_address === 'string' ? body.delivery_address.trim() : '',
      deliveryCity: typeof body.delivery_city === 'string' ? body.delivery_city.trim() : '',
      deliveryPhone: typeof body.delivery_phone === 'string' ? body.delivery_phone.trim() : '',
      // Explicit zone RECORD selected from /api/delivery-zones — never free text.
      deliveryZoneId: typeof body.delivery_zone_id === 'string' ? body.delivery_zone_id.trim() : '',
    });

    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Not found' });
    if (result.outcome === 'FORBIDDEN') return res.status(404).json({ error: 'Not found' });
    if (result.outcome === 'INVALID_DELIVERY_DETAILS') {
      return res.status(400).json({ error: result.error, code: 'INVALID_DELIVERY_DETAILS' });
    }
    if (result.outcome === 'SERVICE_UNAVAILABLE') {
      return res.status(503).json({ error: result.error, code: 'MEDIKA_DELIVERY_NOT_CONFIGURED' });
    }
    if (result.outcome === 'OUT_OF_COVERAGE') {
      return res.status(422).json({ error: result.error, code: 'DELIVERY_ZONE_NOT_SUPPORTED' });
    }
    if (result.outcome === 'NO_PRESCRIPTION') {
      return res.status(409).json({
        error: 'Aucune ordonnance délivrée sur cette consultation : la demande de prix nécessite une ordonnance du médecin.',
        code: 'PRESCRIPTION_NOT_ISSUED',
      });
    }
    if (result.outcome === 'ALREADY_EXISTS') {
      return res.status(409).json({
        error: 'Une demande de prix est déjà en cours pour cette ordonnance.',
        code: 'MEDICATION_ORDER_ALREADY_EXISTS',
        existing_id: result.existing.id,
        existing_reference: result.existing.reference,
      });
    }

    // Ops team notified (owner request: full medication push coverage) AFTER
    // the authoritative creation commits — an order awaits their quote, so
    // the admins are the actionable party (the patient knows they just
    // submitted it). Generic French copy: no medication name, no patient
    // data, no diagnosis; the deep link opens the ops panel only after
    // authentication. Admin ids come from the users table, never from the
    // client; each admin gets their own idempotency key (exactly once).
    // Fire-and-forget per the emit contract: never blocks or breaks the 201.
    const { rows: admins } = await query("SELECT id FROM users WHERE role = 'admin'");
    for (const admin of admins) {
      notifications.emit({
        userId: admin.id,
        eventType: 'medication:order-submitted',
        idempotencyKey: `medication-order:${result.order.id}:submitted:admin:${admin.id}`,
        ...notifications.COPY.medicationOrderSubmitted,
      });
    }

    // Note: the simulation engine (Nov 2026) runs LAZILY on the next GET of
    // the order, not here on the POST. This keeps createOrder returning a
    // clean REQUESTED order so admin-driven manual quoting (issue #83) and
    // the simulation never race: the patient's next status poll is what
    // auto-records the simulated quote when no real pharmacy network is
    // connected.

    res.status(201).json(ordersRepo.orderRowToApi(result.order));
  } catch (err) { next(err); }
});

/**
 * GET /api/consultations/:id/medication-order — the patient's order for this
 * consultation (with the active quote and a derived next step). 404 when the
 * caller has no order here (no existence leak for non-owners).
 */
router.get('/consultations/:id/medication-order', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id FROM medication_orders
        WHERE consultation_id = $1 AND patient_id = $2
        ORDER BY requested_at DESC LIMIT 1`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    // Simulation (owner request, Nov 2026): if the order is still
    // REQUESTED/ESCALATED and the seeded simulation pharmacy is active,
    // auto-record a quote so the patient sees « pricing discovery »
    // immediately instead of waiting for a manual ops call that will never
    // come while no real pharmacy network is connected. Idempotent and
    // fail-safe — never overrides a real (manual) quote.
    await simulation.maybeSimulateQuote(rows[0].id);
    // If the order has already been paid, advance the simulated delivery
    // chain so the patient sees the custody progression.
    await simulation.maybeSimulateDelivery(rows[0].id);

    const order = await ordersRepo.getForPatient(rows[0].id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Not found' });
    order.payment = medicationPayments.toApi(await medicationPayments.findByOrderId(order.id));
    res.json(order);
  } catch (err) { next(err); }
});

/**
 * POST /api/medication-orders/:id/accept — the patient accepts the active,
 * UNEXPIRED quote. 409 QUOTE_EXPIRED when the quote validity has passed
 * (re-validated server-side at the transition, under the row lock); 409
 * INVALID_TRANSITION for any other non-QUOTED status.
 */
router.post('/medication-orders/:id/accept', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const result = await ordersRepo.acceptQuote({ orderId: req.params.id, patient: req.user });
    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Not found' });
    if (result.outcome === 'QUOTE_EXPIRED') {
      return res.status(409).json({
        error: 'Ce devis a expiré. Contactez Medika pour obtenir un devis actualisé.',
        code: 'QUOTE_EXPIRED',
      });
    }
    if (result.outcome === 'INVALID_TRANSITION') {
      return res.status(409).json({
        error: 'Cette action n’est pas possible dans l’état actuel de la demande.',
        code: 'INVALID_TRANSITION',
        status: result.status,
      });
    }
    res.json({ success: true, status: 'ACCEPTED' });
  } catch (err) { next(err); }
});

/**
 * POST /api/medication-orders/:id/decline — the patient declines the quote
 * (terminal for this order; a new request can be created afterwards).
 */
router.post('/medication-orders/:id/decline', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    if (reason.length > ordersRepo.LIMITS.declineReason) {
      return res.status(400).json({ error: `La raison ne peut pas dépasser ${ordersRepo.LIMITS.declineReason} caractères.` });
    }
    const result = await ordersRepo.declineQuote({ orderId: req.params.id, patient: req.user, reason });
    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Not found' });
    if (result.outcome === 'INVALID_TRANSITION') {
      return res.status(409).json({
        error: 'Cette action n’est pas possible dans l’état actuel de la demande.',
        code: 'INVALID_TRANSITION',
        status: result.status,
      });
    }
    res.json({ success: true, status: 'DECLINED' });
  } catch (err) { next(err); }
});

/**
 * POST /api/medication-orders/:id/cancel — the patient cancels BEFORE any
 * quote (REQUESTED / ESCALATED). A quoted order is declined instead (409).
 */
router.post('/medication-orders/:id/cancel', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    if (reason.length > ordersRepo.LIMITS.declineReason) {
      return res.status(400).json({ error: `La raison ne peut pas dépasser ${ordersRepo.LIMITS.declineReason} caractères.` });
    }
    const result = await ordersRepo.cancelOrder({ orderId: req.params.id, patient: req.user, reason });
    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Not found' });
    if (result.outcome === 'INVALID_TRANSITION') {
      return res.status(409).json({
        error: 'Cette action n’est pas possible dans l’état actuel de la demande.',
        code: 'INVALID_TRANSITION',
        status: result.status,
      });
    }
    res.json({ success: true, status: 'CANCELLED' });
  } catch (err) { next(err); }
});

module.exports = router;
