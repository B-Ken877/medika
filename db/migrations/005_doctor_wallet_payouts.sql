-- 005 — Doctor earnings ledger + scheduled manual MonCash payouts (issue #24)
--
-- Model:
--   * doctor_earnings is a DURABLE ledger. A row exists only for a
--     consultation that is TERMINE with a VERIFIED (PAID) payment — i.e. it
--     is born eligible ("AVAILABLE"). UNIQUE (consultation_id) makes
--     materialization idempotent: backfills, retries and concurrent sweeps
--     can never double-count an earning.
--   * amounts are INTEGER gourdes (HTG) — the same integer money used by
--     payments.amount; no floating point anywhere. The CHECK
--     (net_amount = gross_amount - platform_fee) is enforced by the database.
--   * platform_fee is snapshotted per earning at materialization time so
--     later PLATFORM_FEE changes never rewrite historical amounts.
--   * payouts are created ONLY inside the atomic settlement transaction and
--     only in the 'PAID' state (an admin clicks "Payé" strictly after the
--     manual MonCash transfer). UNIQUE (doctor_id, cycle_start, cycle_end)
--     prevents duplicate settlement of the same doctor/cycle at the DB level.
--   * financial records survive user/consultation deletion: FKs are
--     ON DELETE SET NULL with denormalized names for the audit trail.
--
-- Cycle semantics (see src/payout-cycles.js):
--   * cycles END on the 15th and the 30th of each month; for February the
--     second cycle ends on the last calendar day (28th or 29th);
--   * a cycle's window is (previous cycle end, this cycle end] in the app
--     timezone (America/Port-au-Prince) — windows tile with no gaps;
--   * an earning belongs to the cycle whose window contains available_at.

CREATE TABLE IF NOT EXISTS payouts (
  id                  BIGSERIAL PRIMARY KEY,
  doctor_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  doctor_name         TEXT NOT NULL DEFAULT '',
  cycle_start         DATE NOT NULL,
  cycle_end           DATE NOT NULL,
  amount              INTEGER NOT NULL CHECK (amount >= 0),
  earning_count       INTEGER NOT NULL CHECK (earning_count >= 0),
  status              TEXT NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID')),
  moncash_reference   TEXT,
  paid_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_by_admin_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  paid_by_admin_name  TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, cycle_start, cycle_end),
  CHECK (cycle_end > cycle_start)
);
CREATE INDEX IF NOT EXISTS idx_payouts_doctor ON payouts (doctor_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payouts_cycle ON payouts (cycle_end DESC);

-- Created after payouts so the FK below can reference it.
CREATE TABLE IF NOT EXISTS doctor_earnings (
  id              BIGSERIAL PRIMARY KEY,
  doctor_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  doctor_name     TEXT NOT NULL DEFAULT '',
  consultation_id TEXT UNIQUE REFERENCES consultations(id) ON DELETE SET NULL,
  payment_id      BIGINT UNIQUE REFERENCES payments(id) ON DELETE SET NULL,
  gross_amount    INTEGER NOT NULL CHECK (gross_amount >= 0),
  platform_fee    INTEGER NOT NULL CHECK (platform_fee >= 0),
  net_amount      INTEGER NOT NULL CHECK (net_amount >= 0),
  status          TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'PAID')),
  available_at    TIMESTAMPTZ NOT NULL,
  payout_id       BIGINT REFERENCES payouts(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (net_amount = gross_amount - platform_fee)
);
CREATE INDEX IF NOT EXISTS idx_doctor_earnings_doctor ON doctor_earnings (doctor_id, status, available_at);
CREATE INDEX IF NOT EXISTS idx_doctor_earnings_available
  ON doctor_earnings (available_at) WHERE status = 'AVAILABLE';
CREATE INDEX IF NOT EXISTS idx_doctor_earnings_payout ON doctor_earnings (payout_id);
