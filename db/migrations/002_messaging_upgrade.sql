-- Medika migration 002 — messaging upgrade: read receipts + private attachments.
-- Sequential after 001_init.sql (the runner applies files in name order and
-- records each filename in schema_migrations). Every statement is idempotent
-- so an accidental re-apply can never corrupt state.

-- ─── Read receipts ──────────────────────────────────────────────────────────
-- Consultations are strictly one-patient / one-doctor, so a message has at
-- most ONE recipient: a nullable, timezone-aware read timestamp on the
-- message row carries the full receipt state without a second table (a
-- separate receipts table would add a join without adding information).
-- NULL = unread. Only the counterpart (never 'system', never the sender)
-- is ever marked by the mark-read endpoint.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON messages (consultation_id, id)
  WHERE read_at IS NULL AND sender_id <> 'system';

-- ─── Private consultation attachments ───────────────────────────────────────
-- Registry for consultation-scoped medical media stored PRIVATELY (Vercel
-- Blob access:'private', or an opaque disk file in local development).
-- The message row stores only the opaque API path
-- /api/consultations/{cid}/attachments/{aid} in file_url; the blob pathname
-- never reaches the client. Access is re-authorized per signed-URL request.
CREATE TABLE IF NOT EXISTS consultation_attachments (
  id              TEXT PRIMARY KEY,
  consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  uploader_id     TEXT NOT NULL,
  storage         TEXT NOT NULL DEFAULT 'blob',        -- 'blob' | 'local'
  blob_pathname   TEXT NOT NULL,                       -- opaque storage key (never public)
  filename        TEXT NOT NULL,                       -- display name (sanitized)
  mimetype        TEXT NOT NULL,                       -- server-validated content type
  size            BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attachments_consultation
  ON consultation_attachments (consultation_id, created_at DESC);
