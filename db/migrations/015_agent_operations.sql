-- 015: Human agent operations — consultation scheduling assistance.
--
-- A real contact-center layer: agent profiles/shifts/presence, assistance
-- sessions with an authoritative backend queue, targeted agent assignments
-- (offer/accept/expire), callback requests with retry policy, call attempts,
-- session events (audit) and agent notes.
--
-- Conventions follow 013 (delivery operations): FKs to users(id), CHECK
-- constraints for state machines, partial unique indexes as concurrency
-- referees, ON DELETE SET NULL / CASCADE as appropriate.

-- ─── Agent roles: 'agent' + 'agent_supervisor' join the user roles ─────────
-- Follows the 013 pattern (role CHECK extension; public registration stays
-- patient-only — agent accounts are authorized by an administrator, brief #4).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('patient', 'doctor', 'admin', 'delivery', 'agent', 'agent_supervisor'));

-- ─── Agent profiles (extends the authenticated user, never replaces it) ────
CREATE TABLE IF NOT EXISTS agent_profiles (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_ref  TEXT UNIQUE,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended','inactive')),
  interface_language TEXT NOT NULL DEFAULT 'ht',
  supervisor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Shifts: the working period (independent of any patient session) ───────
CREATE TABLE IF NOT EXISTS agent_shifts (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_start TIMESTAMPTZ,
  scheduled_end   TIMESTAMPTZ,
  actual_start    TIMESTAMPTZ,
  actual_end      TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','on_break','ending','completed','missed','cancelled')),
  supervisor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most ONE active/on_break shift per agent (the concurrency referee).
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_shift_active
  ON agent_shifts (agent_id) WHERE status IN ('active','on_break','ending');

CREATE TABLE IF NOT EXISTS agent_shift_breaks (
  id         TEXT PRIMARY KEY,
  shift_id   TEXT NOT NULL REFERENCES agent_shifts(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ
);
-- One open break per shift at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_break_open
  ON agent_shift_breaks (shift_id) WHERE ended_at IS NULL;

-- ─── Presence: realtime routing state + heartbeat ──────────────────────────
CREATE TABLE IF NOT EXISTS agent_presence (
  agent_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  availability     TEXT NOT NULL DEFAULT 'offline'
                   CHECK (availability IN ('available','busy','on_break','offline','wrapping_up','technical_issue')),
  last_heartbeat   TIMESTAMPTZ NOT NULL DEFAULT now(),
  connection_state TEXT NOT NULL DEFAULT 'disconnected'
                   CHECK (connection_state IN ('connected','reconnecting','disconnected')),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Assistance sessions (the patient interaction record) ──────────────────
CREATE TABLE IF NOT EXISTS agent_sessions (
  id              TEXT PRIMARY KEY,
  patient_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting','offered','active','wrap_up','completed','cancelled')),
  source          TEXT NOT NULL DEFAULT 'in_app'
                  CHECK (source IN ('in_app','callback')),
  language        TEXT NOT NULL DEFAULT 'ht',
  -- Non-clinical scheduling context captured by the agent (what the patient
  -- asked for — never a diagnosis).
  reason          TEXT NOT NULL DEFAULT '',
  specialty       TEXT,
  chosen_doctor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  consultation_id TEXT REFERENCES consultations(id) ON DELETE SET NULL,
  callback_id     TEXT,
  -- Structured wrap-up outcome (see brief #15).
  outcome         TEXT
                  CHECK (outcome IS NULL OR outcome IN (
                    'consultation_initiated','payment_pending','consultation_booked',
                    'callback_required','no_doctor_available','information_provided',
                    'patient_cancelled','patient_disconnected','transferred',
                    'escalated','unresolved')),
  outcome_note    TEXT NOT NULL DEFAULT '',
  route_attempts  INT  NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ,
  call_started_at TIMESTAMPTZ,
  call_ended_at   TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Idempotency referee: a patient has at most ONE live assistance session.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_session_live
  ON agent_sessions (patient_id)
  WHERE status IN ('waiting','offered','active','wrap_up');

CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent
  ON agent_sessions (agent_id, status) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status
  ON agent_sessions (status, created_at);

-- ─── Queue entries (FIFO ordering; one per waiting session) ────────────────
CREATE TABLE IF NOT EXISTS agent_queue_entries (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL UNIQUE REFERENCES agent_sessions(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'waiting'
               CHECK (status IN ('waiting','assigned','cancelled','serviced')),
  position     BIGINT NOT NULL,
  enqueued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_queue_fifo
  ON agent_queue_entries (status, position) WHERE status = 'waiting';

-- ─── Assignments: targeted offers with timeout (no broadcast) ──────────────
CREATE TABLE IF NOT EXISTS agent_assignments (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  agent_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'offered'
               CHECK (status IN ('offered','accepted','expired','declined')),
  offered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL
);
-- A live session can have at most one OPEN offer at any instant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_assignment_open
  ON agent_assignments (session_id) WHERE status = 'offered';
-- An agent can hold at most one OPEN offer (no stacking).
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_assignment_agent_open
  ON agent_assignments (agent_id) WHERE status = 'offered';
CREATE INDEX IF NOT EXISTS idx_agent_assignments_expiry
  ON agent_assignments (status, expires_at) WHERE status = 'offered';

-- ─── Callback requests ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_callback_requests (
  id             TEXT PRIMARY KEY,
  patient_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id     TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
  phone_number   TEXT NOT NULL,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  window_start   TIMESTAMPTZ,
  window_end     TIMESTAMPTZ,
  language       TEXT NOT NULL DEFAULT 'ht',
  reason         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'requested'
                 CHECK (status IN ('requested','scheduled','due','assigned','attempting',
                                   'connected','no_answer','rescheduled','cancelled','completed','failed')),
  assigned_agent_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  retry_count    INT NOT NULL DEFAULT 0,
  max_retries    INT NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most ONE open callback per patient (repeated clicks are idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_callback_open
  ON agent_callback_requests (patient_id)
  WHERE status NOT IN ('completed','cancelled','failed');
CREATE INDEX IF NOT EXISTS idx_agent_callback_due
  ON agent_callback_requests (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS agent_callback_attempts (
  id          TEXT PRIMARY KEY,
  callback_id TEXT NOT NULL REFERENCES agent_callback_requests(id) ON DELETE CASCADE,
  agent_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  result      TEXT NOT NULL
              CHECK (result IN ('connected','no_answer','failed','cancelled')),
  note        TEXT NOT NULL DEFAULT '',
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_callback_attempts
  ON agent_callback_attempts (callback_id, attempted_at);

-- ─── In-app call attempts (voice transport history per session) ────────────
CREATE TABLE IF NOT EXISTS agent_call_attempts (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL DEFAULT 'in_app_audio'
              CHECK (channel IN ('in_app_audio','telephone')),
  provider_ref TEXT NOT NULL DEFAULT '',
  state       TEXT NOT NULL DEFAULT 'started'
              CHECK (state IN ('started','connected','failed','ended')),
  failure_reason TEXT NOT NULL DEFAULT '',
  started_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_call_attempts
  ON agent_call_attempts (session_id, started_at);

-- ─── Session events (server-side audit trail) ──────────────────────────────
CREATE TABLE IF NOT EXISTS agent_session_events (
  id         BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_session_events
  ON agent_session_events (session_id, created_at);

-- ─── Agent notes (internal, non-clinical) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_session_notes (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  agent_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_session_notes
  ON agent_session_notes (session_id, created_at);
