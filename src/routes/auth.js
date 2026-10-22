/**
 * Auth routes — login/register issue JWTs (opaque to Android clients).
 * Response shape preserved: { token, user } with user = safe user object.
 */
'use strict';

const express = require('express');
const usersRepo = require('../repos/users');
const { issueToken, hashPassword, comparePassword, newUserId, loginThrottle } = require('../auth');
const { badRequest, unauthorized } = require('../errors');

const router = express.Router();

router.post('/auth/login', loginThrottle, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const user = await usersRepo.login(String(username), String(password), comparePassword);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    res.json({ token: issueToken(user), user: usersRepo.safe(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/auth/register', loginThrottle, async (req, res, next) => {
  try {
    const { username, password, name, email, phone, age, gender } = req.body || {};
    if (!username || !password || !name) {
      return res.status(400).json({ error: 'Username, password and name are required' });
    }
    // Minimum length kept at 4 for Android compatibility — hardening noted in
    // docs/DEPLOYMENT.md remaining tasks.
    if (String(password).length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    const user = await usersRepo.create({
      id: newUserId('patient'),
      username: String(username),
      password_hash: hashPassword(String(password)),
      role: 'patient',
      name: String(name),
      email: email ?? null,
      phone: phone ?? null,
      age: age === undefined ? null : parseInt(age, 10) || null,
      gender: gender || 'Homme',
    });
    if (!user) return res.status(409).json({ error: 'Username already taken' });
    res.status(201).json({ token: issueToken(user), user: usersRepo.safe(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/auth/login', loginThrottle, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const user = await usersRepo.login(String(username), String(password), comparePassword);
    if (!user || user.role !== 'admin') {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    res.json({ token: issueToken(user), user: usersRepo.safe(user) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
