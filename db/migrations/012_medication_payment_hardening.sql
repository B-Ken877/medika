-- 012 — harden medication payment idempotency and quote binding.
-- The initial issue-84 migration shipped a separate payment ledger. This
-- additive migration binds each intent to the exact quote and safely handles
-- a completed provider payment whose quote expires/changes during checkout.
ALTER TABLE medication_payments
  ADD COLUMN IF NOT EXISTS quote_id TEXT REFERENCES pharmacy_quotes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS verified_amount_htg INTEGER,
  ADD COLUMN IF NOT EXISTS redirect_url TEXT,
  ADD COLUMN IF NOT EXISTS create_started_at TIMESTAMPTZ;

-- Backfill intents created by the first implementation to the current quote.
UPDATE medication_payments mp
   SET quote_id = (
     SELECT q.id FROM pharmacy_quotes q
      WHERE q.order_id = mp.medication_order_id AND q.superseded_at IS NULL
      ORDER BY q.confirmed_at DESC LIMIT 1
   )
 WHERE mp.quote_id IS NULL;

ALTER TABLE medication_payments DROP CONSTRAINT IF EXISTS medication_payments_status_check;
ALTER TABLE medication_payments ADD CONSTRAINT medication_payments_status_check
  CHECK (status IN ('PENDING','PAID','FAILED','REVIEW'));

ALTER TABLE medication_order_events DROP CONSTRAINT IF EXISTS medication_order_events_event_type_check;
ALTER TABLE medication_order_events ADD CONSTRAINT medication_order_events_event_type_check
  CHECK (event_type IN (
    'REQUESTED','QUOTE_RECORDED','QUOTE_REVISED','PHARMACY_UNREACHABLE',
    'ACCEPTED','DECLINED','CANCELLED','ESCALATED','QUOTE_EXPIRED',
    'PAYMENT_PENDING','PAYMENT_FAILED','PAYMENT_VERIFIED','PAYMENT_REVIEW'
  ));

CREATE INDEX IF NOT EXISTS idx_medication_payments_quote
  ON medication_payments(quote_id);
