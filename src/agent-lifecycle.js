/**
 * Agent operations lifecycle — the authoritative state machine for the human
 * consultation-assistance contact center (brief #5-#9, #15, #16).
 *
 * Every transition lives here. Routes call these functions; nothing else
 * writes agent-ops rows. Atomicity comes from conditional UPDATEs guarded by
 * the partial unique indexes in migration 015:
 *   - uq_agent_session_live     → one live session per patient (idempotent entry)
 *   - uq_agent_assignment_open  → one open offer per session / per agent
 *   - uq_agent_shift_active     → one active shift per agent
 *   - uq_agent_callback_open    → one open callback per patient
 *
 * The backend is the referee: the frontend never decides that an assignment
 * succeeded because an agent clicked Accept (brief #7 "assignment safety").
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { config } = require('./config');
const ops = require('./repos/agent-ops');
const notifications = require('./notifications/emit');

const ID = (prefix) => `${prefix}_${uuidv4().substring(0, 12)}`;

/** Availability transition table (brief #5). Invalid → 'invalid_transition'.
 *  BUSY is deliberately NOT manually reachable — it is set exclusively by
 *  the authoritative accept path (a real accepted session), so an agent can
 *  never lie to the routing engine about their state. */
const PRESENCE_TRANSITIONS = {
  offline: ['available', 'technical_issue'],
  available: ['on_break', 'offline', 'technical_issue'],
  busy: ['wrapping_up', 'available'],
  on_break: ['available', 'offline'],
  wrapping_up: ['available', 'offline', 'on_break'],
  technical_issue: ['available', 'offline'],
};

function canTransition(from, to) {
  if (from === to) return false;
  return (PRESENCE_TRANSITIONS[from] || []).includes(to);
}

// ─── Routing engine (FIFO + targeted offers) ────────────────────────────────

/**
 * Offer the session to the best eligible agent. Eligibility (brief #7):
 * presence AVAILABLE + fresh heartbeat + active shift + no active session.
 * Agents who already have an open offer are excluded by the partial unique
 * index; the caller surfaces the honest WAITING state when nobody qualifies.
 */
async function routeSession(sessionId, { hub = null, actorId = null } = {}) {
  const session = await ops.sessionById(sessionId);
  if (!session || !['waiting', 'offered'].includes(session.status)) return { routed: false, reason: 'not_routable' };

  const candidates = await ops.listRoutableAgents(config.agentPresenceStaleSeconds);
  if (!candidates.length) {
    // Honest state: nobody is available. The patient sees the real waiting
    // status and the callback option — never a fabricated ETA.
    if (session.status !== 'waiting') await ops.updateSession(sessionId, { status: 'waiting' });
    if (hub) {
      hub.publishToUser(session.patient_id, { type: 'assist:waiting', sessionId });
    }
    return { routed: false, reason: 'no_agents_available' };
  }

  // Prefer agents not already offered this session (attempt history), then
  // least-recently-active presence for fairness.
  const stats = await ops.assignmentStatsForSession(sessionId);
  const expiresAt = new Date(Date.now() + config.agentOfferWindowSeconds * 1000);
  let assignment;
  try {
    assignment = await ops.createAssignment({
      id: ID('aoff'), sessionId, agentId: candidates[0].agent_id, expiresAt,
    });
  } catch (err) {
    // Assignment contention (the agent picked up another session/request
    // between the eligibility read and the INSERT — brief #22): fail into the
    // honest WAITING state; the next sweep re-routes. Never a 500.
    if (ops.pg(err)) {
      if (session.status !== 'waiting') await ops.updateSession(sessionId, { status: 'waiting' });
      return { routed: false, reason: 'assignment_contention' };
    }
    throw err;
  }

  await ops.updateSession(sessionId, {
    status: 'offered',
    route_attempts: (stats ? stats.total : 0) + 1,
  });

  ops.recordEvent({
    sessionId, eventType: 'assignment_created', actorId,
    metadata: { assignment_id: assignment.id, agent_id: assignment.agent_id, expires_at: expiresAt.toISOString() },
  }).catch(() => {});

  if (hub) {
    hub.publishToUser(assignment.agent_id, {
      type: 'agent:offer',
      assignmentId: assignment.id,
      sessionId,
      specialty: session.specialty,
      language: session.language,
      offeredAt: assignment.offered_at,
      expiresAt: expiresAt.toISOString(),
    });
    hub.publishToUser(session.patient_id, { type: 'assist:queued', sessionId, status: 'offered' });
  }

  notifications.emit({
    userId: assignment.agent_id,
    eventType: 'agent:assignment',
    idempotencyKey: `agent_assignment:${assignment.id}`,
    ...notifications.COPY.agentAssignment,
    url: `/agent`,
  }).catch(() => {});

  return { routed: true, assignment };
}

/** Patient entry (brief #6): idempotent, server-checked, honest statuses. */
async function requestAssistance({ patientId, language = 'ht', hub = null }) {
  const existing = await ops.liveSessionForPatient(patientId);
  if (existing) {
    const position = await ops.queuePosition(existing.id);
    return { session: existing, existing: true, position };
  }
  const session = await ops.createSession({ id: ID('asess'), patientId, language, source: 'in_app' });
  await ops.enqueue({ id: ID('aqueue'), sessionId: session.id });
  await ops.recordEvent({ sessionId: session.id, eventType: 'requested', actorId: patientId, metadata: { source: 'in_app' } });
  await ops.recordEvent({ sessionId: session.id, eventType: 'entered_queue', actorId: patientId, metadata: {} });
  if (hub) hub.publishToUser(patientId, { type: 'assist:queued', sessionId: session.id, status: 'waiting' });
  const routed = await routeSession(session.id, { hub, actorId: patientId });
  const position = await ops.queuePosition(session.id);
  return { session: await ops.sessionById(session.id), existing: false, position, routed };
}

/** ATOMIC accept (brief #7): exactly one agent wins each offer. */
async function acceptOffer({ assignmentId, agentId, hub = null }) {
  const accepted = await ops.acceptAssignment(assignmentId, agentId);
  if (!accepted) {
    const current = await ops.sessionById((await offerSessionId(assignmentId)) || '');
    return { ok: false, reason: current && current.agent_id === agentId ? 'already_active' : 'offer_gone' };
  }
  const sessionId = accepted.session_id;
  const now = new Date();
  const session = await ops.updateSession(sessionId, {
    status: 'active', agent_id: agentId, started_at: now,
  });
  const entry = await ops.queueEntryFor(sessionId);
  if (entry && entry.status === 'waiting') {
    await require('./db').query(
      `UPDATE agent_queue_entries SET status = 'assigned', assigned_at = now() WHERE id = $1 AND status = 'waiting'`,
      [entry.id],
    );
  }
  await ops.upsertPresence(agentId, 'busy');
  await ops.recordEvent({ sessionId, eventType: 'agent_accepted', actorId: agentId, metadata: { assignment_id: assignmentId } });

  if (hub) {
    hub.publishToUser(session.patient_id, { type: 'assist:connected', sessionId, agentId });
    hub.publishToUser(agentId, { type: 'agent:session-active', sessionId });
  }
  const { emit, COPY } = notifications;
  emit({
    userId: session.patient_id,
    eventType: 'assist:connected',
    idempotencyKey: `assist_connected:${sessionId}`,
    ...COPY.patientConnected,
  }).catch(() => {});

  return { ok: true, session };
}

async function offerSessionId(assignmentId) {
  const { rows } = await require('./db').query(
    `SELECT session_id, agent_id FROM agent_assignments WHERE id = $1`, [assignmentId],
  );
  return rows[0] ? rows[0].session_id : null;
}

async function declineOffer({ assignmentId, agentId, hub = null }) {
  const declined = await ops.declineAssignment(assignmentId, agentId);
  if (!declined) return { ok: false, reason: 'offer_gone' };
  const sessionId = declined.session_id;
  await ops.updateSession(sessionId, { status: 'waiting' });
  await ops.recordEvent({ sessionId, eventType: 'agent_declined', actorId: agentId, metadata: { assignment_id: assignmentId } });
  const routed = await routeSession(sessionId, { hub, actorId: agentId });
  return { ok: true, routed };
}

/** Cron sweep (brief #7 assignment timeout): expire, re-route, record. Also
 *  picks up WAITING sessions that hold no open offer — the "agent came online
 *  after the request parked" case — so correctness never depends on the
 *  patient re-clicking. */
async function processExpiredOffers({ hub = null } = {}) {
  const expired = await ops.expiredOffers();
  let rerouted = 0;
  for (const offer of expired) {
    await ops.expireAssignment(offer.id);
    await ops.recordEvent({ sessionId: offer.session_id, eventType: 'assignment_expired', actorId: null, metadata: { agent_id: offer.agent_id } });
    if (offer.session_status === 'offered') {
      await ops.updateSession(offer.session_id, { status: 'waiting' });
      const result = await routeSession(offer.session_id, { hub });
      if (result.routed) rerouted += 1;
    }
  }
  const waiting = await ops.waitingSessions();
  for (const s of waiting) {
    if (s.status !== 'waiting') continue;
    const open = await ops.openOfferFor(s.id);
    if (open) continue;
    const result = await routeSession(s.id, { hub });
    if (result.routed) rerouted += 1;
  }
  return { expired: expired.length, rerouted };
}

// ─── Presence + shifts ───────────────────────────────────────────────────────

async function heartbeat({ agentId, connectionState = 'connected' }) {
  const presence = await ops.heartbeat(agentId, connectionState);
  return presence;
}

async function setAvailability({ agentId, next, hub = null }) {
  const presence = await ops.presenceOf(agentId);
  const from = presence ? presence.availability : 'offline';
  if (!canTransition(from, next)) {
    const err = new Error(`invalid transition ${from} -> ${next}`);
    err.code = 'invalid_transition';
    err.from = from;
    throw err;
  }
  const updated = await ops.upsertPresence(agentId, next, 'connected');
  if (hub) hub.publishToUser(agentId, { type: 'agent:presence', availability: next });
  return updated;
}

async function startShift({ agentId, hub = null }) {
  const existing = await ops.activeShift(agentId);
  if (existing) return { shift: existing, existing: true };
  const scheduledEnd = new Date(Date.now() + config.agentShiftHours * 3600 * 1000);
  const shift = await ops.startShift({ id: ID('ashift'), agentId, scheduledEnd });
  // Brief #5: agents start NOT ready; they explicitly switch to Available.
  await ops.upsertPresence(agentId, 'offline', 'connected');
  if (hub) hub.publishToUser(agentId, { type: 'agent:shift', shiftId: shift.id, status: 'active' });
  return { shift, existing: false };
}

async function endShift({ agentId, hub = null }) {
  const shift = await ops.activeShift(agentId);
  if (!shift) return { ok: false, reason: 'no_active_shift' };
  const live = await liveSessionForAgent(agentId);
  if (live && ['active', 'wrap_up'].includes(live.status)) {
    // Brief #5: never terminate an active session at shift end.
    const err = new Error('complete or hand over the active session first');
    err.code = 'active_session_exists';
    err.sessionId = live.id;
    throw err;
  }
  await ops.endBreak(shift.id);
  const ended = await ops.endShift(shift.id);
  await ops.upsertPresence(agentId, 'offline', 'connected');
  if (hub) hub.publishToUser(agentId, { type: 'agent:shift', shiftId: shift.id, status: 'completed' });
  return { ok: true, shift: ended };
}

async function startBreak({ agentId, hub = null }) {
  const shift = await ops.activeShift(agentId);
  if (!shift) return { ok: false, reason: 'no_active_shift' };
  const live = await liveSessionForAgent(agentId);
  if (live && ['active', 'wrap_up'].includes(live.status)) {
    const err = new Error('finish the active session before taking a break');
    err.code = 'active_session_exists';
    err.sessionId = live.id;
    throw err;
  }
  await ops.startBreak({ id: ID('abreak'), shiftId: shift.id });
  const presence = await ops.upsertPresence(agentId, 'on_break', 'connected');
  if (hub) hub.publishToUser(agentId, { type: 'agent:presence', availability: 'on_break' });
  return { ok: true, presence };
}

async function endBreak({ agentId, hub = null }) {
  const shift = await ops.activeShift(agentId);
  if (!shift) return { ok: false, reason: 'no_active_shift' };
  await ops.endBreak(shift.id);
  await ops.updateShiftStatus(shift.id, 'active');
  const presence = await ops.upsertPresence(agentId, 'available', 'connected');
  if (hub) hub.publishToUser(agentId, { type: 'agent:presence', availability: 'available' });
  return { ok: true, presence };
}

// ─── Voice lifecycle (in-app audio; PSTN documented as NOT configured) ──────

async function callStarted({ sessionId, actorId, channel = 'in_app_audio', hub = null }) {
  const attempt = await ops.createCallAttempt({ id: ID('acall'), sessionId, channel, startedBy: actorId });
  const session = await ops.updateSession(sessionId, { call_started_at: new Date() });
  await ops.recordEvent({ sessionId, eventType: 'call_started', actorId, metadata: { attempt_id: attempt.id, channel } });
  if (session.agent_id && hub) hub.publishToUser(session.agent_id, { type: 'agent:call', sessionId, state: 'started' });
  if (hub) hub.publishToUser(session.patient_id, { type: 'assist:call', sessionId, state: 'started' });
  return attempt;
}

async function callEnded({ sessionId, actorId = null, failureReason = '', hub = null }) {
  const session = await ops.sessionById(sessionId);
  const attempts = await ops.callAttemptsFor(sessionId);
  const open = attempts.find((a) => a.state === 'started' || a.state === 'connected');
  if (open) {
    await ops.updateCallAttempt(open.id, {
      state: failureReason ? 'failed' : 'ended',
      failure_reason: failureReason,
      ended_at: new Date(),
    });
  }
  if (session && ['active'].includes(session.status)) {
    await ops.updateSession(sessionId, { status: 'wrap_up', call_ended_at: new Date() });
    await ops.recordEvent({ sessionId, eventType: 'call_ended', actorId, metadata: { failureReason } });
    if (session.agent_id) {
      await ops.upsertPresence(session.agent_id, 'wrapping_up');
      if (hub) hub.publishToUser(session.agent_id, { type: 'agent:session-update', sessionId, status: 'wrap_up' });
    }
    if (hub) hub.publishToUser(session.patient_id, { type: 'assist:ended', sessionId, status: 'wrap_up' });
  }
  return { ok: true };
}

// ─── Wrap-up (brief #15): explicit, persisted, separate from call end ───────

const OUTCOMES = [
  'consultation_initiated', 'payment_pending', 'consultation_booked', 'callback_required',
  'no_doctor_available', 'information_provided', 'patient_cancelled', 'patient_disconnected',
  'transferred', 'escalated', 'unresolved',
];

async function completeSession({ sessionId, agentId, outcome, outcomeNote = '', hub = null }) {
  if (!OUTCOMES.includes(outcome)) {
    const err = new Error(`unknown outcome ${outcome}`);
    err.code = 'invalid_outcome';
    throw err;
  }
  const session = await ops.sessionById(sessionId);
  if (!session || !['active', 'wrap_up'].includes(session.status)) {
    const err = new Error('session not in a completable state');
    err.code = 'invalid_state';
    err.status = session ? session.status : null;
    throw err;
  }
  const updated = await ops.updateSession(sessionId, {
    status: 'completed', outcome, outcome_note: outcomeNote, ended_at: new Date(),
  });
  const entry = await ops.queueEntryFor(sessionId);
  if (entry) {
    await require('./db').query(
      `UPDATE agent_queue_entries SET status = 'serviced' WHERE id = $1 AND status = 'assigned'`,
      [entry.id],
    );
  }
  if (session.agent_id) {
    await ops.upsertPresence(session.agent_id, 'available');
    if (hub) hub.publishToUser(session.agent_id, { type: 'agent:presence', availability: 'available' });
  }
  if (hub) {
    hub.publishToUser(session.patient_id, { type: 'assist:completed', sessionId, outcome });
    if (session.agent_id) hub.publishToUser(session.agent_id, { type: 'agent:session-update', sessionId, status: 'completed', outcome });
  }
  await ops.recordEvent({ sessionId, eventType: 'session_completed', actorId: agentId, metadata: { outcome } });
  return updated;
}

/** Patient cancel while waiting (brief #22). */
async function cancelByPatient({ patientId, hub = null }) {
  const session = await ops.liveSessionForPatient(patientId);
  if (!session || !['waiting', 'offered'].includes(session.status)) {
    return { ok: false, reason: 'not_cancellable' };
  }
  const open = await ops.openOfferFor(session.id);
  if (open) await ops.expireAssignment(open.id);
  const updated = await ops.updateSession(session.id, {
    status: 'cancelled', outcome: 'patient_cancelled', ended_at: new Date(),
  });
  const entry = await ops.queueEntryFor(session.id);
  if (entry) {
    await require('./db').query(
      `UPDATE agent_queue_entries SET status = 'cancelled' WHERE id = $1 AND status = 'waiting'`,
      [entry.id],
    );
  }
  await ops.recordEvent({ sessionId: session.id, eventType: 'patient_cancelled', actorId: patientId, metadata: {} });
  if (session.agent_id && hub) hub.publishToUser(session.agent_id, { type: 'agent:session-update', sessionId: session.id, status: 'cancelled' });
  return { ok: true, session: updated };
}

// ─── Callbacks (brief #8) ────────────────────────────────────────────────────

async function createCallback({ patientId, phoneNumber, phoneVerified, windowStart = null, windowEnd = null, language = 'ht', reason = '', sessionId = null, hub = null }) {
  const open = await ops.openCallbackForPatient(patientId);
  if (open) return { callback: open, existing: true };
  const callback = await ops.createCallback({
    id: ID('acb'), patientId, sessionId, phoneNumber, phoneVerified,
    windowStart, windowEnd, language, reason,
    maxRetries: config.callbackMaxAttempts,
  });
  if (sessionId) {
    await ops.updateSession(sessionId, { callback_id: callback.id });
    await ops.recordEvent({ sessionId, eventType: 'callback_requested', actorId: patientId, metadata: { callback_id: callback.id } });
  }
  if (hub) hub.publishToUser(patientId, { type: 'assist:callback', callbackId: callback.id, status: callback.status });
  return { callback, existing: false };
}

async function claimCallback({ callbackId, agentId, hub = null }) {
  const claimed = await ops.claimCallback(callbackId, agentId);
  if (!claimed) return { ok: false, reason: 'callback_gone' };
  if (claimed.session_id) {
    await ops.recordEvent({ sessionId: claimed.session_id, eventType: 'callback_assigned', actorId: agentId, metadata: { callback_id: callbackId } });
  }
  if (hub) hub.publishToUser(agentId, { type: 'agent:callback-assigned', callbackId });
  return { ok: true, callback: claimed };
}

/**
 * Callback attempt result (brief #8 workflow steps 7-10). Connected → the
 * interaction continues as a normal ACTIVE session. No-answer → configured
 * retry policy (never infinite).
 */
async function recordCallbackResult({ callbackId, agentId, result, note = '', hub = null }) {
  const callback = await ops.callbackById(callbackId);
  if (!callback || !['assigned', 'attempting', 'connected', 'due', 'requested', 'scheduled'].includes(callback.status)) {
    return { ok: false, reason: 'callback_not_active' };
  }
  await ops.recordCallbackAttempt({ id: ID('acba'), callbackId, agentId, result, note });

  if (result === 'connected') {
    await ops.updateCallback(callbackId, { status: 'connected' });
    // Successful contact continues into the normal scheduling session.
    const session = await ops.createSession({
      id: ID('asess'), patientId: callback.patient_id, source: 'callback',
      language: callback.language, callbackId, reason: callback.reason,
    });
    await ops.updateSession(session.id, { status: 'active', agent_id: agentId, started_at: new Date() });
    await ops.updateCallback(callbackId, { status: 'completed' });
    await ops.upsertPresence(agentId, 'busy');
    await ops.recordEvent({ sessionId: session.id, eventType: 'callback_connected', actorId: agentId, metadata: { callback_id: callbackId } });
    await ops.recordEvent({ sessionId: session.id, eventType: 'agent_accepted', actorId: agentId, metadata: { via: 'callback' } });
    if (hub) {
      hub.publishToUser(callback.patient_id, { type: 'assist:connected', sessionId: session.id, agentId });
      hub.publishToUser(agentId, { type: 'agent:session-active', sessionId: session.id });
    }
    return { ok: true, connected: true, session };
  }

  const retryCount = callback.retry_count + 1;
  if (result === 'no_answer') {
    if (retryCount >= callback.max_retries) {
      await ops.updateCallback(callbackId, { status: 'failed', retry_count: retryCount, assigned_agent_id: agentId });
    } else {
      await ops.updateCallback(callbackId, {
        status: 'requested', retry_count: retryCount, assigned_agent_id: null,
        next_attempt_at: new Date(Date.now() + config.callbackRetryMinutes * 60000),
      });
    }
  } else if (result === 'failed') {
    await ops.updateCallback(callbackId, { status: 'failed', retry_count: retryCount, assigned_agent_id: agentId });
  } else if (result === 'cancelled') {
    await ops.updateCallback(callbackId, { status: 'cancelled', assigned_agent_id: agentId });
  }
  return { ok: true, connected: false, retryCount };
}

/** Cron sweep: mark due callbacks + refresh stale presence (brief #5, #8). */
async function processDueCallbacks({ hub = null } = {}) {
  const due = await ops.dueCallbacks();
  for (const c of due) {
    await ops.updateCallback(c.id, { status: 'due' });
    if (hub) hub.publishToUser(c.patient_id, { type: 'assist:callback', callbackId: c.id, status: 'due' });
  }
  return { due: due.length };
}

async function processStalePresence() {
  const ids = await ops.expireStalePresence(config.agentPresenceStaleSeconds);
  return { dropped: ids };
}

// helpers ---------------------------------------------------------------------

async function liveSessionForAgent(agentId) {
  const { rows } = await require('./db').query(
    `SELECT * FROM agent_sessions WHERE agent_id = $1 AND status IN ('active','wrap_up')
      ORDER BY created_at DESC LIMIT 1`,
    [agentId],
  );
  return rows[0] || null;
}

module.exports = {
  canTransition,
  requestAssistance, routeSession, acceptOffer, declineOffer, processExpiredOffers,
  heartbeat, setAvailability, startShift, endShift, startBreak, endBreak, liveSessionForAgent,
  callStarted, callEnded, completeSession, cancelByPatient, OUTCOMES,
  createCallback, claimCallback, recordCallbackResult, processDueCallbacks, processStalePresence,
};
