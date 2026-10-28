/**
 * Profile, doctor directory and availability routes.
 * GET /api/doctors now strips email/phone (patient-facing PII — audit M1);
 * license_number stays because the Android profile card displays it.
 */
'use strict';

const express = require('express');
const usersRepo = require('../repos/users');
const { authenticate, requireRole } = require('../auth');
const { notFound } = require('../errors');
const { isMediaAssetUrl } = require('../uploads');

const router = express.Router();

router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const user = await usersRepo.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(usersRepo.safe(user));
  } catch (err) { next(err); }
});

/**
 * Avatar URL validation for PUT /api/profile. Accepts ONLY:
 *  - absolute http(s) URLs (historical public Blob uploads), or
 *  - site-relative /uploads/… paths (legacy local/VPS storage), or
 *  - the private-store capability shape /api/media/assets/ast_….… issued
 *    by POST /api/upload since the store moved to private access
 * Anything else (data:, javascript:, file:, arbitrary paths) is rejected —
 * the value is rendered in <img src> on every client.
 */
function isValidAvatarUrl(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 1 || v.length > 500) return false;
  return /^https?:\/\/[^\s]+$/i.test(v) || /^\/uploads\/[^"]*$/i.test(v) || isMediaAssetUrl(v);
}

router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { name, email, phone, age, gender, avatarUrl } = req.body || {};
    if (avatarUrl !== undefined && !isValidAvatarUrl(avatarUrl)) {
      return res.status(400).json({ error: 'URL avatar non valide' });
    }
    const user = await usersRepo.updateProfile(req.user.id, {
      name: typeof name === 'string' && name ? name : undefined,
      email,
      phone,
      age: age === undefined ? undefined : (parseInt(age, 10) || null),
      gender,
      avatarUrl,
    });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(usersRepo.safe(user));
  } catch (err) { next(err); }
});

router.put('/doctor/availability', authenticate, requireRole('doctor'), async (req, res, next) => {
  try {
    const { isAvailable } = req.body || {};
    await usersRepo.setAvailability(req.user.id, isAvailable);
    res.json({ success: true, isAvailable: !!isAvailable });
  } catch (err) { next(err); }
});

router.get('/doctors', authenticate, async (req, res, next) => {
  try {
    const doctors = await usersRepo.listDoctors(req.query.specialty ? String(req.query.specialty) : undefined);
    res.json(doctors.map(usersRepo.publicDoctor));
  } catch (err) { next(err); }
});

/**
 * GET /api/doctors/:id — public doctor detail for the profile page (issue
 * #30). Same redaction contract as the list (publicDoctor: no email/phone);
 * the response carries the explicit verification_status (issue #32) so the
 * badge is grounded in server state, never inferred from a license string.
 * 404 for unknown/non-doctor ids (no existence leak beyond the directory).
 */
router.get('/doctors/:id', authenticate, async (req, res, next) => {
  try {
    const user = await usersRepo.findById(req.params.id);
    if (!user || user.role !== 'doctor') return next(notFound());
    res.json(usersRepo.publicDoctor(usersRepo.toApi(user)));
  } catch (err) { next(err); }
});

module.exports = router;
