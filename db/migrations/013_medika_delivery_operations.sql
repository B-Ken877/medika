-- 013 — Medika-owned delivery operations (consolidated issue #82).
--
-- Provenance: adapted from the closed PR #95 draft (its migration was
-- numbered 012 and collided with the merged 012_medication_payment_hardening;
-- its 013 duplicated the merged hardening and is dropped entirely). Renumbered
-- here into the single unambiguous sequential chain and extended for the
-- consolidated #82 contract.
--
-- Product rules enforced by this schema:
--   * Delivery employees are a distinct DB role managed by admins only —
--     public registration stays patient-only (users.role CHECK extended;
--     no self-registration route exists for the role).
--   * Coverage is EXPLICIT: only activated rows in delivery_zones are
--     serviceable. The seed row is inserted INACTIVE — nothing is serviceable
--     until an admin activates an exact city/zone. Fail closed when no zone
--     is configured or an inactive/unknown zone is selected (repo enforces;
--     no free-text match can enable delivery).
--   * A medication order stores the exact zone RECORD it was validated
--     against (delivery_zone_id FK) plus the city; legacy rows keep their
--     historical free-text delivery_zone (column retained, nullable FK).
--   * Custody chain has exactly the nine audited states of the issue spec,
--     with append-only events carrying an idempotency key (UNIQUE) so a
--     duplicate client submission can never double-apply a transition.
--   * Medika's internal delivery expenses live in their own ledger, separate
--     from any patient-facing amount — the patient pays 0 HTG for delivery
--     and the quote/payment model has no delivery line (enforced upstream by
--     migrations 010/011/012; nothing here adds one).

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('patient', 'doctor', 'admin', 'delivery'));

CREATE TABLE IF NOT EXISTS delivery_zones (
  id TEXT PRIMARY KEY,
  city TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city, zone_name)
);

-- Bind each order to the exact validated coverage zone record + city.
ALTER TABLE medication_orders
  ADD COLUMN IF NOT EXISTS delivery_city TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS delivery_zone_id TEXT REFERENCES delivery_zones(id);

-- The only initial service city is Port-au-Prince, and even it starts
-- INACTIVE: an administrator must explicitly activate an exact zone before
-- any patient can select it (fail-closed launch configuration).
INSERT INTO delivery_zones (id, city, zone_name, active)
VALUES ('ZONE_PAP', 'Port-au-Prince', 'Port-au-Prince', FALSE)
ON CONFLICT (city, zone_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS medication_deliveries (
  id TEXT PRIMARY KEY,
  medication_order_id TEXT NOT NULL UNIQUE REFERENCES medication_orders(id) ON DELETE CASCADE,
  assigned_to TEXT NOT NULL REFERENCES users(id),
  zone_id TEXT NOT NULL REFERENCES delivery_zones(id),
  scheduled_for DATE NOT NULL,
  urgent BOOLEAN NOT NULL DEFAULT FALSE,
  urgent_reason TEXT NOT NULL DEFAULT '',
  -- Chain of custody (issue #82 §7): every transition is validated
  -- server-side under the row lock; a button click is never proof.
  status TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN
    ('ASSIGNED', 'PHARMACY_PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP',
     'OUT_FOR_DELIVERY', 'AWAITING_CONFIRMATION', 'DELIVERED',
     'FAILED_ATTEMPT', 'RETURNED_ESCALATED')),
  pickup_pharmacy_name TEXT NOT NULL,
  pickup_reference TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_medication_deliveries_employee
  ON medication_deliveries (assigned_to, scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_medication_deliveries_schedule
  ON medication_deliveries (scheduled_for, status);

CREATE TABLE IF NOT EXISTS medication_delivery_events (
  id BIGSERIAL PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES medication_deliveries(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN
    ('ASSIGNED', 'PHARMACY_PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP',
     'OUT_FOR_DELIVERY', 'AWAITING_CONFIRMATION', 'DELIVERED',
     'FAILED_ATTEMPT', 'RETURNED_ESCALATED')),
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  -- Idempotent submission: a repeated event (double click, retry, offline
  -- replay) with the same key applies exactly once.
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medication_delivery_events
  ON medication_delivery_events (delivery_id, created_at);

-- Medika's internal cost ledger — NEVER part of the patient's quote/payment.
CREATE TABLE IF NOT EXISTS medication_delivery_expenses (
  id BIGSERIAL PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES medication_deliveries(id) ON DELETE CASCADE,
  amount_htg INTEGER NOT NULL CHECK (amount_htg >= 0),
  category TEXT NOT NULL DEFAULT 'DELIVERY',
  notes TEXT NOT NULL DEFAULT '',
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medication_delivery_expenses_created
  ON medication_delivery_expenses (created_at DESC);

-- Admin-configured monthly budget + alert threshold for internal delivery cost.
CREATE TABLE IF NOT EXISTS medication_delivery_budgets (
  id TEXT PRIMARY KEY DEFAULT 'DEFAULT',
  monthly_budget_htg INTEGER NOT NULL CHECK (monthly_budget_htg >= 0),
  alert_threshold_percent INTEGER NOT NULL DEFAULT 80
    CHECK (alert_threshold_percent BETWEEN 1 AND 100),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
