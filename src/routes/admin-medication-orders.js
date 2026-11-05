/**
 * Medication order operations routes — ADMIN side (issue #83).
 *
 * The internal « Médicaments et pharmacies » operations area: partner
 * pharmacy directory, operations queue (new requests / overdue / quotes
 * awaiting the patient / exceptions), quote recording and WhatsApp handoff.
 *
 * Authorization: this router is mounted under /api/admin — the router-level
 * authenticateAdmin guard (JWT + role==='admin') applies to EVERY route
 * here. A patient or doctor token gets 403; an anonymous request gets 401.
 *
 * Hard rules (issue #83):
 *  - Pharmacies are partners, not users: NO login, NO portal, NO credential
 *    is stored or accepted — only directory entries (name / contact /
 *    WhatsApp number / location).
 *  - Recording a quote NEVER modifies the prescription (no code path writes
 *    prescription_documents or consultations.prescription here).
 *  - Quote totals are recomputed server-side; client totals are ignored.
 *  - The 30-minute SLA is measured from the ORDER REQUEST timestamp.
 *  - The patient is notified AFTER the quote is committed; a notification
 *    failure can never fail the recording (emit() never throws).
 *  - All copy is French (issue #83).
 */
'use strict';

const express = require('express');
const ordersRepo = require('../repos/medication-orders');
const notifications = require('../notifications/emit');
const { query } = require('../db');

const router = express.Router();

// Reuse the exact same admin guard as src/routes/admin.js (audit C1 fix).
const { authenticateAdmin } = require('../auth');
router.use(authenticateAdmin);

/**
 * French notification copy for the quote-recorded event (issue #83 requires
 * French copy for this feature's notifications). Category reuses the
 * existing 'consultations' group: the notifications table (migration 007)
 * constrains category to consultations/messages/calls/wallet and the
 * preference surface stays coherent — the deep link opens the consultation
 * where the quote is displayed. Privacy: generic copy only — never any
 * medication name, pharmacy name or price.
 */
function quoteNotificationCopy() {
  return {
    title: 'Medika',
    body: 'Le devis de vos médicaments est prêt. Ouvrez Medika pour le consulter et décider.',
    url: '/app/consultations',
  };
}

// ─── Partner pharmacy directory (no credentials — WhatsApp only) ────────────

/** GET /api/admin/pharmacies — the directory (active + archived entries). */
router.get('/pharmacies', async (req, res, next) => {
  try {
    res.json(await ordersRepo.listPharmacies({ includeInactive: true }));
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/pharmacies — create a directory entry.
 * Allowlisted fields ONLY (name, contactName, whatsappNumber, location,
 * notes, active). Any credential-like field is ignored by construction.
 */
router.post('/pharmacies', async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await ordersRepo.upsertPharmacy({
      name: body.name,
      contactName: body.contact_name ?? body.contactName,
      whatsappNumber: body.whatsapp_number ?? body.whatsappNumber,
      location: body.location,
      notes: body.notes,
      active: body.active,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json(result.pharmacy);
  } catch (err) { next(err); }
});

/** PUT /api/admin/pharmacies/:id — update a directory entry. */
router.put('/pharmacies/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await ordersRepo.upsertPharmacy({
      id: req.params.id,
      name: body.name,
      contactName: body.contact_name ?? body.contactName,
      whatsappNumber: body.whatsapp_number ?? body.whatsappNumber,
      location: body.location,
      notes: body.notes,
      active: body.active,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    if (!result.pharmacy) return res.status(404).json({ error: 'Pharmacie introuvable' });
    res.json(result.pharmacy);
  } catch (err) { next(err); }
});

// ─── Operations queue ────────────────────────────────────────────────────────

/**
 * GET /api/admin/medication-orders?bucket=new|overdue|quotes|exceptions|all
 * The operations queue. Runs the idempotent SLA/expiry sweep first, so the
 * buckets reflect server truth. Every item carries the active quote summary
 * and attention flags.
 */
router.get('/medication-orders', async (req, res, next) => {
  try {
    const bucket = ['new', 'overdue', 'quotes', 'exceptions', 'all'].includes(String(req.query.bucket))
      ? String(req.query.bucket) : 'all';
    res.json(await ordersRepo.adminQueue({ bucket }));
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/medication-orders/:id — full operational detail: order +
 * READ-ONLY prescription snapshot + quote history + audit events + the
 * WhatsApp handoff for the pharmacy selected via ?pharmacy_id=… (or the
 * active quote's pharmacy).
 */
router.get('/medication-orders/:id', async (req, res, next) => {
  try {
    const detail = await ordersRepo.adminDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Demande introuvable' });

    // Pharmacy for the handoff link: explicit query param wins, else the
    // active quote's pharmacy, else nothing (the agent picks one first).
    let pharmacyId = req.query.pharmacy_id ? String(req.query.pharmacy_id) : null;
    if (!pharmacyId && detail.quotes.length > 0) {
      pharmacyId = detail.quotes[0].pharmacy.id;
    }
    let whatsapp = { url: null, message: '' };
    if (pharmacyId) {
      const { rows } = await query(`SELECT * FROM partner_pharmacies WHERE id = $1`, [pharmacyId]);
      if (rows[0]) {
        whatsapp = ordersRepo.buildWhatsAppHandoff({
          order: detail,
          pharmacy: rows[0],
          prescriptionItems: detail.prescription?.items ?? [],
        });
      }
    }
    res.json({ ...detail, whatsapp });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/medication-orders/:id/quotes — record the pharmacy's
 * confirmed response (obtained manually via WhatsApp).
 *
 * Body: {
 *   pharmacy_id,                              // required, active pharmacy
 *   items: [{ prescription_index, availability: AVAILABLE|PARTIAL|UNAVAILABLE,
 *             unit_price_htg?, quantity?, offered_quantity? }, …],
 *                                             // one line per prescribed item
 *   expires_at,                               // ISO/epoch, future, ≤ 30 days
 *   confirmation_source?, notes? (delivery is always free to the patient)
 * }
 *
 * Server-side enforcement: every prescribed item covered exactly once (no
 * substitution), UNAVAILABLE lines carry no prices, totals recomputed,
 * superseding a previous quote is explicit (QUOTE_REVISED + price change).
 * The patient is notified after commit — never before, never blocking.
 */
router.post('/medication-orders/:id/quotes', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.pharmacy_id || typeof body.pharmacy_id !== 'string') {
      return res.status(400).json({ error: 'La pharmacie est requise.' });
    }
    const result = await ordersRepo.recordQuote({
      orderId: req.params.id,
      admin: req.user,
      payload: body,
    });

    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Demande introuvable' });
    if (result.outcome === 'INVALID_PHARMACY') {
      return res.status(400).json({ error: 'Pharmacie introuvable ou inactive dans l’annuaire.' });
    }
    if (result.outcome === 'INVALID_STATE') {
      return res.status(409).json({
        error: 'Cette demande n’attend plus de devis (statut actuel : ' + result.status + ').',
        code: 'INVALID_TRANSITION',
        status: result.status,
      });
    }
    if (result.outcome === 'INVALID_PAYLOAD') {
      return res.status(400).json({ error: result.error });
    }

    // Notify the patient AFTER the commit (idempotency keyed on the quote —
    // a re-recording that supersedes gets a new key, so each quote notifies
    // exactly once; emit() never throws, so this cannot fail the response).
    const order = await ordersRepo.findById(req.params.id);
    if (order?.patient_id) {
      notifications.emit({
        userId: order.patient_id,
        eventType: 'medication:quoted',
        idempotencyKey: `medication-order:${order.id}:quote:${result.quote.id}`,
        ...quoteNotificationCopy(),
      });
    }

    res.status(result.revised ? 200 : 201).json(result.quote);
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/medication-orders/:id/unreachable — record an explicit
 * "pharmacy unreachable" attempt. The order status and the SLA clock are
 * unchanged (the SLA runs from the request timestamp); the attempt lands in
 * the audit history.
 */
router.post('/medication-orders/:id/unreachable', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.pharmacy_id || typeof body.pharmacy_id !== 'string') {
      return res.status(400).json({ error: 'La pharmacie est requise.' });
    }
    const result = await ordersRepo.recordUnreachable({
      orderId: req.params.id,
      admin: req.user,
      pharmacyId: body.pharmacy_id,
      notes: typeof body.notes === 'string' ? body.notes : '',
    });
    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Demande introuvable' });
    if (result.outcome === 'INVALID_PHARMACY') {
      return res.status(400).json({ error: 'Pharmacie introuvable dans l’annuaire.' });
    }
    res.status(201).json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
