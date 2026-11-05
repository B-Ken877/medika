-- 011 — Medication-specific MonCash payments (issue #84).
-- Kept separate from consultation payments: no fake consultation_id and no
-- changes to the existing payments table invariants.
ALTER TABLE medication_orders DROP CONSTRAINT IF EXISTS medication_orders_status_check;
ALTER TABLE medication_orders ADD CONSTRAINT medication_orders_status_check
  CHECK (status IN ('REQUESTED','ESCALATED','QUOTED','ACCEPTED','PAID','DECLINED','CANCELLED','EXPIRED'));

ALTER TABLE medication_order_events DROP CONSTRAINT IF EXISTS medication_order_events_event_type_check;
ALTER TABLE medication_order_events ADD CONSTRAINT medication_order_events_event_type_check
  CHECK (event_type IN (
    'REQUESTED','QUOTE_RECORDED','QUOTE_REVISED','PHARMACY_UNREACHABLE',
    'ACCEPTED','DECLINED','CANCELLED','ESCALATED','QUOTE_EXPIRED',
    'PAYMENT_PENDING','PAYMENT_FAILED','PAYMENT_VERIFIED'
  ));

CREATE TABLE medication_payments (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES medication_orders(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES pharmacy_quotes(id) ON DELETE RESTRICT,
  patient_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reference TEXT NOT NULL UNIQUE,
  amount_htg INTEGER NOT NULL CHECK (amount_htg > 0),
  currency TEXT NOT NULL DEFAULT 'HTG' CHECK (currency = 'HTG'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','FAILED','EXPIRED')),
  transaction_id TEXT UNIQUE,
  verified_amount_htg INTEGER,
  simulated BOOLEAN NOT NULL DEFAULT FALSE,
  redirect_url TEXT,
  create_started_at TIMESTAMPTZ,
  provider_raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  UNIQUE(order_id, quote_id)
);
CREATE INDEX idx_medication_payments_patient ON medication_payments(patient_id, created_at DESC);
CREATE INDEX idx_medication_payments_order ON medication_payments(order_id, created_at DESC);
