/**
 * Web Push sender (issue #36) — VAPID-only, server-side keys.
 *
 *  - Private VAPID keys stay server-side (VAPID_PRIVATE_KEY); the public key
 *    is served to authenticated clients via GET /api/notifications/vapid-public-key.
 *  - web-push never logs payloads; the payloads here are already generic.
 *  - When VAPID is not configured the sender reports { configured: false }
 *    and the dispatcher leaves rows queued (feature safely disabled — in-app
 *    notifications keep working; documented rollout switch).
 */
'use strict';

const webpush = require('web-push');

/** VAPID configuration, read from the environment on EVERY call (no module
 *  caching) so keys can be rotated without a redeploy — and so any test or
 *  tooling that mutates the env is always consistent with the sender. */
function vapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@medika.ht';
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

function isConfigured() {
  return vapidConfig() !== null;
}

function publicKey() {
  return vapidConfig()?.publicKey ?? null;
}

/**
 * Send one push to one subscription. Returns a classified outcome:
 *  - { ok: true }                       — accepted by the push service
 *  - { ok: false, kind: 'gone' }        — 404/410: subscription expired → revoke
 *  - { ok: false, kind: 'retryable' }   — 429/5xx/network: back off and retry
 *  - { ok: false, kind: 'permanent' }   — other 4xx: dead (bad payload/request)
 * Never throws.
 */
async function sendToOne(subscription, payload) {
  const cfg = vapidConfig();
  if (!cfg) return { ok: false, kind: 'unconfigured' };
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
      { TTL: 24 * 3600 }
    );
    return { ok: true };
  } catch (err) {
    const status = err && typeof err.statusCode === 'number' ? err.statusCode : 0;
    if (status === 404 || status === 410) return { ok: false, kind: 'gone', status };
    if (status === 0 || status === 429 || status >= 500) return { ok: false, kind: 'retryable', status };
    return { ok: false, kind: 'permanent', status };
  }
}

module.exports = { isConfigured, publicKey, sendToOne };
