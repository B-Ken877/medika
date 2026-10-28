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
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const consultationsRepo = require('../repos/consultations');
const attachmentsRepo = require('../repos/attachments');
const usersRepo = require('../repos/users');
const paymentsRepo = require('../repos/payments');
const specialtiesRepo = require('../repos/specialties');
const notesRepo = require('../repos/notes');
const walletRepo = require('../repos/wallet');
const lifecycle = require('../consultation-lifecycle');
const moncash = require('../moncash');
const { config, simulationAllowed } = require('../config');
const { authenticate, requireRole } = require('../auth');
const { badRequest, notFound, paymentRequired, conflict, serviceUnavailable } = require('../errors');
const {
  createAttachmentMiddleware,
  storePrivateAttachment,
  cleanupStoredAttachment,
  signLocalAttachmentUrl,
  verifyLocalAttachmentSignature,
  localAttachmentPath,
  sanitizeFilename,
  newUploadRequestId,
  logUploadDiagnostic,
  SIGNED_URL_TTL_SECONDS,
} = require('../uploads');

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
        // Issue #40 — idempotent replay: the SAME verified payment already
        // created a consultation for THIS patient (double-click, refresh or
        // a retry of the same logical intent). The payment row is proven to
        // belong to the requester (checked in resolveVerifiedPayment), so
        // the consultation it bought IS this patient's request. Return it
        // instead of a confusing 409 — never create a duplicate.
        if (payment.errorStatus === 409 && payment.row && payment.row.consultation_id) {
          const existing = await consultationsRepo.findById(payment.row.consultation_id);
          if (existing && existing.patient_id === req.user.id) {
            return res.json({ ...consultationsRepo.consToApi(existing), payment_replayed: true });
          }
        }
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
        // Remove the just-created (duplicate) consultation and replay the
        // winner: the payment belongs to THIS patient, so the consultation it
        // bought is their own request (issue #40 — no duplicate, no 409).
        await consultationsRepo.adminDelete(id);
        const winner = await paymentsRepo.findByOrderId(payment.row.order_id);
        if (winner && winner.consultation_id) {
          const existing = await consultationsRepo.findById(winner.consultation_id);
          if (existing && existing.patient_id === req.user.id) {
            return res.json({ ...consultationsRepo.consToApi(existing), payment_replayed: true });
          }
        }
        return res.status(409).json({ error: 'Ce paiement a deja ete utilise pour une autre consultation' });
      }
    }

    // Issue #25: route the request — the patient-picked doctor (or the best
    // eligible available doctor) receives a one-hour offer; when nobody is
    // eligible the request parks in a retryable waiting state.
    const routed = await lifecycle.routeNewConsultation(consultation, {
      patientChoiceDoctorId: doctorId || null,
    });

    const api = consultationsRepo.consToApi(routed.consultation);
    const hub = req.app.locals.hub;
    if (hub) {
      const newNotif = { type: 'consultation:new', id, patientName: patient.name, description, specialtyNeeded: specialty, urgencyLevel: urgencyLevel || 'Moyenne' };
      hub.publishToUser(req.user.id, newNotif);
      // Targeted offer — the request is no longer broadcast to every doctor.
      if (routed.offeredTo) {
        hub.publishToUser(routed.offeredTo.id, newNotif);
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
    // Issue #40: include the row so the caller can attempt an idempotent
    // replay (same verified payment, same patient → same consultation).
    return { error: 'Ce paiement a deja ete utilise pour une autre consultation', errorStatus: 409, row };
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
    // Opportunistic deadline enforcement (throttled, fire-and-forget):
    // offer timeouts, 5-hour expiries and waiting-state retries are applied
    // whenever anyone reads the list, so state stays fresh even without a
    // scheduler. Never blocks or fails the read.
    lifecycle.enforceDueDeadlines(req.app.locals.hub);
    res.json(await consultationsRepo.listForUser(req.user));
  } catch (err) { next(err); }
});

router.get('/consultations/:id', authenticate, async (req, res, next) => {
  try {
    lifecycle.enforceDueDeadlines(req.app.locals.hub);
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
    const { text, messageType, fileUrl, duration, fileSize, clientMsgId } = req.body || {};
    const type = messageType || 'text';
    const trimmedText = typeof text === 'string' ? text.trim() : '';
    if (!trimmedText && type !== 'voice' && type !== 'image' && type !== 'video' && type !== 'file') {
      return res.status(400).json({ error: 'Message text required' });
    }
    // Client correlation id (migration 003): same validation as the WS frame —
    // a string of 1..64 chars. Invalid shapes are IGNORED (treated as absent),
    // matching hub behavior; no new error paths for legacy clients.
    const correlationId =
      typeof clientMsgId === 'string' && clientMsgId.length > 0 && clientMsgId.length <= 64
        ? clientMsgId
        : null;
    const msg = await consultationsRepo.createMessage({
      consultation_id: req.params.id,
      sender_id: req.user.id,
      sender_name: req.user.name,
      text: trimmedText,
      message_type: type,
      file_url: fileUrl || null,
      duration: duration ?? null,
      file_size: fileSize ?? null,
      client_msg_id: correlationId,
    });
    const hub = req.app.locals.hub;
    if (hub) {
      const envelope = require('../realtime/hub').messageEnvelope(msg, { clientMsgId: correlationId || undefined });
      hub.publishToUser(req.user.id, envelope);
      const recipientId = c.patient_id === req.user.id ? c.doctor_id : c.patient_id;
      if (recipientId) hub.publishToUser(recipientId, envelope);
    }
    res.status(201).json(consultationsRepo.msgToApi(msg));
  } catch (err) { next(err); }
});

// ─── Read receipts ─────────────────────────────────────────────────────────

/**
 * POST /api/consultations/:id/read — mark the OTHER participant's unread,
 * non-system messages as read (authenticated caller = reader, never the
 * payload). Atomic + idempotent in PostgreSQL; answers with the persisted
 * state and relays ONE compact `messages:read` event to the original sender
 * through the hub (authorized participant only — cross-instance via Redis
 * when configured, exactly like message:new).
 */
router.post('/consultations/:id/read', authenticate, async (req, res, next) => {
  try {
    const c = await consultationsRepo.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (c.patient_id !== req.user.id && c.doctor_id !== req.user.id) {
      // Legacy hiding convention: participants-only resources answer 404.
      return res.status(404).json({ error: 'Not found' });
    }
    const counterpartId = c.patient_id === req.user.id ? c.doctor_id : c.patient_id;
    if (!counterpartId) {
      return res.json({ consultationId: req.params.id, readerId: req.user.id, messageIds: [], readAt: null });
    }
    const { messageIds, readAt } = await consultationsRepo.markIncomingRead({
      consultationId: req.params.id,
      readerId: req.user.id,
      counterpartId,
    });
    if (messageIds.length) {
      const hub = req.app.locals.hub;
      if (hub) {
        hub.publishToUser(counterpartId, {
          type: 'messages:read',
          consultationId: req.params.id,
          readerId: req.user.id,
          messageIds,
          readAt,
        });
      }
    }
    res.json({ consultationId: req.params.id, readerId: req.user.id, messageIds, readAt });
  } catch (err) { next(err); }
});

// ─── Private consultation attachments ───────────────────────────────────────

/** Participant-or-404 consultation guard shared by the attachment routes. */
async function loadConsultationForAttachment(req, res) {
  const c = await consultationsRepo.findById(req.params.id);
  if (!c) { res.status(404).json({ error: 'Not found' }); return null; }
  if (c.patient_id !== req.user.id && c.doctor_id !== req.user.id) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return c;
}

/**
 * POST /api/consultations/:id/attachments — private, consultation-scoped
 * upload for medical media. Authenticated participants only; the
 * consultation must be EN_COURS (the same permission that gates sending
 * messages). Stored PRIVATELY (Blob access:'private' / opaque dev path);
 * the client receives only an opaque API path to put in the message.
 */
router.post('/consultations/:id/attachments', authenticate, (req, res, next) => {
  const reqId = newUploadRequestId();
  createAttachmentMiddleware()(req, res, async (err) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: `Fichye a twò gwo (maksimòm ${config.maxUploadMb}Mo)` });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ error: 'Type de fichier non autorisé' });
        }
        return res.status(400).json({ error: 'Upload invalide' });
      }
      if (!req.file) return res.status(400).json({ error: 'No file provided' });

      const c = await loadConsultationForAttachment(req, res);
      if (!c) return;
      if (c.status !== 'EN_COURS') {
        return res.status(409).json({ error: 'Consultation non active' });
      }

      const attachmentId = 'att_' + uuidv4().substring(0, 12);
      const stored = await storePrivateAttachment({
        file: req.file,
        consultationId: req.params.id,
        attachmentId,
        reqId,
      });
      let row;
      try {
        row = await attachmentsRepo.create({
          id: attachmentId,
          consultation_id: req.params.id,
          uploader_id: req.user.id,
          storage: stored.storage,
          blob_pathname: stored.blobPathname,
          filename: sanitizeFilename(req.file.originalname),
          mimetype: req.file.mimetype,
          size: req.file.size,
        });
      } catch (dbErr) {
        // The bytes reached storage but the registry insert failed: remove
        // the now-UNTRACKED private file so no orphaned medical media stays
        // behind, then surface the original failure.
        await cleanupStoredAttachment({ storage: stored.storage, blobPathname: stored.blobPathname, reqId });
        logUploadDiagnostic(reqId, 'attachment_registry_failed', {
          category: dbErr && dbErr.constructor ? dbErr.constructor.name : 'unknown',
        });
        throw dbErr;
      }
      res.status(201).json({
        attachmentId: row.id,
        url: `/api/consultations/${encodeURIComponent(row.consultation_id)}/attachments/${encodeURIComponent(row.id)}`,
        filename: row.filename,
        mimetype: row.mimetype,
        size: Number(row.size),
      });
    } catch (e) {
      next(e);
    }
  });
});

/**
 * GET /api/consultations/:id/attachments/:aid/url — participant-authorized,
 * short-lived signed access. Membership is re-checked on EVERY request; the
 * answer carries only the expiring grant, never storage keys or tokens.
 */
router.get('/consultations/:id/attachments/:aid/url', authenticate, async (req, res, next) => {
  try {
    const c = await loadConsultationForAttachment(req, res);
    if (!c) return;
    const row = await attachmentsRepo.findById(req.params.aid);
    if (!row || row.consultation_id !== req.params.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (row.storage === 'blob') {
      const { issueSignedToken, presignUrl } = require('@vercel/blob');
      const validUntil = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;
      const signedToken = await issueSignedToken({
        pathname: row.blob_pathname,
        operations: ['get'],
        validUntil,
        token: config.blobReadWriteToken,
      });
      const { presignedUrl } = await presignUrl(signedToken, {
        operation: 'get',
        pathname: row.blob_pathname,
        validUntil,
        access: 'private',
      });
      return res.json({
        url: presignedUrl,
        expiresIn: SIGNED_URL_TTL_SECONDS,
        filename: row.filename,
        mimetype: row.mimetype,
        size: Number(row.size),
      });
    }

    // Local-dev storage: HMAC-signed, expiring API grant (dev parity for the
    // production signed-URL model — the static /uploads route never serves it).
    const { url } = signLocalAttachmentUrl({ consultationId: req.params.id, attachmentId: row.id });
    res.json({
      url,
      expiresIn: SIGNED_URL_TTL_SECONDS,
      filename: row.filename,
      mimetype: row.mimetype,
      size: Number(row.size),
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/consultations/:id/attachments/:aid/file — streams a LOCAL-dev
 * attachment for holders of the short-lived HMAC grant. Blob-stored
 * attachments are served by the presigned Blob URL instead (this route
 * 404s for them by construction: the grant is only issued for local rows).
 */
router.get('/consultations/:id/attachments/:aid/file', async (req, res, next) => {
  try {
    const { exp, sig } = req.query;
    if (!verifyLocalAttachmentSignature({
      consultationId: req.params.id,
      attachmentId: req.params.aid,
      exp: String(exp || ''),
      sig: String(sig || ''),
    })) {
      return res.status(404).json({ error: 'Not found' });
    }
    const row = await attachmentsRepo.findById(req.params.aid);
    if (!row || row.consultation_id !== req.params.id || row.storage !== 'local') {
      return res.status(404).json({ error: 'Not found' });
    }
    const fp = localAttachmentPath(row.blob_pathname);
    await fs.promises.access(fp).catch(() => {
      throw notFound('Not found');
    });
    res.setHeader('Content-Type', row.mimetype);
    res.setHeader('Cache-Control', `private, max-age=${SIGNED_URL_TTL_SECONDS}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(fp)
      .on('error', () => { if (!res.headersSent) res.status(404).json({ error: 'Not found' }); else res.end(); })
      .pipe(res);
  } catch (err) { next(err); }
});

// ─── Doctor actions (authorization hardened — audit H2) ─────────────────────

/**
 * PUT /api/consultations/:id/accept — atomic claim, deadline-aware (issue #25).
 * The one-hour offer window is enforced by the conditional UPDATE itself;
 * when the claim loses, the reason is diagnosed from the persisted state:
 *   * offer expired → the timeout is processed inline (reroute happens now)
 *     and the late acceptance is rejected with 410 — it can never take
 *     ownership of the consultation;
 *   * offered to someone else / waiting / no active offer → 409;
 *   * missing or terminal → 404 (legacy hiding convention).
 */
router.put('/consultations/:id/accept', authenticate, requireRole('doctor'), async (req, res, next) => {
  try {
    const c = await consultationsRepo.accept(req.params.id, req.user.id);
    if (!c) {
      const current = await consultationsRepo.findById(req.params.id);
      if (!current || current.status !== 'RECHERCHE_MEDECIN') {
        return res.status(404).json({ error: 'Not found' });
      }
      if (current.doctor_id === req.user.id && current.offer_deadline && current.offer_deadline <= new Date()) {
        // Deadline passed: process the timeout NOW so the reroute is not
        // deferred to the scheduler, then reject the late acceptance.
        const outcome = { offersExpired: 0, rerouted: 0, waiting: 0, adopted: 0, retried: 0, expired: 0, notified: 0, consultation: null, notifyNewDoctor: null };
        await lifecycle.expireOfferAndReroute(req.params.id, outcome);
        return res.status(410).json({
          error: 'Delai d\u2019acceptation depasse (1 heure). La demande a ete reorientee a un autre medecin.',
        });
      }
      if (current.doctor_id && current.doctor_id !== req.user.id) {
        return res.status(409).json({ error: 'Cette demande est actuellement offerte a un autre medecin' });
      }
      return res.status(409).json({ error: 'Cette demande n\u2019est pas disponible pour acceptation' });
    }
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

/**
 * PUT /api/consultations/:id/reject (issue #25 semantics):
 *   * the patient-chosen doctor rejecting ends the request as REFUSE
 *     (historical behavior — patient notified);
 *   * a routed-offer rejection behaves like a timeout: immediate reroute.
 */
router.put('/consultations/:id/reject', authenticate, requireRole('doctor'), async (req, res, next) => {
  try {
    const result = await lifecycle.rejectConsultation(req.params.id, req.user.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    notifyConsultationUpdate(req, result.consultation);
    const hub = req.app.locals.hub;
    if (hub && result.nextDoctor) {
      hub.publishToUser(result.nextDoctor.id, {
        type: 'consultation:new',
        id: result.consultation.id,
        patientName: result.consultation.patient_name,
        description: result.consultation.description,
        specialtyNeeded: result.consultation.specialty_needed,
        urgencyLevel: result.consultation.urgency_level,
      });
    }
    res.json(consultationsRepo.consToApi(result.consultation));
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
    // Issue #24: a completed consultation with a verified payment becomes
    // an available earning exactly once (idempotent materialization).
    await walletRepo.materializeEarnings().catch((err) => {
      console.error('[wallet] earning materialization failed:', err.code || err.message);
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
