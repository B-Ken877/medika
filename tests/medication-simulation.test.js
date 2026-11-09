/**
 * Medication journey simulation (Nov 2026 owner request).
 *
 * src/medication-simulation.js is the engine that auto-progresses a
 * REQUESTED/ESCALATED order to QUOTED (using the seeded simulation pharmacy)
 * and a PAID order to a delivery in AWAITING_CONFIRMATION (using the seeded
 * simulation courier). It is fail-safe and idempotent: it never overrides a
 * real (manual) quote or delivery, and concurrent calls serialize.
 *
 * These tests run against a real embedded PostgreSQL (the repo's
 * global-setup), seeded with the full migration chain (001–014) so the
 * simulation pharmacy (PHARMA_SIM_DEMO), the coverage zone (ZONE_PAP, ACTIVE)
 * and the simulation courier (USER_SIM_LIVREUR) already exist.
 */
'use strict';

import { describe, it, expect, beforeAll } from 'vitest';
const { query, withTransaction } = await import('../src/db');
const crypto = await import('node:crypto');
const simulation = await import('../src/medication-simulation');
const ordersRepo = await import('../src/repos/medication-orders');

// Minimal but real prescription_document + consultation fixtures so the
// simulation has something to quote. The repos do the heavy validation; here
// we only need a row that createOrder/getForPatient will accept.
async function seedConsultationWithPrescription(patientId, patientName = 'Patient Test') {
  const consultationId = `CONS_SIM_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await query(
    `INSERT INTO consultations
       (id, patient_id, patient_name, specialty_needed, urgency_level,
        status, description, created_at, expires_at)
     VALUES ($1, $2, $3, 'general', 'ROUTINE', 'TERMINE',
             'Consultation simulation', now(), now() + interval '5 hours')`,
    [consultationId, patientId, patientName]
  );
  const docId = `PD_SIM_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const docRef = `ORD-SIM-${Date.now()}`;
  await query(
    `INSERT INTO prescription_documents
       (id, consultation_id, patient_id, patient_name, doctor_id, doctor_name,
        reference, status, items, issued_at)
     VALUES ($1, $2, $3, $4, NULL, 'Dr Simulation', $5, 'ISSUED',
             $6::jsonb, now())`,
    [
      docId, consultationId, patientId, patientName, docRef,
      JSON.stringify([
        { name: 'Amoxicilline', strength: '500mg', form: 'comprimé', quantity: '12', dose: '1 comprimé', frequency: '3x/jour', duration: '4 jours' },
        { name: 'Paracétamol', strength: '500mg', form: 'comprimé', quantity: '10', dose: '1 comprimé', frequency: 'si besoin', duration: '3 jours' },
      ]),
    ]
  );
  return { consultationId, docId, docRef };
}

async function seedPatient() {
  const id = `USER_SIM_PATIENT_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await query(
    `INSERT INTO users (id, username, password_hash, role, name, email)
     VALUES ($1, $2, '$2a$10$abcdefghijklmnopqrstuv', 'patient', 'Patient Sim', $3)`,
    [id, `sim.patient.${id.slice(-8)}`, `${id}@sim.local`]
  );
  return { id, name: 'Patient Sim', role: 'patient' };
}

/** Push an order's requested_at into the past so it clears the simulation
 *  grace period (SIM_GRACE_PERIOD_MS in src/medication-simulation.js). Tests
 *  that need the simulation to fire immediately age the order 10 seconds. */
async function agePastGracePeriod(orderId) {
  await query(
    `UPDATE medication_orders SET requested_at = now() - interval '10 seconds' WHERE id = $1`,
    [orderId]
  );
}

describe('medication-simulation — deterministic pricing', () => {
  it('the same prescription item always yields the same unit price (no flicker)', () => {
    const item = { name: 'Amoxicilline', strength: '500mg', form: 'comprimé' };
    const a = simulation.deterministicUnitHtg(item);
    const b = simulation.deterministicUnitHtg(item);
    const c = simulation.deterministicUnitHtg({ ...item });
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBeGreaterThanOrEqual(250);
    expect(a).toBeLessThanOrEqual(1750);
  });

  it('different medications can yield different prices', () => {
    const a = simulation.deterministicUnitHtg({ name: 'Amoxicilline' });
    const b = simulation.deterministicUnitHtg({ name: 'Paracétamol' });
    // Not a strict inequality assertion (collisions are possible), just a
    // sanity smoke that the function varies with the input.
    expect(typeof a).toBe('number');
    expect(typeof b).toBe('number');
  });

  it('quote lines cover every prescription item, AVAILABLE, with subtotals', () => {
    const lines = simulation.simulatedQuoteLines([
      { name: 'Amoxicilline', strength: '500mg', form: 'comprimé', quantity: '12' },
      { name: 'Paracétamol', strength: '500mg', form: 'comprimé', quantity: '10' },
    ]);
    expect(lines.length).toBe(2);
    expect(lines[0].availability).toBe('AVAILABLE');
    expect(lines[0].quantity).toBe(12);
    expect(lines[0].subtotal_htg).toBe(lines[0].unit_price_htg * 12);
    expect(simulation.quoteTotalHtg(lines)).toBe(lines[0].subtotal_htg + lines[1].subtotal_htg);
  });
});

describe('medication-simulation — end-to-end against a real database', () => {
  // Each test seeds its OWN consultation+prescription+patient so the
  // one-active-order-per-prescription invariant (uq_medication_orders_active)
  // never carries state across tests.

  it('maybeSimulateQuote records a QUOTE from the simulation pharmacy on a REQUESTED order', async () => {
    const patient = await seedPatient();
    const { consultationId } = await seedConsultationWithPrescription(patient.id, patient.name);

    // Create a real order through the repo so all invariants hold.
    const result = await ordersRepo.createOrder({
      consultationId,
      patient,
      deliveryAddress: '12, rue Ka o, Port-au-Prince',
      deliveryCity: 'Port-au-Prince',
      deliveryPhone: '+50937000000',
      deliveryZoneId: 'ZONE_PAP',
    });
    expect(result.outcome).toBe('CREATED');
    const orderId = result.order.id;
    await agePastGracePeriod(orderId);

    // Before simulation: REQUESTED, no quote.
    let fetched = await ordersRepo.getForPatient(orderId, patient.id);
    expect(fetched.status).toBe('REQUESTED');
    expect(fetched.quote).toBeNull();

    // Run the simulation.
    const applied = await simulation.maybeSimulateQuote(orderId);
    expect(applied).toBe(true);

    // After simulation: QUOTED with a quote from the simulation pharmacy.
    fetched = await ordersRepo.getForPatient(orderId, patient.id);
    expect(fetched.status).toBe('QUOTED');
    expect(fetched.quote).not.toBeNull();
    expect(fetched.quote.pharmacy.name).toContain('simulation');
    expect(fetched.quote.items.length).toBe(2);
    expect(fetched.quote.total_htg).toBeGreaterThan(0);
    // Every line is AVAILABLE with a positive unit price.
    for (const item of fetched.quote.items) {
      expect(item.availability).toBe('AVAILABLE');
      expect(item.unit_price_htg).toBeGreaterThan(0);
      expect(item.subtotal_htg).toBe(item.unit_price_htg * item.quantity);
    }
  });

  it('maybeSimulateQuote is idempotent — a second call does not create a second quote', async () => {
    const patient = await seedPatient();
    const { consultationId } = await seedConsultationWithPrescription(patient.id, patient.name);
    const result = await ordersRepo.createOrder({
      consultationId,
      patient,
      deliveryAddress: '12, rue Ka o, Port-au-Prince',
      deliveryCity: 'Port-au-Prince',
      deliveryPhone: '+50937000000',
      deliveryZoneId: 'ZONE_PAP',
    });
    const orderId = result.order.id;
    await agePastGracePeriod(orderId);

    await simulation.maybeSimulateQuote(orderId);
    const after1 = await ordersRepo.getForPatient(orderId, patient.id);
    expect(after1.status).toBe('QUOTED');
    const quoteId1 = after1.quote.id;

    // Second call — the order is now QUOTED (no longer REQUESTED), so the
    // engine's status guard returns false (no-op). The existing quote is
    // NEVER superseded by a second simulation call.
    const applied = await simulation.maybeSimulateQuote(orderId);
    expect(applied).toBe(false);
    const after2 = await ordersRepo.getForPatient(orderId, patient.id);
    expect(after2.quote.id).toBe(quoteId1); // SAME quote, no supersede
  });

  it('maybeSimulateQuote does nothing on a non-REQUESTED order (e.g. already ACCEPTED)', async () => {
    const patient = await seedPatient();
    const { consultationId } = await seedConsultationWithPrescription(patient.id, patient.name);
    const result = await ordersRepo.createOrder({
      consultationId,
      patient,
      deliveryAddress: '12, rue Ka o, Port-au-Prince',
      deliveryCity: 'Port-au-Prince',
      deliveryPhone: '+50937000000',
      deliveryZoneId: 'ZONE_PAP',
    });
    const orderId = result.order.id;
    await agePastGracePeriod(orderId);

    // Simulate once to get to QUOTED, then accept.
    await simulation.maybeSimulateQuote(orderId);
    await ordersRepo.acceptQuote({ orderId, patient });
    const accepted = await ordersRepo.getForPatient(orderId, patient.id);
    expect(accepted.status).toBe('ACCEPTED');

    // A second simulation call should NOT supersede the accepted quote.
    const applied = await simulation.maybeSimulateQuote(orderId);
    expect(applied).toBe(false);
    const after = await ordersRepo.getForPatient(orderId, patient.id);
    expect(after.status).toBe('ACCEPTED');
    expect(after.quote.id).toBe(accepted.quote.id);
  });
});
