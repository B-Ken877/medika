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
const { config } = require('../config');

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
