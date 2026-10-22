/**
 * LiveKit call token route + specialty price endpoints + health.
 *
 * LiveKit credentials now come from env vars (the hardcoded key/secret that
 * was committed in server.js is treated as compromised — audit C3 — and must
 * be rotated). The response shape is preserved exactly:
 *   { token, url, roomName, participantIdentity }
 * Tokens are minted ONLY after the requester is verified to belong to the
 * consultation (unchanged legacy behavior).
 */
'use strict';

const express = require('express');
const { AccessToken } = require('livekit-server-sdk');
const consultationsRepo = require('../repos/consultations');
const specialtiesRepo = require('../repos/specialties');
const { config } = require('../config');
const { authenticate } = require('../auth');
const { badRequest, serviceUnavailable } = require('../errors');

const router = express.Router();

router.post('/call/token', authenticate, async (req, res, next) => {
  try {
    const { consultationId } = req.body || {};
    if (!consultationId) return res.status(400).json({ error: 'consultationId required' });

    const consultation = await consultationsRepo.findById(String(consultationId));
    if (!consultation ||
        (consultation.patient_id !== req.user.id && consultation.doctor_id !== req.user.id)) {
      return res.status(403).json({ error: 'Not part of this consultation' });
    }

    if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) {
      return res.status(503).json({ error: 'LiveKit non configure (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET requis)' });
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
