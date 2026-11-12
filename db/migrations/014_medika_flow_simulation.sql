-- 014 — Medication journey go-live data (owner request, Nov 2026).
--
-- The prescription outage fix (auto-migrate at cold start) made the
-- medication-order surfaces reachable again, but three LAUNCH-GATING rows
-- were still missing in production, so the patient flow stopped right after
-- the prescription document:
--
--   1. the seeded coverage zone (ZONE_PAP) ships INACTIVE by design
--      (fail-closed launch configuration, migration 013) — with no admin
--      activation yet, GET /api/delivery-zones returned an empty list and
--      the order form closed itself ("Livraison pas disponible dans votre
--      zone");
--   2. no partner_pharmacies row existed, so nothing could ever quote an
--      order;
--   3. no delivery-employee account existed, so nothing could ever be
--      assigned a delivery.
--
-- This migration ships the explicit go-live configuration: the
-- Port-au-Prince coverage zone goes ACTIVE, and the clearly-labeled
-- simulation pharmacy + simulation courier used by the simulated medication
-- journey (src/medication-simulation.js) are provisioned. Everything is
-- idempotent; re-running changes nothing.
--
-- The simulation courier's password_hash is a bcrypt digest of a discarded
-- 32-byte random value: the account can render as a delivery assignee but
-- NOBODY can authenticate with it.

-- ─── 1. Coverage: the Port-au-Prince zone goes live ─────────────────────────
UPDATE delivery_zones SET active = TRUE, updated_at = now()
 WHERE id = 'ZONE_PAP';

-- ─── 2. The simulation pharmacy (visible as such in every quote) ────────────
INSERT INTO partner_pharmacies
  (id, name, contact_name, whatsapp_number, location, notes, active)
VALUES
  ('PHARMA_SIM_DEMO',
   'Pharmacie partenaire Medika (simulation)',
   'Équipe simulation Medika',
   '5090000000',
   'Port-au-Prince — mode simulation',
   'Pharmacie de démonstration du parcours médicaments : génère des devis '
   || 'simulés tant que le réseau réel de pharmacies partenaires n''est pas '
   || 'connecté. Désactiver ce compte pour couper la simulation.',
   TRUE)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      active = TRUE,
      updated_at = now();

-- ─── 3. The simulation courier (delivery assignee, no login possible) ───────
INSERT INTO users (id, username, password_hash, role, name, email, is_available)
VALUES
  ('USER_SIM_LIVREUR',
   'livreur.simulation',
   '$2a$10$UEmg0QbchMweIpvSelb6UevZq28S5YnzTB/6Dq.HaeNt4R5mjehtq',
   'delivery',
   'Équipe livraison Medika (simulation)',
   'livreur.simulation@medika.local',
   TRUE)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      role = 'delivery',
      is_available = TRUE;
