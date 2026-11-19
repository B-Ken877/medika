/**
 * Agent operations repository — the data layer for the human agent
 * consultation-assistance system (migration 015).
 *
 * State machines live here as CHECK constraints; the concurrency referees
 * are the partial unique indexes (uq_agent_session_live, uq_agent_assignment_open,
 * uq_agent_shift_active, uq_agent_callback_open). The lifecycle service
 * (src/agent-lifecycle.js) owns the transitions; routes never write rows
 * directly.
 */
'use strict';

const { query, withTransaction } = require('../db');

const pg = (e) => (e && e.code === '23505') || (e && e.code === '23514');

// ─── Profiles ────────────────────────────────────────────────────────────────

async function upsertProfile({ id, userId, employeeRef = null, supervisorId = null, createdBy = null, interfaceLanguage = 'ht' }) {
  const { rows } = await query(
    `INSERT INTO agent_profiles (id, user_id, employee_ref, supervisor_id, created_by, interface_language)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id) DO UPDATE SET
       employee_ref = COALESCE(EXCLUDED.employee_ref, agent_profiles.employee_ref),
       supervisor_id = COALESCE(EXCLUDED.supervisor_id, agent_profiles.supervisor_id),
       status = 'active'
     RETURNING *`,
    [id, userId, employeeRef, supervisorId, createdBy, interfaceLanguage],
  );
  return rows[0];
}

async function profileByUserId(userId) {
  const { rows } = await query(`SELECT * FROM agent_profiles WHERE user_id = $1`, [userId]);
  return rows[0] || null;
}

async function listProfiles() {
  const { rows } = await query(
    `SELECT p.*, u.name, u.username, u.email, u.phone,
            su.name AS supervisor_name
       FROM agent_profiles p
       JOIN users u  ON u.id = p.user_id
       LEFT JOIN users su ON su.id = p.supervisor_id
      ORDER BY u.name`,
  );
  return rows;
}

// ─── Shifts ──────────────────────────────────────────────────────────────────

async function activeShift(agentId) {
  const { rows } = await query(
    `SELECT * FROM agent_shifts
      WHERE agent_id = $1 AND status IN ('active','on_break','ending')
      ORDER BY created_at DESC LIMIT 1`,
    [agentId],
  );
  return rows[0] || null;
}

async function startShift({ id, agentId, scheduledStart = null, scheduledEnd = null, supervisorId = null }) {
  const { rows } = await query(
    `INSERT INTO agent_shifts (id, agent_id, scheduled_start, scheduled_end, actual_start, status, supervisor_id)
     VALUES ($1,$2,$3,$4, now(), 'active', $5)
     RETURNING *`,
    [id, agentId, scheduledStart, scheduledEnd, supervisorId],
  );
  return rows[0];
}

async function updateShiftStatus(shiftId, status) {
  const { rows } = await query(
    `UPDATE agent_shifts SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [shiftId, status],
  );
  return rows[0] || null;
}

async function endShift(shiftId) {
  const { rows } = await query(
    `UPDATE agent_shifts
        SET status = 'completed', actual_end = COALESCE(actual_end, now()), updated_at = now()
      WHERE id = $1 AND status IN ('active','on_break','ending')
      RETURNING *`,
    [shiftId],
  );
  return rows[0] || null;
}

async function startBreak({ id, shiftId }) {
  const { rows } = await query(
    `INSERT INTO agent_shift_breaks (id, shift_id) VALUES ($1,$2) RETURNING *`,
    [id, shiftId],
  );
  await updateShiftStatus(shiftId, 'on_break');
  return rows[0];
}

async function endBreak(shiftId) {
  const { rows } = await query(
    `UPDATE agent_shift_breaks SET ended_at = now()
      WHERE shift_id = $1 AND ended_at IS NULL
      RETURNING *`,
    [shiftId],
  );
  return rows[0] || null;
}

// ─── Presence ────────────────────────────────────────────────────────────────

async function upsertPresence(agentId, availability, connectionState = 'connected') {
  const { rows } = await query(
    `INSERT INTO agent_presence (agent_id, availability, connection_state, last_heartbeat, updated_at)
     VALUES ($1,$2,$3, now(), now())
     ON CONFLICT (agent_id) DO UPDATE SET
       availability = EXCLUDED.availability,
       connection_state = EXCLUDED.connection_state,
       last_heartbeat = now(),
       updated_at = now()
     RETURNING *`,
    [agentId, availability, connectionState],
  );
  return rows[0];
}

async function heartbeat(agentId, connectionState = 'connected') {
  const { rows } = await query(
    `UPDATE agent_presence SET last_heartbeat = now(), connection_state = $2, updated_at = now()
      WHERE agent_id = $1 RETURNING *`,
    [agentId, connectionState],
  );
  return rows[0] || null;
}

async function presenceOf(agentId) {
  const { rows } = await query(`SELECT * FROM agent_presence WHERE agent_id = $1`, [agentId]);
  return rows[0] || null;
}

/** Eligible-for-routing agents: AVAILABLE, heartbeat fresh, on an active shift. */
async function listRoutableAgents(staleSeconds) {
  const { rows } = await query(
    `SELECT p.agent_id, p.last_heartbeat, s.id AS shift_id
       FROM agent_presence p
       JOIN agent_shifts s
         ON s.agent_id = p.agent_id AND s.status IN ('active','on_break','ending')
      WHERE p.availability = 'available'
        AND p.last_heartbeat > now() - ($1 || ' seconds')::interval
        AND NOT EXISTS (SELECT 1 FROM agent_sessions sess
                         WHERE sess.agent_id = p.agent_id AND sess.status = 'active')
      ORDER BY p.updated_at ASC`,
    [String(staleSeconds)],
  );
  return rows;
}

async function listPresenceOverview() {
  const { rows } = await query(
    `SELECT p.*, u.name, s.status AS shift_status, s.actual_start AS shift_started_at,
            s.scheduled_end AS shift_scheduled_end
       FROM agent_presence p
       JOIN users u ON u.id = p.agent_id
       LEFT JOIN agent_shifts s ON s.agent_id = p.agent_id AND s.status IN ('active','on_break','ending')
      ORDER BY u.name`,
  );
  return rows;
}

/** Cron sweep: stale/absent heartbeats drop to offline (never falsely routable). */
async function expireStalePresence(staleSeconds) {
  const { rows } = await query(
    `UPDATE agent_presence SET availability = 'offline', connection_state = 'disconnected', updated_at = now()
      WHERE availability <> 'offline'
        AND last_heartbeat <= now() - ($1 || ' seconds')::interval
      RETURNING agent_id`,
    [String(staleSeconds)],
  );
  return rows.map((r) => r.agent_id);
}

// ─── Sessions ────────────────────────────────────────────────────────────────

const LIVE_STATUSES = "('waiting','offered','active','wrap_up')";

async function liveSessionForPatient(patientId) {
  const { rows } = await query(
    `SELECT * FROM agent_sessions WHERE patient_id = $1 AND status IN ${LIVE_STATUSES}
      ORDER BY created_at DESC LIMIT 1`,
    [patientId],
  );
  return rows[0] || null;
}

async function createSession({ id, patientId, source = 'in_app', language = 'ht', callbackId = null, reason = '' }) {
  const { rows } = await query(
    `INSERT INTO agent_sessions (id, patient_id, source, language, callback_id, reason, status)
     VALUES ($1,$2,$3,$4,$5,$6,'waiting') RETURNING *`,
    [id, patientId, source, language, callbackId, reason],
  );
  return rows[0];
}

async function sessionById(id) {
  const { rows } = await query(`SELECT * FROM agent_sessions WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function updateSession(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return sessionById(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => fields[k]);
  const { rows } = await query(
    `UPDATE agent_sessions SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...values],
  );
  return rows[0] || null;
}

async function waitingSessions() {
  const { rows } = await query(
    `SELECT * FROM agent_sessions WHERE status IN ('waiting','offered') ORDER BY created_at ASC`,
  );
  return rows;
}

/** Minimum-necessary patient info for the assigned agent (no medical record). */
async function patientSummaryForAgent(patientId) {
  const { rows } = await query(
    `SELECT id, name, username, phone FROM users WHERE id = $1 AND role = 'patient'`,
    [patientId],
  );
  return rows[0] || null;
}

// ─── Queue ───────────────────────────────────────────────────────────────────

async function enqueue({ id, sessionId }) {
  const { rows } = await query(
    `INSERT INTO agent_queue_entries (id, session_id, position)
     VALUES ($1,$2, (SELECT COALESCE(MAX(position),0) + 1 FROM agent_queue_entries WHERE status = 'waiting'))
     RETURNING *`,
    [id, sessionId],
  );
  return rows[0];
}

async function queueEntryFor(sessionId) {
  const { rows } = await query(`SELECT * FROM agent_queue_entries WHERE session_id = $1`, [sessionId]);
  return rows[0] || null;
}

async function waitingQueueSize() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM agent_queue_entries WHERE status = 'waiting'`,
  );
  return rows[0].n;
}

async function queuePosition(sessionId) {
  const { rows } = await query(
    `SELECT position FROM agent_queue_entries WHERE session_id = $1`,
    [sessionId],
  );
  return rows[0] ? rows[0].position : null;
}

// ─── Assignments (targeted offers) ──────────────────────────────────────────

async function openOfferFor(sessionId) {
  const { rows } = await query(
    `SELECT * FROM agent_assignments WHERE session_id = $1 AND status = 'offered' LIMIT 1`,
    [sessionId],
  );
  return rows[0] || null;
}

async function createAssignment({ id, sessionId, agentId, expiresAt }) {
  const { rows } = await query(
    `INSERT INTO agent_assignments (id, session_id, agent_id, expires_at) VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [id, sessionId, agentId, expiresAt],
  );
  return rows[0];
}

/**
 * ATOMIC accept — the referee. Conditional UPDATE: exactly one agent's accept
 * flips the offer; every other accept of the same offer (or of an expired
 * one) affects zero rows.
 */
async function acceptAssignment(assignmentId, agentId) {
  const { rows } = await query(
    `UPDATE agent_assignments
        SET status = 'accepted', responded_at = now()
      WHERE id = $1 AND agent_id = $2 AND status = 'offered' AND expires_at > now()
      RETURNING *`,
    [assignmentId, agentId],
  );
  return rows[0] || null;
}

async function expireAssignment(assignmentId) {
  const { rows } = await query(
    `UPDATE agent_assignments SET status = 'expired', responded_at = now()
      WHERE id = $1 AND status = 'offered' RETURNING *`,
    [assignmentId],
  );
  return rows[0] || null;
}

async function declineAssignment(assignmentId, agentId) {
  const { rows } = await query(
    `UPDATE agent_assignments SET status = 'declined', responded_at = now()
      WHERE id = $1 AND agent_id = $2 AND status = 'offered' RETURNING *`,
    [assignmentId, agentId],
  );
  return rows[0] || null;
}

async function expiredOffers(now = new Date()) {
  const { rows } = await query(
    `SELECT a.*, s.status AS session_status FROM agent_assignments a
       JOIN agent_sessions s ON s.id = a.session_id
      WHERE a.status = 'offered' AND a.expires_at <= $1`,
    [now],
  );
  return rows;
}

async function assignmentStatsForSession(sessionId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total,
            SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END)::int AS expired,
            SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END)::int AS declined
       FROM agent_assignments WHERE session_id = $1`,
    [sessionId],
  );
  return rows[0];
}

// ─── Callbacks ───────────────────────────────────────────────────────────────

async function openCallbackForPatient(patientId) {
  const { rows } = await query(
    `SELECT * FROM agent_callback_requests
      WHERE patient_id = $1 AND status NOT IN ('completed','cancelled','failed')
      ORDER BY created_at DESC LIMIT 1`,
    [patientId],
  );
  return rows[0] || null;
}

async function createCallback({ id, patientId, sessionId = null, phoneNumber, phoneVerified, windowStart = null, windowEnd = null, language = 'ht', reason = '', maxRetries }) {
  const { rows } = await query(
    `INSERT INTO agent_callback_requests
       (id, patient_id, session_id, phone_number, phone_verified, window_start, window_end, language, reason, max_retries, next_attempt_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     RETURNING *`,
    [id, patientId, sessionId, phoneNumber, phoneVerified, windowStart, windowEnd, language, reason, maxRetries],
  );
  return rows[0];
}

async function callbackById(id) {
  const { rows } = await query(`SELECT * FROM agent_callback_requests WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function updateCallback(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return callbackById(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => fields[k]);
  const { rows } = await query(
    `UPDATE agent_callback_requests SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...values],
  );
  return rows[0] || null;
}

/** ATOMIC callback claim — exactly one agent wins. */
async function claimCallback(callbackId, agentId) {
  const { rows } = await query(
    `UPDATE agent_callback_requests
        SET status = 'assigned', assigned_agent_id = $2, updated_at = now()
      WHERE id = $1 AND status IN ('requested','scheduled','due','assigned')
        AND (assigned_agent_id IS NULL OR assigned_agent_id = $2)
      RETURNING *`,
    [callbackId, agentId],
  );
  return rows[0] || null;
}

async function callbacksForAgent(agentId) {
  const { rows } = await query(
    `SELECT c.*, u.name AS patient_name
       FROM agent_callback_requests c JOIN users u ON u.id = c.patient_id
      WHERE c.assigned_agent_id = $1 AND c.status NOT IN ('completed','cancelled','failed')
      ORDER BY COALESCE(c.next_attempt_at, c.created_at) ASC`,
    [agentId],
  );
  return rows;
}

async function pendingCallbacks() {
  const { rows } = await query(
    `SELECT c.*, u.name AS patient_name
       FROM agent_callback_requests c JOIN users u ON u.id = c.patient_id
      WHERE c.status IN ('requested','scheduled','due')
      ORDER BY COALESCE(c.next_attempt_at, c.created_at) ASC`,
  );
  return rows;
}

async function callbackAttempts(callbackId) {
  const { rows } = await query(
    `SELECT a.*, u.name AS agent_name FROM agent_callback_attempts a
       LEFT JOIN users u ON u.id = a.agent_id
      WHERE a.callback_id = $1 ORDER BY a.attempted_at DESC`,
    [callbackId],
  );
  return rows;
}

async function recordCallbackAttempt({ id, callbackId, agentId, result, note = '' }) {
  const { rows } = await query(
    `INSERT INTO agent_callback_attempts (id, callback_id, agent_id, result, note)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, callbackId, agentId, result, note],
  );
  return rows[0];
}

/** Cron: callbacks whose window opened and nobody is assigned yet. */
async function dueCallbacks(now = new Date()) {
  const { rows } = await query(
    `SELECT * FROM agent_callback_requests
      WHERE status IN ('requested','scheduled') AND next_attempt_at <= $1`,
    [now],
  );
  return rows;
}

// ─── Call attempts (voice transport history) ────────────────────────────────

async function createCallAttempt({ id, sessionId, channel = 'in_app_audio', providerRef = '', startedBy }) {
  const { rows } = await query(
    `INSERT INTO agent_call_attempts (id, session_id, channel, provider_ref, started_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, sessionId, channel, providerRef, startedBy],
  );
  return rows[0];
}

async function updateCallAttempt(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => fields[k]);
  const { rows } = await query(`UPDATE agent_call_attempts SET ${sets} WHERE id = $1 RETURNING *`, [id, ...values]);
  return rows[0] || null;
}

async function callAttemptsFor(sessionId) {
  const { rows } = await query(
    `SELECT * FROM agent_call_attempts WHERE session_id = $1 ORDER BY started_at ASC`,
    [sessionId],
  );
  return rows;
}

// ─── Events + notes ──────────────────────────────────────────────────────────

async function recordEvent({ sessionId, eventType, actorId = null, metadata = {} }) {
  await query(
    `INSERT INTO agent_session_events (session_id, event_type, actor_id, metadata)
     VALUES ($1,$2,$3,$4::jsonb)`,
    [sessionId, eventType, actorId, JSON.stringify(metadata || {})],
  );
}

async function eventsFor(sessionId, limit = 100) {
  const { rows } = await query(
    `SELECT e.*, u.name AS actor_name FROM agent_session_events e
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.session_id = $1 ORDER BY e.created_at ASC LIMIT $2`,
    [sessionId, limit],
  );
  return rows;
}

async function addNote({ id, sessionId, agentId, content }) {
  const { rows } = await query(
    `INSERT INTO agent_session_notes (id, session_id, agent_id, content) VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [id, sessionId, agentId, content],
  );
  return rows[0];
}

async function notesFor(sessionId) {
  const { rows } = await query(
    `SELECT n.*, u.name AS agent_name FROM agent_session_notes n
       JOIN users u ON u.id = n.agent_id
      WHERE n.session_id = $1 ORDER BY n.created_at ASC`,
    [sessionId],
  );
  return rows;
}

// ─── Reports (derived ONLY from persisted records — never fabricated) ───────

async function agentDailyStats(agentId, sinceTs) {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE agent_id = $1 AND status = 'active')::int AS active_now,
       COUNT(*) FILTER (WHERE agent_id = $1 AND status = 'completed')::int AS completed_today,
       COUNT(*) FILTER (WHERE agent_id = $1 AND status = 'completed'
                         AND outcome IN ('consultation_initiated','payment_pending','consultation_booked'))::int AS consult_requested_today,
       COUNT(*) FILTER (WHERE agent_id = $1 AND status = 'completed' AND outcome = 'callback_required')::int AS callback_outcomes_today,
       COUNT(*) FILTER (WHERE agent_id = $1 AND status = 'completed' AND outcome = 'unresolved')::int AS unresolved_today,
       AVG(EXTRACT(EPOCH FROM (ended_at - started_at)))
         FILTER (WHERE agent_id = $1 AND status = 'completed' AND ended_at IS NOT NULL AND started_at IS NOT NULL)::int AS avg_session_seconds
       FROM agent_sessions
      WHERE (agent_id = $1 OR $1 IS NULL) AND COALESCE(ended_at, started_at, created_at) >= $2`,
    [agentId, sinceTs],
  );
  return rows[0];
}

async function operationsOverview() {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM agent_presence WHERE availability = 'available' AND last_heartbeat > now() - interval '45 seconds') AS agents_available,
       (SELECT COUNT(*)::int FROM agent_presence WHERE availability = 'busy') AS agents_busy,
       (SELECT COUNT(*)::int FROM agent_presence WHERE availability = 'on_break') AS agents_on_break,
       (SELECT COUNT(*)::int FROM agent_presence WHERE availability <> 'offline') AS agents_online,
       (SELECT COUNT(*)::int FROM agent_queue_entries WHERE status = 'waiting') AS queue_waiting,
       (SELECT COUNT(*)::int FROM agent_sessions WHERE status IN ('waiting','offered')) AS sessions_waiting,
       (SELECT COUNT(*)::int FROM agent_sessions WHERE status = 'active') AS sessions_active,
       (SELECT COUNT(*)::int FROM agent_sessions WHERE status = 'wrap_up') AS sessions_wrapping_up,
       (SELECT COUNT(*)::int FROM agent_callback_requests WHERE status IN ('requested','scheduled','due')) AS callbacks_pending,
       (SELECT COUNT(*)::int FROM agent_callback_requests WHERE status = 'assigned') AS callbacks_assigned`,
  );
  return rows[0];
}

async function recentSessions(limit = 50) {
  const { rows } = await query(
    `SELECT s.id, s.status, s.source, s.outcome, s.language, s.specialty, s.consultation_id,
            s.created_at, s.started_at, s.ended_at, s.agent_id,
            p.name AS patient_name, a.name AS agent_name
       FROM agent_sessions s
       JOIN users p ON p.id = s.patient_id
       LEFT JOIN users a ON a.id = s.agent_id
      ORDER BY s.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

module.exports = {
  pg,
  upsertProfile, profileByUserId, listProfiles,
  activeShift, startShift, updateShiftStatus, endShift, startBreak, endBreak,
  upsertPresence, heartbeat, presenceOf, listRoutableAgents, listPresenceOverview, expireStalePresence,
  liveSessionForPatient, createSession, sessionById, updateSession, waitingSessions, patientSummaryForAgent,
  enqueue, queueEntryFor, waitingQueueSize, queuePosition,
  openOfferFor, createAssignment, acceptAssignment, expireAssignment, declineAssignment, expiredOffers, assignmentStatsForSession,
  openCallbackForPatient, createCallback, callbackById, updateCallback, claimCallback, callbacksForAgent, pendingCallbacks,
  callbackAttempts, recordCallbackAttempt, dueCallbacks,
  createCallAttempt, updateCallAttempt, callAttemptsFor,
  recordEvent, eventsFor, addNote, notesFor,
  agentDailyStats, operationsOverview, recentSessions,
};
