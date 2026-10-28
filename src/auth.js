/**
 * Authentication & authorization.
 *
 * SECURITY CHANGE vs legacy server.js: the bearer token is no longer the raw
 * user id (which let anyone impersonate anyone by knowing an id — user ids are
 * exposed by public endpoints). We now issue HS256 JWTs at login/register.
 * Android clients treat the token as an opaque string (they echo whatever
 * login returned), so existing logins keep working; previously stored
 * user-id tokens simply fail verification → users log in again once.
 */
'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('./db');
const { config } = require('./config');
const { unauthorized, forbidden } = require('./errors');

const TOKEN_TTL_SECONDS = config.jwtExpiresDays * 24 * 60 * 60;

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username, name: user.name },
    config.jwtSecret,
    { expiresIn: TOKEN_TTL_SECONDS }
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret); // throws on invalid/expired
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function newUserId(role) {
  return `${role}_${uuidv4().substring(0, 8)}`;
}

/**
 * Express middleware: Bearer JWT → fresh user row from DB.
 * A DB hit per request keeps role/name/edits/deletions authoritative.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const token = header.substring(7).trim();
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    req.user = { id: user.id, username: user.username, role: user.role, name: user.name };
    next();
  } catch (err) {
    next(err);
  }
}

/** Express middleware: authenticated AND role === 'admin'. */
async function authenticateAdmin(req, res, next) {
  authenticate(req, res, async (err) => {
    if (err) return next(err);
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

/** Express middleware factory: require one of the given roles. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès non autorisé pour ce rôle' });
    }
    next();
  };
}

/**
 * Best-effort per-instance login throttling.
 * Serverless instances are ephemeral, so this is defense-in-depth, not a
 * complete solution — pair with Vercel WAF / provider rate limits in production
 * (documented in docs/DEPLOYMENT.md).
 */
const attempts = new Map(); // key -> number[]
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

function throttle(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_ATTEMPTS) {
    attempts.set(key, list);
    return false;
  }
  list.push(now);
  attempts.set(key, list);
  if (attempts.size > 10_000) attempts.clear(); // bound memory
  return true;
}

function clientKey(req) {
  return (
    req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function loginThrottle(req, res, next) {
  if (!throttle(`login:${clientKey(req)}`)) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une minute.' });
  }
  next();
}

module.exports = {
  issueToken,
  verifyToken,
  hashPassword,
  comparePassword,
  newUserId,
  authenticate,
  authenticateAdmin,
  requireRole,
  loginThrottle,
  TOKEN_TTL_SECONDS,
};
