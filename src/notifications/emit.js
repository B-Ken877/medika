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
  'consultation:expiry-reminder': 'consultations',
  'consultation:completed': 'consultations',
  'consultation:rerouted': 'consultations',
  'message:new': 'messages',
  'call:incoming': 'calls',
  'wallet:earnings': 'wallet',
  'payout:paid': 'wallet',
  // Medication order REQUESTED (patient asked Medika to source a prescription):
  // the actionable party is the ops/admin team, who must prepare a pharmacy
  // quote. Grouped under 'consultations' like the other medication events
  // (the DB CHECK in migration 007 has no 'orders' category).
  'medication:order-submitted': 'consultations',
  // Issue #83: medication-order quote ready for the patient's review. Grouped
  // under the 'consultations' category (the DB CHECK in migration 007 has no
  // 'orders' category; the deep link opens the consultation's document view).
  'medication:quoted': 'consultations',
  'medication:paid': 'consultations',
  'medication:payment-review': 'consultations',
  // Issue #82 delivery scope: assignment/scheduling and live custody updates
  // for the patient. Same 'consultations' grouping as the other medication
  // events; bodies are generic French copy without any medical data.
  'medication:delivery-assigned': 'consultations',
  'medication:delivery-update': 'consultations',
};

const CATEGORIES = ['consultations', 'messages', 'calls', 'wallet'];

/**
 * Emit one notification. Idempotent per idempotencyKey: a second call with
 * the same key is a no-op (both the in-app row and the outbox row).
 * `push: false` records the in-app row but queues the outbox row as
 * already-suppressed — used ONLY where a live channel provably replaces the
 * push (incoming call rings app-wide while connected); chat messages never
 * use it (see pushDelaySeconds below). Failures are logged by category only
 * and swallowed.
 *
 * `pushDelaySeconds` (read-aware suppression, owner request): queues the
 * outbox row as normal but defers its FIRST dispatch attempt — the row only
 * becomes due after the grace window. Used for message:new rows emitted
 * while the recipient is actively viewing the EXACT conversation: if their
 * read receipt lands within the window, the read route marks the queued row
 * suppressed (read_in_conversation) and no redundant push is sent; if the
 * message remains unread, the row dispatches normally (unread messages are
 * never silently lost). The dispatcher already claims only rows with
 * next_attempt_at <= now(), so no dispatcher change is needed.
 */
async function emit({ userId, eventType, idempotencyKey, title, body, url = null, push = true, pushDelaySeconds = 0 }) {
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
    const delay = Number.isFinite(pushDelaySeconds) && pushDelaySeconds > 0
      ? Math.min(Math.floor(pushDelaySeconds), 600)
      : 0;
    if (push) {
      if (delay > 0) {
        await query(
          `INSERT INTO notification_outbox
             (user_id, category, event_type, idempotency_key, title, body, url, next_attempt_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8))
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [userId, category, eventType, idempotencyKey, title, body, url, delay]
        );
      } else {
        await query(
          `INSERT INTO notification_outbox
             (user_id, category, event_type, idempotency_key, title, body, url)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [userId, category, eventType, idempotencyKey, title, body, url]
        );
      }
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
  // Patient + doctor: ONE gentle reminder before the 5-hour expiry
  // (issue #71). Calm copy — no urgency language, no countdown; the
  // conversation simply closes on its own at the deadline and history stays.
  consultationExpiryReminder: {
    title: 'Medika',
    body: 'Piti piti: konsiltasyon sa a ap disponib pou kèk lè ankò. Tanpri fin echanj sa ki enpòtan yo — istorik la ap konsève.',
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
  // Admin ops: a patient asked Medika to source a prescription (order
  // REQUESTED). Generic French copy — no medication name, no patient data;
  // the deep link opens the ops panel after authentication.
  medicationOrderSubmitted: {
    title: 'Medika',
    body: 'Une nouvelle demande de médicaments attend un devis. Ouvrez le panneau ops.',
    url: '/admin/medicaments',
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
