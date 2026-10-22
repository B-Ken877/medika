/**
 * Consultations + messages + consultation notes routes.
 *
 * Payment gating: when REQUIRE_PAYMENT is active, POST /api/consultations
 * requires a server-side VERIFIED payment (MonCash retrieve or the strictly
 * isolated simulation) owned by the requesting patient, matching the specialty
 * price and not already consumed by another consultation. Clients already send
 * orderId/transactionId — the legacy server ignored them (audit C5).
 */
'use strict';

/** Deterministic simulated transaction id — full encoding (no truncation: a
 *  truncated base64 prefix collides across similar order ids). */
function simulatedTransactionId(orderId) {
  return 'SIM-' + Buffer.from(String(orderId)).toString('base64url');
}

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const consultationsRepo = require('../repos/consultations');
const usersRepo = require('../repos/users');
const paymentsRepo = require('../repos/payments');
const specialtiesRepo = require('../repos/specialties');
const notesRepo = require('../repos/notes');
const moncash = require('../moncash');
const { config, simulationAllowed } = require('../config');
const { authenticate, requireRole } = require('../auth');
const { badRequest, notFound, paymentRequired, conflict, serviceUnavailable } = require('../errors');

const router = express.Router();

function notifyConsultationUpdate(req, consultation) {
  const hub = req.app.locals.hub;
  if (!hub) return;
  const event = { type: 'consultation:updated', ...consultationsRepo.consToApi(consultation) };
  if (consultation.patient_id) hub.publishToUser(consultation.patient_id, event);
  if (consultation.doctor_id) hub.publishToUser(consultation.doctor_id, event);
}

// ─── POST /api/consultations ─────────────────────────────────────────────────

router.post('/consultations', authenticate, requireRole('patient'), async (req, res, next) => {
  try {
    const { description, specialtyNeeded, urgencyLevel, aiSummary, aiExplanation, doctorId, patientAge, transactionId, paymentAmount, orderId } = req.body || {};
    const id = 'cons_' + uuidv4().substring(0, 8);

    const patient = await usersRepo.findById(req.user.id);
    if (!patient) return res.status(401).json({ error: 'Invalid token' });

    const specialty = specialtyNeeded || 'Medecine Generale';
    const price = await specialtiesRepo.priceFor(specialty);

    // ── Payment gate (audit C5 fix) ──────────────────────────────────────────
    let payment = null;
    if (config.requirePayment) {
      if (!orderId && !transactionId) {
        return res.status(402).json({ error: 'Paiement requis pour creer une consultation' });
      }
      payment = await resolveVerifiedPayment({
        patientId: req.user.id,
        orderId: orderId || null,
        transactionId: transactionId || null,
        requiredAmount: price,
      });
      if (payment.error) {
        return res.status(payment.errorStatus || 402).json({ error: payment.error });
      }
    }

    const consultation = await consultationsRepo.create({
      id,
      patient_id: req.user.id,
      patient_name: patient.name,
      patient_age: patientAge === undefined ? null : (parseInt(patientAge, 10) || null),
      doctor_id: doctorId || null,
      description,
      specialty_needed: specialty,
      urgency_level: urgencyLevel || 'Moyenne',
      ai_summary: aiSummary || '',
      ai_explanation: aiExplanation || '',
    });

    if (payment && payment.row) {
      const attached = await paymentsRepo.attachToConsultation(payment.row.id, id);
      if (!attached) {
        // Lost the race → the same payment already bought another consultation.
        // Remove the just-created consultation to keep state consistent.
        await consultationsRepo.adminDelete(id);
        return res.status(409).json({ error: 'Ce paiement a deja ete utilise pour une autre consultation' });
      }
    }

    const api = consultationsRepo.consToApi(consultation);
    const hub = req.app.locals.hub;
    if (hub) {
      const newNotif = { type: 'consultation:new', id, patientName: patient.name, description, specialtyNeeded: specialty, urgencyLevel: urgencyLevel || 'Moyenne' };
      hub.publishToUser(req.user.id, newNotif);
      if (doctorId) {
        hub.publishToUser(doctorId, newNotif);
      } else {
        hub.publishToRole('doctor', newNotif);
      }
    }
    res.status(201).json(api);
  } catch (err) {
    next(err);
  }
});

/**
 * Resolve + verify a payment for consultation creation.
 * Order of operations mirrors the Android flow (orderId authoritative, with
 * transactionId as fallback). Verification ALWAYS goes through the provider
 * (or the isolated simulation) — client-supplied metadata is never trusted.
 */
async function resolveVerifiedPayment({ patientId, orderId, transactionId, requiredAmount }) {
  let row = orderId ? await paymentsRepo.findByOrderId(String(orderId)) : null;

  if (!row && transactionId) {
    // Payment created outside our records? Query the provider by transactionId
    // and register it from the verified provider response.
    if (!moncash.moncashConfigured() && !simulationAllowed()) {
      return { error: 'Paiement non verifiable (provider non configure)', errorStatus: 503 };
    }
    const verified = simulationAllowed()
      ? simulatedRetrieveByTransaction(transactionId)
      : await moncash.retrieveByTransactionId(String(transactionId));
    if (!verified || verified.status !== 'completed' || !verified.reference) {
      return { error: 'Paiement non verifie' };
    }
    row = await paymentsRepo.create({
      order_id: String(verified.reference),
      patient_id: patientId,
      amount: verified.amount || requiredAmount,
      simulated: simulationAllowed(),
    });
    if (row) row = await paymentsRepo.markVerified(row.id, {
      transaction_id: verified.transactionId,
      verified_amount: verified.amount,
      provider_raw: verified.raw,
      simulated: simulationAllowed(),
    });
  }

  if (!row) return { error: 'Paiement introuvable' };
  if (row.patient_id && row.patient_id !== patientId) {
    return { error: 'Paiement non associe a ce compte' };
  }
  if (row.consultation_id) {
    return { error: 'Ce paiement a deja ete utilise pour une autre consultation', errorStatus: 409 };
  }

  if (row.status !== 'PAID') {
    // Verify against the provider now.
    if (simulationAllowed() && row.simulated) {
      const verified = simulatedRetrieveByOrderId(row.order_id);
      if (!verified || verified.status !== 'completed') return { error: 'Paiement non complete' };
      row = await paymentsRepo.markVerified(row.id, {
        transaction_id: verified.transactionId,
        verified_amount: verified.amount,
        provider_raw: null,
        simulated: true,
      });
    } else {
      if (!moncash.moncashConfigured()) {
        return { error: 'Verification de paiement non configuree', errorStatus: 503 };
      }
      const verified = await moncash.retrieveByOrderId(row.order_id);
      if (!verified || verified.status !== 'completed') {
        await paymentsRepo.markFailed(row.id, verified?.raw || null);
        return { error: 'Paiement non verifie aupres du fournisseur' };
      }
      if (verified.reference && String(verified.reference) !== String(row.order_id)) {
        return { error: 'Reference de paiement incoherente' };
      }
      row = await paymentsRepo.markVerified(row.id, {
        transaction_id: verified.transactionId,
        verified_amount: verified.amount,
        provider_raw: verified.raw,
        simulated: false,
      });
    }
  }

  // Amount check against the server-side price (underpayment is rejected).
  const paid = row.verified_amount ?? row.amount;
  if (!Number.isFinite(paid) || paid < requiredAmount) {
    return { error: `Montant paye insuffisant (requis: ${requiredAmount} HTG)` };
  }
  return { row };
}

// Simulation-mode retrieval helpers (STRICTLY isolated: non-production +
// sandbox + explicit PAYMENT_SIMULATION — enforced by config.assertProductionSafety).
function simulatedRetrieveByOrderId(orderId) {
  return {
    reference: orderId,
    transactionId: simulatedTransactionId(orderId),
    amount: null,
    status: 'completed',
    raw: { simulated: true },
  };
}
function simulatedRetrieveByTransaction(transactionId) {
  return { reference: null, transactionId: String(transactionId), amount: null, status: 'completed', raw: { simulated: true } };
}

// ─── GET routes ──────────────────────────────────────────────────────────────

router.get('/consultations', authenticate, async (req, res, next) => {
  try {
    res.json(await consultationsRepo.listForUser(req.user));
  } catch (err) { next(err); }
});

router.get('/consultations/:id', authenticate, async (req, res, next) => {
  try {
    const c = await consultationsRepo.findById(req.params.id);
    if (!c) return res.json(null); // legacy: null (200), hides existence
    if (req.user.role !== 'admin' && c.patient_id !== req.user.id && c.doctor_id !== req.user.id) {
      return res.json(null);
    }
    res.json(consultationsRepo.consToApi(c));
  } catch (err) { next(err); }
});

router.get('/consultations/:id/messages', authenticate, async (req, res, next) => {
  try {
    const c = await consultationsRepo.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && c.patient_id !== req.user.id && c.doctor_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(await consultationsRepo.listMessages(req.params.id));
  } catch (err) { next(err); }
});

/**
 * POST /api/consultations/:id/messages — ADDITIVE endpoint (not in the legacy
 * server): same semantics as the WS message:send frame, over REST. Gives
 * clients (e.g. a future Android update) a WS-independent send path and makes
 * concurrent-send behavior testable.
 */
router.post('/consultations/:id/messages', authenticate, async (req, res, next) => {
  try {
    const c = await consultationsRepo.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (c.patient_id !== req.user.id && c.doctor_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { text, messageType, fileUrl, duration, fileSize } = req.body || {};
    const type = messageType || 'text';
    if (!text && type !== 'voice' && type !== 'image' && type !== 'video') {
      return res.status(400).json({ error: 'Message text required' });
    }
    const msg = await consultationsRepo.createMessage({
      consultation_id: req.params.id,
      sender_id: req.user.id,
      sender_name: req.user.name,
      text: text || '',
      message_type: type,
      file_url: fileUrl || null,
      duration: duration ?? null,
      file_size: fileSize ?? null,
    });
    const hub = req.app.locals.hub;
    if (hub) {
      const envelope = require('../realtime/hub').messageEnvelope(msg);
      hub.publishToUser(req.user.id, envelope);
      const recipientId = c.patient_id === req.user.id ? c.doctor_id : c.patient_id;
      if (recipientId) hub.publishToUser(recipientId, envelope);
    }
    res.status(201).json(consultationsRepo.msgToApi(msg));
  } catch (err) { next(err); }
});

// ─── Doctor actions (authorization hardened — audit H2) ─────────────────────

router.put('/consultations/:id/accept', authenticate, requireRole('doctor'), async (req, res, next) => {
  try {
    const c = await consultationsRepo.accept(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const messages = await consultationsRepo.listMessages(req.params.id);
    const hasSystemMsg = messages.some((m) => m.sender_id === 'system' && m.consultation_id === req.params.id);
    if (!hasSystemMsg) {
      await consultationsRepo.createMessage({
        consultation_id: req.params.id,
        sender_id: 'system',
        sender_name: 'Systeme',
        text: `Le ${req.user.name} a accepte votre demande. La session de chat est ouverte.`,
      });
    }
    notifyConsultationUpdate(req, c);
    res.json(consultationsRepo.consToApi(c));
  } catch (err) { next(err); }
});

router.put('/consultations/:id/reject', authenticate, requireRole('doctor'), async (req, res, next) => {
  try {
    const c = await consultationsRepo.reject(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    notifyConsultationUpdate(req, c);
    res.json(consultationsRepo.consToApi(c));
  } catch (err) { next(err); }
});

router.put('/consultations/:id/prescription', authenticate, requireRole('doctor'), async (req, res, next) => {
  try {
    const { prescription } = req.body || {};
    if (!prescription) return res.status(400).json({ error: 'Prescription required' });
    const c = await consultationsRepo.prescribe(req.params.id, req.user.id, String(prescription));
    if (!c) return res.status(404).json({ error: 'Not found' });
    await consultationsRepo.createMessage({
      consultation_id: req.params.id,
      sender_id: 'system',
      sender_name: 'Systeme',
      text: `Ordonnance redigee par ${req.user.name}. Consultation clôturée.`,
    });
    notifyConsultationUpdate(req, c);
    res.json(consultationsRepo.consToApi(c));
  } catch (err) { next(err); }
});

// ─── Consultation notes (RECONSTRUCTED endpoint — audit §3.2) ────────────────

router.get('/consultations/:id/notes', authenticate, async (req, res, next) => {
  try {
    const c = await consultationsRepo.findById(req.params.id);
    if (!c) return res.json(null);
    if (req.user.role !== 'admin' && c.patient_id !== req.user.id && c.doctor_id !== req.user.id) {
      return res.json(null);
    }
    const note = await notesRepo.findNote(req.params.id);
    res.json(note ? notesRepo.noteToApi(note) : null);
  } catch (err) { next(err); }
});

router.put('/consultations/:id/notes', authenticate, requireRole('doctor'), async (req, res, next) => {
  try {
    const c = await consultationsRepo.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (c.doctor_id !== req.user.id) {
      return res.status(403).json({ error: 'Seul le medecin de cette consultation peut rediger les notes' });
    }
    if (!c.patient_id) return res.status(409).json({ error: 'Consultation sans patient associe' });

    const { diagnosis, symptoms, notes, prescriptions, followUp, flagAllergy } = req.body || {};
    const normalizedPrescriptions = Array.isArray(prescriptions)
      ? prescriptions.map((p) => ({
          medication: String(p?.medication || ''),
          dosage: String(p?.dosage || ''),
          duration: String(p?.duration || ''),
        }))
      : [];

    const row = await notesRepo.upsertNote({
      consultation_id: req.params.id,
      patient_id: c.patient_id,
      doctor_id: req.user.id,
      doctor_name: req.user.name,
      diagnosis: diagnosis || '',
      symptoms: symptoms || '',
      notes: notes || '',
      prescriptions: normalizedPrescriptions,
      follow_up: followUp || '',
      flag_allergy: Boolean(flagAllergy),
    });

    // Documented production behavior: notes auto-update the patient dossier.
    await notesRepo.autoUpdateFromNote(c, notesRepo.noteToApi(row));

    res.json(notesRepo.noteToApi(row));
  } catch (err) { next(err); }
});

module.exports = router;
