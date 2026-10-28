/**
 * Outbox dispatcher (issue #36) — idempotent worker with bounded retries.
 *
 *  - Claims due rows atomically (UPDATE ... WHERE id IN (SELECT ... FOR UPDATE
 *    SKIP LOCKED)) so concurrent workers / duplicate cron runs never
 *    double-send.
 *  - Push policy applied AT DISPATCH TIME: category preferences and active
 *    subscriptions are read when the row is processed, so a preference change
 *    immediately affects already-queued rows.
 *  - Error classification (from push.js): 404/410 revokes the subscription
 *    (never retried forever); 429/5xx/network → retryable with exponential
 *    backoff; other 4xx → dead. Exhausted attempts → dead (dead-letter).
 *  - "delivered" means ACCEPTED BY THE PUSH SERVICE — not proof the device
 *    displayed anything (documented; the in-app record is the source of truth
 *    for what happened).
 *  - VAPID unconfigured → no-op (rows stay queued; in-app unaffected).
 *
 * Triggered by GET/POST /api/crons/notification-dispatch (same authorization
 * pattern as the deadlines cron) and opportunistically after emits are
 * drained — never inline with a business response.
 */
'use strict';

const { query } = require('../db');
const push = require('./push');

const MAX_ATTEMPTS = 6;

/** Exponential backoff schedule (seconds) per attempt number. */
const BACKOFF_SECONDS = [0, 60, 5 * 60, 15 * 60, 60 * 60, 6 * 60 * 60];

/** Process due outbox rows. Returns aggregate counts (never payloads). */
async function dispatchDueNotifications({ limit = 25 } = {}) {
  const counts = { claimed: 0, delivered: 0, suppressed: 0, retryable: 0, revoked: 0, dead: 0, failed: 0 };

  if (!push.isConfigured()) {
    return { ...counts, unconfigured: true };
  }

  // Atomic claim: marked processing under the row lock, skipped by rivals.
  const claimed = await query(
    `UPDATE notification_outbox SET status = 'processing', updated_at = now()
      WHERE id IN (
        SELECT id FROM notification_outbox
         WHERE status IN ('queued', 'retryable')
           AND next_attempt_at <= now()
         ORDER BY id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, user_id, category, title, body, url, attempts`,
    [limit]
  );
  counts.claimed = claimed.rows.length;

  for (const row of claimed.rows) {
    try {
      const outcome = await processRow(row);
      counts[outcome] = (counts[outcome] || 0) + 1;
    } catch (err) {
      counts.failed += 1;
      // Release the row for a later run — never leave it stuck in processing.
      await query(
        `UPDATE notification_outbox
            SET status = 'queued', attempts = attempts + 1,
                next_attempt_at = now() + make_interval(secs => $2),
                last_error_code = 'worker', updated_at = now()
          WHERE id = $1`,
        [row.id, BACKOFF_SECONDS[Math.min(row.attempts + 1, BACKOFF_SECONDS.length - 1)] || 3600]
      ).catch(() => undefined);
      console.error('[notifications] dispatch row failed:', err.code || err.constructor?.name);
    }
  }
  return counts;
}

/** One claimed row → terminal/retryable state transition. */
async function processRow(row) {
  // 1. Category preference (read at dispatch time by design).
  const pref = await query(
    `SELECT consultations, messages, calls, wallet FROM notification_preferences WHERE user_id = $1`,
    [row.user_id]
  );
  const prefs = pref.rows[0] || { consultations: true, messages: true, calls: true, wallet: true };
  if (prefs[row.category] === false) {
    await finish(row.id, 'suppressed', 'preference_off');
    return 'suppressed';
  }

  // 2. Active subscriptions for this user.
  const subs = await query(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [row.user_id]
  );
  if (subs.rows.length === 0) {
    await finish(row.id, 'suppressed', 'no_subscriptions');
    return 'suppressed';
  }

  // 3. Privacy-safe payload: generic copy + opaque deep link only.
  const payload = { title: row.title, body: row.body, url: row.url, tag: `medika:${row.category}` };

  let delivered = false;
  let anyGone = false;
  let lastRetryable = false;
  let lastPermanent = false;

  for (const sub of subs.rows) {
    const result = await push.sendToOne(sub, payload);
    if (result.ok) {
      delivered = true;
    } else if (result.kind === 'gone') {
      anyGone = true;
      // Revoke the dead subscription (bounded: never retried forever).
      await query(
        `UPDATE push_subscriptions SET revoked_at = now(), last_seen_at = now() WHERE id = $1 AND revoked_at IS NULL`,
        [sub.id]
      ).catch(() => undefined);
    } else if (result.kind === 'retryable') {
      lastRetryable = true;
    } else if (result.kind === 'permanent') {
      lastPermanent = true;
    }
  }

  if (delivered) {
    await finish(row.id, 'delivered', null);
    return 'delivered';
  }
  if (anyGone && !lastRetryable) {
    // Every subscription was expired → nothing left to deliver to.
    await finish(row.id, 'revoked', 'subscriptions_gone');
    return 'revoked';
  }
  if (lastRetryable || anyGone) {
    return await retryOrFail(row, 'retryable', 'push_retryable');
  }
  return await retryOrFail(row, 'dead', lastPermanent ? `push_${'permanent'}` : 'push_failed');
}

async function retryOrFail(row, retryableStatus, errorCode) {
  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await finish(row.id, 'dead', errorCode); // dead-letter after bounded retries
    return 'dead';
  }
  const backoff = BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)] || 3600;
  await query(
    `UPDATE notification_outbox
        SET status = $2, attempts = $3, last_error_code = $4,
            next_attempt_at = now() + make_interval(secs => $5), updated_at = now()
      WHERE id = $1`,
    [row.id, retryableStatus, attempts, errorCode, backoff]
  );
  return retryableStatus;
}

async function finish(id, status, errorCode) {
  await query(
    `UPDATE notification_outbox
        SET status = $2, attempts = attempts + 1, last_error_code = $3, updated_at = now()
      WHERE id = $1`,
    [id, status, errorCode]
  );
}

/** Active subscription count per user (for tests/observability). */
async function activeSubscriptionCount(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
  return rows[0].n;
}

module.exports = { dispatchDueNotifications, activeSubscriptionCount, MAX_ATTEMPTS };
