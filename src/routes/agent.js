/**
 * Agent workspace + supervisor endpoints — the human contact-center API
 * (brief #4, #5, #7, #9, #15-#18).
 *
 * Permission boundaries (brief #4): server-side requireRole on EVERY route;
 * agents see only their own assigned sessions; supervisors/admins get the
 * operational view; only admins manage agent accounts. Hiding buttons in
 * the frontend is not security — these guards are the security.
 */
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticate, requireRole } = require('../auth');
const ops = require('../repos/agent-ops');
const lifecycle = require('../agent-lifecycle');
const usersRepo = require('../repos/users');
const specialtiesRepo = require('../repos/specialties');
const consultationsRepo = require('../repos/consultations');
const paymentRequestsRepo = require('../repos/agent-payment-requests');
const { config, simulationAllowed } = require('../config');

const router = express.Router();
const hub = (req) => req.app.locals.hub;
const AGENT_ROLES = ['agent', 'agent_supervisor', 'admin'];
const SUPERVISOR_ROLES = ['agent_supervisor', 'admin'];

const pgUnique = (e) => e && (e.code === '23505' || e.code === '23514');

/** Map the authoritative consultation status → operational display state (brief #14). */
function consultationDisplayState(consultation) {
  if (!consultation) return 'payment_pending';
  switch (consultation.status) {
    case 'RECHERCHE_MEDECIN': return 'awaiting_doctor';
    case 'EN_COURS': return 'doctor_accepted';
    case 'TERMINE': return 'consultation_completed';
    case 'REFUSE': return 'doctor_declined';
    case 'EXPIRE': return 'reassignment_required';
    default: return 'request_submitted';
  }
}

function guard(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ─── Agent identity, shift, presence ─────────────────────────────────────────

router.get('/agent/me', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const [profile, presence, shift] = await Promise.all([
    ops.profileByUserId(req.user.id),
    ops.presenceOf(req.user.id),
    ops.activeShift(req.user.id),
  ]);
  const active = await lifecycle.liveSessionForAgent(req.user.id);
  return res.json({
    agent: profile ? { employeeRef: profile.employee_ref, status: profile.status, interfaceLanguage: profile.interface_language } : null,
    role: req.user.role,
    presence: presence ? { availability: presence.availability, lastHeartbeat: presence.last_heartbeat, connectionState: presence.connection_state } : { availability: 'offline' },
    shift: shift ? { id: shift.id, status: shift.status, startedAt: shift.actual_start, scheduledEnd: shift.scheduled_end } : null,
    activeSession: active ? { sessionId: active.id, status: active.status, patientId: active.patient_id } : null,
  });
}));

router.post('/agent/shift/start', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const result = await lifecycle.startShift({ agentId: req.user.id, hub: hub(req) });
  return res.status(result.existing ? 200 : 201).json({ shift: { id: result.shift.id, status: result.shift.status, startedAt: result.shift.actual_start, scheduledEnd: result.shift.scheduled_end }, existing: result.existing });
}));

router.post('/agent/shift/end', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const result = await lifecycle.endShift({ agentId: req.user.id, hub: hub(req) });
  if (!result.ok && result.reason === 'no_active_shift') return res.status(409).json({ error: 'Pa gen vakt aktif' });
  return res.json({ shift: { id: result.shift.id, status: result.shift.status, endedAt: result.shift.actual_end } });
}));

router.post('/agent/shift/break/start', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const result = await lifecycle.startBreak({ agentId: req.user.id, hub: hub(req) });
  if (!result.ok && result.reason === 'no_active_shift') return res.status(409).json({ error: 'Pa gen vakt aktif' });
  if (result.ok) return res.json({ availability: result.presence.availability });
  return res.status(409).json({ error: result.reason });
}));

router.post('/agent/shift/break/end', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const result = await lifecycle.endBreak({ agentId: req.user.id, hub: hub(req) });
  if (!result.ok && result.reason === 'no_active_shift') return res.status(409).json({ error: 'Pa gen vakt aktif' });
  if (result.ok) return res.json({ availability: result.presence.availability });
  return res.status(409).json({ error: result.reason });
}));

/** Explicit availability change — validated server-side (brief #5 table). */
router.post('/agent/presence', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const next = String(req.body?.availability || '');
  try {
    const presence = await lifecycle.setAvailability({ agentId: req.user.id, next, hub: hub(req) });
    return res.json({ availability: presence.availability });
  } catch (err) {
    if (err.code === 'invalid_transition') {
      return res.status(409).json({ error: `Chanjman dispo pa valab (${err.from} → ${next})` });
    }
    throw err;
  }
}));

router.post('/agent/presence/heartbeat', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const state = ['connected', 'reconnecting', 'disconnected'].includes(req.body?.connectionState) ? req.body.connectionState : 'connected';
  const presence = await lifecycle.heartbeat({ agentId: req.user.id, connectionState: state });
  if (!presence) await ops.upsertPresence(req.user.id, 'offline', state);
  return res.json({ heartbeat: new Date().toISOString() });
}));

// ─── Offers + queue ──────────────────────────────────────────────────────────

router.get('/agent/queue', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  // Lazy self-healing sweep (brief #7): expired offers + waiting re-routes
  // happen on the agent's own 15s poll — no scheduled job is required.
  await lifecycle.sweepWaiting({ hub: hub(req) });
  const { rows } = await require('../db').query(
    `SELECT a.id AS assignment_id, a.session_id, a.offered_at, a.expires_at, s.language, s.specialty, s.reason
       FROM agent_assignments a JOIN agent_sessions s ON s.id = a.session_id
      WHERE a.agent_id = $1 AND a.status = 'offered' AND a.expires_at > now()
      ORDER BY a.offered_at ASC`,
    [req.user.id],
  );
  const [queueSize, callbacks] = await Promise.all([ops.waitingQueueSize(), ops.pendingCallbacks()]);
  const active = await lifecycle.liveSessionForAgent(req.user.id);
  return res.json({
    offers: rows.map((r) => ({ assignmentId: r.assignment_id, sessionId: r.session_id, offeredAt: r.offered_at, expiresAt: r.expires_at, language: r.language, specialty: r.specialty, reason: r.reason })),
    activeSession: active ? { sessionId: active.id, status: active.status } : null,
    queueWaiting: queueSize,
    callbacksPending: callbacks.length,
  });
}));

router.post('/agent/assignments/:id/accept', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const result = await lifecycle.acceptOffer({ assignmentId: req.params.id, agentId: req.user.id, hub: hub(req) });
  if (!result.ok) {
    return res.status(result.reason === 'already_active' ? 200 : 409).json({ error: result.reason === 'already_active' ? 'Sesyon an deja aktif pou ou' : 'Of la ekspire oswa pran pa yon lòt ajan' });
  }
  return res.json({ sessionId: result.session.id, status: result.session.status });
}));

router.post('/agent/assignments/:id/decline', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const result = await lifecycle.declineOffer({ assignmentId: req.params.id, agentId: req.user.id, hub: hub(req) });
  if (!result.ok) return res.status(409).json({ error: 'Of la pa disponib' });
  return res.json({ declined: true, rerouted: result.routed.routed });
}));

// ─── Session detail + workflow ───────────────────────────────────────────────

async function loadSessionForAgent(req, res) {
  const session = await ops.sessionById(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Sesyon pa jwenn' });
    return null;
  }
  const isAssigned = session.agent_id === req.user.id;
  if (!isAssigned && !SUPERVISOR_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: 'Sesyon sa a pa ou' });
    return null;
  }
  return session;
}

router.get('/agent/sessions/:id', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const session = await loadSessionForAgent(req, res);
  if (!session) return;
  const [patient, events, notes, attempts, entry, prRow] = await Promise.all([
    ops.patientSummaryForAgent(session.patient_id),
    ops.eventsFor(session.id),
    ops.notesFor(session.id),
    ops.callAttemptsFor(session.id),
    ops.queueEntryFor(session.id),
    paymentRequestsRepo.latestForSession(session.id),
  ]);
  const consultation = session.consultation_id ? await consultationsRepo.findById(session.consultation_id) : null;
  return res.json({
    session: {
      sessionId: session.id,
      status: session.status,
      source: session.source,
      language: session.language,
      reason: session.reason,
      specialty: session.specialty,
      chosenDoctorId: session.chosen_doctor_id,
      consultationId: session.consultation_id,
      consultState: consultationDisplayState(consultation),
      consultation: consultation ? { id: consultation.id, status: consultation.status, doctorId: consultation.doctor_id, specialty: consultation.specialty_needed, createdAt: consultation.created_at } : null,
      // Intake captured BY THE AGENT on behalf of the member (migration 017).
      intake: {
        description: session.intake_description || '',
        urgencyLevel: session.urgency_level || 'Moyenne',
        reason: session.reason || '',
      },
      startedAt: session.started_at,
      callStartedAt: session.call_started_at,
      callEndedAt: session.call_ended_at,
      outcome: session.outcome,
      outcomeNote: session.outcome_note,
      createdAt: session.created_at,
      queuePosition: entry ? entry.position : null,
    },
    // The agent's own "Submit Payment" state (pending → the member is paying;
    // paid → the consultation exists). Null when none was raised yet.
    paymentRequest: prRow ? paymentRequestsRepo.toApi(prRow) : null,
    patient: patient ? { id: patient.id, name: patient.name, phone: patient.phone, language: patient.language } : null,
    events: events.map((e) => ({ type: e.event_type, at: e.created_at, actor: e.actor_name, metadata: e.metadata })),
    notes: notes.map((n) => ({ id: n.id, content: n.content, agent: n.agent_name, at: n.created_at })),
    calls: attempts.map((a) => ({ id: a.id, channel: a.channel, state: a.state, startedAt: a.started_at, endedAt: a.ended_at, failureReason: a.failure_reason })),
  });
}));

router.post('/agent/sessions/:id/specialty', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const session = await loadSessionForAgent(req, res);
  if (!session) return;
  const specialty = String(req.body?.specialty || '').slice(0, 80);
  const price = await specialtiesRepo.priceFor(specialty);
  await ops.updateSession(session.id, { specialty });
  await ops.recordEvent({ sessionId: session.id, eventType: 'specialty_selected', actorId: req.user.id, metadata: { specialty, price } });
  return res.json({ specialty, price });
}));

router.post('/agent/sessions/:id/doctor', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const session = await loadSessionForAgent(req, res);
  if (!session) return;
  const doctorId = String(req.body?.doctorId || '');
  const doctor = await usersRepo.findById(doctorId);
  if (!doctor || doctor.role !== 'doctor') {
    return res.status(404).json({ error: 'Doktè pa jwenn' });
  }
  await ops.updateSession(session.id, { chosen_doctor_id: doctorId });
  await ops.recordEvent({ sessionId: session.id, eventType: 'doctor_presented', actorId: req.user.id, metadata: { doctorId, doctorName: doctor.name } });
  return res.json({ doctorId, doctorName: doctor.name });
}));

router.post('/agent/sessions/:id/notes', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const session = await loadSessionForAgent(req, res);
  if (!session) return;
  const content = String(req.body?.content || '').trim().slice(0, 2000);
  if (!content) return res.status(400).json({ error: 'Nòt vid' });
  const note = await ops.addNote({ id: uuidv4().substring(0, 18), sessionId: session.id, agentId: req.user.id, content });
  return res.status(201).json({ id: note.id, content: note.content, at: note.created_at });
}));

/**
 * POST /agent/sessions/:id/intake — the agent fills the intake ON BEHALF of
 * the member during the call (owner brief): the reason for the visit, what
 * the member says they feel (the member's OWN words — the agent never
 * diagnoses), and the urgency level (raw internal values only — display
 * labels stay client-side, matching the manual flow's contract). Medical-
 * history updates are captured as session notes; the clinical history
 * workstream comes later.
 */
router.post('/agent/sessions/:id/intake', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const session = await loadSessionForAgent(req, res);
  if (!session) return;
  const reason = String(req.body?.reason ?? session.reason ?? '').trim().slice(0, 500);
  const description = String(req.body?.description ?? '').trim().slice(0, 2000);
  const urgencyLevel = String(req.body?.urgencyLevel || session.urgency_level || 'Moyenne');
  if (!['Faible', 'Moyenne', 'Haute', 'Critique'].includes(urgencyLevel)) {
    return res.status(400).json({ error: 'Nivo ijans pa valab' });
  }
  const updated = await ops.updateSession(session.id, {
    reason,
    intake_description: description,
    urgency_level: urgencyLevel,
  });
  await ops.recordEvent({
    sessionId: session.id, eventType: 'intake_recorded', actorId: req.user.id,
    // No symptom content in the audit trail — it lives on the session row.
    metadata: { hasDescription: description.length > 0, urgencyLevel, reasonLength: reason.length },
  });
  return res.json({
    intake: {
      description: updated.intake_description || '',
      urgencyLevel: updated.urgency_level || 'Moyenne',
      reason: updated.reason || '',
    },
  });
}));

// ─── Agent-initiated payment request (owner brief: "Submit Payment") ────────
// The agent raises the request DURING the active call; the member's device
// shows the payment popup while the call stays open. Simulation-only by
// design (no MonCash API yet): the payments row is created PENDING +
// simulated server-side, and the member's confirm (routes/assist.js)
// verifies through the strictly isolated simulation path — fail-closed when
// simulation is not allowed on the deployment.

function paymentRequestView(row) {
  const api = paymentRequestsRepo.toApi(row);
  return {
    id: api.id, sessionId: api.sessionId, patientId: api.patientId,
    doctorId: api.doctorId, specialty: api.specialty, amount: api.amount,
    currency: api.currency, status: api.status,
    consultationId: api.consultationId,
    createdAt: api.createdAt, paidAt: api.paidAt, expiresAt: api.expiresAt,
  };
}

router.post('/agent/sessions/:id/payment-request', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const session = await loadSessionForAgent(req, res);
  if (!session) return;
  if (session.status !== 'active') {
    return res.status(409).json({ error: 'Sesyon an pa aktif — peman mande pandan apèl la' });
  }
  if (!String(session.intake_description || '').trim()) {
    return res.status(409).json({ error: 'Ranpli entèvyou a (sa pasyan an ap santi) anvan w voye demann peman an' });
  }
  const specialty = session.specialty;
  if (!specialty) {
    return res.status(409).json({ error: 'Chwazi espesyalite anvan w voye demann peman an' });
  }
  const price = await specialtiesRepo.priceFor(specialty);
  if (!price || price <= 0) {
    return res.status(409).json({ error: 'Pri espesyalite sa a pa disponib kounye a' });
  }
  const patient = await usersRepo.findById(session.patient_id);
  if (!patient || patient.role !== 'patient') {
    return res.status(404).json({ error: 'Pasyan pa jwenn' });
  }
  // The MEMBER is the one who pays — the simulation authorization is theirs
  // (resolved from the DB user, never client input). Fail-closed: on a
  // deployment without simulation there is no agent-assisted payment.
  if (!simulationAllowed(patient)) {
    return res.status(503).json({ error: 'Mòd peman tès la pa aktive sou deploieman sa a' });
  }
  const pending = await paymentRequestsRepo.pendingForPatient(session.patient_id);
  if (pending) {
    return res.status(409).json({ error: 'Pasyan an gen yon demann peman an atann deja — anile l anvan w voye yon lòt', requestId: pending.id });
  }
  const requestId = 'apr_' + uuidv4().substring(0, 12);
  const orderId = `APR_${Date.now()}_${requestId}`;
  const expiresAt = new Date(Date.now() + config.agentPaymentRequestTtlSeconds * 1000);
  try {
    // The payments row the member's confirm will verify + consume (PENDING
    // + simulated — created first; a losing race below only leaves a
    // harmless never-verified PENDING row, exactly like the self-service flow).
    const payment = await require('../repos/payments').create({
      order_id: orderId, patient_id: session.patient_id, amount: price, simulated: true,
    });
    if (!payment) throw Object.assign(new Error('order_id collision'), { code: '23505' });
    await paymentRequestsRepo.create({
      id: requestId, sessionId: session.id, patientId: session.patient_id,
      doctorId: session.chosen_doctor_id || null, specialty, amount: price,
      orderId, createdBy: req.user.id, expiresAt,
    });
  } catch (err) {
    // uq_agent_payment_pending is the authoritative referee against a
    // concurrent request for the same member.
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Yon demann peman an atann deja pou pasyan an' });
    }
    throw err;
  }
  await ops.recordEvent({
    sessionId: session.id, eventType: 'payment_request_created', actorId: req.user.id,
    metadata: { requestId, amount: price, specialty, doctorId: session.chosen_doctor_id || null },
  });
  // Realtime + durable: the popup must appear on the member's device NOW,
  // and survive a closed tab via the notification outbox.
  if (hub(req)) {
    hub(req).publishToUser(session.patient_id, {
      type: 'payment:request', requestId, sessionId: session.id, amount: price, specialty,
    });
  }
  const notifications = require('../notifications/emit');
  notifications.emit({
    userId: session.patient_id,
    eventType: 'payment:request',
    idempotencyKey: `payment-request:${requestId}`,
    ...notifications.COPY.paymentRequest,
  });
  const row = await paymentRequestsRepo.byId(requestId);
  return res.status(201).json(row ? paymentRequestView(row) : { id: requestId, status: 'pending', amount: price, specialty, expiresAt, orderId });
}));

router.get('/agent/sessions/:id/payment-request', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const session = await loadSessionForAgent(req, res);
  if (!session) return;
  const row = await paymentRequestsRepo.latestForSession(session.id);
  return res.json(row ? paymentRequestView(row) : { status: 'none' });
}));

router.post('/agent/sessions/:id/payment-request/cancel', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const session = await loadSessionForAgent(req, res);
  if (!session) return;
  const row = await paymentRequestsRepo.pendingForSession(session.id);
  if (!row) return res.status(409).json({ error: 'Pa gen demann peman an atann pou sesyon sa a' });
  await paymentRequestsRepo.markStatus(row.id, 'cancelled');
  await ops.recordEvent({ sessionId: session.id, eventType: 'payment_request_cancelled', actorId: req.user.id, metadata: { requestId: row.id } });
  if (hub(req)) {
    hub(req).publishToUser(session.patient_id, { type: 'payment:request-cancelled', requestId: row.id, sessionId: session.id });
  }
  return res.json({ status: 'cancelled' });
}));

router.post('/agent/sessions/:id/call/start', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const session = await loadSessionForAgent(req, res);
  if (!session) return;
  if (session.status !== 'active') return res.status(409).json({ error: 'Sesyon an pa aktif' });
  const { zegoCallGrant } = require('../zego');
  if (!config.zegoCloudAppId || !config.zegoCloudServerSecret) {
    return res.status(503).json({ error: 'Koneksyon vokal pa disponib kounye a (ZEGOCLOUD pa configure)' });
  }
  const roomName = `assist_${session.id}`;
  const streamId = `${roomName}_${req.user.id}`;
  const token = zegoCallGrant({
    appId: config.zegoCloudAppId, serverSecret: config.zegoCloudServerSecret,
    userId: req.user.id, roomName, streamId, ttlSeconds: 3600,
  });
  const attempt = await lifecycle.callStarted({ sessionId: session.id, actorId: req.user.id, channel: 'in_app_audio', hub: hub(req) });
  return res.json({ provider: 'zego', token, roomName, streamId, appId: config.zegoCloudAppId, attemptId: attempt.id, audioOnly: true });
}));

router.post('/agent/sessions/:id/call/end', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const session = await loadSessionForAgent(req, res);
  if (!session) return;
  const failureReason = String(req.body?.failureReason || '');
  await lifecycle.callEnded({ sessionId: session.id, actorId: req.user.id, failureReason, hub: hub(req) });
  return res.json({ status: 'wrap_up' });
}));

router.post('/agent/sessions/:id/complete', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const session = await loadSessionForAgent(req, res);
  if (!session) return;
  try {
    const updated = await lifecycle.completeSession({
      sessionId: session.id, agentId: req.user.id,
      outcome: String(req.body?.outcome || ''), outcomeNote: String(req.body?.outcomeNote || '').slice(0, 2000),
      hub: hub(req),
    });
    return res.json({ sessionId: updated.id, status: updated.status, outcome: updated.outcome });
  } catch (err) {
    if (err.code === 'invalid_outcome') return res.status(400).json({ error: ' Rezilta pa valab', allowed: lifecycle.OUTCOMES });
    if (err.code === 'invalid_state') return res.status(409).json({ error: 'Sesyon an pa nan yon eta ki ka fini' });
    throw err;
  }
}));

// ─── Doctor discovery (existing verified profile data — brief #12) ──────────

router.get('/agent/doctors', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const specialty = req.query.specialty ? String(req.query.specialty) : undefined;
  // Preferred-doctor search (owner brief): a member can name a doctor they
  // trust — the agent searches by name substring, across ALL specialties
  // when no specialty filter is given.
  const q = req.query.q ? String(req.query.q).trim().toLowerCase() : '';
  let doctors = await usersRepo.listDoctors(specialty);
  if (q) doctors = doctors.filter((d) => (d.name || '').toLowerCase().includes(q));
  return res.json(doctors);
}));

router.get('/agent/specialties', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const specialties = await specialtiesRepo.list();
  return res.json(specialties.map((s) => ({ id: s.id, name: s.name, price: s.price })));
}));

// ─── Callbacks (agent side — brief #8) ──────────────────────────────────────

router.get('/agent/callbacks', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const [mine, pool] = await Promise.all([ops.callbacksForAgent(req.user.id), ops.pendingCallbacks()]);
  return res.json({
    mine: mine.map(cbView),
    pool: pool.filter((c) => !c.assigned_agent_id).map(cbView),
  });
}));

function cbView(c) {
  return {
    callbackId: c.id, patientName: c.patient_name, patientId: c.patient_id,
    phoneNumber: c.phone_number, phoneVerified: c.phone_verified,
    status: c.status, reason: c.reason, language: c.language,
    windowStart: c.window_start, windowEnd: c.window_end,
    retryCount: c.retry_count, maxRetries: c.max_retries,
    nextAttemptAt: c.next_attempt_at, createdAt: c.created_at,
  };
}

router.post('/agent/callbacks/:id/claim', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const result = await lifecycle.claimCallback({ callbackId: req.params.id, agentId: req.user.id, hub: hub(req) });
  if (!result.ok) return res.status(409).json({ error: 'Callback la pran oswa pa disponib' });
  return res.json({ callbackId: req.params.id, status: result.callback.status });
}));

router.post('/agent/callbacks/:id/result', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  const result = String(req.body?.result || '');
  if (!['connected', 'no_answer', 'failed', 'cancelled'].includes(result)) {
    return res.status(400).json({ error: 'Rezilta pa valab' });
  }
  const out = await lifecycle.recordCallbackResult({
    callbackId: req.params.id, agentId: req.user.id, result,
    note: String(req.body?.note || '').slice(0, 1000), hub: hub(req),
  });
  if (!out.ok) return res.status(409).json({ error: 'Callback la pa nan yon eta pou yon tantativ' });
  return res.json(out.connected ? { connected: true, sessionId: out.session.id } : { connected: false, retryCount: out.retryCount });
}));

// ─── Dashboard (brief #17 — metrics derived ONLY from persisted records) ────

router.get('/agent/dashboard', authenticate, requireRole(...AGENT_ROLES), guard(async (req, res) => {
  // Lazy self-healing sweep (see /agent/queue).
  await lifecycle.sweepWaiting({ hub: hub(req) });
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [stats, queueSize, pending, active, presence] = await Promise.all([
    ops.agentDailyStats(req.user.id, since),
    ops.waitingQueueSize(),
    ops.pendingCallbacks(),
    lifecycle.liveSessionForAgent(req.user.id),
    ops.presenceOf(req.user.id),
  ]);
  const shift = await ops.activeShift(req.user.id);
  const { rows } = await require('../db').query(
    `SELECT a.id AS assignment_id, a.session_id, a.offered_at, a.expires_at, s.language, s.specialty, s.reason
       FROM agent_assignments a JOIN agent_sessions s ON s.id = a.session_id
      WHERE a.agent_id = $1 AND a.status = 'offered' AND a.expires_at > now()
      ORDER BY a.offered_at ASC`,
    [req.user.id],
  );
  return res.json({
    presence: presence ? presence.availability : 'offline',
    shift: shift ? { id: shift.id, status: shift.status, scheduledEnd: shift.scheduled_end } : null,
    offers: rows.map((r) => ({ assignmentId: r.assignment_id, sessionId: r.session_id, offeredAt: r.offered_at, expiresAt: r.expires_at, language: r.language, specialty: r.specialty, reason: r.reason })),
    queueWaiting: queueSize,
    callbacksPending: pending.map(cbView),
    activeSession: active ? { sessionId: active.id, status: active.status } : null,
    today: {
      callsHandled: stats.completed_today || 0,
      consultRequests: stats.consult_requested_today || 0,
      callbackOutcomes: stats.callback_outcomes_today || 0,
      unresolved: stats.unresolved_today || 0,
      avgSessionSeconds: stats.avg_session_seconds || null,
    },
  });
}));

// ─── Supervisor workspace (brief #18) ────────────────────────────────────────

router.get('/agent/ops/overview', authenticate, requireRole(...SUPERVISOR_ROLES), guard(async (req, res) => {
  const [overview, presence] = await Promise.all([ops.operationsOverview(), ops.listPresenceOverview()]);
  return res.json({
    metrics: overview,
    agents: presence.map((p) => ({
      agentId: p.agent_id, name: p.name, availability: p.availability,
      shiftStatus: p.shift_status, shiftStartedAt: p.shift_started_at,
      shiftScheduledEnd: p.shift_scheduled_end,
      lastHeartbeat: p.last_heartbeat, connectionState: p.connection_state,
    })),
  });
}));

router.get('/agent/ops/sessions', authenticate, requireRole(...SUPERVISOR_ROLES), guard(async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
  const sessions = await ops.recentSessions(limit);
  return res.json(sessions.map((s) => ({
    sessionId: s.id, status: s.status, source: s.source, outcome: s.outcome,
    specialty: s.specialty, consultationId: s.consultation_id,
    patientName: s.patient_name, agentName: s.agent_name,
    createdAt: s.created_at, startedAt: s.started_at, endedAt: s.ended_at,
  })));
}));

router.get('/agent/ops/reports', authenticate, requireRole(...SUPERVISOR_ROLES), guard(async (req, res) => {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const profiles = await ops.listProfiles();
  const perAgent = [];
  for (const p of profiles) {
    const stats = await ops.agentDailyStats(p.user_id, since);
    perAgent.push({
      agentId: p.user_id, name: p.name, employeeRef: p.employee_ref,
      completed: stats.completed_today || 0,
      consultRequests: stats.consult_requested_today || 0,
      unresolved: stats.unresolved_today || 0,
      avgSessionSeconds: stats.avg_session_seconds || null,
    });
  }
  const overview = await ops.operationsOverview();
  return res.json({ since: since.toISOString(), metrics: overview, perAgent });
}));

// ─── Admin: agent account management (brief #4) ─────────────────────────────

router.post('/agent/ops/agents', authenticate, requireRole('admin'), guard(async (req, res) => {
  const { username, employeeRef, supervisorId, interfaceLanguage } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  const { rows } = await require('../db').query(`SELECT id, role FROM users WHERE username = $1`, [String(username)]);
  if (!rows[0]) return res.status(404).json({ error: 'User pa jwenn — kreye kont anvan' });
  const user = rows[0];
  if (!['agent', 'agent_supervisor'].includes(user.role)) {
    await require('../db').query(`UPDATE users SET role = $2 WHERE id = $1`, [user.id, 'agent']);
  }
  if (supervisorId) {
    const { rows: sup } = await require('../db').query(`SELECT id FROM users WHERE id = $1 AND role IN ('agent_supervisor','admin')`, [String(supervisorId)]);
    if (!sup[0]) return res.status(400).json({ error: 'Supervizè pa valab' });
  }
  const profile = await ops.upsertProfile({
    id: uuidv4().substring(0, 18),
    userId: user.id,
    employeeRef: employeeRef ? String(employeeRef) : null,
    supervisorId: supervisorId ? String(supervisorId) : null,
    createdBy: req.user.id,
    interfaceLanguage: interfaceLanguage ? String(interfaceLanguage).slice(0, 8) : 'ht',
  }).catch((e) => { if (pgUnique(e)) return null; throw e; });
  return res.status(profile ? 201 : 409).json(profile ? { agentId: user.id, role: 'agent', profile: { employeeRef: profile.employee_ref, status: profile.status } } : { error: 'Profile deja egziste ak konflit' });
}));

router.get('/agent/ops/agents', authenticate, requireRole(...SUPERVISOR_ROLES), guard(async (req, res) => {
  const profiles = await ops.listProfiles();
  return res.json(profiles.map((p) => ({
    agentId: p.user_id, name: p.name, username: p.username, email: p.email,
    phone: p.phone, employeeRef: p.employee_ref, status: p.status,
    supervisorName: p.supervisor_name, createdAt: p.created_at,
  })));
}));

module.exports = router;
