/**
 * Medication orders repository (issue #83).
 *
 * A patient can ask Medika to source the medications of an ISSUED (immutable)
 * prescription. A Medika operations agent contacts a partner pharmacy
 * MANUALLY via WhatsApp, records the confirmed stock and itemized prices, and
 * the patient reviews the quote. The clinical prescription is NEVER modified:
 * orders reference prescription_documents read-only and no code path here
 * touches consultations.prescription or the document row.
 *
 * Guarantees enforced at the DATABASE level (not just the API):
 *  - ONE active (non-terminal) order per prescription document
 *    (uq_medication_orders_active) — concurrent double-requests serialize and
 *    exactly one wins, the loser answers 409 MEDICATION_ORDER_ALREADY_EXISTS.
 *  - Quote totals are RECOMPUTED server-side from the itemized lines; any
 *    client-supplied total/subtotal field is ignored (allowlist philosophy,
 *    same as the prescription item fields in issue #82).
 *
 * State machine (every transition validated SERVER-SIDE under the order row
 * lock; client-supplied status values are never trusted):
 *   REQUESTED -> QUOTED | CANCELLED | ESCALATED
 *   ESCALATED -> QUOTED | CANCELLED
 *   QUOTED    -> ACCEPTED | DECLINED | EXPIRED | QUOTED (re-quote supersedes)
 *   EXPIRED   -> QUOTED (ops re-quotes)
 * The 30-minute operations SLA runs from the REQUEST timestamp (never from
 * when an agent opens a page). ESCALATED / QUOTE_EXPIRED are explicit states,
 * persisted lazily on read and by the medication-deadlines cron.
 */
'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db');

// ─── Constants ───────────────────────────────────────────────────────────────

/** Operations SLA target for obtaining/recording a pharmacy response. */
const SLA_MINUTES = 30;
const SLA_SECONDS = SLA_MINUTES * 60;

/** Order statuses. */
const ORDER_STATUSES = [
  'REQUESTED', 'ESCALATED', 'QUOTED', 'ACCEPTED', 'PAID', 'DECLINED', 'CANCELLED', 'EXPIRED',
];
/** Statuses that block a new request for the same prescription. */
const ACTIVE_STATUSES = ['REQUESTED', 'ESCALATED', 'QUOTED', 'ACCEPTED', 'PAID', 'EXPIRED'];
/** Statuses the patient can still decide on (cancel pre-quote). */
const CANCELLABLE_STATUSES = ['REQUESTED', 'ESCALATED'];

/** Item-level stock availability as confirmed by the pharmacy. */
const ITEM_AVAILABILITIES = ['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'];

/** Quote validity bounds (ops-entered, server-validated). */
const QUOTE_EXPIRY_MIN_MINUTES = 5;
const QUOTE_EXPIRY_MAX_DAYS = 30;

const LIMITS = {
  deliveryAddress: 500,
  deliveryPhone: 40,
  offeredQuantity: 120,
  itemNotes: 500,
  quoteNotes: 1000,
  declineReason: 500,
  unreachableNotes: 500,
  pharmacyName: 120,
  pharmacyContactName: 120,
  pharmacyWhatsapp: 20,
  pharmacyLocation: 200,
  pharmacyNotes: 500,
};

/** Events that can land in the append-only audit history. */
const EVENT_TYPES = [
  'REQUESTED', 'QUOTE_RECORDED', 'QUOTE_REVISED', 'PHARMACY_UNREACHABLE',
  'ACCEPTED', 'DECLINED', 'CANCELLED', 'ESCALATED', 'QUOTE_EXPIRED', 'PAYMENT_VERIFIED',
];

// ─── Small helpers ───────────────────────────────────────────────────────────

/** Stable human-readable order reference (same derivation as ORD-…). */
function buildReference(orderId, at = new Date()) {
  const digest = crypto.createHash('sha256').update(`medika-cmd:${orderId}`).digest('hex');
  return `CMD-${at.getUTCFullYear()}-${digest.slice(0, 10).toUpperCase()}`;
}

function toEpoch(ts) {
  return ts ? Math.floor(new Date(ts).getTime() / 1000) : null;
}

function clampText(value, max) {
  const v = String(value ?? '').trim();
  return v.length > max ? v.slice(0, max) : v;
}

function normalizeZone(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
}

function configuredDeliveryZones() {
  return String(process.env.MEDIKA_MEDICATION_DELIVERY_ZONES || '')
    .split(',').map(normalizeZone).filter(Boolean);
}

function validateDeliveryRequest({ deliveryAddress, deliveryPhone, deliveryZone }) {
  const address = typeof deliveryAddress === 'string' ? deliveryAddress.trim() : '';
  const phoneInput = typeof deliveryPhone === 'string' ? deliveryPhone.trim() : '';
  const zone = typeof deliveryZone === 'string' ? deliveryZone.trim() : '';
  if (!address || address.length < 8 || address.length > LIMITS.deliveryAddress) {
    return { outcome: 'INVALID_DELIVERY_DETAILS', error: 'Veuillez saisir une adresse de livraison complète (8 à 500 caractères).' };
  }
  if (!zone || zone.length > 80) {
    return { outcome: 'INVALID_DELIVERY_DETAILS', error: 'Veuillez indiquer votre quartier ou zone de livraison (80 caractères maximum).' };
  }
  const phone = phoneInput.replace(/[\s().-]/g, '');
  if (!/^(?:\+?509)?\d{8}$/.test(phone)) {
    return { outcome: 'INVALID_DELIVERY_DETAILS', error: 'Veuillez saisir un numéro haïtien valide à 8 chiffres, avec ou sans indicatif +509.' };
  }
  const zones = configuredDeliveryZones();
  if (zones.length === 0) {
    return { outcome: 'SERVICE_UNAVAILABLE', error: 'La zone de livraison Medika n’est pas encore configurée. Vous pouvez télécharger votre ordonnance et acheter vos médicaments en pharmacie.' };
  }
  if (!zones.includes(normalizeZone(zone))) {
    return { outcome: 'OUT_OF_COVERAGE', error: 'La livraison Medika n’est pas encore disponible dans cette zone. Vous pouvez télécharger votre ordonnance et acheter vos médicaments en pharmacie.' };
  }
  const digits = phone.replace(/\D/g, '');
  return { ok: true, address, phone: '+509' + digits.slice(-8), zone: clampText(zone, 80) };
}

/**
 * Normalize a WhatsApp click-to-chat target to bare digits (country code
 * included, no '+'). Returns '' when nothing usable remains.
 */
function normalizeWhatsapp(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

/**
 * French status labels — the single source of truth for the UI copy.
 */
const STATUS_LABELS_FR = {
  REQUESTED: 'Demande en cours de traitement',
  ESCALATED: 'En retard — relance requise',
  QUOTED: 'Devis à consulter',
  ACCEPTED: 'Devis accepté',
  PAID: 'Paiement confirmé — préparation en attente',
  DECLINED: 'Devis refusé',
  CANCELLED: 'Demande annulée',
  EXPIRED: 'Devis expiré',
};

const AVAILABILITY_LABELS_FR = {
  AVAILABLE: 'Disponible',
  PARTIAL: 'Stock partiel',
  UNAVAILABLE: 'Indisponible',
};

// ─── Quote payload validation (server is the only arithmetic authority) ─────

/**
 * Validate + normalize one quote line against the prescription item it maps
 * to (1:1 by index — no substitution is representable). Prices are integers
 * in HTG. UNAVAILABLE lines must not carry prices. Returns
 * { ok: true, line } | { ok: false, error }.
 */
function sanitizeQuoteLine(raw, prescriptionItem, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `La ligne ${index + 1} du devis est invalide.` };
  }
  const availability = String(raw.availability ?? '').trim().toUpperCase();
  if (!ITEM_AVAILABILITIES.includes(availability)) {
    return { ok: false, error: `Disponibilité invalide pour « ${prescriptionItem.name} » (utilisez Disponible, Stock partiel ou Indisponible).` };
  }

  // Snapshot of the prescribed item — the quote stays self-describing and
  // the prescribed name/quantity can never be rewritten by quote entry.
  const line = {
    prescription_index: index,
    name: prescriptionItem.name,
    strength: prescriptionItem.strength ?? null,
    form: prescriptionItem.form ?? null,
    dose: prescriptionItem.dose ?? null,
    frequency: prescriptionItem.frequency ?? null,
    duration: prescriptionItem.duration ?? null,
    quantity_prescribed: prescriptionItem.quantity ?? null,
    availability,
  };

  if (availability === 'UNAVAILABLE') {
    // No prices may hide on an unavailable line.
    if (raw.unit_price_htg !== undefined && raw.unit_price_htg !== null && raw.unit_price_htg !== '') {
      return { ok: false, error: `« ${prescriptionItem.name} » est indisponible : aucun prix ne doit être saisi.` };
    }
    return { ok: true, line };
  }

  const unit = raw.unit_price_htg;
  const qty = raw.quantity;
  if (!Number.isInteger(unit) || unit <= 0) {
    return { ok: false, error: `Prix unitaire (entier, HTG) requis pour « ${prescriptionItem.name} ».` };
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    return { ok: false, error: `Quantité confirmée (entier > 0) requise pour « ${prescriptionItem.name} ».` };
  }
  line.unit_price_htg = unit;
  line.quantity = qty;
  line.subtotal_htg = unit * qty; // computed HERE — client values are ignored
  if (raw.offered_quantity !== undefined && raw.offered_quantity !== null && String(raw.offered_quantity).trim() !== '') {
    line.offered_quantity = clampText(raw.offered_quantity, LIMITS.offeredQuantity);
  }
  return { ok: true, line };
}

/**
 * Validate the full quote payload against the prescription's items.
 * Every prescription item must be covered EXACTLY once (indices 0..n-1).
 * Returns { ok, lines, total } | { ok, error }.
 */
function sanitizeQuoteLines(rawItems, prescriptionItems) {
  if (!Array.isArray(rawItems)) {
    return { ok: false, error: 'La réponse de la pharmacie doit être une liste de lignes.' };
  }
  if (prescriptionItems.length === 0) {
    return { ok: false, error: 'Cette ordonnance ne contient aucun médicament à sourcer.' };
  }
  if (rawItems.length !== prescriptionItems.length) {
    return { ok: false, error: `Chaque médicament de l’ordonnance doit apparaître exactement une fois (${prescriptionItems.length} ligne(s) attendue(s)).` };
  }
  // Each line must claim a DISTINCT valid prescription index — collectively
  // exactly 0..n-1 (every prescribed item covered exactly once, in any order).
  const claimed = new Set();
  for (const raw of rawItems) {
    const idx = raw?.prescription_index;
    if (!Number.isInteger(idx) || idx < 0 || idx >= prescriptionItems.length) {
      return { ok: false, error: 'Chaque ligne doit pointer vers un médicament de l’ordonnance (index requis).' };
    }
    if (claimed.has(idx)) {
      return { ok: false, error: 'Chaque médicament de l’ordonnance doit apparaître exactement une fois.' };
    }
    claimed.add(idx);
  }
  const lines = [];
  let total = 0;
  for (const raw of rawItems) {
    const at = raw.prescription_index;
    const sanitized = sanitizeQuoteLine(raw, prescriptionItems[at], at);
    if (!sanitized.ok) return sanitized;
    total += sanitized.line.subtotal_htg ?? 0;
    lines.push(sanitized.line);
  }
  lines.sort((a, b) => a.prescription_index - b.prescription_index);
  return { ok: true, lines, total };
}

// ─── Serialization ───────────────────────────────────────────────────────────

function quoteRowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    order_id: row.order_id,
    pharmacy: {
      id: row.pharmacy_id ?? null,
      name: row.pharmacy_name ?? '',
      whatsapp_number: row.pharmacy_whatsapp ?? '',
    },
    items: row.items || [],
    total_htg: row.total_htg,
    agent_name: row.agent_name ?? '',
    confirmation_source: row.confirmation_source ?? 'WHATSAPP',
    confirmed_at: toEpoch(row.confirmed_at),
    expires_at: toEpoch(row.expires_at),
    notes: row.notes ?? '',
    superseded_at: toEpoch(row.superseded_at),
  };
}

function eventRowToApi(row) {
  return {
    id: row.id,
    event_type: row.event_type,
    actor: { id: row.actor_id ?? null, name: row.actor_name ?? '', role: row.actor_role ?? '' },
    details: row.details ?? {},
    created_at: toEpoch(row.created_at),
  };
}

function orderRowToApi(row, { withSla = true } = {}) {
  if (!row) return null;
  const api = {
    id: row.id,
    reference: row.reference,
    consultation_id: row.consultation_id,
    prescription_document_id: row.prescription_document_id,
    prescription_reference: row.prescription_reference ?? '',
    patient_id: row.patient_id ?? null,
    patient_name: row.patient_name ?? '',
    status: row.status,
    status_label_fr: STATUS_LABELS_FR[row.status] ?? row.status,
    delivery_address: row.delivery_address ?? '',
    delivery_phone: row.delivery_phone ?? '',
    delivery_zone: row.delivery_zone ?? '',
    requested_at: toEpoch(row.requested_at),
  };
  if (withSla) {
    api.sla_deadline_at = toEpoch(row.sla_deadline_at);
    // DERIVED truth — never lies even before the lazy sweep persisted it:
    // ESCALATED once the deadline passed without a confirmed quote (whether
    // or not the sweep has persisted the transition yet).
    const deadlinePassed = new Date(row.sla_deadline_at).getTime() <= Date.now();
    api.sla_state = (row.status === 'REQUESTED' && deadlinePassed) || row.status === 'ESCALATED'
      ? 'ESCALATED' : 'PENDING';
  }
  return api;
}

// ─── Audit events (append-only) ──────────────────────────────────────────────

async function insertEvent(client, { orderId, type, actor, details = {} }) {
  await client.query(
    `INSERT INTO medication_order_events (order_id, event_type, actor_id, actor_name, actor_role, details)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      orderId,
      type,
      actor?.id ?? null,
      clampText(actor?.name ?? 'Système', 120),
      actor?.role ?? 'system',
      JSON.stringify(details),
    ]
  );
}

// ─── Order creation (patient) ────────────────────────────────────────────────

/**
 * Create a medication request for an ISSUED prescription.
 *
 * Outcomes:
 *   NOT_FOUND              — unknown consultation
 *   FORBIDDEN              — caller is not the consultation's patient
 *   NO_PRESCRIPTION        — consultation has no ISSUED prescription document
 *   ALREADY_EXISTS         — an active order already exists for it (409)
 *   CREATED                — success; { order }
 */
async function createOrder({ consultationId, patient, deliveryAddress, deliveryPhone, deliveryZone }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM consultations WHERE id = $1 FOR UPDATE`,
      [consultationId]
    );
    const consultation = rows[0];
    if (!consultation) return { outcome: 'NOT_FOUND' };
    if (consultation.patient_id !== patient.id) return { outcome: 'FORBIDDEN' };

    const { rows: docs } = await client.query(
      `SELECT * FROM prescription_documents
        WHERE consultation_id = $1 AND status = 'ISSUED'`,
      [consultationId]
    );
    const document = docs[0];
    if (!document) return { outcome: 'NO_PRESCRIPTION' };

    // Validate contact details and exact allowlisted zone only after confirming
    // consultation ownership and an issued prescription (no coverage oracle).
    const delivery = validateDeliveryRequest({ deliveryAddress, deliveryPhone, deliveryZone });
    if (!delivery.ok) return delivery;

    // The partial unique index backstops this check against concurrent races.
    const { rows: existing } = await client.query(
      `SELECT id, reference FROM medication_orders
        WHERE prescription_document_id = $1 AND status = ANY($2::text[])`,
      [document.id, ACTIVE_STATUSES]
    );
    if (existing[0]) {
      return { outcome: 'ALREADY_EXISTS', existing: existing[0] };
    }

    const orderId = `MO_${crypto.randomUUID()}`;
    const { rows: inserted } = await client.query(
      `INSERT INTO medication_orders
         (id, reference, prescription_document_id, consultation_id,
          patient_id, patient_name, prescription_reference,
          status, requested_at, sla_deadline_at, delivery_address, delivery_phone, delivery_zone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'REQUESTED',now(),now() + interval '${SLA_MINUTES} minutes',$8,$9,$10)
       RETURNING *`,
      [
        orderId,
        buildReference(orderId),
        document.id,
        consultationId,
        patient.id,
        consultation.patient_name ?? patient.name ?? '',
        document.reference,
        delivery.address,
        delivery.phone,
        delivery.zone,
      ]
    );
    const order = inserted[0];

    await insertEvent(client, {
      orderId,
      type: 'REQUESTED',
      actor: { id: patient.id, name: patient.name, role: 'patient' },
      details: {
        prescription_reference: document.reference,
        sla_minutes: SLA_MINUTES,
      },
    });

    return { outcome: 'CREATED', order };
  });
}

// ─── Time-driven transitions (lazy + cron sweep) ─────────────────────────────

/**
 * Persist the due time-driven transitions (idempotent; safe to run on every
 * read and from the cron):
 *   REQUESTED past sla_deadline_at → ESCALATED  (event ESCALATED, actor system)
 *   QUOTED with active quote past expires_at → EXPIRED (event QUOTE_EXPIRED)
 * Returns the number of orders transitioned.
 */
async function persistDueTransitions(client) {
  const run = async (c) => {
    const { rows: escalated } = await c.query(
      `UPDATE medication_orders
          SET status = 'ESCALATED', updated_at = now()
        WHERE status = 'REQUESTED' AND sla_deadline_at <= now()
        RETURNING id, reference`
    );
    for (const row of escalated) {
      await insertEvent(c, {
        orderId: row.id,
        type: 'ESCALATED',
        actor: { id: null, name: 'Système', role: 'system' },
        details: { reason: 'SLA_DELAIS_DEPASSE', sla_minutes: SLA_MINUTES },
      });
    }

    const { rows: expired } = await c.query(
      `UPDATE medication_orders o
          SET status = 'EXPIRED', updated_at = now()
        WHERE o.status = 'QUOTED'
          AND EXISTS (
            SELECT 1 FROM pharmacy_quotes q
             WHERE q.order_id = o.id AND q.superseded_at IS NULL
               AND q.expires_at <= now()
          )
        RETURNING id, reference`
    );
    for (const row of expired) {
      await insertEvent(c, {
        orderId: row.id,
        type: 'QUOTE_EXPIRED',
        actor: { id: null, name: 'Système', role: 'system' },
        details: { reason: 'DEVIS_EXPIRE' },
      });
    }
    return escalated.length + expired.length;
  };
  if (client) return run(client);
  return withTransaction(run);
}

// ─── Reads ───────────────────────────────────────────────────────────────────

async function findById(orderId) {
  const { rows } = await query(`SELECT * FROM medication_orders WHERE id = $1`, [orderId]);
  return rows[0] ?? null;
}

/** The active (non-superseded) quote of an order, if any. */
async function activeQuote(orderId, client = null) {
  const exec = client
    ? (sql, params) => client.query(sql, params)
    : (sql, params) => query(sql, params);
  const { rows } = await exec(
    `SELECT * FROM pharmacy_quotes
      WHERE order_id = $1 AND superseded_at IS NULL`,
    [orderId]
  );
  return rows[0] ?? null;
}

async function listQuotes(orderId) {
  const { rows } = await query(
    `SELECT * FROM pharmacy_quotes WHERE order_id = $1 ORDER BY confirmed_at DESC, id DESC`,
    [orderId]
  );
  return rows;
}

async function listEvents(orderId) {
  const { rows } = await query(
    `SELECT * FROM medication_order_events WHERE order_id = $1 ORDER BY created_at ASC, id ASC`,
    [orderId]
  );
  return rows;
}

/**
 * Patient-facing order payload: order + active quote (+ expiry flag) in one
 * read. Runs the lazy SLA/expiry sweep first so the persisted status never
 * lags behind reality when the patient looks.
 */
async function getForPatient(orderId, patientId) {
  await persistDueTransitions();
  const order = await findById(orderId);
  if (!order || order.patient_id !== patientId) return null;
  const quote = await activeQuote(orderId);
  const active = quote && new Date(quote.expires_at).getTime() > Date.now();
  return {
    ...orderRowToApi(order),
    quote: quote ? { ...quoteRowToApi(quote), expired: !active } : null,
    // Explicit, derived next step — the client never guesses from raw status.
    next_step:
      order.status === 'REQUESTED' || order.status === 'ESCALATED' ? 'WAITING_MEDIKA'
        : order.status === 'QUOTED' ? 'REVIEW_QUOTE'
          : order.status === 'ACCEPTED' ? 'PAYMENT'
            : order.status === 'EXPIRED' ? 'QUOTE_EXPIRED'
              : 'CLOSED',
  };
}

/**
 * Admin ops queue. Runs the lazy sweep first; every order carries its
 * active quote summary + attention flags. bucket: new|overdue|quotes|
 * exceptions|all (default all).
 */
async function adminQueue({ bucket = 'all' } = {}) {
  await persistDueTransitions();
  const { rows } = await query(
    `SELECT o.*,
            q.id AS q_id, q.pharmacy_name AS q_pharmacy, q.total_htg AS q_total,
            q.expires_at AS q_expires_at, q.confirmed_at AS q_confirmed_at,
            q.items AS q_items,
            (SELECT COUNT(*) FROM pharmacy_quotes qq
              WHERE qq.order_id = o.id AND qq.superseded_at IS NULL) AS quote_count
       FROM medication_orders o
       LEFT JOIN pharmacy_quotes q
         ON q.order_id = o.id AND q.superseded_at IS NULL
      ORDER BY o.requested_at ASC, o.id ASC`
  );

  const now = Date.now();
  const items = rows.map((row) => {
    const order = orderRowToApi(row);
    const quote = row.q_id
      ? {
          id: row.q_id,
          pharmacy_name: row.q_pharmacy,
          total_htg: row.q_total,
          confirmed_at: toEpoch(row.q_confirmed_at),
          expires_at: toEpoch(row.q_expires_at),
          expired: new Date(row.q_expires_at).getTime() <= now,
          has_unavailable_items: (row.q_items || []).some((i) => i.availability !== 'AVAILABLE'),
        }
      : null;
    const attention =
      order.status === 'EXPIRED' ||
      order.status === 'ESCALATED' ||
      (quote && quote.has_unavailable_items);
    return {
      ...order,
      quote,
      quote_count: Number(row.quote_count) || 0,
      attention,
      buckets: [
        ...(order.status === 'REQUESTED' ? ['new'] : []),
        ...(order.status === 'ESCALATED' ? ['overdue', 'exceptions'] : []),
        ...(order.status === 'QUOTED' ? ['quotes'] : []),
        ...(order.status === 'EXPIRED' ? ['exceptions'] : []),
        ...(order.status === 'QUOTED' && quote && quote.has_unavailable_items ? ['exceptions'] : []),
      ],
    };
  });

  if (bucket === 'all') return items;
  return items.filter((item) => item.buckets.includes(bucket));
}

/**
 * Admin order detail: order + read-only prescription snapshot + quote
 * history + full audit events + WhatsApp handoff for the given pharmacy.
 * The prescription data comes straight from prescription_documents —
 * provably unmodifiable by this feature (no code path writes it).
 */
async function adminDetail(orderId) {
  await persistDueTransitions();
  const order = await findById(orderId);
  if (!order) return null;
  const [docResult, quotes, events] = await Promise.all([
    query(
      `SELECT pd.id, pd.reference, pd.items, pd.general_instructions,
              pd.doctor_name, pd.issued_at
         FROM prescription_documents pd WHERE pd.id = $1`,
      [order.prescription_document_id]
    ),
    listQuotes(orderId),
    listEvents(orderId),
  ]);
  const doc = docResult.rows[0] ?? null;
  return {
    ...orderRowToApi(order),
    prescription: doc
      ? {
          id: doc.id,
          reference: doc.reference,
          doctor_name: doc.doctor_name ?? '',
          issued_at: toEpoch(doc.issued_at),
          items: doc.items || [],
          general_instructions: doc.general_instructions ?? '',
        }
      : null,
    quotes: quotes.map(quoteRowToApi),
    events: events.map(eventRowToApi),
  };
}

// ─── Patient decisions ───────────────────────────────────────────────────────

/**
 * Accept the active quote. Row-locked; re-validates the quote expiry at the
 * moment of the transition (a stale client cannot accept an expired quote).
 * Outcomes: NOT_FOUND | FORBIDDEN | INVALID_TRANSITION | QUOTE_EXPIRED | ACCEPTED.
 */
async function acceptQuote({ orderId, patient }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM medication_orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = rows[0];
    if (!order || order.patient_id !== patient.id) return { outcome: 'NOT_FOUND' };
    if (order.status === 'QUOTED') {
      const quote = await activeQuote(orderId, client);
      if (quote && new Date(quote.expires_at).getTime() <= Date.now()) {
        // Persist the expiry transition now (lazy sweep may not have run yet).
        await client.query(
          `UPDATE medication_orders SET status = 'EXPIRED', updated_at = now() WHERE id = $1`,
          [orderId]
        );
        await insertEvent(client, {
          orderId, type: 'QUOTE_EXPIRED',
          actor: { id: null, name: 'Système', role: 'system' },
          details: { reason: 'DEVIS_EXPIRE' },
        });
        return { outcome: 'QUOTE_EXPIRED' };
      }
      if (!quote) return { outcome: 'INVALID_TRANSITION' };
      await client.query(
        `UPDATE medication_orders SET status = 'ACCEPTED', updated_at = now() WHERE id = $1`,
        [orderId]
      );
      await insertEvent(client, {
        orderId, type: 'ACCEPTED',
        actor: { id: patient.id, name: patient.name, role: 'patient' },
        details: { quote_id: quote.id, total_htg: quote.total_htg },
      });
      return { outcome: 'ACCEPTED', quote };
    }
    return { outcome: 'INVALID_TRANSITION', status: order.status };
  });
}

/**
 * Decline the active quote. Outcomes: NOT_FOUND | FORBIDDEN |
 * INVALID_TRANSITION | DECLINED.
 */
async function declineQuote({ orderId, patient, reason }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM medication_orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = rows[0];
    if (!order || order.patient_id !== patient.id) return { outcome: 'NOT_FOUND' };
    if (order.status !== 'QUOTED') return { outcome: 'INVALID_TRANSITION', status: order.status };
    await client.query(
      `UPDATE medication_orders SET status = 'DECLINED', updated_at = now() WHERE id = $1`,
      [orderId]
    );
    await insertEvent(client, {
      orderId, type: 'DECLINED',
      actor: { id: patient.id, name: patient.name, role: 'patient' },
      details: { reason: clampText(reason, LIMITS.declineReason) },
    });
    return { outcome: 'DECLINED' };
  });
}

/**
 * Cancel before any quote (REQUESTED / ESCALATED only — a quoted order is
 * declined instead). Outcomes: NOT_FOUND | FORBIDDEN | INVALID_TRANSITION | CANCELLED.
 */
async function cancelOrder({ orderId, patient, reason }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM medication_orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = rows[0];
    if (!order || order.patient_id !== patient.id) return { outcome: 'NOT_FOUND' };
    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      return { outcome: 'INVALID_TRANSITION', status: order.status };
    }
    await client.query(
      `UPDATE medication_orders SET status = 'CANCELLED', updated_at = now() WHERE id = $1`,
      [orderId]
    );
    await insertEvent(client, {
      orderId, type: 'CANCELLED',
      actor: { id: patient.id, name: patient.name, role: 'patient' },
      details: { reason: clampText(reason, LIMITS.declineReason) },
    });
    return { outcome: 'CANCELLED' };
  });
}

// ─── Quote recording (admin ops) ─────────────────────────────────────────────

/**
 * Record the pharmacy's confirmed response as a quote (ops manually obtained
 * via WhatsApp). Supersedes any previous quote; price changes are explicit
 * (QUOTE_REVISED event with previous → new totals). The prescription is left
 * untouched — provably: no UPDATE touches prescription_documents here.
 *
 * Outcomes: NOT_FOUND | INVALID_STATE | INVALID_PHARMACY | INVALID_PAYLOAD
 *           | RECORDED (+ revised flag).
 */
async function recordQuote({ orderId, admin, payload }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM medication_orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = rows[0];
    if (!order) return { outcome: 'NOT_FOUND' };
    const QUOTABLE = ['REQUESTED', 'ESCALATED', 'QUOTED', 'EXPIRED'];
    if (!QUOTABLE.includes(order.status)) {
      return { outcome: 'INVALID_STATE', status: order.status };
    }

    const { rows: pharmacyRows } = await client.query(
      `SELECT * FROM partner_pharmacies WHERE id = $1`,
      [payload.pharmacy_id]
    );
    const pharmacy = pharmacyRows[0];
    if (!pharmacy || !pharmacy.active) {
      return { outcome: 'INVALID_PHARMACY' };
    }

    // Read-only prescription snapshot (the lines map to its item indices).
    const { rows: docRows } = await client.query(
      `SELECT items FROM prescription_documents WHERE id = $1`,
      [order.prescription_document_id]
    );
    const prescriptionItems = docRows[0]?.items ?? [];

    const sanitized = sanitizeQuoteLines(payload.items, prescriptionItems);
    if (!sanitized.ok) return { outcome: 'INVALID_PAYLOAD', error: sanitized.error };

    // Expiry: required, in the future, bounded (server clock — never client trust).
    const expiresAt = new Date(payload.expires_at ?? 0);
    if (Number.isNaN(expiresAt.getTime())) {
      return { outcome: 'INVALID_PAYLOAD', error: 'La date d’expiration du devis est requise.' };
    }
    const nowMs = Date.now();
    const minMs = nowMs + QUOTE_EXPIRY_MIN_MINUTES * 60 * 1000;
    const maxMs = nowMs + QUOTE_EXPIRY_MAX_DAYS * 24 * 60 * 60 * 1000;
    if (expiresAt.getTime() < minMs) {
      return { outcome: 'INVALID_PAYLOAD', error: `L’expiration du devis doit être dans plus de ${QUOTE_EXPIRY_MIN_MINUTES} minutes.` };
    }
    if (expiresAt.getTime() > maxMs) {
      return { outcome: 'INVALID_PAYLOAD', error: `L’expiration du devis ne peut pas dépasser ${QUOTE_EXPIRY_MAX_DAYS} jours.` };
    }

    const previous = await activeQuote(orderId, client);
    const quoteId = `PQ_${crypto.randomUUID()}`;

    if (previous) {
      await client.query(
        `UPDATE pharmacy_quotes SET superseded_at = now() WHERE id = $1`,
        [previous.id]
      );
    }

    await client.query(
      `INSERT INTO pharmacy_quotes
         (id, order_id, pharmacy_id, pharmacy_name, pharmacy_whatsapp,
          items, total_htg,
          agent_id, agent_name, confirmation_source, confirmed_at, expires_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,now(),$11,$12)`,
      [
        quoteId,
        orderId,
        pharmacy.id,
        pharmacy.name,
        normalizeWhatsapp(pharmacy.whatsapp_number),
        JSON.stringify(sanitized.lines),
        sanitized.total,
        admin.id,
        admin.name ?? '',
        clampText(payload.confirmation_source || 'WHATSAPP', 40),
        expiresAt,
        clampText(payload.notes, LIMITS.quoteNotes),
      ]
    );

    await client.query(
      `UPDATE medication_orders SET status = 'QUOTED', updated_at = now() WHERE id = $1`,
      [orderId]
    );

    const priceChanged = previous && previous.total_htg !== sanitized.total;
    await insertEvent(client, {
      orderId,
      type: previous ? 'QUOTE_REVISED' : 'QUOTE_RECORDED',
      actor: { id: admin.id, name: admin.name, role: 'admin' },
      details: {
        quote_id: quoteId,
        pharmacy_name: pharmacy.name,
        total_htg: sanitized.total,
        ...(previous ? { previous_total_htg: previous.total_htg, price_changed: priceChanged } : {}),
      },
    });

    return {
      outcome: 'RECORDED',
      revised: Boolean(previous),
      price_changed: Boolean(priceChanged),
      quote: quoteRowToApi({
        id: quoteId,
        order_id: orderId,
        pharmacy_id: pharmacy.id,
        pharmacy_name: pharmacy.name,
        pharmacy_whatsapp: normalizeWhatsapp(pharmacy.whatsapp_number),
        items: sanitized.lines,
        total_htg: sanitized.total,
        agent_id: admin.id,
        agent_name: admin.name ?? '',
        confirmation_source: clampText(payload.confirmation_source || 'WHATSAPP', 40),
        confirmed_at: new Date(),
        expires_at: expiresAt,
        notes: clampText(payload.notes, LIMITS.quoteNotes),
        superseded_at: null,
      }),
    };
  });
}

/**
 * Record a "pharmacy unreachable" attempt (explicit state — never silence).
 * The order status and the SLA clock are UNCHANGED (the SLA is measured from
 * the request timestamp). Outcomes: NOT_FOUND | INVALID_PHARMACY | RECORDED.
 */
async function recordUnreachable({ orderId, admin, pharmacyId, notes }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM medication_orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = rows[0];
    if (!order) return { outcome: 'NOT_FOUND' };
    const { rows: pharmacyRows } = await client.query(
      `SELECT * FROM partner_pharmacies WHERE id = $1`,
      [pharmacyId]
    );
    const pharmacy = pharmacyRows[0];
    if (!pharmacy) return { outcome: 'INVALID_PHARMACY' };
    await insertEvent(client, {
      orderId,
      type: 'PHARMACY_UNREACHABLE',
      actor: { id: admin.id, name: admin.name, role: 'admin' },
      details: {
        pharmacy_id: pharmacy.id,
        pharmacy_name: pharmacy.name,
        notes: clampText(notes, LIMITS.unreachableNotes),
      },
    });
    return { outcome: 'RECORDED' };
  });
}

// ─── WhatsApp handoff (click-to-chat; pharmacies never log in) ───────────────

/**
 * Build the WhatsApp click-to-chat handoff for an order + pharmacy: the
 * agent opens this link and contacts the pharmacy MANUALLY. The prefilled
 * message contains ONLY the medication sourcing list — no patient identity,
 * no clinical data beyond the medication names the pharmacy must quote.
 */
function buildWhatsAppHandoff({ order, pharmacy, prescriptionItems }) {
  const number = normalizeWhatsapp(pharmacy?.whatsapp_number);
  if (!number) return { url: null, message: '' };
  const lines = (prescriptionItems || []).map((item, i) => {
    const parts = [item.name, item.strength, item.form ? `(${item.form})` : null].filter(Boolean);
    const qty = item.quantity ? ` — quantité : ${item.quantity}` : '';
    return `${i + 1}. ${parts.join(' ')}${qty}`;
  });
  const message = [
    'Bonjour, nous sommes Medika.',
    'Pour le compte d’un patient, souhaitons-nous confirmer la disponibilité et le prix de ces médicaments :',
    '',
    ...lines,
    '',
    'Merci de nous confirmer les prix unitaires en gourdes (HTG) et les quantités disponibles.',
  ].join('\n');
  return {
    url: `https://wa.me/${number}?text=${encodeURIComponent(message)}`,
    message,
  };
}

// ─── Partner pharmacy directory ──────────────────────────────────────────────

async function listPharmacies({ includeInactive = true } = {}) {
  const { rows } = await query(
    `SELECT * FROM partner_pharmacies ${includeInactive ? '' : 'WHERE active = TRUE'} ORDER BY name ASC`
  );
  return rows.map(pharmacyToApi);
}

function pharmacyToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    contact_name: row.contact_name ?? '',
    whatsapp_number: row.whatsapp_number ?? '',
    location: row.location ?? '',
    notes: row.notes ?? '',
    active: row.active,
    created_at: toEpoch(row.created_at),
  };
}

/**
 * Create/update a partner pharmacy directory entry. NO credential field can
 * enter this table (name/contact/WhatsApp/location/notes only — pharmacies
 * never authenticate; enforced by the allowlist below).
 */
async function upsertPharmacy({ id, name, contactName, whatsappNumber, location, notes, active }) {
  const cleanName = clampText(name, LIMITS.pharmacyName);
  const whatsapp = normalizeWhatsapp(whatsappNumber);
  if (!cleanName) return { error: 'Le nom de la pharmacie est requis.' };
  if (!whatsapp) return { error: 'Le numéro WhatsApp de la pharmacie est requis.' };
  if (whatsapp.length > LIMITS.pharmacyWhatsapp) return { error: 'Le numéro WhatsApp est trop long.' };

  if (id) {
    const { rows } = await query(
      `UPDATE partner_pharmacies
          SET name = $2, contact_name = $3, whatsapp_number = $4,
              location = $5, notes = $6, active = $7, updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [id, cleanName, clampText(contactName, LIMITS.pharmacyContactName), whatsapp,
        clampText(location, LIMITS.pharmacyLocation), clampText(notes, LIMITS.pharmacyNotes),
        active === undefined ? true : Boolean(active)]
    );
    return { pharmacy: pharmacyToApi(rows[0]) };
  }
  const newId = `PH_${crypto.randomUUID()}`;
  const { rows } = await query(
    `INSERT INTO partner_pharmacies
       (id, name, contact_name, whatsapp_number, location, notes, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [newId, cleanName, clampText(contactName, LIMITS.pharmacyContactName), whatsapp,
      clampText(location, LIMITS.pharmacyLocation), clampText(notes, LIMITS.pharmacyNotes),
      active === undefined ? true : Boolean(active)]
  );
  return { pharmacy: pharmacyToApi(rows[0]) };
}

module.exports = {
  SLA_MINUTES,
  SLA_SECONDS,
  ORDER_STATUSES,
  ACTIVE_STATUSES,
  ITEM_AVAILABILITIES,
  EVENT_TYPES,
  STATUS_LABELS_FR,
  AVAILABILITY_LABELS_FR,
  LIMITS,
  buildReference,
  normalizeWhatsapp,
  normalizeZone,
  configuredDeliveryZones,
  validateDeliveryRequest,
  sanitizeQuoteLines,
  createOrder,
  persistDueTransitions,
  findById,
  activeQuote,
  listQuotes,
  listEvents,
  getForPatient,
  adminQueue,
  adminDetail,
  acceptQuote,
  declineQuote,
  cancelOrder,
  recordQuote,
  recordUnreachable,
  buildWhatsAppHandoff,
  listPharmacies,
  upsertPharmacy,
  pharmacyToApi,
  quoteRowToApi,
  orderRowToApi,
  eventRowToApi,
};
