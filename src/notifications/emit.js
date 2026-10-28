/**
 * Notification emission (issue #36) — the single write path for every
 * notification-producing business transition.
 *
 * Design (from the issue):
 *  - ONE business event → ONE coherent record: the in-app history row and
 *    the outbox row share the same stable idempotency_key (derived from the
 *    authoritative record, never random per retry), so duplicate emissions,
 *    duplicate scheduler runs and concurrent workers are all harmless.
 *  - The business transaction commits independently: emit() is fire-and-
 *    forget for the caller and NEVER throws — a notification failure can
 *    not break consultation creation, payment, chat persistence or wallet
 *    transitions.
 *  - Privacy: titles/bodies are GENERIC Haitian Creole copy. Message text,
 *    symptoms, diagnoses, prescriptions, patient names and any medical data
 *    are never written to notification tables. Details are fetched only
 *    after the user opens Medika and passes normal authorization.
 *  - Push POLICY (who gets a push at all) is applied at DISPATCH time:
 *    category preferences and active subscriptions are read when the worker
 *    runs, so a preference change immediately affects already-queued rows.
 *
 * Events that must NEVER reach this module (enforced by the wiring, asserted
 * by tests): typing, recording activity, presence, read receipts, reconnects,
 * polling and uncommitted/failed transitions.
 */
'use strict';

const { query } = require('../db');

const CATEGORY_FOR_EVENT = {
  'consultation:submitted': 'consultations',
  'consultation:offer': 'consultations',
  'consultation:accepted': 'consultations',
  'consultation:rejected': 'consultations',
  'consultation:expired': 'consultations',
  'consultation:completed': 'consultations',
  'consultation:rerouted': 'consultations',
  'message:new': 'messages',
  'call:incoming': 'calls',
  'wallet:earnings': 'wallet',
  'payout:paid': 'wallet',
};

const CATEGORIES = ['consultations', 'messages', 'calls', 'wallet'];

/**
 * Emit one notification. Idempotent per idempotencyKey: a second call with
 * the same key is a no-op (both the in-app row and the outbox row).
 * `push: false` (active-conversation suppression) still records the in-app
 * row but queues the outbox row as already-suppressed — used when the
 * recipient is CONNECTED and received the live WS delivery, so push is not
 * spammy for a user who is actively in the app (any connected device counts;
 * documented trade-off — they still get the live message + in-app unread).
 * Failures are logged by category only and swallowed.
 */
async function emit({ userId, eventType, idempotencyKey, title, body, url = null, push = true }) {
  try {
    const category = CATEGORY_FOR_EVENT[eventType];
    if (!category || !userId || !idempotencyKey || !title || !body) return;

    // In-app history (always recorded, regardless of push preferences —
    // documented policy: preferences suppress DELIVERY, not the record).
    await query(
      `INSERT INTO notifications
         (user_id, category, event_type, idempotency_key, title, body, url)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [userId, category, eventType, idempotencyKey, title, body, url]
    );

    // Durable outbox (drained by the dispatcher; push policy applied there).
    // Active-conversation suppression is recorded as a terminal state so the
    // outbox stays a coherent mirror of the in-app history.
    if (push) {
      await query(
        `INSERT INTO notification_outbox
           (user_id, category, event_type, idempotency_key, title, body, url)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [userId, category, eventType, idempotencyKey, title, body, url]
      );
    } else {
      await query(
        `INSERT INTO notification_outbox
           (user_id, category, event_type, idempotency_key, title, body, url,
            status, attempts, last_error_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'suppressed',1,'recipient_online')
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [userId, category, eventType, idempotencyKey, title, body, url]
      );
    }
  } catch (err) {
    // Category only — never payload (notification copy is safe, but be
    // consistent with the operational logging rules).
    console.error('[notifications] emit failed:', eventType, err.code || err.constructor?.name);
  }
}

// ─── Privacy-safe copy (Haitian Creole, generic — no medical data) ──────────

const COPY = {
  // Patient: request submitted / waiting.
  consultationSubmitted: {
    title: 'Medika',
    body: 'Demann konsiltasyon ou a anrejistre. N ap fè w konnen le yon doktè aksepte l.',
    url: '/app/consultations',
  },
  // Doctor: a consultation offer was committed to THEM (safe deep link,
  // deadline communicated in-app after authentication — never patient data).
  consultationOffer: {
    title: 'Medika',
    body: 'Ou gen yon nouvo demann konsiltasyon. Tanpri, gade l rapidman.',
    url: '/app',
  },
  // Patient: doctor accepted.
  consultationAccepted: {
    title: 'Medika',
    body: 'Yon doktè aksepte demann ou a. Konsiltasyon an kòmanse.',
    url: '/app/consultations',
  },
  // Patient: request refused.
  consultationRejected: {
    title: 'Medika',
    body: 'Ou gen yon mizajou sou demann konsiltasyon ou a.',
    url: '/app/consultations',
  },
  // Patient: consultation expired (5h).
  consultationExpired: {
    title: 'Medika',
    body: 'Ou gen yon mizajou sou konsiltasyon ou a.',
    url: '/app/consultations',
  },
  // Patient + doctor: completed.
  consultationCompleted: {
    title: 'Medika',
    body: 'Yon konsiltasyon fini. Gade rezime a nan Medika.',
    url: '/app/consultations',
  },
  // Recipient: a new chat message arrived (persisted; no body content).
  messageNew: {
    title: 'Medika',
    body: 'Ou gen yon nouvo mesaj sou Medika.',
    url: '/app/consultations',
  },
  // Recipient: incoming call (urgent).
  callIncoming: {
    title: 'Medika',
    body: 'Ou gen yon apèl ki ap rantre sou Medika.',
    url: '/app/consultations',
  },
  // Doctor: earnings became available.
  walletEarnings: {
    title: 'Medika',
    body: 'Ou gen yon nouvo mizajou sou revni ou sou Medika.',
    url: '/app/wallet',
  },
  // Doctor: admin recorded a payout as paid.
  payoutPaid: {
    title: 'Medika',
    body: 'Ou gen yon mizajou sou peman ou sou Medika.',
    url: '/app/wallet',
  },
};

module.exports = { emit, CATEGORIES, CATEGORY_FOR_EVENT, COPY };
