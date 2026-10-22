#!/usr/bin/env node
/**
 * Migration runner + seeding.
 *
 *   DATABASE_URL=postgres://… node scripts/migrate.js          apply pending
 *   DATABASE_URL=postgres://… node scripts/migrate.js --status  show status
 *
 * Applies db/migrations/*.sql in filename order, records each in
 * schema_migrations, then:
 *   - seeds specialties from the repo-root specialties.json (idempotent);
 *   - ensures an admin account exists when ADMIN_USERNAME/ADMIN_PASSWORD are
 *     set (never logs the password).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

function parseArgs(argv) {
  return { status: argv.includes('--status') };
}

async function main() {
  const { status } = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required (see .env.example).');
    process.exit(1);
  }
  const ssl = !/localhost|127\.0\.0\.1/.test(connectionString)
    ? { rejectUnauthorized: false }
    : undefined;
  const pool = new Pool({ connectionString, ssl });

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('Cannot connect to PostgreSQL:', err.code || err.message);
    process.exit(1);
  }

  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  );
  const applied = new Set(
    (await pool.query(`SELECT id FROM schema_migrations`)).rows.map((r) => r.id)
  );

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.log('No migration files found.');
  }

  if (status) {
    for (const f of files) {
      console.log(`${applied.has(f) ? '[applied]' : '[pending]'} ${f}`);
    }
    await pool.end();
    return;
  }

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] FAILED ${file}:`, err.message);
      process.exitCode = 1;
      client.release();
      break;
    }
    client.release();
  }

  // ─── Seed specialties (reference data, idempotent) ─────────────────────────
  const specPath = path.join(__dirname, '..', 'specialties.json');
  if (fs.existsSync(specPath)) {
    const specialties = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    for (let i = 0; i < specialties.length; i++) {
      const s = specialties[i];
      await pool.query(
        `INSERT INTO specialties (id, name, price, position)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price, position = EXCLUDED.position`,
        [s.id, s.name, s.price, i]
      );
    }
    console.log(`[seed] specialties: ${specialties.length} ensured`);
  }

  // ─── Ensure admin (env-driven; no default credentials) ─────────────────────
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminUsername && adminPassword) {
    const existing = await pool.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`);
    if (existing.rowCount === 0) {
      await pool.query(
        `INSERT INTO users (id, username, password_hash, role, name, email, is_available)
         VALUES ('admin_1', $1, $2, 'admin', 'Administrateur', 'admin@medika.ht', true)
         ON CONFLICT (username) DO NOTHING`,
        [adminUsername, bcrypt.hashSync(adminPassword, 10)]
      );
      console.log('[seed] admin account created (username from ADMIN_USERNAME; password NOT logged)');
    } else {
      console.log('[seed] admin exists — skipping');
    }
  } else {
    console.log('[seed] ADMIN_USERNAME/ADMIN_PASSWORD not set — no admin seeded');
  }

  // ─── Optional demo data (development only) ─────────────────────────────────
  if (process.env.SEED_DEMO === 'true' && process.env.NODE_ENV !== 'production') {
    const demoPassword = process.env.DEMO_PASSWORD || 'demo1234';
    const hash = bcrypt.hashSync(demoPassword, 10);
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role, name, email, phone, age, gender, specialty, license_number, location, hospital, biography, rating, is_available)
       VALUES ('doctor_demo', 'dr.demo', $1, 'doctor', 'Dr. Demo Medika', 'dr.demo@medika.ht', '+509 0000-0000', 40, 'Homme',
               'Medecine Generale', 'MSPP-00000', 'Port-au-Prince, Haiti', 'Hopital General', 'Medecin generaliste de demonstration.', 5.0, true)
       ON CONFLICT (username) DO NOTHING`,
      [hash]
    );
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role, name, email, phone, age, gender)
       VALUES ('patient_demo', 'patient.demo', $1, 'patient', 'Patient Demo', 'patient.demo@medika.ht', '+509 0000-0001', 30, 'Femme')
       ON CONFLICT (username) DO NOTHING`,
      [hash]
    );
    console.log('[seed] demo users ensured (dr.demo / patient.demo, password from DEMO_PASSWORD)');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] fatal:', err.message);
  process.exit(1);
});
