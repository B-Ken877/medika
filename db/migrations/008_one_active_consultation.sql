-- 008 — One active consultation per patient and per doctor (issue #60)
--
-- Product rule: at most ONE consultation in a blocking state
-- ('RECHERCHE_MEDECIN' or 'EN_COURS') per patient AND per doctor at any
-- time. Enforced by the DATABASE (two partial unique indexes), not only by
-- the API, so no race or client bug can create overlapping bookings.
--
-- Deploy-order safety (issue #60 requirement: reconcile BEFORE enforcing):
--   1. close_reason column is additive (NULL = normal transition).
--   2. Legacy duplicates are reconciled FIRST by
--      reconcile_duplicate_active_consultations() — a deterministic,
--      rerunnable greedy pass — so creating the unique indexes below can
--      never fail on existing production data.
--   3. Only then are the partial unique indexes created.
--
-- Reconciliation rule (deterministic, documented, safe to rerun):
--   Consider every blocking row newest-first (created_at DESC, id DESC as
--   the tie-breaker). A row is KEPT iff no already-processed (i.e. newer)
--   row that is still blocking shares its patient_id OR its doctor_id.
--   Everything else transitions to the terminal status 'EXPIRE' with
--   close_reason = 'duplicate_open_consultation' and a system message in
--   the conversation. Nothing is ever deleted; history is preserved.
--   Because cancelled rows immediately stop being blocking, a single pass
--   resolves patient/doctor conflict interactions consistently (a newer
--   request can take a participant's only slot; older conflicting rows are
--   then cancelled in the same pass). A second run finds no conflicts and
--   is a no-op.
--
-- Privacy: the function logs ONLY aggregate counts — never patient names,
-- descriptions, or ids tied to medical content.

-- ── close_reason (additive, NULL for normal transitions) ────────────────────
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS close_reason TEXT;

-- ── Shared cancellation step (terminal status + reason + visible system
--    message; the conversation history is never deleted) ────────────────────
CREATE OR REPLACE FUNCTION cancel_duplicate_consultation(consultation_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE consultations
     SET status = 'EXPIRE',
         close_reason = 'duplicate_open_consultation',
         updated_at = now()
   WHERE id = consultation_id
     AND status IN ('RECHERCHE_MEDECIN', 'EN_COURS');
  INSERT INTO messages (consultation_id, sender_id, sender_name, text)
  VALUES (consultation_id, 'system', 'Systeme', 'Konsiltasyon an fèmen otomatikman: te gen yon lòt konsiltasyon ki toujou aktif pou menm pasyan oswa menm doktè. Istor la konserve.');
END;
$$;

-- ── Deterministic reconciliation (also callable later for reruns/tests) ─────
CREATE OR REPLACE FUNCTION reconcile_duplicate_active_consultations()
RETURNS TABLE (kept INTEGER, cancelled INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
  v_cancelled INTEGER := 0;
  v_kept INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id, patient_id, doctor_id, created_at
      FROM consultations
     WHERE status IN ('RECHERCHE_MEDECIN', 'EN_COURS')
     ORDER BY created_at DESC, id DESC
     FOR UPDATE
  LOOP
    -- Conflict with an ALREADY-PROCESSED row? Rows processed earlier in this
    -- loop are strictly newer ((created_at, id) lexicographically greater);
    -- among those, only still-blocking ones were KEPT — cancelled ones no
    -- longer match the status filter. Rows NOT yet processed (older) must
    -- never block the current row: their turn comes later in this pass.
    IF r.patient_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM consultations c2
          WHERE c2.status IN ('RECHERCHE_MEDECIN', 'EN_COURS')
            AND c2.patient_id = r.patient_id
            AND c2.id <> r.id
            AND (c2.created_at, c2.id) > (r.created_at, r.id)
       )
    THEN
      PERFORM cancel_duplicate_consultation(r.id);
      v_cancelled := v_cancelled + 1;
    ELSIF r.doctor_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM consultations c2
          WHERE c2.status IN ('RECHERCHE_MEDECIN', 'EN_COURS')
            AND c2.doctor_id = r.doctor_id
            AND c2.id <> r.id
            AND (c2.created_at, c2.id) > (r.created_at, r.id)
       )
    THEN
      PERFORM cancel_duplicate_consultation(r.id);
      v_cancelled := v_cancelled + 1;
    ELSE
      v_kept := v_kept + 1;
    END IF;
  END LOOP;

  -- Aggregate counts only — never patient-identifying details (issue #60).
  RAISE NOTICE 'reconcile_duplicate_active_consultations: kept %, cancelled %', v_kept, v_cancelled;
  RETURN QUERY SELECT v_kept, v_cancelled;
END;
$$;

-- Reconcile existing data BEFORE creating the unique indexes.
SELECT * FROM reconcile_duplicate_active_consultations();

-- ── Database-enforced invariant (partial unique indexes) ────────────────────
-- NULL participant ids (orphaned rows) can never conflict and are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consultations_patient_active
  ON consultations (patient_id)
  WHERE patient_id IS NOT NULL
    AND status IN ('RECHERCHE_MEDECIN', 'EN_COURS');

CREATE UNIQUE INDEX IF NOT EXISTS uq_consultations_doctor_active
  ON consultations (doctor_id)
  WHERE doctor_id IS NOT NULL
    AND status IN ('RECHERCHE_MEDECIN', 'EN_COURS');

-- ── Bounded pending-request timeout support (issue #60 §3) ──────────────────
-- Pending ('RECHERCHE_MEDECIN') rows older than PENDING_EXPIRY_HOURS are
-- expired by the scheduled deadline processor; EN_COURS rows are NOT touched
-- by that pass (their own five-hour expiry from migration 004 is unchanged).
CREATE INDEX IF NOT EXISTS idx_consultations_pending_age
  ON consultations (created_at)
  WHERE status = 'RECHERCHE_MEDECIN';
