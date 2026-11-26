-- 018: Agent roster visibility + call-routing hardening.
--
-- Two owner goals:
--   1. ADMIN VISIBILITY — the admin panel's agent roster must show, LIVE
--      (same realtime layer as the payment popup), each agent's presence
--      state, current call (member name, phone, step in the intake state
--      machine), calls handled today and last activity. The server — not the
--      browser — owns the truth: the wizard step is persisted on the session
--      row on every transition, so the roster is truthful even when an
--      agent's browser dies mid-call.
--   2. ROUTING HARDENING — single ownership (a call can only ever be claimed
--      by one agent), a truthful pending-queue position, immediate
--      auto-dispatch when an agent frees up, and no orphan sessions: stuck
--      pre-payment sessions, agent-crash victims and abandoned requests are
--      swept server-side. Consultation creation stays strictly gated on
--      payment confirmation (migration 017 contract — untouched here).
--
-- Conventions follow 015/017: CHECK constraints for state machines, partial
-- unique indexes as concurrency referees.

-- ─── Presence gains an explicit DISCONNECTED state ──────────────────────────
-- The stale-heartbeat sweep previously dropped agents straight to 'offline'.
-- The roster must tell the two cases apart: a person who logged off
-- ('offline') and a browser that DIED mid-work ('disconnected', red — with
-- their call marked for cleanup). Heartbeat restore flips it back based on
-- the live session (busy) / active shift (available) — server-side only.
ALTER TABLE agent_presence DROP CONSTRAINT IF EXISTS agent_presence_availability_check;
ALTER TABLE agent_presence ADD CONSTRAINT agent_presence_availability_check
  CHECK (availability IN ('available','busy','on_break','offline','wrapping_up','technical_issue','disconnected'));

-- Last ACTIVITY distinct from last heartbeat: upserts that change a state
-- (available → busy → wrapping_up → available, …) stamp last_transition_at;
-- the periodic heartbeat only refreshes last_heartbeat. The roster shows both.
ALTER TABLE agent_presence ADD COLUMN IF NOT EXISTS last_transition_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ─── Session: the server-written intake stage (the roster's step column) ────
-- The wizard's step was previously DERIVED client-side from field presence.
-- Persisting it server-side on every transition means:
--   * the admin roster shows the member's exact step in the intake state
--     machine (form → doctor → payment → booked, wrapup when the call ends);
--   * the audit can prove no dead-end states: every stage is written by the
--     authoritative transition, never by the browser.
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS intake_stage TEXT NOT NULL DEFAULT 'form'
  CHECK (intake_stage IN ('form','doctor','payment','booked','wrapup'));

-- ─── Session: crash-cleanup marker ──────────────────────────────────────────
-- When an agent's heartbeat goes stale while they hold an ACTIVE session, the
-- sweep stamps cleanup_due_at = now() + grace (AGENT_DISCONNECT_GRACE_SECONDS)
-- instead of killing the call instantly — a flaky network must not drop a
-- live member. If the heartbeat does not resume before the deadline, the
-- orphan sweep re-queues the session for another agent. NULL = healthy.
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS cleanup_due_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_agent_sessions_cleanup
  ON agent_sessions (cleanup_due_at) WHERE cleanup_due_at IS NOT NULL;

-- ─── SINGLE OWNERSHIP referee: one ACTIVE session per agent ─────────────────
-- The accept path is already a conditional UPDATE on the offer, but the
-- session activation that follows it was unconditional — two browser tabs of
-- the same agent accepting two different offers could interleave between the
-- two writes and produce TWO active calls. This partial unique index makes
-- double-ownership impossible at the storage layer; the lifecycle maps the
-- violation to a typed already_in_session rejection and re-routes the loser.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_session_agent_active
  ON agent_sessions (agent_id)
  WHERE status = 'active' AND agent_id IS NOT NULL;
