#!/usr/bin/env node
/**
 * Seed SYNTHETIC doctor profiles for preview/demo environments.
 *
 *   DATABASE_URL="postgres://…" CONFIRM_NON_PRODUCTION_SEED=1 node scripts/seed-doctors.js
 *   DATABASE_URL="postgres://…" CONFIRM_NON_PRODUCTION_SEED=1 node scripts/seed-doctors.js --dry-run
 *   DATABASE_URL="postgres://…" node scripts/seed-doctors.js --status
 *
 * WHAT IT DOES
 *   Inserts 10 clearly-synthetic doctor rows (role='doctor') so the patient
 *   doctor-search (GET /api/doctors, optional ?specialty=) returns realistic
 *   results on preview branches. Every profile is marked as a demonstration
 *   account in its biography and license number (DEMO-LIC-xxxx) — none of
 *   these clinicians exist and no real-world license is implied.
 *   No email, phone, or rating values are set: rating is inserted as an
 *   explicit NULL (the column default of 5.0 would fabricate feedback that
 *   no patient ever gave — the existing preview records carry no ratings).
 *
 * SAFETY GATES (read before running)
 *   1. The script REFUSES to run when NODE_ENV=production.
 *   2. The script REFUSES to run without CONFIRM_NON_PRODUCTION_SEED=1 —
 *      this is your assertion that you have verified the DATABASE_URL
 *      points at a NON-PRODUCTION database/branch (e.g. a Neon preview
 *      branch), NOT the production database.
 *   3. Before writing anything it prints the connection target (host,
 *      database name, current user) and the current doctor count, so the
 *      operator can abort if the target looks wrong.
 *   4. --dry-run prints the plan (target identity + rows it would insert)
 *      without touching the database.
 *
 *   The script CANNOT detect the Neon branch by itself: the branch identity
 *   lives in the Neon console / connection-string host, not in PostgreSQL.
 *   ALWAYS run `--dry-run` first and check the printed host against your
 *   Neon project's preview branch endpoint.
 *
 * IDEMPOTENCY (and the existing Neon preview records)
 *   The Neon preview branch (preview/feat/clinical-calm-redesign) already
 *   holds 10 manually seeded rows whose ids AND usernames are both
 *   doctor_seed_01…doctor_seed_10. This script uses exactly those identities
 *   (id = username = doctor_seed_NN), and every INSERT ends in a bare
 *   ON CONFLICT DO NOTHING — no conflict target — so a rerun is skipped when
 *   EITHER unique constraint fires: the users primary key (id) or the UNIQUE
 *   username. A rerun against the already-seeded preview branch therefore
 *   inserts nothing, crashes on nothing, and overwrites nothing (seeded or
 *   real rows alike). Runtime-created users cannot collide (ids are
 *   doctor_<uuid8> and usernames are chosen by real people).
 *
 * CREDENTIALS
 *   users.password_hash is NOT NULL, so each row gets a REAL bcrypt hash of
 *   a cryptographically random, never-logged, never-stored password: the
 *   accounts are valid schema-wise but nobody can log in as them. This does
 *   not bypass authentication — it locks the synthetic accounts out of it.
 *   To test the doctor-side workflow with a known password, use the
 *   SEED_DEMO support in scripts/migrate.js (dr.demo) instead.
 *
 * SPECIALTY VALUES
 *   The canonical specialty list (db `specialties` table, seeded by
 *   scripts/migrate.js from specialties.json) is the source of truth. The
 *   script loads it from the target database and refuses to insert a doctor
 *   whose specialty is not in that list — no invented specialties.
 */
'use strict';

const { randomBytes } = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

/**
 * The 10 synthetic directory doctors. French/Haitian-style FICTIONAL names,
 * canonical specialties only, fictional hospitals explicitly labeled "de
 * Démo", license numbers explicitly labeled DEMO. No email/phone (the API
 * strips them from patient-facing listings anyway) and no ratings — the
 * identities (id = username = doctor_seed_NN) deliberately match the 10 rows
 * manually seeded on the Neon preview branch so a rerun conflicts cleanly.
 */
const SYNTHETIC_DOCTORS = [
  {
    id: 'doctor_seed_01', username: 'doctor_seed_01', name: 'Dr Alain Dariste',
    specialty: 'Cardiologie', age: 47, gender: 'Homme',
    hospital: 'Centre Cardiologique de Démo — Port-au-Prince',
    location: 'Port-au-Prince, Haïti', license_number: 'DEMO-LIC-0001',
    is_available: true,
  },
  {
    id: 'doctor_seed_02', username: 'doctor_seed_02', name: 'Dr Michèle Fontaine',
    specialty: 'Pediatrie', age: 41, gender: 'Femme',
    hospital: 'Clinique Pédiatrique de Démo — Delmas',
    location: 'Delmas, Haïti', license_number: 'DEMO-LIC-0002',
    is_available: true,
  },
  {
    id: 'doctor_seed_03', username: 'doctor_seed_03', name: 'Dr Gérard Antoine',
    specialty: 'Dermatologie', age: 52, gender: 'Homme',
    hospital: 'Cabinet Dermatologique de Démo — Pétion-Ville',
    location: 'Pétion-Ville, Haïti', license_number: 'DEMO-LIC-0003',
    is_available: true,
  },
  {
    id: 'doctor_seed_04', username: 'doctor_seed_04', name: 'Dr Nadège Baptiste',
    specialty: 'Gynecologie', age: 38, gender: 'Femme',
    hospital: 'Maternité de Démo — Carrefour',
    location: 'Carrefour, Haïti', license_number: 'DEMO-LIC-0004',
    is_available: false,
  },
  {
    id: 'doctor_seed_05', username: 'doctor_seed_05', name: 'Dr Rosemond Étienne',
    specialty: 'Medecine Generale', age: 44, gender: 'Homme',
    hospital: 'Centre de Santé de Démo — Tabarre',
    location: 'Tabarre, Haïti', license_number: 'DEMO-LIC-0005',
    is_available: true,
  },
  {
    id: 'doctor_seed_06', username: 'doctor_seed_06', name: 'Dr Yvette Charlemagne',
    specialty: 'Psychiatrie', age: 49, gender: 'Femme',
    hospital: 'Institut de Santé Mentale de Démo — Delmas',
    location: 'Delmas, Haïti', license_number: 'DEMO-LIC-0006',
    is_available: true,
  },
  {
    id: 'doctor_seed_07', username: 'doctor_seed_07', name: 'Dr Frantz Delva',
    specialty: 'Odontologie', age: 36, gender: 'Homme',
    hospital: 'Cabinet Dentaire de Démo — Port-au-Prince',
    location: 'Port-au-Prince, Haïti', license_number: 'DEMO-LIC-0007',
    is_available: true,
  },
  {
    id: 'doctor_seed_08', username: 'doctor_seed_08', name: 'Dr Clarisse Vilmont',
    specialty: 'Ophtalmologie', age: 43, gender: 'Femme',
    hospital: 'Centre Ophtalmologique de Démo — Croix-des-Bouquets',
    location: 'Croix-des-Bouquets, Haïti', license_number: 'DEMO-LIC-0008',
    is_available: true,
  },
  {
    id: 'doctor_seed_09', username: 'doctor_seed_09', name: 'Dr Jacques Belizaire',
    specialty: 'Orthopedie', age: 55, gender: 'Homme',
    hospital: 'Clinique Orthopédique de Démo — Pétion-Ville',
    location: 'Pétion-Ville, Haïti', license_number: 'DEMO-LIC-0009',
    is_available: false,
  },
  {
    id: 'doctor_seed_10', username: 'doctor_seed_10', name: 'Dr Sylvie Larose',
    specialty: 'Nutrition', age: 34, gender: 'Femme',
    hospital: 'Cabinet Nutrition de Démo — Tabarre',
    location: 'Tabarre, Haïti', license_number: 'DEMO-LIC-0010',
    is_available: true,
  },
];

/** Disclosure biography — printed verbatim for every synthetic profile. */
const SYNTHETIC_BIOGRAPHY =
  'Profil de démonstration Medika : médecin fictif utilisé pour tester la ' +
  'recherche de médecins. Aucune licence médicale réelle. ' +
  '(Compte non connectable — identifiants aléatoires non conservés.)';

/**
 * Build the INSERT statement + params for one synthetic doctor.
 * Pure function (exported for tests): no I/O, deterministic SQL shape.
 */
function buildDoctorInsert(doctor) {
  // Real bcrypt hash of an unknowable random password (see header). The
  // plaintext is discarded in this scope and never returned or logged.
  const passwordHash = bcrypt.hashSync(randomBytes(24).toString('base64url'), 10);
  // Bare ON CONFLICT DO NOTHING — no conflict target — skips the insert when
  // EITHER unique constraint fires: the users primary key (id) or the UNIQUE
  // username. That is what makes a rerun against the already-seeded Neon
  // preview branch safe: the manual rows (id = username = doctor_seed_NN)
  // collide on both constraints and are left untouched instead of crashing
  // with a duplicate-key error. rating is an explicit NULL: the column
  // default (5.0) would fabricate a rating the records intentionally lack.
  const sql = `
    INSERT INTO users (id, username, password_hash, role, name, email, phone,
                       age, gender, specialty, license_number, location,
                       hospital, biography, rating, is_available)
    VALUES ($1, $2, $3, 'doctor', $4, NULL, NULL,
            $5, $6, $7, $8, $9, $10, $11, NULL, $12)
    ON CONFLICT DO NOTHING`;
  const params = [
    doctor.id, doctor.username, passwordHash, doctor.name,
    doctor.age, doctor.gender, doctor.specialty, doctor.license_number,
    doctor.location, doctor.hospital, SYNTHETIC_BIOGRAPHY,
    doctor.is_available,
  ];
  return { sql, params };
}

/** Redact a connection string to its safe identity parts. */
function describeTarget(connectionString) {
  try {
    const u = new URL(connectionString);
    return {
      host: u.hostname,
      port: u.port || '(default)',
      database: (u.pathname || '/').replace(/^\//, '') || '(default)',
      user: u.username || '(default)',
    };
  } catch {
    return { host: '(unparseable)', port: '?', database: '?', user: '?' };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const statusOnly = argv.includes('--status');

  // ── Safety gates ─────────────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    console.error('[seed-doctors] REFUSED: NODE_ENV=production. This script must never run against production.');
    process.exit(1);
  }
  if (!statusOnly && !dryRun && process.env.CONFIRM_NON_PRODUCTION_SEED !== '1') {
    console.error(
      '[seed-doctors] REFUSED: set CONFIRM_NON_PRODUCTION_SEED=1 after verifying ' +
        'DATABASE_URL targets a NON-PRODUCTION database/branch (run --dry-run first ' +
        'and check the printed host against your Neon preview branch endpoint).',
    );
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[seed-doctors] DATABASE_URL is required (see .env.example).');
    process.exit(1);
  }

  const ssl = !/localhost|127\.0\.0\.1/.test(connectionString)
    ? { rejectUnauthorized: false }
    : undefined;
  const pool = new Pool({ connectionString, ssl });

  try {
    // ── Target identity (always printed; never the connection string) ──────
    const target = describeTarget(connectionString);
    const { rows: ident } = await pool.query('SELECT current_database() AS db, current_user AS usr');
    const { rows: before } = await pool.query(
      `SELECT count(*)::int AS doctors FROM users WHERE role = 'doctor'`,
    );
    console.log('[seed-doctors] target host       :', target.host + (target.port !== '(default)' ? ':' + target.port : ''));
    console.log('[seed-doctors] target database  :', ident[0].db, '(connection-string name:', target.database + ')');
    console.log('[seed-doctors] target user      :', ident[0].usr);
    console.log('[seed-doctors] existing doctors  :', before[0].doctors);

    // ── Canonical specialties come from the database (source of truth) ────
    const { rows: specRows } = await pool.query('SELECT name FROM specialties ORDER BY position, name');
    const canonical = specRows.map((r) => r.name);
    if (canonical.length === 0) {
      console.error('[seed-doctors] ABORT: specialties table is empty — run scripts/migrate.js first.');
      process.exit(1);
    }
    const invalid = SYNTHETIC_DOCTORS.filter((d) => !canonical.includes(d.specialty));
    if (invalid.length > 0) {
      console.error(
        '[seed-doctors] ABORT: specialties not in the database:',
        invalid.map((d) => `${d.username}→"${d.specialty}"`).join(', '),
      );
      process.exit(1);
    }

    // ── Status mode: report and exit without writing ──────────────────────
    if (statusOnly) {
      const { rows: seeded } = await pool.query(
        `SELECT username, name, specialty, rating, is_available FROM users WHERE id LIKE 'doctor\\_seed\\_%' ORDER BY id`,
      );
      console.log('[seed-doctors] synthetic profiles present:', seeded.length);
      for (const s of seeded) {
        const rating = s.rating === null ? 'non noté' : `noté ${s.rating}`;
        console.log(`  - ${s.username} | ${s.name} | ${s.specialty} | ${rating} | ${s.is_available ? 'disponible' : 'indisponible'}`);
      }
      return;
    }

    // ── Dry-run mode: print the plan without writing ──────────────────────
    if (dryRun) {
      console.log('[seed-doctors] DRY RUN — no writes. Would insert:');
      for (const d of SYNTHETIC_DOCTORS) {
        console.log(`  - ${d.username} | ${d.name} | ${d.specialty} | ${d.hospital} | ${d.license_number}`);
      }
      console.log('[seed-doctors] verify the host above is your NON-PRODUCTION branch, then re-run with CONFIRM_NON_PRODUCTION_SEED=1');
      return;
    }

    // ── Insert (idempotent) ───────────────────────────────────────────────
    let inserted = 0;
    let existing = 0;
    for (const doctor of SYNTHETIC_DOCTORS) {
      const { sql, params } = buildDoctorInsert(doctor);
      const { rowCount } = await pool.query(sql, params);
      if (rowCount === 1) inserted += 1;
      else existing += 1;
    }
    console.log(`[seed-doctors] inserted: ${inserted}, already present (untouched): ${existing}`);

    // ── Post-verify: doctor search must return them ──────────────────────
    const { rows: all } = await pool.query(
      `SELECT specialty, count(*)::int AS n FROM users WHERE role = 'doctor' GROUP BY specialty ORDER BY specialty`,
    );
    console.log('[seed-doctors] doctor counts by specialty (what GET /api/doctors?specialty= returns):');
    for (const r of all) console.log(`  - ${r.specialty}: ${r.n}`);
    const { rows: seededCount } = await pool.query(
      `SELECT count(*)::int AS n FROM users WHERE id LIKE 'doctor\\_seed\\_%'`,
    );
    console.log('[seed-doctors] synthetic profiles in database:', seededCount[0].n);
    if (seededCount[0].n !== SYNTHETIC_DOCTORS.length) {
      console.error(
        `[seed-doctors] WARNING: expected ${SYNTHETIC_DOCTORS.length} synthetic profiles, found ${seededCount[0].n}` +
          ' — a colliding username or id may be blocking an identity. Run --status to inspect.',
      );
      process.exit(1);
    }
  } catch (err) {
    console.error('[seed-doctors] fatal:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { SYNTHETIC_DOCTORS, SYNTHETIC_BIOGRAPHY, buildDoctorInsert, describeTarget };
