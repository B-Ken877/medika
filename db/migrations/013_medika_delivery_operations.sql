-- 013 — Medika-owned delivery operations (issue #85)
-- Employees are managed by admins only; public registration remains patient-only.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('patient', 'doctor', 'admin', 'delivery'));

ALTER TABLE medication_orders ADD COLUMN IF NOT EXISTS delivery_city TEXT NOT NULL DEFAULT 'Port-au-Prince';

CREATE TABLE IF NOT EXISTS delivery_zones (
  id TEXT PRIMARY KEY,
  city TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city, zone_name)
);
-- The only initial configured service area is Port-au-Prince itself. No
-- neighborhood/commune is silently enabled; admins must add exact zones.
INSERT INTO delivery_zones (id, city, zone_name, active)
VALUES ('ZONE_PAP', 'Port-au-Prince', 'Port-au-Prince', TRUE)
ON CONFLICT (city, zone_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS medication_deliveries (
  id TEXT PRIMARY KEY,
  medication_order_id TEXT NOT NULL UNIQUE REFERENCES medication_orders(id) ON DELETE CASCADE,
  assigned_to TEXT NOT NULL REFERENCES users(id),
  zone_id TEXT NOT NULL REFERENCES delivery_zones(id),
  scheduled_for DATE NOT NULL,
  urgent BOOLEAN NOT NULL DEFAULT FALSE,
  urgent_reason TEXT NOT NULL DEFAULT '',
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
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medication_delivery_events
  ON medication_delivery_events (delivery_id, created_at);

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

CREATE TABLE IF NOT EXISTS medication_delivery_budgets (
  id TEXT PRIMARY KEY DEFAULT 'DEFAULT',
  monthly_budget_htg INTEGER NOT NULL CHECK (monthly_budget_htg >= 0),
  alert_threshold_percent INTEGER NOT NULL DEFAULT 80
    CHECK (alert_threshold_percent BETWEEN 1 AND 100),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
