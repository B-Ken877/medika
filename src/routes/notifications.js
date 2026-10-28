/**
 * Notification routes (issue #36) — subscriptions, in-app history, unread
 * state and category preferences. All endpoints are authenticated; every
 * operation is ownership-scoped to the authenticated user (a client-supplied
 * user id is never authoritative).
 *
 *  POST   /api/notifications/subscriptions   register (multi-device)
 *  PUT    /api/notifications/subscriptions   refresh/upsert by endpoint
 *  DELETE /api/notifications/subscriptions   revoke own subscription(s)
 *  GET    /api/notifications                 history (paginated, own only)
 *  POST   /api/notifications/read            mark ids read (own only)
 *  POST   /api/notifications/read-all        mark everything read
 *  GET    /api/notifications/preferences     category opt-outs
 *  PUT    /api/notifications/preferences     update opt-outs
 *  GET    /api/notifications/vapid-public-key  client bootstrap
 *
 * Payload validation is strict (endpoint shape, key lengths): the stored
 * values are used verbatim as push targets and must never be garbage.
 */
'use strict';

const express = require('express');
const { query } = require('../db');
const push = require('../notifications/push');
const dispatch = require('../notifications/dispatch');
const { authenticate } = require('../auth');
const { badRequest } = require('../errors');

const router = express.Router();

// ─── Subscriptions ───────────────────────────────────────────────────────────

const MAX_SUBSCRIPTIONS_PER_USER = 10;

function validateSubscription(body) {
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
  const p256dh = body.keys && typeof body.keys.p256dh === 'string' ? body.keys.p256dh : '';
  const auth = body.keys && typeof body.keys.auth === 'string' ? body.keys.auth : '';
  if (!/^https:\/\/[^\s]+$/.test(endpoint)) return null; // push services are https
  if (p256dh.length < 40 || p256dh.length > 400) return null;
  if (auth.length < 8 || auth.length > 400) return null;
  return {
    endpoint,
    p256dh,
    auth,
    userAgent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 250) : null,
  };
}

router.post('/notifications/subscriptions', authenticate, async (req, res, next) => {
  try {
    const sub = validateSubscription(req.body || {});
    if (!sub) return next(badRequest('Subscription invalide'));
    const { rowCount: existing } = await query(
      `SELECT 1 FROM push_subscriptions WHERE user_id = $1 AND revoked_at IS NULL`,
      [req.user.id]
    );
    if (existing >= MAX_SUBSCRIPTIONS_PER_USER) {
      return res.status(409).json({ error: 'Trop d\'appareils enregistrés pour les notifications' });
    }
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id,   -- a re-login on the same browser
             p256dh = EXCLUDED.p256dh,     -- re-binds the device to its owner
             auth = EXCLUDED.auth,
             user_agent = EXCLUDED.user_agent,
             last_seen_at = now(),
             revoked_at = NULL`,
      [req.user.id, sub.endpoint, sub.p256dh, sub.auth, sub.userAgent]
    );
    // Opportunistic, non-fatal drain after a new subscription appears.
    dispatch.dispatchDueNotifications({ limit: 10 }).catch(() => undefined);
    res.status(201).json({ success: true });
  } catch (err) { next(err); }
});

router.put('/notifications/subscriptions', authenticate, async (req, res, next) => {
  try {
    const sub = validateSubscription(req.body || {});
    if (!sub) return next(badRequest('Subscription invalide'));
    // Refresh: only the OWNER of the subscription may renew it.
    const { rows } = await query(
      `UPDATE push_subscriptions
          SET p256dh = $3, auth = $4, last_seen_at = now()
        WHERE endpoint = $2 AND user_id = $1 AND revoked_at IS NULL
        RETURNING id`,
      [req.user.id, sub.endpoint, sub.p256dh, sub.auth]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Subscription introuvable' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

/** Revoke by endpoint (body) or ALL own subscriptions (logout flow). */
router.delete('/notifications/subscriptions', authenticate, async (req, res, next) => {
  try {
    const endpoint = req.body && typeof req.body.endpoint === 'string' ? req.body.endpoint.trim() : null;
    if (endpoint) {
      await query(
        `UPDATE push_subscriptions SET revoked_at = now()
          WHERE endpoint = $2 AND user_id = $1 AND revoked_at IS NULL`,
        [req.user.id, endpoint]
      );
    } else {
      await query(
        `UPDATE push_subscriptions SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [req.user.id]
      );
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── In-app history ──────────────────────────────────────────────────────────

router.get('/notifications', authenticate, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const before = req.query.before ? parseInt(req.query.before, 10) : null;
    const params = [req.user.id];
    let where = `user_id = $1`;
    if (Number.isFinite(before) && before > 0) {
      params.push(before);
      where += ` AND id < $${params.length}`;
    }
    // `limit` is a clamped integer (never user-supplied text) — safe inline.
    const { rows } = await query(
      `SELECT id, category, event_type, title, body, url, read_at, created_at
         FROM notifications
        WHERE ${where}
        ORDER BY id DESC
        LIMIT ${limit}`,
      params
    );
    const { rows: unread } = await query(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({
      notifications: rows.map(toApi),
      unread: unread[0].n,
      hasMore: rows.length === limit,
    });
  } catch (err) { next(err); }
});

router.post('/notifications/read', authenticate, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids)
      ? req.body.ids.map((v) => parseInt(v, 10)).filter((v) => Number.isFinite(v)).slice(0, 200)
      : [];
    if (ids.length === 0) return next(badRequest('ids requis'));
    // Ownership-scoped: a user can only mark their OWN rows read.
    const { rowCount } = await query(
      `UPDATE notifications SET read_at = now()
        WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL`,
      [req.user.id, ids]
    );
    res.json({ success: true, updated: rowCount });
  } catch (err) { next(err); }
});

router.post('/notifications/read-all', authenticate, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({ success: true, updated: rowCount });
  } catch (err) { next(err); }
});

// ─── Preferences ─────────────────────────────────────────────────────────────

function readPrefs(row) {
  return {
    consultations: row ? row.consultations !== false : true,
    messages: row ? row.messages !== false : true,
    calls: row ? row.calls !== false : true,
    wallet: row ? row.wallet !== false : true,
  };
}

router.get('/notifications/preferences', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT consultations, messages, calls, wallet FROM notification_preferences WHERE user_id = $1`,
      [req.user.id]
    );
    res.json(readPrefs(rows[0]));
  } catch (err) { next(err); }
});

router.put('/notifications/preferences', authenticate, async (req, res, next) => {
  try {
    const body = req.body || {};
    const prefs = {};
    for (const key of ['consultations', 'messages', 'calls', 'wallet']) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'boolean') return next(badRequest(`${key} doit être un booléen`));
        prefs[key] = body[key];
      }
    }
    if (Object.keys(prefs).length === 0) return next(badRequest('Aucune préférence fournie'));
    const current = readPrefs((await query(
      `SELECT consultations, messages, calls, wallet FROM notification_preferences WHERE user_id = $1`,
      [req.user.id]
    )).rows[0]);
    const merged = { ...current, ...prefs };
    await query(
      `INSERT INTO notification_preferences (user_id, consultations, messages, calls, wallet, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (user_id) DO UPDATE
         SET consultations = EXCLUDED.consultations,
             messages = EXCLUDED.messages,
             calls = EXCLUDED.calls,
             wallet = EXCLUDED.wallet,
             updated_at = now()`,
      [req.user.id, merged.consultations, merged.messages, merged.calls, merged.wallet]
    );
    res.json(merged);
  } catch (err) { next(err); }
});

// ─── Client bootstrap ────────────────────────────────────────────────────────

router.get('/notifications/vapid-public-key', authenticate, (req, res) => {
  res.json({ publicKey: push.publicKey(), configured: push.isConfigured() });
});

function toApi(row) {
  return {
    id: Number(row.id),
    category: row.category,
    event_type: row.event_type,
    title: row.title,
    body: row.body,
    url: row.url ?? null,
    read: row.read_at !== null,
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
  };
}

module.exports = router;
