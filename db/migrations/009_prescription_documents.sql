-- 009 — Structured, immutable prescription documents (issue #82)
--
-- Product rule: the free-text consultations.prescription column becomes a
-- backwards-compatible PROJECTION of a durable, structured prescription
-- document. The document is the authoritative clinical record; the plain
-- text stays populated for older Android clients and legacy rows.
--
-- Immutability / audit trail:
--   * An issued clinical document is never silently overwritten. Corrections
--     (if ever needed) must INSERT a new row with version = previous + 1 and
--     mark the previous row SUPERSEDED (status + superseded_at exist for that
--     future flow; no correction endpoint is exposed in this issue).
--   * At most ONE active (ISSUED) document per consultation — enforced by the
--     partial unique index below at the DATABASE level, so no race or client
--     bug can double-issue. Issuance happens exactly once because it is
--     coupled to the consultation's single EN_COURS -> TERMINE completion
--     (see src/repos/prescriptions.js: row-locked atomic issuance).
--
-- Privacy: patient/doctor ids are SET NULL on user deletion (the denormalized
-- names survive, mirroring consultations); deleting a consultation cascades
-- to its documents (same privacy cleanup as consultation_notes).
--
-- No price/financial field exists in this model BY CONSTRUCTION — prescription
-- documents must never contain medication, pharmacy or delivery prices (issue
-- #82). The API layer additionally allowlist-filters item fields.

CREATE TABLE IF NOT EXISTS prescription_documents (
  id                   TEXT PRIMARY KEY,                    -- 'RX_<uuid v4>'
  consultation_id      TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  patient_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  doctor_id            TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Denormalized identities: the document stays readable even if a user row
  -- disappears (same convention as consultations.patient_name).
  patient_name         TEXT NOT NULL DEFAULT '',
  doctor_name          TEXT NOT NULL DEFAULT '',
  -- Stable, human-readable prescription reference shown on the document
  -- (deterministic from the consultation id — see src/repos/prescriptions.js).
  reference            TEXT NOT NULL UNIQUE,
  status               TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'SUPERSEDED')),
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- Structured medication instructions. Each item is an allowlisted object:
  --   { name (required), strength, form, dose, route, frequency, duration,
  --     quantity, refills, instructions } — all free-text as dictated by the
  --     doctor; the server never invents or auto-fills clinical values.
  items                JSONB NOT NULL DEFAULT '[]'::jsonb,
  general_instructions TEXT NOT NULL DEFAULT '',
  issued_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at        TIMESTAMPTZ
);

-- Patient's prescription history (newest first).
CREATE INDEX IF NOT EXISTS idx_prescription_documents_patient
  ON prescription_documents (patient_id, issued_at DESC)
  WHERE patient_id IS NOT NULL;

-- Issuing doctor's documents (newest first).
CREATE INDEX IF NOT EXISTS idx_prescription_documents_doctor
  ON prescription_documents (doctor_id, issued_at DESC)
  WHERE doctor_id IS NOT NULL;

-- Database-enforced invariant: at most ONE active document per consultation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prescription_documents_active
  ON prescription_documents (consultation_id)
  WHERE status = 'ISSUED';
