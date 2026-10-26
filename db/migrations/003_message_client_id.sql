-- Medika migration 003 — durable message delivery: client correlation id.
-- Sequential after 002_messaging_upgrade.sql (the runner applies files in
-- name order and records each filename in schema_migrations). Every statement
-- is idempotent so an accidental re-apply can never corrupt state.
--
-- Purpose: retries of the SAME logical send (WebSocket frame lost after the
-- server persisted it, then a REST fallback or user retry) must never create
-- duplicate message rows. The client-generated id is scoped per SENDER, so
-- two users generating the same UUID cannot collide. NULL (legacy clients,
-- system messages) is excluded from the uniqueness index and behaves exactly
-- as before.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_msg_id TEXT;

-- One persisted row per (sender, clientMsgId). Partial index keeps legacy
-- NULL rows conflict-free.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_client_msg_id
  ON messages (sender_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;
