-- 007 — Push notification system (issue #36).
--
-- Components:
--   * push_subscriptions — Web Push endpoints per user (multi-device),
--     ownership-enforced; revocable; expired subscriptions detected by the
--     dispatcher (404/410) are revoked, never retried forever.
--   * notification_outbox — durable outbox: the business transaction commits
--     independently of push delivery; a worker drains due rows with bounded
--     retries + exponential backoff and explicit terminal states. Stable
--     idempotency keys (derived from authoritative records) make duplicate
--     emissions and duplicate runs harmless.
--   * notifications — persisted in-app history (unread/read state,
--     pagination, retention); one business event has ONE coherent record
--     shared by the in-app center and the push channel.
--   * notification_preferences — per-user category opt-outs. Preferences
--     suppress DELIVERY at dispatch time (rows already in the outbox respect
--     later changes); business events and in-app records are unaffected.
--
-- Privacy: payload columns store ONLY privacy-safe generic titles/bodies.
-- Message text, symptoms, diagnoses, prescriptions and other medical data
-- are NEVER written here.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,      -- the push service URL
  p256dh        TEXT NOT NULL,             -- client public key
  auth          TEXT NOT NULL,             -- client auth secret
  user_agent    TEXT,                      -- minimal device metadata
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ                -- NULL = active
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_outbox (
  id               BIGSERIAL PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category         TEXT NOT NULL CHECK (category IN
                     ('consultations', 'messages', 'calls', 'wallet')),
  event_type       TEXT NOT NULL,           -- e.g. 'message:new', 'offer:new'
  idempotency_key  TEXT NOT NULL UNIQUE,    -- stable, record-derived
  title            TEXT NOT NULL,           -- privacy-safe generic copy
  body             TEXT NOT NULL,           -- privacy-safe generic copy
  url              TEXT,                    -- same-origin deep link
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
                     ('queued', 'processing', 'delivered', 'suppressed',
                      'retryable', 'revoked', 'dead')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_code  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbox_due
  ON notification_outbox (next_attempt_at)
  WHERE status IN ('queued', 'retryable');

CREATE TABLE IF NOT EXISTS notifications (
  id              BIGSERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  url             TEXT,
  read_at         TIMESTAMPTZ,             -- NULL = unread
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, id DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  consultations BOOLEAN NOT NULL DEFAULT TRUE,
  messages      BOOLEAN NOT NULL DEFAULT TRUE,
  calls         BOOLEAN NOT NULL DEFAULT TRUE,
  wallet        BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
