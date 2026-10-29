/**
 * ZEGOCLOUD call-token route, specialty pricing, and health endpoints.
 *
 * ZEGO is the sole video-call provider. Tokens are generated server-side;
 * the ServerSecret is never returned to clients or written to logs.
 * The shared authorization funnel verifies consultation membership and
 * active lifecycle status before issuing a room- and stream-scoped token.
 */
'use strict';

const express = require('express');
const consultationsRepo = require('../repos/consultations');
const specialtiesRepo = require('../repos/specialties');
const { config } = require('../config');
const { zegoCallGrant } = require('../zego');
const { authenticate } = require('../auth');

const router = express.Router();
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

    if (!config.zegoCloudAppId || !config.zegoCloudServerUrl || !config.zegoCloudServerSecret) {
      return res.status(503).json({
        error: 'ZEGOCLOUD non configure (ZEGOCLOUD_APP_ID / ZEGOCLOUD_SERVER_URL / ZEGOCLOUD_SERVER_SECRET requis)',
      });
    }

    if (consultation.status !== 'EN_COURS') {
      return res.status(403).json({ error: 'Appel indisponible pour cette consultation' });
    }

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
      return res.status(503).json({
        error: 'ZEGOCLOUD non configure (ZEGOCLOUD_SERVER_SECRET invalide — 32 caracteres requis)',
      });
    }

    return res.json({
      provider: 'zego',
      token,
      url: config.zegoCloudServerUrl,
      roomName,
      participantIdentity: req.user.id,
      streamId,
      appId: config.zegoCloudAppId,
      tokenTtlSeconds: ZEGO_TOKEN_TTL_SECONDS,
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
