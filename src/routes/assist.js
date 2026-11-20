/**
 * Patient-facing assistance endpoints — the entry into the HUMAN agent
 * contact center (brief #6, #8, #13).
 *
 * Idempotency: repeated clicks reuse the live session (partial unique index
 * uq_agent_session_live); the honest waiting/connected status is always
 * server-derived. No internal queue/assignment ids are exposed here — the
 * patient sees statuses, queue position and an optional callback, never
 * operational internals.
 */
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../auth');
const ops = require('../repos/agent-ops');
const lifecycle = require('../agent-lifecycle');
const consultLifecycle = require('../consultation-lifecycle');
const paymentRequestsRepo = require('../repos/agent-payment-requests');
const paymentsRepo = require('../repos/payments');
const consultationsRepo = require('../repos/consultations');
const usersRepo = require('../repos/users');
const specialtiesRepo = require('../repos/specialties');
const notifications = require('../notifications/emit');
const { simulatedTransactionId, simulatedRetrieveByOrderId } = require('../simulated-payment');
const { config, simulationAllowed } = require('../config');

const router = express.Router();
const hub = (req) => req.app.locals.hub;

function publicSessionView(session, position, agentName) {
  // Operational display state for the patient — brief #6/#14, no internals.
  let status = 'waiting';
  if (session.status === 'offered') status = 'connecting';
  else if (session.status === 'active') status = 'connected';
  else if (session.status === 'wrap_up') status = 'wrap_up';
  return {
    sessionId: session.id,
    status,
    position: status === 'waiting' && position ? position : null,
    agentName: agentName || null,
    createdAt: session.created_at,
  };
}

async function agentNameFor(session) {
  if (!session.agent_id) return null;
  const { rows } = await require('../db').query(`SELECT name FROM users WHERE id = $1`, [session.agent_id]);
  return rows[0] ? rows[0].name : null;
}

/** POST /api/assist/requests — request human assistance (idempotent). */
router.post('/assist/requests', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ error: 'Se pasyan yo ka mande asistans' });
    }
    const language = typeof req.body?.language === 'string' ? req.body.language.slice(0, 8) : 'ht';
    const result = await lifecycle.requestAssistance({
      patientId: req.user.id, language, hub: hub(req),
    });
    const agentName = await agentNameFor(result.session);
    const position = result.existing ? await ops.queuePosition(result.session.id) : result.position;
    return res.status(result.existing ? 200 : 201).json({
      ...publicSessionView(result.session, position, agentName),
      existing: result.existing,
      agentsAvailable: (await ops.listRoutableAgents(config.agentPresenceStaleSeconds)).length,
    });
  } catch (err) { next(err); }
});

/** GET /api/assist/requests/current — honest current status (poll + WS). */
router.get('/assist/requests/current', authenticate, async (req, res, next) => {
  try {
    const session = await ops.liveSessionForPatient(req.user.id);
    if (!session) return res.json({ status: 'none' });
    const [position, agentName] = await Promise.all([ops.queuePosition(session.id), agentNameFor(session)]);
    return res.json(publicSessionView(session, position, agentName));
  } catch (err) { next(err); }
});

/** POST /api/assist/requests/current/cancel — patient cancel while waiting. */
router.post('/assist/requests/current/cancel', authenticate, async (req, res, next) => {
  try {
    const result = await lifecycle.cancelByPatient({ patientId: req.user.id, hub: hub(req) });
    if (!result.ok) return res.status(409).json({ error: 'Demann an pa ka anile kounye a' });
    return res.json({ status: 'cancelled' });
  } catch (err) { next(err); }
});

/** POST /api/assist/callbacks — request a callback (idempotent per patient). */
router.post('/assist/callbacks', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ error: 'Se pasyan yo ka mande yon callback' });
    }
    const phoneNumber = String(req.body?.phoneNumber || '').trim();
    if (!/^[+0-9 ()-]{5,20}$/.test(phoneNumber)) {
      return res.status(400).json({ error: 'Nimewo telefòn pa valab' });
    }
    // A number equal to the account's saved phone counts as verified; a NEW
    // number is stored unverified (brief #8 — never assume ownership).
    const { rows } = await require('../db').query(
      `SELECT phone FROM users WHERE id = $1`, [req.user.id],
    );
    const phoneVerified = Boolean(rows[0]?.phone) && rows[0].phone === phoneNumber;

    const session = await ops.liveSessionForPatient(req.user.id);
    const windowStart = req.body?.windowStart ? new Date(req.body.windowStart) : null;
    const windowEnd = req.body?.windowEnd ? new Date(req.body.windowEnd) : null;
    const result = await lifecycle.createCallback({
      patientId: req.user.id,
      sessionId: session ? session.id : null,
      phoneNumber,
      phoneVerified,
      windowStart: windowStart && !isNaN(windowStart) ? windowStart : null,
      windowEnd: windowEnd && !isNaN(windowEnd) ? windowEnd : null,
      language: typeof req.body?.language === 'string' ? req.body.language.slice(0, 8) : 'ht',
      reason: String(req.body?.reason || '').slice(0, 500),
      hub: hub(req),
    });
    return res.status(result.existing ? 200 : 201).json({
      callbackId: result.callback.id,
      status: result.callback.status,
      phoneNumber: result.callback.phone_number,
      phoneVerified: result.callback.phone_verified,
      maxRetries: result.callback.max_retries,
      existing: result.existing,
    });
  } catch (err) { next(err); }
});

/** GET /api/assist/callbacks/current — the patient's open callback. */
router.get('/assist/callbacks/current', authenticate, async (req, res, next) => {
  try {
    const callback = await ops.openCallbackForPatient(req.user.id);
    if (!callback) return res.json({ status: 'none' });
    const attempts = await ops.callbackAttempts(callback.id);
    return res.json({
      callbackId: callback.id,
      status: callback.status,
      phoneNumber: callback.phone_number,
      phoneVerified: callback.phone_verified,
      retryCount: callback.retry_count,
      maxRetries: callback.max_retries,
      nextAttemptAt: callback.next_attempt_at,
      attempts: attempts.map((a) => ({ result: a.result, at: a.attempted_at })),
      createdAt: callback.created_at,
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/assist/payment-requests/current — the member's payment popup
 * source of truth (poll + WS `payment:*`). Returns the pending request, or
 * a recently PAID one (bounded window) so a refresh mid-success still shows
 * the confirmation instead of an empty state. No operational internals
 * beyond what the popup needs.
 */
router.get('/assist/payment-requests/current', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ error: 'Se pasyan yo ki resevwa demann peman' });
    }
    await paymentRequestsRepo.expireDue();
    const row = await paymentRequestsRepo.latestRelevantForPatient(req.user.id);
    if (!row) return res.json({ status: 'none' });
    const session = await ops.sessionById(row.session_id);
    const { rows: doctorRows } = row.doctor_id
      ? await require('../db').query(`SELECT name FROM users WHERE id = $1`, [row.doctor_id])
      : { rows: [] };
    const agentName = session && session.agent_id ? await agentNameFor(session) : null;
    return res.json({
      id: row.id,
      sessionId: row.session_id,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      specialty: row.specialty,
      doctorName: doctorRows[0] ? doctorRows[0].name : null,
      agentName: agentName || null,
      consultationId: row.consultation_id,
      createdAt: row.created_at,
      paidAt: row.paid_at,
      expiresAt: row.expires_at,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/assist/payment-requests/:id/confirm — the MEMBER pays the
 * agent-raised request on their own device (owner brief): phone number +
 * 4-digit PIN, MonCash-style. SIMULATION ONLY for now (no MonCash API —
 * the real provider plugs in here later): the payments row is verified
 * through the strictly isolated simulation path, then the consultation is
 * created FOR THE MEMBER from the agent-captured intake, linked to the
 * assistance session, and BOTH sides are notified in realtime. The call is
 * never touched — the member stays in the audio room, and nobody is
 * redirected: the consultation simply appears on their dashboard.
 */
router.post('/assist/payment-requests/:id/confirm', authenticate, async (req, res, next) => {
  try {
    if (req.user.role !== 'patient') {
      return res.status(403).json({ error: 'Se pasyan an ki peye demann lan' });
    }
    const request = await paymentRequestsRepo.byId(req.params.id);
    if (!request || request.patient_id !== req.user.id) {
      return res.status(404).json({ error: 'Demann peman pa jwenn' });
    }
    const phoneNumber = String(req.body?.phoneNumber || '').trim();
    const pin = String(req.body?.pin || '').trim();
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'Kòd sekirite a dwe 4 chif' });
    }
    if (!/^[+0-9 ()-]{5,20}$/.test(phoneNumber)) {
      return res.status(400).json({ error: 'Nimewo telefòn pa valab' });
    }

    // Idempotent replay: a double-tap on Pay (or a device retry) returns the
    // SAME success answer — never a duplicate consultation, never a 500.
    if (request.status === 'paid') {
      return res.json({ success: true, consultationId: request.consultation_id, replayed: true });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({ error: 'Demann peman an pa disponib — mande ajan an voye l ankò', status: request.status });
    }
    if (new Date(request.expires_at).getTime() <= Date.now()) {
      await paymentRequestsRepo.markStatus(request.id, 'expired');
      return res.status(409).json({ error: 'Demann peman an ekspire — mande ajan an voye l ankò', status: 'expired' });
    }

    const patient = await usersRepo.findById(req.user.id);
    if (!patient) return res.status(401).json({ error: 'Invalid token' });
    // Fail-closed: this flow IS the simulation. Without simulation rights
    // (per-user, resolved from the DB user — never client input) the
    // payment can never complete here.
    if (!simulationAllowed(patient)) {
      return res.status(503).json({ error: 'Mòd peman tès la pa aktive sou deploieman sa a' });
    }
    const paymentRow = await paymentsRepo.findByOrderId(request.order_id);
    if (!paymentRow || paymentRow.patient_id !== req.user.id) {
      return res.status(404).json({ error: 'Peman an pa jwenn' });
    }
    if (paymentRow.consultation_id) {
      // The payment already bought a consultation (self-service double-run):
      // its consultation IS the authoritative result.
      return res.status(409).json({ error: 'Peman an deja itilize pou yon lòt konsiltasyon', existing_id: paymentRow.consultation_id });
    }
    if (paymentRow.status === 'PENDING') {
      if (!paymentRow.simulated) {
        return res.status(409).json({ error: 'Peman an pa yon peman tès — sispann epi mande èd' });
      }
      const verified = simulatedRetrieveByOrderId(paymentRow.order_id);
      if (!verified || verified.status !== 'completed') {
        await paymentsRepo.markFailed(paymentRow.id, verified?.raw || null);
        return res.status(409).json({ error: 'Peman an pa konfime' });
      }
      await paymentsRepo.markVerified(paymentRow.id, {
        transaction_id: verified.transactionId,
        verified_amount: paymentRow.amount,
        provider_raw: { simulated: true, agentAssisted: true, paidPhone: phoneNumber },
        simulated: true,
      });
    } else if (paymentRow.status !== 'PAID') {
      return res.status(409).json({ error: 'Peman an pa konfime', status: paymentRow.status });
    }

    // ── Consultation creation FOR THE MEMBER (mirrors POST /api/consultations:
    //    same one-active invariant, same payment consumption, same routing) ──
    const session = await ops.sessionById(request.session_id);
    const description = String((session && session.intake_description) || '').trim();
    const urgencyLevel = (session && session.urgency_level) || 'Moyenne';
    const specialty = request.specialty;
    const id = 'cons_' + uuidv4().substring(0, 8);
    const price = await specialtiesRepo.priceFor(specialty);
    if (price && paymentRow.amount < price) {
      return res.status(409).json({ error: `Montant paye insuffisant (requis: ${price} HTG)` });
    }

    const existingActive = await consultationsRepo.findActiveForPatient(req.user.id);
    if (existingActive) {
      // Payment verified but the member already has a blocking consultation.
      // The request stays PENDING so the agent can cancel or re-raise it;
      // the PAID payment is kept for reconciliation — never silently consumed.
      if (session) {
        await ops.recordEvent({ sessionId: session.id, eventType: 'payment_conflict', actorId: req.user.id, metadata: { requestId: request.id, existingId: existingActive.id } });
      }
      return res.status(409).json({
        error: 'Ou gen deja yon konsiltasyon aktif. Fini oswa tann li anvan w kreye yon lòt.',
        existing_id: existingActive.id,
        existing_status: existingActive.status,
      });
    }
    if (request.doctor_id) {
      const doctorActive = await consultationsRepo.findActiveForDoctor(request.doctor_id);
      if (doctorActive) {
        if (session) {
          await ops.recordEvent({ sessionId: session.id, eventType: 'payment_conflict', actorId: req.user.id, metadata: { requestId: request.id, existingId: doctorActive.id, scope: 'doctor' } });
        }
        return res.status(409).json({
          error: 'Doktè sa a okipe deja yon konsiltasyon. Chwazi yon lòt doktè oswa eseye pi ta.',
          existing_id: doctorActive.id,
        });
      }
    }

    let consultation;
    try {
      consultation = await consultationsRepo.create({
        id,
        patient_id: req.user.id,
        patient_name: patient.name,
        patient_age: typeof patient.age === 'number' ? patient.age : (parseInt(patient.age, 10) || null),
        doctor_id: request.doctor_id || null,
        description,
        specialty_needed: specialty,
        urgency_level: urgencyLevel,
        ai_summary: '',
        ai_explanation: '',
        channel: 'AGENT', // migration 016 column — distinguish agent-assisted bookings
      });
    } catch (err) {
      // The partial unique indexes are the authoritative referee (issue #60):
      // a concurrent creation won the patient's slot — typed 409, never a 500.
      if (err && err.code === '23505') {
        const winner = await consultationsRepo.findActiveForPatient(req.user.id);
        if (winner) {
          return res.status(409).json({ error: 'Ou gen deja yon konsiltasyon aktif. Fini oswa tann li anvan w kreye yon lòt.', existing_id: winner.id, existing_status: winner.status });
        }
        return res.status(409).json({ error: 'Ou gen deja yon konsiltasyon aktif.' });
      }
      throw err;
    }

    const attached = await paymentsRepo.attachToConsultation(paymentRow.id, id);
    if (!attached) {
      // Lost the attach race → the payment already bought another consultation.
      // Remove the duplicate and replay the winner (issue #40 semantics).
      await consultationsRepo.adminDelete(id);
      const winner = await paymentsRepo.findByOrderId(paymentRow.order_id);
      if (winner && winner.consultation_id) {
        const existing = await consultationsRepo.findById(winner.consultation_id);
        if (existing && existing.patient_id === req.user.id) {
          await paymentRequestsRepo.markPaid(request.id, { consultationId: winner.consultation_id, paidPhone: phoneNumber });
          return res.json({ success: true, consultationId: winner.consultation_id, replayed: true });
        }
      }
      return res.status(409).json({ error: 'Peman an deja itilize pou yon lòt konsiltasyon' });
    }

    await paymentRequestsRepo.markPaid(request.id, { consultationId: id, paidPhone: phoneNumber });

    // Link the assistance session — same contract as the patient-driven
    // link-consultation endpoint — and append the audit trail.
    if (session) {
      await ops.updateSession(session.id, {
        consultation_id: id,
        chosen_doctor_id: request.doctor_id || session.chosen_doctor_id,
        specialty,
      });
      await ops.recordEvent({ sessionId: session.id, eventType: 'consultation_linked', actorId: req.user.id, metadata: { consultationId: id, specialty, viaPaymentRequest: request.id } });
    }

    // Same post-commit routing contract as the manual path (issue #79): a
    // routing failure must NEVER turn the persisted booking into a 500.
    let routed;
    try {
      routed = await consultLifecycle.routeNewConsultation(consultation, { patientChoiceDoctorId: request.doctor_id || null });
    } catch (routingErr) {
      console.error('[assist] payment-request routing failed:', id, routingErr.code || routingErr.constructor?.name);
      try {
        routed = await consultLifecycle.parkInWaiting(id);
      } catch (parkErr) {
        console.error('[assist] payment-request waiting fallback failed:', id, parkErr.code || parkErr.constructor?.name);
        routed = { consultation, waiting: true, events: [] };
      }
    }

    const hubInst = hub(req);
    if (hubInst) {
      const newNotif = { type: 'consultation:new', id, patientName: patient.name, description, specialtyNeeded: specialty, urgencyLevel };
      hubInst.publishToUser(req.user.id, newNotif);
      hubInst.publishToUser(req.user.id, { type: 'payment:confirmed', requestId: request.id, consultationId: id });
      if (routed.offeredTo) hubInst.publishToUser(routed.offeredTo.id, newNotif);
      if (session && session.agent_id) {
        hubInst.publishToUser(session.agent_id, { type: 'agent:session-update', sessionId: session.id, consultationId: id, paymentRequestId: request.id, paid: true });
      }
    }
    notifications.emit({
      userId: req.user.id,
      eventType: 'payment:confirmed',
      idempotencyKey: `payment-request:${request.id}:confirmed`,
      ...notifications.COPY.paymentConfirmed,
    });
    notifications.emit({
      userId: req.user.id,
      eventType: 'consultation:submitted',
      idempotencyKey: `consultation:${id}:submitted`,
      ...notifications.COPY.consultationSubmitted,
    });
    if (routed.offeredTo) {
      notifications.emit({
        userId: routed.offeredTo.id,
        eventType: 'consultation:offer',
        idempotencyKey: `consultation:${id}:offer:${routed.offeredTo.id}`,
        ...notifications.COPY.consultationOffer,
      });
    }
    return res.status(201).json({ success: true, consultationId: id, transactionId: simulatedTransactionId(paymentRow.order_id) });
  } catch (err) { next(err); }
});

/**
 * POST /api/assist/sessions/:id/link-consultation — patient-authorized
 * linkage of a consultation created by the EXISTING flow (the patient paid
 * and submitted on their own device; the agent only sees the authoritative
 * result — brief #13 "backend is authoritative").
 */
router.post('/assist/sessions/:id/link-consultation', authenticate, async (req, res, next) => {
  try {
    const session = await ops.sessionById(req.params.id);
    if (!session || session.patient_id !== req.user.id) {
      return res.status(404).json({ error: 'Sesyon pa jwenn' });
    }
    const consultationId = String(req.body?.consultationId || '');
    const consultation = await require('../repos/consultations').findById(consultationId);
    if (!consultation || consultation.patient_id !== req.user.id) {
      return res.status(404).json({ error: 'Konsiltasyon pa jwenn' });
    }
    const startedAt = session.started_at ? new Date(session.started_at).getTime() : new Date(session.created_at).getTime();
    if (consultation.created_at * 1000 < startedAt - 60_000) {
      return res.status(409).json({ error: 'Konsiltasyon sa a pa koresponn ak sesyon asistans lan' });
    }
    if (session.consultation_id === consultationId) {
      return res.json({ linked: true, consultationId }); // idempotent
    }
    await ops.updateSession(session.id, { consultation_id: consultationId, chosen_doctor_id: consultation.doctor_id, specialty: consultation.specialty_needed });
    await ops.recordEvent({ sessionId: session.id, eventType: 'consultation_linked', actorId: req.user.id, metadata: { consultationId, specialty: consultation.specialty_needed } });
    if (hub(req) && session.agent_id) {
      hub(req).publishToUser(session.agent_id, { type: 'agent:session-update', sessionId: session.id, consultationId });
    }
    return res.json({ linked: true, consultationId });
  } catch (err) { next(err); }
});

/**
 * GET /api/assist/sessions/:id/call-token — ZEGOCLOUD token for the PATIENT
 * side of the in-app audio room. Only when the session is ACTIVE (agent
 * accepted). Audio-only room: assist_<sessionId> (brief #10).
 */
router.get('/assist/sessions/:id/call-token', authenticate, async (req, res, next) => {
  try {
    const session = await ops.sessionById(req.params.id);
    if (!session || session.patient_id !== req.user.id) {
      return res.status(404).json({ error: 'Sesyon pa jwenn' });
    }
    if (session.status !== 'active') {
      return res.status(403).json({ error: 'Koneksyon an poko aktif' });
    }
    const { zegoCallGrant } = require('../zego');
    const { config: cfg } = require('../config');
    if (!cfg.zegoCloudAppId || !cfg.zegoCloudServerSecret) {
      return res.status(503).json({ error: 'Koneksyon vokal pa disponib kounye a' });
    }
    const roomName = `assist_${session.id}`;
    const streamId = `${roomName}_${req.user.id}`;
    const token = zegoCallGrant({
      appId: cfg.zegoCloudAppId,
      serverSecret: cfg.zegoCloudServerSecret,
      userId: req.user.id,
      roomName,
      streamId,
      ttlSeconds: 3600,
    });
    await lifecycle.callStarted({ sessionId: session.id, actorId: req.user.id, channel: 'in_app_audio', hub: hub(req) });
    return res.json({ provider: 'zego', token, roomName, streamId, appId: cfg.zegoCloudAppId, audioOnly: true });
  } catch (err) { next(err); }
});

/** POST /api/assist/sessions/:id/call-end — patient hung up / lost. */
router.post('/assist/sessions/:id/call-end', authenticate, async (req, res, next) => {
  try {
    const session = await ops.sessionById(req.params.id);
    if (!session || session.patient_id !== req.user.id) {
      return res.status(404).json({ error: 'Sesyon pa jwenn' });
    }
    const failureReason = String(req.body?.failureReason || '');
    await lifecycle.callEnded({ sessionId: session.id, actorId: req.user.id, failureReason, hub: hub(req) });
    return res.json({ status: 'wrap_up' });
  } catch (err) { next(err); }
});

module.exports = router;
