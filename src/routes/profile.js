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

const router = express.Router();

router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const user = await usersRepo.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(usersRepo.safe(user));
  } catch (err) { next(err); }
});

router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { name, email, phone, age, gender } = req.body || {};
    const user = await usersRepo.updateProfile(req.user.id, {
      name: typeof name === 'string' && name ? name : undefined,
      email,
      phone,
      age: age === undefined ? undefined : (parseInt(age, 10) || null),
      gender,
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

module.exports = router;
