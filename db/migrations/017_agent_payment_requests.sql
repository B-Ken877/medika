-- 017: Agent-initiated payment requests — the member pays ON THEIR DEVICE
-- while the voice call with the agent keeps running.
--
-- Flow (owner brief): the agent answers the call, fills the intake ON BEHALF
-- of the member (reason, what they feel, urgency — medical history comes
-- later), picks the doctor (or searches the member's preferred doctor by
-- name), then clicks "Submit Payment". A payment request is pushed to the
-- member's device: it shows the amount, a phone-number field and a 4-digit
-- PIN field. The member taps Pay; the SIMULATED payment is confirmed
-- server-side (no MonCash API yet — clearly isolated, fail-closed), the
-- consultation is created for the MEMBER's account from the agent-captured
-- intake, linked to the assistance session, and both the member and the
-- agent are notified in realtime. Nobody is redirected; the call stays open.
--
-- Conventions follow 015: FKs to users(id), CHECK constraints for state
-- machines, partial unique indexes as concurrency referees.

-- ─── Intake captured by the agent on behalf of the member ──────────────────
-- Lives on the session (the live conversation is the source of truth); the
-- consultation created after payment reads it at confirm time.
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS intake_description TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS urgency_level TEXT NOT NULL DEFAULT 'Moyenne';

-- ─── Payment requests raised by agents ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_payment_requests (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  patient_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  specialty       TEXT NOT NULL,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL DEFAULT 'HTG',
  -- Joins to the payments row (created PENDING + simulated by the agent
  -- action); the member's confirm verifies and consumes it like the
  -- self-service flow does.
  order_id        TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','paid','failed','expired','cancelled')),
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  consultation_id TEXT UNIQUE REFERENCES consultations(id) ON DELETE SET NULL,
  paid_phone      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);

-- Concurrency referee: a member sees at most ONE pending payment request —
-- the popup on their device is unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_payment_pending
  ON agent_payment_requests (patient_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agent_payment_requests_patient
  ON agent_payment_requests (patient_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_payment_requests_session
  ON agent_payment_requests (session_id, created_at DESC);
