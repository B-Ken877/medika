-- 013 — align the medication-payment schema with the hardened provider lifecycle
-- The application uses REVIEW for a provider-confirmed payment whose quote
-- expired/changed during checkout, and stores the quote snapshot and redirect
-- creation lease for safe idempotent retries.

ALTER TABLE medication_payments
  ADD COLUMN IF NOT EXISTS quote_id TEXT REFERENCES pharmacy_quotes(id),
  ADD COLUMN IF NOT EXISTS verified_amount_htg INTEGER,
  ADD COLUMN IF NOT EXISTS redirect_url TEXT,
  ADD COLUMN IF NOT EXISTS create_started_at TIMESTAMPTZ;

ALTER TABLE medication_payments
  DROP CONSTRAINT IF EXISTS medication_payments_status_check;
ALTER TABLE medication_payments
  ADD CONSTRAINT medication_payments_status_check
  CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'REVIEW'));

ALTER TABLE medication_order_events
  DROP CONSTRAINT IF EXISTS medication_order_events_event_type_check;
ALTER TABLE medication_order_events
  ADD CONSTRAINT medication_order_events_event_type_check CHECK (event_type IN
    ('REQUESTED', 'QUOTE_RECORDED', 'QUOTE_REVISED', 'PHARMACY_UNREACHABLE',
     'ACCEPTED', 'DECLINED', 'CANCELLED', 'ESCALATED', 'QUOTE_EXPIRED',
     'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAYMENT_VERIFIED', 'PAYMENT_REVIEW'));
