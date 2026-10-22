-- Medika — initial PostgreSQL schema
-- Designed from the actual data entities found in server.js (JSON files) and the
-- client DTO contracts (GeminiApi.kt, medika-web/lib/api/types.ts, medika-admin pages).
--
-- Conventions:
--  * All timestamps are TIMESTAMPTZ in storage; the API layer converts to unix
--    seconds (and ms in WS envelopes) to preserve the existing client contract.
--  * message/ticket_message ids are BIGSERIAL (numeric) because Android parses
--    them as Long — never UUIDs.
--  * Document-shaped sub-objects (medical history lists) are JSONB to preserve
--    the exact DTO shapes; they are always fetched together and never queried
--    relationally.
--  * ON DELETE semantics chosen to preserve current observable behavior:
--     - deleting a user leaves their consultations in place (patient_id becomes
--       NULL; patient_name is denormalized and survives) — mirrors today's
--       orphaned-consultation behavior while keeping medical records;
--     - payments survive user deletion (financial records, patient_id NULL);
--     - tickets / medical histories / notes are removed with their owner
--       (privacy cleanup).

CREATE TABLE IF NOT EXISTS schema_migrations (
  id        TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('patient', 'doctor', 'admin')),
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  age           INTEGER,
  gender        TEXT,
  specialty     TEXT,
  license_number TEXT,
  location      TEXT,
  hospital      TEXT,
  biography     TEXT,
  avatar_url    TEXT,
  rating        NUMERIC(3,1) DEFAULT 5.0,
  is_available  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE TABLE specialties (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  price    INTEGER NOT NULL CHECK (price > 0),
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE consultations (
  id              TEXT PRIMARY KEY,
  patient_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  patient_name    TEXT NOT NULL,
  patient_age     INTEGER,
  doctor_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  description     TEXT NOT NULL DEFAULT '',
  specialty_needed TEXT NOT NULL DEFAULT 'Medecine Generale',
  urgency_level   TEXT NOT NULL DEFAULT 'Moyenne',
  ai_summary      TEXT NOT NULL DEFAULT '',
  ai_explanation  TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL CHECK (status IN ('RECHERCHE_MEDECIN', 'EN_COURS', 'TERMINE', 'REFUSE')),
  prescription    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_doctor ON consultations (doctor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_unassigned ON consultations (status) WHERE doctor_id IS NULL;

CREATE TABLE messages (
  id              BIGSERIAL PRIMARY KEY,
  consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL,
  sender_name     TEXT NOT NULL,
  text            TEXT NOT NULL DEFAULT '',
  message_type    TEXT NOT NULL DEFAULT 'text',
  file_url        TEXT,
  duration        INTEGER,
  file_size       BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_consultation ON messages (consultation_id, id);

-- Payments (new): server-side MonCash verification state machine.
-- order_id is client-generated (MC_<ts>_<doctorId>) and must be unique.
-- transaction_id is the provider transaction id (unique when present).
-- consultation_id enforces "one payment buys one consultation" (UNIQUE + only
-- set atomically at consultation creation).
CREATE TABLE payments (
  id              BIGSERIAL PRIMARY KEY,
  order_id        TEXT NOT NULL UNIQUE,
  patient_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL DEFAULT 'HTG',
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'EXPIRED')),
  transaction_id  TEXT UNIQUE,
  verified_amount INTEGER,
  consultation_id TEXT UNIQUE REFERENCES consultations(id) ON DELETE SET NULL,
  provider        TEXT NOT NULL DEFAULT 'moncash',
  simulated       BOOLEAN NOT NULL DEFAULT FALSE,
  provider_raw    JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payments_patient ON payments (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments (transaction_id);

-- Support tickets (RECONSTRUCTED from client contracts — production VPS
-- implementation was never committed; see docs/VERCEL_MIGRATION_AUDIT.md §3.2).
CREATE TABLE tickets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  priority   TEXT NOT NULL DEFAULT 'normal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status, updated_at DESC);

CREATE TABLE ticket_messages (
  id          BIGSERIAL PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL DEFAULT 'user' CHECK (sender_role IN ('user', 'admin', 'system')),
  sender_id   TEXT,
  sender_name TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  file_url    TEXT,
  file_type   TEXT,
  file_size   BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages (ticket_id, id);

-- Consultation notes (RECONSTRUCTED from ConsultationNote DTO).
CREATE TABLE consultation_notes (
  consultation_id TEXT PRIMARY KEY REFERENCES consultations(id) ON DELETE CASCADE,
  patient_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  doctor_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  doctor_name     TEXT,
  diagnosis       TEXT NOT NULL DEFAULT '',
  symptoms        TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  prescriptions   JSONB NOT NULL DEFAULT '[]'::jsonb,
  follow_up       TEXT NOT NULL DEFAULT '',
  flag_allergy    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Medical histories (RECONSTRUCTED from MedicalHistory DTO).
CREATE TABLE medical_histories (
  patient_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  basic_info         JSONB,
  allergies          JSONB NOT NULL DEFAULT '[]'::jsonb,
  chronic_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_medications JSONB NOT NULL DEFAULT '[]'::jsonb,
  vaccinations       JSONB NOT NULL DEFAULT '[]'::jsonb,
  emergency_contact  JSONB,
  surgical_history   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated       TIMESTAMPTZ NOT NULL DEFAULT now()
);
