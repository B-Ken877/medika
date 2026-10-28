/**
 * Scheduled deadline-processor endpoint (issue #25).
 *
 *   GET/POST /api/crons/consultation-deadlines
 *
 * Processes every due consultation deadline (offer timeouts + rerouting,
 * waiting-state retries, five-hour expirations) and materializes pending
 * wallet earnings. Fully idempotent and concurrency-safe, so any scheduler
 * cadence — and duplicate or overlapping runs — is harmless.
 *
 * Durable triggering (all optional; opportunistic enforcement on
 * consultation reads keeps state correct even with none of them):
 *   * GitHub Actions workflow (.github/workflows/consultation-deadlines.yml)
 *     every 10 minutes with `Authorization: Bearer <CRON_SECRET>`;
 *   * an optional Vercel cron entry for the same path (see the PR notes —
 *     minute-level cron schedules require a Vercel Pro plan, so it is not
 *     added to vercel.json by default);
 *   * manual admin runs.
 *
 * Authorization (fail-closed):
 *   * CRON_SECRET set → `Authorization: Bearer <CRON_SECRET>` (what Vercel
 *     cron and the workflow send) or a valid admin JWT;
 *   * CRON_SECRET unset → Vercel's `x-vercel-cron` request marker or a
 *     valid admin JWT. The endpoint mutates only already-due items
 *     idempotently and exposes only aggregate counts, but configuring
 *     CRON_SECRET remains the recommended production posture.
 */
'use strict';

const express = require('express');
const lifecycle = require('../consultation-lifecycle');
const walletRepo = require('../repos/wallet');
const dispatch = require('../notifications/dispatch');
const { authenticateAdmin } = require('../auth');

const router = express.Router();

/**
 * CRON_SECRET is read at REQUEST time (not boot time) so operators can
 * rotate it without a redeploy, and so the value is a single source of
 * truth (the environment) for both the API and the scheduled caller.
 */
function currentCronSecret() {
  const v = process.env.CRON_SECRET;
  return v === undefined || v === '' ? '' : v;
}

function authorizeCron(req, res, next) {
  const authz = String(req.headers.authorization || '');
  const secret = currentCronSecret();
  if (secret) {
    if (authz === `Bearer ${secret}`) return next();
    // Fall through to the admin check so an admin can also trigger a run.
    return authenticateAdmin(req, res, next);
  }
  const marker = String(req.headers['x-vercel-cron'] || '').toLowerCase();
  if (marker === '1' || marker === 'true') return next();
  return authenticateAdmin(req, res, next);
}

async function processDeadlines(req, res, next) {
  try {
    const processed = await lifecycle.processDueDeadlines({ hub: req.app.locals.hub });
    let earningsMaterialized = 0;
    try {
      earningsMaterialized = await walletRepo.materializeEarnings();
    } catch (err) {
      console.error('[cron] earning materialization failed:', err.code || err.message);
    }
    res.json({
      ok: true,
      processed,
      earningsMaterialized,
      ranAt: new Date().toISOString(),
    });
  } catch (err) { next(err); }
}

// Vercel cron jobs issue GET requests; POST is kept for manual/operator use.
router.get('/crons/consultation-deadlines', authorizeCron, processDeadlines);
router.post('/crons/consultation-deadlines', authorizeCron, processDeadlines);

/**
 * GET/POST /api/crons/notification-dispatch (issue #36) — drain the due
 * notification outbox (idempotent, concurrency-safe; duplicate runs are
 * harmless). Same fail-closed authorization as the deadlines cron. Aggregate
 * counts only in the response — never payloads or recipient data.
 */
async function processNotifications(req, res, next) {
  try {
    const counts = await dispatch.dispatchDueNotifications({ limit: 50 });
    res.json({ ok: true, counts, ranAt: new Date().toISOString() });
  } catch (err) { next(err); }
}
router.get('/crons/notification-dispatch', authorizeCron, processNotifications);
router.post('/crons/notification-dispatch', authorizeCron, processNotifications);

module.exports = router;
