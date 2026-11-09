/**
 * Cold-start auto-migration (production incident fix, Nov 2026).
 *
 * WHY THIS EXISTS
 * The prescription system shipped issues #82–#84 with migrations 009–013
 * (prescription_documents, medication_orders, medication_payments,
 * delivery operations). The migration runner is MANUAL — `npm run migrate`
 * against DATABASE_URL — and nothing in the deployed backend ever applied
 * them. Result in production: the consultation page loaded fine (tables from
 * migrations 001–008 exist) while EVERY call that touches a 009+ table
 * answered 500 "Erreur interne du serveur":
 *   - GET /api/consultations/:id/prescription      → "Impossible de charger
 *     l'ordonnance" (the patient could not see the prescription document);
 *   - GET /api/consultations/:id/medication-order   → "Sèvis la pa disponib";
 *   - GET /api/delivery-zones                       → fail-closed empty zones,
 *     the "buy through Medika" form disabled.
 * This module makes the backend self-healing: at every cold start the API
 * applies PENDING migrations itself, so a deploy can no longer reach
 * production with a schema that is older than the code.
 *
 * SAFETY MODEL
 *  - Idempotent: only files absent from schema_migrations are applied, and
 *    each one runs inside a transaction with a Postgres ADVISORY LOCK, so
 *    concurrent serverless cold starts serialize and re-check under the lock
 *    (exactly one instance applies a file; the others skip it).
 *  - The gate is fail-open by design: if migration application fails (dead
 *    database, drifted schema), the error is logged and the API still serves
 *    — same behavior as before this module existed, with a precise log line
 *    explaining what is wrong instead of silent 500s.
 *  - Opt-out for special environments: set AUTO_MIGRATE=0.
 *  - Reference data: specialties are re-seeded idempotently (same upsert as
 *    scripts/migrate.js). The env-driven admin account is deliberately NOT
 *    auto-created here — admin provisioning stays a conscious, manual step.
 *  - Nothing is ever logged except migration file names and error categories
 *    — never connection strings or credentials.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { query, withTransaction } = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const SPECIALTIES_JSON = path.join(__dirname, '..', 'specialties.json');
// Arbitrary fixed bigint advisory-lock key for Medika schema changes.
const ADVISORY_LOCK_KEY = 813622010;

let pending = null; // module-singleton: one auto-migration per function instance

function migrationFiles() {
  try {
    return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return null; // dir not bundled (deployment packaging issue) — see caller
  }
}

async function appliedSet(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  );
  const { rows } = await client.query(`SELECT id FROM schema_migrations`);
  return new Set(rows.map((r) => r.id));
}

/**
 * Apply pending migrations. Serialized across instances by
 * pg_advisory_xact_lock; the applied-set is re-checked UNDER the lock, so a
 * second cold start that lost the race skips the file cleanly.
 */
async function applyPendingMigrations() {
  const files = migrationFiles();
  if (!files) {
    console.error('[auto-migrate] db/migrations is not present in this bundle — cannot self-migrate. Run `npm run migrate` manually.');
    return { applied: [], error: 'migrations-dir-missing' };
  }
  const applied = await appliedSet({ query: (t, p) => query(t, p) });
  const pendingFiles = files.filter((f) => !applied.has(f));
  if (pendingFiles.length === 0) {
    return { applied: [] };
  }

  const done = [];
  for (const file of pendingFiles) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await withTransaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock($1)`, [ADVISORY_LOCK_KEY]);
        // Re-check under the lock: another instance may have applied it while
        // this one waited.
        const current = await appliedSet(client);
        if (current.has(file)) return;
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [file]);
        done.push(file);
      });
      if (done.includes(file)) console.log(`[auto-migrate] applied ${file}`);
    } catch (err) {
      console.error(`[auto-migrate] FAILED ${file}:`, err.code || err.message);
      return { applied: done, error: `${file}: ${err.code || err.message}` };
    }
  }
  return { applied: done };
}

/**
 * Idempotent reference-data seed — same upsert as scripts/migrate.js, minus
 * the admin-account logic (admin provisioning stays a conscious manual step).
 */
async function seedSpecialties() {
  try {
    if (!fs.existsSync(SPECIALTIES_JSON)) return;
    const specialties = JSON.parse(fs.readFileSync(SPECIALTIES_JSON, 'utf8'));
    for (let i = 0; i < specialties.length; i++) {
      const s = specialties[i];
      await query(
        `INSERT INTO specialties (id, name, price, position)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price, position = EXCLUDED.position`,
        [s.id, s.name, s.price, i]
      );
    }
  } catch (err) {
    // Never let reference-data seeding block serving (e.g. an empty database
    // whose migrations failed above — the specialties table may not exist yet).
    console.error('[auto-migrate] specialties seed skipped:', err.code || err.message);
  }
}

async function runOnce() {
  if (process.env.AUTO_MIGRATE === '0') {
    return { skipped: true };
  }
  try {
    const result = await applyPendingMigrations();
    if (result.applied.length > 0) {
      console.log(`[auto-migrate] ${result.applied.length} migration(s) applied at cold start`);
      await seedSpecialties();
    }
    // else: schema is current (steady state — one cheap SELECT per instance,
    // no writes) or a precise error was already logged above.
    return result;
  } catch (err) {
    console.error('[auto-migrate] failed:', err.code || err.message);
    return { error: err.code || err.message };
  }
}

/**
 * Start (or join) the once-per-instance auto-migration. NEVER rejects — the
 * request gate below can always `await` it safely. Returns a result summary
 * for logging/tests.
 */
function ensureMigrations() {
  if (!pending) {
    pending = runOnce();
  }
  return pending;
}

/** Await the instance's migration gate (resolves even on failure — fail-open). */
function migrationsReady() {
  return ensureMigrations();
}

/** Express middleware: holds requests until the instance's migrations settled. */
function migrationsGate(req, res, next) {
  migrationsReady().then(
    () => next(),
    () => next()
  );
}

module.exports = { ensureMigrations, migrationsReady, migrationsGate, migrationFiles };

// Test-only helper (kept out of the public contract above).
module.exports.__resetForTests = () => { pending = null; };
