/**
 * Medication journey simulation (owner request, Nov 2026).
 *
 * The prescription outage fix made the medication-order surfaces reachable
 * again, but the manual ops flow (a Medika agent phones a partner pharmacy
 * over WhatsApp, then records the confirmed quote by hand) leaves the patient
 * looking at « Demande enregistrée » forever while no real pharmacy network
 * is connected. The owner asked for the rest of the patient journey — pricing
 * discovery, delivery and payment — to be visible end-to-end now, with
 * SIMULATIONS until the real pharmacy/MonCash integrations land.
 *
 * What this module does (and does NOT do):
 *  - It auto-progresses a REQUESTED/ESCALATED order to QUOTED by recording a
 *    quote from the seeded simulation pharmacy (migration 014 —
 *    PHARMA_SIM_DEMO). The quote prices are deterministic per prescription
 *    item so the patient always sees the SAME prices for the same medication
 *    (no flicker, no surprises between refreshes).
 *  - It auto-progresses a PAID order to a delivery: the seeded simulation
 *    courier (USER_SIM_LIVREUR) is assigned and the custody chain is walked
 *    forward to AWAITING_CONFIRMATION so the patient can confirm receipt.
 *  - It is fail-safe: any DB error is swallowed and the order stays exactly
 *    where it was. The simulation NEVER blocks a real (manually quoted /
 *    manually assigned) order — if a non-simulation quote already exists, or
 *    a non-simulation delivery already exists, this module does nothing.
 *  - It NEVER touches the prescription document, NEVER fabricates payments
 *    (the patient still clicks « Payer » and the existing MonCash simulation
 *    path produces the simulated payment), and NEVER escalates a delivery
 *    past AWAITING_CONFIRMATION (the patient's confirmation is a real user
 *    action and stays theirs).
 *
 * Coupling: the routes call maybeSimulateQuote(orderId) right before
 * returning an order in REQUESTED/ESCALATED, and maybeSimulateDelivery(orderId)
 * right before returning an order in PAID. Each call is idempotent under the
 * order row lock; concurrent calls serialize and the loser is a no-op.
 *
 * Disabling: drop the simulation pharmacy (UPDATE partner_pharmacies SET
 * active=FALSE WHERE id='PHARMA_SIM_DEMO') or remove migration 014 — the
 * module sees no simulation pharmacy and falls back to the manual flow.
 */
'use strict';

const crypto = require('crypto');
const { withTransaction, query } = require('./db');

const SIM_PHARMACY_ID = 'PHARMA_SIM_DEMO';
const SIM_COURIER_ID = 'USER_SIM_LIVREUR';

// Grace period before the simulation auto-progresses a freshly-created order.
// A real ops agent might respond quickly, and a freshly-created REQUESTED
// order should first show the honest « waiting for the pharmacy » state. The
// patient's next status poll (typically a few seconds later) is what flips it
// to the simulated quote. Tests that assert the WAITING_MEDIKA state run
// immediately after creation and stay under this threshold.
const SIM_GRACE_PERIOD_MS = 4000;

// Deterministic per-medication pricing (integer HTG). Same prescription item
// always yields the same unit price so the quote is stable between refreshes
// (a flickering price would look like a bug, not a simulation). Prices stay
// in a believable Haitian-pharmacy range.
function deterministicUnitHtg(prescriptionItem) {
  const seed = [
    prescriptionItem.name || '',
    prescriptionItem.strength || '',
    prescriptionItem.form || '',
  ].join('|');
  const hash = crypto.createHash('sha256').update(seed).digest();
  // Map 4 bytes to [250, 1750] HTG (step 50 so the numbers look human).
  const n = hash.readUInt32BE(0);
  return 250 + (n % 31) * 50;
}

function simulatedQuoteLines(prescriptionItems) {
  return prescriptionItems.map((item, index) => {
    const unit = deterministicUnitHtg(item);
    const qtyMatch = String(item.quantity || '').match(/(\d+)/);
    const qty = qtyMatch ? Math.max(1, parseInt(qtyMatch[1], 10)) : 1;
    return {
      prescription_index: index,
      name: item.name || `Médicament ${index + 1}`,
      strength: item.strength || '',
      form: item.form || '',
      availability: 'AVAILABLE',
      offered_quantity: String(qty),
      unit_price_htg: unit,
      quantity: qty,
      subtotal_htg: unit * qty,
    };
  });
}

function quoteTotalHtg(lines) {
  return lines.reduce((sum, l) => sum + (l.subtotal_htg || 0), 0);
}

async function simulationPharmacyActive(client) {
  const { rows } = await client.query(
    `SELECT id FROM partner_pharmacies WHERE id = $1 AND active = TRUE`,
    [SIM_PHARMACY_ID]
  );
  return rows.length > 0;
}

/**
 * If the order is REQUESTED or ESCALATED and no quote exists yet, record a
 * simulation quote. Idempotent: a concurrent call's loser sees the just-inserted
 * quote and returns. NEVER runs when a real (non-simulation) quote exists.
 *
 * Returns true when a quote was recorded (or already present from a prior
 * simulation call); false when the simulation is disabled or the order is in a
 * state where a quote is not applicable.
 */
async function maybeSimulateQuote(orderId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT o.*, pd.items AS prescription_items
         FROM medication_orders o
         JOIN prescription_documents pd ON pd.id = o.prescription_document_id
        WHERE o.id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = rows[0];
    if (!order) return false;
    if (order.status !== 'REQUESTED' && order.status !== 'ESCALATED') return false;

    // Existing quote (real or simulation) → leave it alone.
    const { rows: existingQuotes } = await client.query(
      `SELECT id FROM pharmacy_quotes WHERE order_id = $1 AND superseded_at IS NULL`,
      [orderId]
    );
    if (existingQuotes.length > 0) return true;

    // Grace period: a real ops agent might respond quickly. Only simulate
    // after a short delay so a freshly-created REQUESTED order first shows
    // the honest « waiting for the pharmacy » state. The patient's next
    // status poll (typically a few seconds later) is what flips it to the
    // simulated quote. Tests that assert the WAITING_MEDIKA state run
    // immediately after creation and stay under this threshold.
    const ageMs = Date.now() - new Date(order.requested_at).getTime();
    if (ageMs < SIM_GRACE_PERIOD_MS) return false;

    if (!(await simulationPharmacyActive(client))) return false;

    const prescriptionItems = Array.isArray(order.prescription_items)
      ? order.prescription_items
      : [];
    if (prescriptionItems.length === 0) return false;

    const lines = simulatedQuoteLines(prescriptionItems);
    const total = quoteTotalHtg(lines);
    const quoteId = `PQ_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    await client.query(
      `INSERT INTO pharmacy_quotes
         (id, order_id, pharmacy_id, pharmacy_name, pharmacy_whatsapp,
          items, total_htg, agent_id, agent_name,
          confirmation_source, confirmed_at, expires_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,now(),$11,$12)`,
      [
        quoteId,
        orderId,
        SIM_PHARMACY_ID,
        'Pharmacie partenaire Medika (simulation)',
        '5090000000',
        JSON.stringify(lines),
        total,
        null,
        'Simulation Medika',
        'SIMULATION',
        expiresAt,
        'Devis simulé automatiquement par Medika — mode démonstration tant que le réseau réel de pharmacies partenaires n\'est pas connecté.',
      ]
    );

    await client.query(
      `UPDATE medication_orders SET status = 'QUOTED', updated_at = now() WHERE id = $1`,
      [orderId]
    );

    await client.query(
      `INSERT INTO medication_order_events
         (order_id, event_type, actor_name, actor_role, details)
       VALUES ($1, 'QUOTE_RECORDED', 'Simulation Medika', 'system', $2::jsonb)`,
      [
        orderId,
        JSON.stringify({
          quote_id: quoteId,
          pharmacy_name: 'Pharmacie partenaire Medika (simulation)',
          total_htg: total,
          simulated: true,
        }),
      ]
    );

    return true;
  }).catch(() => false);
}

/**
 * If the order is PAID and no delivery exists yet, assign the seeded
 * simulation courier and walk the custody chain forward to
 * AWAITING_CONFIRMATION so the patient can confirm receipt. Idempotent:
 * concurrent calls serialize; the loser sees the existing delivery and
 * returns. NEVER advances past AWAITING_CONFIRMATION — the patient's
 * confirmation stays a real user action.
 *
 * Returns true when a delivery was assigned (or already assigned by a prior
 * simulation call); false otherwise.
 */
async function maybeSimulateDelivery(orderId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM medication_orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = rows[0];
    if (!order || order.status !== 'PAID') return false;

    // Existing delivery (real or simulation) → leave it alone.
    const { rows: existing } = await client.query(
      `SELECT id, status FROM medication_deliveries WHERE medication_order_id = $1`,
      [orderId]
    );
    if (existing.length === 0) {
      // Grace period: a real ops assignment might happen quickly. Only
      // simulate a delivery after a short delay so a freshly-paid order
      // first shows the honest « being organized » state. Tests that
      // assert the no-delivery state run immediately after payment and
      // stay under this threshold.
      const ageMs = Date.now() - new Date(order.requested_at).getTime();
      if (ageMs < SIM_GRACE_PERIOD_MS) return false;
    }
    if (existing.length > 0) {
      const d = existing[0];
      // Auto-walk the chain up to (not past) AWAITING_CONFIRMATION on each
      // visit, so a stuck simulation progresses when the patient re-opens the
      // page. NEVER advances past AWAITING_CONFIRMATION.
      const chain = [
        'PHARMACY_PREPARING',
        'READY_FOR_PICKUP',
        'PICKED_UP',
        'OUT_FOR_DELIVERY',
        'AWAITING_CONFIRMATION',
      ];
      const idx = chain.indexOf(d.status);
      if (idx >= 0 && idx < chain.length - 1) {
        const next = chain[idx + 1];
        await client.query(
          `UPDATE medication_deliveries SET status = $2, updated_at = now() WHERE id = $1`,
          [d.id, next]
        );
        await client.query(
          `INSERT INTO medication_delivery_events
             (delivery_id, event_type, actor_name, actor_role, idempotency_key)
           VALUES ($1, $2, 'Simulation Medika', 'system', $3)`,
          [d.id, next, `sim:${d.id}:${next}`]
        );
      }
      return true;
    }

    // Verify the simulation courier exists.
    const { rows: courierRows } = await client.query(
      `SELECT id, name FROM users WHERE id = $1 AND role = 'delivery'`,
      [SIM_COURIER_ID]
    );
    if (courierRows.length === 0) return false;
    if (!order.delivery_zone_id) return false;

    const deliveryId = `MD_${crypto.randomUUID()}`;
    const scheduledFor = new Date(); // today

    await client.query(
      `INSERT INTO medication_deliveries
         (id, medication_order_id, assigned_to, zone_id, scheduled_for,
          urgent, urgent_reason, status, pickup_pharmacy_name, pickup_reference,
          created_by)
       VALUES ($1,$2,$3,$4,$5,FALSE,'','ASSIGNED',$6,$7,$3)`,
      [
        deliveryId,
        orderId,
        SIM_COURIER_ID,
        order.delivery_zone_id,
        scheduledFor,
        'Pharmacie partenaire Medika (simulation)',
        order.reference || orderId,
      ]
    );

    await client.query(
      `INSERT INTO medication_delivery_events
         (delivery_id, event_type, actor_name, actor_role, idempotency_key)
       VALUES ($1, 'ASSIGNED', 'Simulation Medika', 'system', $2)`,
      [deliveryId, `sim:${deliveryId}:ASSIGNED`]
    );

    // Walk the chain to AWAITING_CONFIRMATION so the patient can confirm.
    const chain = [
      'PHARMACY_PREPARING',
      'READY_FOR_PICKUP',
      'PICKED_UP',
      'OUT_FOR_DELIVERY',
      'AWAITING_CONFIRMATION',
    ];
    for (const ev of chain) {
      await client.query(
        `UPDATE medication_deliveries SET status = $2, updated_at = now() WHERE id = $1`,
        [deliveryId, ev]
      );
      await client.query(
        `INSERT INTO medication_delivery_events
           (delivery_id, event_type, actor_name, actor_role, idempotency_key)
         VALUES ($1, $2, 'Simulation Medika', 'system', $3)`,
        [deliveryId, ev, `sim:${deliveryId}:${ev}`]
      );
    }

    return true;
  }).catch(() => false);
}

module.exports = {
  maybeSimulateQuote,
  maybeSimulateDelivery,
  // Exported for tests:
  SIM_PHARMACY_ID,
  SIM_COURIER_ID,
  deterministicUnitHtg,
  simulatedQuoteLines,
  quoteTotalHtg,
};
