-- 013 — Medika-owned delivery operations (issue #82, delivery scope; supersedes
-- the unmerged reference PR #95 whose 012/013 numbering collided with the
-- payment migrations already merged on main).
--
-- Product rules:
--   * Medika EMPLOYEES (never pharmacies, never third-party couriers) collect
--     medication from the partner pharmacy and deliver to the patient.
--   * Delivery employees are managed accounts: admins create/disable them;
--     public registration stays patient-only (src/routes/auth.js hardcodes
--     role: 'patient').
--   * Coverage is EXPLICIT: only admin-activated rows in delivery_zones are
--     serviceable. The single seed zone (Port-au-Prince) ships INACTIVE so an
--     unconfigured deployment fails closed; there is no free-text matching.
--   * Chain of custody: every stage change is an append-only, idempotent
--     event (unique idempotency_key) written in the same transaction as the
--     delivery row update — a client click alone is never proof of delivery;
--     the DELIVERED state requires the patient's own confirmation.
--   * Money boundary: delivery is FREE to the patient (no billable fee exists
--     in this schema by construction). Medika's internal costs live in
--     medication_delivery_expenses and are never added to any quote/payment.
--   * Privacy: delivery staff never see diagnosis, notes, history or the
--     prescription content — the deliveries API exposes only fulfilment data
--     (recipient, phone, address, zone, pickup pharmacy/reference, schedule).

-- ─── Delivery employee role ─────────────────────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('patient', 'doctor', 'admin', 'delivery'));

-- City is stored on the order next to the zone (both validated server-side
-- against delivery_zones at order creation; default keeps pre-existing rows
-- meaningful — launch city is Port-au-Prince only).
ALTER TABLE medication_orders
  ADD COLUMN IF NOT EXISTS delivery_city TEXT NOT NULL DEFAULT 'Port-au-Prince';

-- ─── Explicit service coverage (admin-activated, fail-closed) ───────────────
CREATE TABLE IF NOT EXISTS delivery_zones (
  id         TEXT PRIMARY KEY,                     -- 'ZONE_<uuid v4>'
  city       TEXT NOT NULL,
  zone_name  TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city, zone_name)
);
-- Launch configuration: Port-au-Prince only as a CITY record, but the zone
-- row starts INACTIVE — no neighborhood is silently serviceable until an admin
-- activates exact zones (issue #82 §7: "Fail closed if no zones are
-- configured").
INSERT INTO delivery_zones (id, city, zone_name, active)
VALUES ('ZONE_PAP_DEFAULT', 'Port-au-Prince', 'Port-au-Prince', FALSE)
ON CONFLICT (city, zone_name) DO NOTHING;

-- ─── Deliveries (1:1 with a PAID medication order) ──────────────────────────
CREATE TABLE IF NOT EXISTS medication_deliveries (
  id                   TEXT PRIMARY KEY,            -- 'DL_<uuid v4>'
  medication_order_id  TEXT NOT NULL UNIQUE REFERENCES medication_orders(id) ON DELETE CASCADE,
  assigned_to          TEXT NOT NULL REFERENCES users(id),
  zone_id              TEXT NOT NULL REFERENCES delivery_zones(id),
  -- Regular deliveries happen on Fridays (server-enforced); urgent exceptions
  -- carry a mandatory, audited reason.
  scheduled_for        DATE NOT NULL,
  urgent               BOOLEAN NOT NULL DEFAULT FALSE,
  urgent_reason        TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN
                         ('ASSIGNED', 'PHARMACY_PREPARING', 'READY_FOR_PICKUP',
                          'PICKED_UP', 'OUT_FOR_DELIVERY', 'AWAITING_CONFIRMATION',
                          'DELIVERED', 'FAILED_ATTEMPT', 'RETURNED_ESCALATED')),
  -- Minimum fulfilment data for the assigned employee (no clinical content).
  pickup_pharmacy_name TEXT NOT NULL,
  pickup_reference     TEXT NOT NULL,
  created_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_medication_deliveries_employee
  ON medication_deliveries (assigned_to, scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_medication_deliveries_schedule
  ON medication_deliveries (scheduled_for, status);

-- ─── Append-only chain-of-custody events (idempotent) ───────────────────────
CREATE TABLE IF NOT EXISTS medication_delivery_events (
  id              BIGSERIAL PRIMARY KEY,
  delivery_id     TEXT NOT NULL REFERENCES medication_deliveries(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN
                    ('ASSIGNED', 'PHARMACY_PREPARING', 'READY_FOR_PICKUP',
                     'PICKED_UP', 'OUT_FOR_DELIVERY', 'AWAITING_CONFIRMATION',
                     'DELIVERED', 'FAILED_ATTEMPT', 'RETURNED_ESCALATED')),
  actor_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name      TEXT NOT NULL DEFAULT '',
  actor_role      TEXT NOT NULL,
  reason          TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medication_delivery_events
  ON medication_delivery_events (delivery_id, created_at);

-- ─── Medika internal delivery expense ledger (never patient-billed) ─────────
CREATE TABLE IF NOT EXISTS medication_delivery_expenses (
  id          BIGSERIAL PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES medication_deliveries(id) ON DELETE CASCADE,
  amount_htg  INTEGER NOT NULL CHECK (amount_htg >= 0),
  category    TEXT NOT NULL DEFAULT 'DELIVERY',
  notes       TEXT NOT NULL DEFAULT '',
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medication_delivery_expenses_created
  ON medication_delivery_expenses (created_at DESC);

-- ─── Monthly delivery budget + alert threshold (admin-configured) ───────────
CREATE TABLE IF NOT EXISTS medication_delivery_budgets (
  id                     TEXT PRIMARY KEY DEFAULT 'DEFAULT',
  monthly_budget_htg     INTEGER NOT NULL CHECK (monthly_budget_htg >= 0),
  alert_threshold_percent INTEGER NOT NULL DEFAULT 80
                           CHECK (alert_threshold_percent BETWEEN 1 AND 100),
  updated_by             TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
