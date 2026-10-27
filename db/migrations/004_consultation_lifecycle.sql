-- 004 — Consultation request lifecycle (issue #25)
--   * one-hour server-authoritative doctor acceptance window per offer
--   * sequential rerouting to the next eligible available doctor
--   * five-hour consultation expiry after acceptance
--
-- Backward compatibility:
--   * existing columns are ADDITIVE (offer_deadline, accepted_at, expires_at,
--     reroute_after all start NULL);
--   * legacy EN_COURS rows keep expires_at NULL → they are NEVER retro-
--     actively expired (only consultations accepted after this migration
--     carry a five-hour deadline);
--   * legacy RECHERCHE_MEDECIN rows are adopted by the scheduler/opportunistic
--     pass (they get a fresh offer or a waiting-state retry timestamp);
--   * the status CHECK is replaced to admit the new 'EXPIRE' terminal state.
--
-- Concurrency:
--   * accept() stays a single atomic conditional UPDATE that additionally
--     requires the current offer holder and an unexpired offer_deadline;
--   * consultation_offers has UNIQUE (consultation_id, doctor_id) so the same
--     doctor is never offered the same consultation twice (product rule:
--     no re-offer after the eligible pool is exhausted);
--   * offer transitions are claimed atomically (UPDATE ... WHERE status='PENDING')
--     so duplicate scheduler runs / concurrent workers are harmless.

-- ── Status machine: add EXPIRE ───────────────────────────────────────────────
ALTER TABLE consultations DROP CONSTRAINT IF EXISTS consultations_status_check;
ALTER TABLE consultations ADD CONSTRAINT consultations_status_check
  CHECK (status IN ('RECHERCHE_MEDECIN', 'EN_COURS', 'TERMINE', 'REFUSE', 'EXPIRE'));

-- ── Deadline columns (all additive, NULL = not applicable) ──────────────────
ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS offer_deadline  TIMESTAMPTZ,  -- current offer acceptance deadline
  ADD COLUMN IF NOT EXISTS accepted_at     TIMESTAMPTZ,  -- when the doctor accepted
  ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ,  -- 5h consultation expiry (accepted only)
  ADD COLUMN IF NOT EXISTS reroute_after   TIMESTAMPTZ;  -- waiting-state retry cooldown

-- ── Offer history (audit trail of offers, timeouts, rerouting) ──────────────
-- doctor_id is nullable ON DELETE SET NULL + doctor_name is denormalized so
-- offer history survives doctor deletion (audit requirement).
CREATE TABLE IF NOT EXISTS consultation_offers (
  id              BIGSERIAL PRIMARY KEY,
  consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  doctor_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  doctor_name     TEXT NOT NULL DEFAULT '',
  origin          TEXT NOT NULL DEFAULT 'routing' CHECK (origin IN ('patient_choice', 'routing')),
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REJECTED')),
  offered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deadline_at     TIMESTAMPTZ NOT NULL,
  responded_at    TIMESTAMPTZ,
  UNIQUE (consultation_id, doctor_id)
);
CREATE INDEX IF NOT EXISTS idx_consultation_offers_doctor
  ON consultation_offers (doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_consultation_offers_consultation
  ON consultation_offers (consultation_id, id);

-- ── Due-deadline lookups (partial indexes: tiny, exact) ─────────────────────
CREATE INDEX IF NOT EXISTS idx_consultations_due_offer
  ON consultations (offer_deadline)
  WHERE status = 'RECHERCHE_MEDECIN' AND offer_deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consultations_due_expiry
  ON consultations (expires_at)
  WHERE status = 'EN_COURS';
CREATE INDEX IF NOT EXISTS idx_consultations_due_reroute
  ON consultations (reroute_after)
  WHERE status = 'RECHERCHE_MEDECIN' AND offer_deadline IS NULL;
