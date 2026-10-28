/**
 * LiveKit / ZEGOCLOUD call token route + specialty price endpoints + health.
 *
 * LiveKit credentials come from env vars (the hardcoded key/secret that was
 * committed in server.js is treated as compromised — audit C3 — and must be
 * rotated). The legacy LiveKit response shape is preserved exactly:
 *   { provider, token, url, roomName, participantIdentity }
 * Tokens are minted ONLY after the requester is verified to belong to the
 * consultation (unchanged legacy behavior).
 *
 * Issue #62: the same endpoint now also mints ZEGOCLOUD token04 grants when
 * the server-side provider switch (config.callProvider) selects 'zego'. The
 * provider switch is honored ONLY on preview/development deployments —
 * production deployments always keep LiveKit (config-level fail-safe). Both
 * providers share the SAME authorization funnel: authenticate → consultation
 * membership (403) → service availability (503, no credential fallback
 * ever) → consultation lifecycle eligibility (403; EN_COURS only). ZEGO
 * token payloads additionally pin the room and the exact allowed stream, so
 * room/stream identity is always server-derived, never client-supplied.
 */
'use strict';

const express = require('express');
const { AccessToken } = require('livekit-server-sdk');
const consultationsRepo = require('../repos/consultations');
const specialtiesRepo = require('../repos/specialties');
const { config } = require('../config');
const { zegoCallGrant } = require('../zego');
const { authenticate } = require('../auth');
const { badRequest, serviceUnavailable } = require('../errors');

const router = express.Router();

// ZEGO token TTL — short-lived by design (issue #62). The web client renews
// via POST /api/call/token on the tokenWillExpire event, so every renewal
// re-runs the full authorization funnel (membership + EN_COURS).
const ZEGO_TOKEN_TTL_SECONDS = 3600;

router.post('/call/token', authenticate, async (req, res, next) => {
  try {
    const { consultationId } = req.body || {};
    if (!consultationId) return res.status(400).json({ error: 'consultationId required' });

    const consultation = await consultationsRepo.findById(String(consultationId));
    if (!consultation ||
        (consultation.patient_id !== req.user.id && consultation.doctor_id !== req.user.id)) {
      return res.status(403).json({ error: 'Not part of this consultation' });
    }

    // Consultation lifecycle eligibility (issue #45 — fail closed).
    // Only an ACTIVE consultation may open a call room:
    //   * RECHERCHE_MEDECIN — waiting/routing; the row can already carry a
    //     temporary doctor_id (current OFFER holder), so participant identity
    //     alone is NOT proof of acceptance. Calls before accept are denied.
    //   * TERMINE / REFUSE / EXPIRE — terminal states, no call ever.
    // Payment is verified server-side BEFORE creation, so EN_COURS implies
    // the established business rules (verified payment + accepted doctor).
    // Unknown/legacy statuses also fail closed.
    // NOTE: the service-availability (503) check below intentionally runs
    // FIRST — its existing contract (no credential fallback, ever) is
    // independent of eligibility and must not leak business-rule rejections
    // when the service itself is not configured. The same funnel order
    // (membership → 503 → eligibility) applies to BOTH providers.
    if (config.callProvider === 'zego') {
      // ─── ZEGOCLOUD branch (issue #62) — preview/development only ─────────
      if (!config.zegoCloudAppId || !config.zegoCloudServerUrl || !config.zegoCloudServerSecret) {
        return res.status(503).json({ error: 'ZEGOCLOUD non configure (ZEGOCLOUD_APP_ID / ZEGOCLOUD_SERVER_URL / ZEGOCLOUD_SERVER_SECRET requis)' });
      }

      if (consultation.status !== 'EN_COURS') {
        return res.status(403).json({ error: 'Appel indisponible pour cette consultation' });
      }

      // Room + stream identity are SERVER-derived. The token04 payload pins
      // this user to THIS room and allows publishing EXACTLY their stream —
      // a stolen token cannot join another room or publish another stream.
      const roomName = 'medika_' + consultationId;
      const streamId = `medika_${consultationId}_${req.user.id}`;
      let token;
      try {
        token = zegoCallGrant({
          appId: config.zegoCloudAppId,
          serverSecret: config.zegoCloudServerSecret,
          userId: req.user.id,
          roomName,
          streamId,
          ttlSeconds: ZEGO_TOKEN_TTL_SECONDS,
        });
      } catch (err) {
        // Invalid ZEGO configuration (e.g. secret not 32 chars) — fail closed
        // with a configuration error. Never echo the secret or error details.
        return res.status(503).json({ error: 'ZEGOCLOUD non configure (ZEGOCLOUD_SERVER_SECRET invalide — 32 caracteres requis)' });
      }
      return res.json({
        provider: 'zego',
        token,
        // url carries the public engine endpoint (same field role as LiveKit).
        url: config.zegoCloudServerUrl,
        roomName,
        participantIdentity: req.user.id,
        streamId,
        appId: config.zegoCloudAppId,
        tokenTtlSeconds: ZEGO_TOKEN_TTL_SECONDS,
      });
    }

    // ─── LiveKit branch (default; production keeps this path) ────────────────
    if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) {
      return res.status(503).json({ error: 'LiveKit non configure (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET requis)' });
    }

    if (consultation.status !== 'EN_COURS') {
      return res.status(403).json({ error: 'Appel indisponible pour cette consultation' });
    }

    const roomName = 'medika_' + consultationId;
    const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
      identity: req.user.id,
      name: req.user.name,
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    res.json({
      provider: 'livekit',
      token,
      url: config.livekitUrl,
      roomName,
      participantIdentity: req.user.id,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Public specialty pricing (used by the Android payment flow) ───────────

router.get('/specialties/prices', async (req, res, next) => {
  try {
    const specialties = await specialtiesRepo.list();
    res.json(specialties.map((s) => ({ id: s.id, name: s.name, price: s.price })));
  } catch (err) { next(err); }
});

router.get('/specialties/price', async (req, res, next) => {
  try {
    const { specialty } = req.query;
    if (!specialty) return res.status(400).json({ error: 'specialty query param required' });
    const price = await specialtiesRepo.priceFor(String(specialty));
    res.json({ specialty: String(specialty), price });
  } catch (err) { next(err); }
});

// ─── Health ──────────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

module.exports = router;
