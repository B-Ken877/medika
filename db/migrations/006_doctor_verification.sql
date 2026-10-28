-- 006 — Doctor credential verification (issue #32)
--   An explicit, server-owned verification status for doctor professional
--   credentials, with an auditable admin workflow.
--
-- Status model (users.verification_status, doctors only in practice):
--   NULL      = unknown / legacy — NOT verified; existing records start here
--               (never silently marked verified by this migration).
--   'pending' = submitted / awaiting admin review.
--   'verified'   = an admin completed the credential review.
--   'rejected'   = an admin rejected the credentials (needs review/resubmit).
--
-- Transition rules (enforced by the admin route, all changes audited):
--   * only role='admin' may change the status (doctors/patients cannot
--     self-assign through profile endpoints — the column is not writable by
--     PUT /api/profile at all);
--   * any state → pending | verified | rejected is a legal ADMIN transition;
--   * verified_at / verified_by are set only on transition to 'verified'
--     and cleared when leaving it.
--
-- Audit trail: verification_audit_log records every status change and every
-- admin edit of credential fields (actor, action, from/to, note, timestamp).
-- No sensitive documents are stored — reference information only.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verification_status TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by TEXT;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_verification_status_check;
ALTER TABLE users ADD CONSTRAINT users_verification_status_check
  CHECK (verification_status IS NULL
      OR verification_status IN ('pending', 'verified', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_users_verification
  ON users (verification_status) WHERE role = 'doctor';

CREATE TABLE IF NOT EXISTS verification_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  doctor_id   TEXT NOT NULL,
  actor_id    TEXT,                       -- acting admin (NULL = system)
  action      TEXT NOT NULL CHECK (action IN
                ('status_changed', 'credential_fields_edited', 'created')),
  from_status TEXT,
  to_status   TEXT,
  note        TEXT,                       -- optional, non-sensitive
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_audit_doctor
  ON verification_audit_log (doctor_id, id DESC);
