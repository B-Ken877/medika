-- 011 — verified MonCash payments for medication orders (issue #84)
-- Medication payments are intentionally separate from consultation payments:
-- no fake consultation_id, no weakening of the payments table invariants.

ALTER TABLE medication_orders
  DROP CONSTRAINT IF EXISTS medication_orders_status_check;
ALTER TABLE medication_orders
  ADD CONSTRAINT medication_orders_status_check CHECK (status IN
    ('REQUESTED', 'ESCALATED', 'QUOTED', 'ACCEPTED', 'PAID',
     'DECLINED', 'CANCELLED', 'EXPIRED'));

ALTER TABLE medication_order_events
  DROP CONSTRAINT IF EXISTS medication_order_events_event_type_check;
ALTER TABLE medication_order_events
  ADD CONSTRAINT medication_order_events_event_type_check CHECK (event_type IN
    ('REQUESTED', 'QUOTE_RECORDED', 'QUOTE_REVISED', 'PHARMACY_UNREACHABLE',
     'ACCEPTED', 'DECLINED', 'CANCELLED', 'ESCALATED', 'QUOTE_EXPIRED',
     'PAYMENT_VERIFIED'));

CREATE TABLE IF NOT EXISTS medication_payments (
  id                TEXT PRIMARY KEY,
  medication_order_id TEXT NOT NULL UNIQUE REFERENCES medication_orders(id) ON DELETE CASCADE,
  patient_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  payment_reference TEXT NOT NULL UNIQUE,
  amount_htg        INTEGER NOT NULL CHECK (amount_htg > 0),
  currency          TEXT NOT NULL DEFAULT 'HTG' CHECK (currency = 'HTG'),
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'FAILED')),
  transaction_id    TEXT UNIQUE,
  provider          TEXT NOT NULL DEFAULT 'moncash',
  simulated         BOOLEAN NOT NULL DEFAULT FALSE,
  provider_raw      JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_medication_payments_patient
  ON medication_payments (patient_id, created_at DESC)
  WHERE patient_id IS NOT NULL;
