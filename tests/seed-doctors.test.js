/**
 * Seed-doctors script tests — run against the embedded PostgreSQL booted by
 * the global setup (migrations + canonical specialties already applied).
 *
 * Seed strategy under test (see scripts/seed-doctors.js header):
 *   - identities are id = username = doctor_seed_01…doctor_seed_10, exactly
 *     matching the 10 rows manually seeded on the Neon preview branch
 *     (preview/feat/clinical-calm-redesign);
 *   - INSERTs end in a bare ON CONFLICT DO NOTHING, so a rerun is skipped on
 *     EITHER unique constraint (primary key id OR username) — no crash, no
 *     duplicate, no overwrite;
 *   - profiles are honest: no email/phone, rating explicitly NULL (never the
 *     schema default of 5.0), DEMO license, disclosed fictional biography.
 *
 * Proves:
 *   1. The safety gate refuses to run without CONFIRM_NON_PRODUCTION_SEED=1
 *      (and writes nothing) and refuses NODE_ENV=production.
 *   2. REGRESSION: against a database that already holds the manual-seed
 *      identities (id = username = doctor_seed_NN, different field values),
 *      the script neither crashes on the primary-key collision nor
 *      duplicates nor overwrites those rows.
 *   3. On a fresh database a confirmed run inserts the 10 profiles exactly
 *      once with NULL ratings; re-running is idempotent.
 *   4. The doctor-search query (listDoctors semantics: role='doctor' AND
 *      specialty=…) returns the synthetic profiles, with specialty filtering.
 *   5. A seed username claimed by a different (real) row is skipped, not
 *      overwritten, and the blocked identity is reported honestly.
 *   6. Canonical specialties only; stable, coherent identities (username = id).
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it, beforeAll } from 'vitest';
const h = await import('./helpers');

const SCRIPT = new URL('../scripts/seed-doctors.js', import.meta.url).pathname;

function runScript(args, extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    timeout: 20_000,
  });
}

let usersRepo;

async function seedRun(extraEnv = {}) {
  return runScript([], { CONFIRM_NON_PRODUCTION_SEED: '1', ...extraEnv });
}

async function doctorRows() {
  const { query } = await import('../src/db.js');
  const { rows } = await query(
    `SELECT * FROM users WHERE id LIKE 'doctor\\_seed\\_%' ORDER BY id`,
  );
  return rows;
}

async function rawQuery(sql, params = []) {
  const { query } = await import('../src/db.js');
  return query(sql, params);
}

async function importBcrypt() {
  return (await import('bcryptjs')).default ?? (await import('bcryptjs'));
}

describe('seed-doctors safety gate', () => {
  it('refuses to run without CONFIRM_NON_PRODUCTION_SEED=1 and writes nothing', async () => {
    const res = runScript([]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('REFUSED');
    const rows = await doctorRows();
    expect(rows.length).toBe(0);
  });

  it('refuses to run when NODE_ENV=production even with the confirmation flag', () => {
    const res = runScript([], { CONFIRM_NON_PRODUCTION_SEED: '1', NODE_ENV: 'production' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('REFUSED');
    expect(res.stderr).toContain('production');
  });

  it('dry-run prints the plan without writing', async () => {
    const res = runScript(['--dry-run'], { CONFIRM_NON_PRODUCTION_SEED: '1' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('DRY RUN');
    expect(res.stdout).toContain('doctor_seed_01');
    const rows = await doctorRows();
    expect(rows.length).toBe(0);
  });

  it('--status reports zero synthetic profiles before seeding', () => {
    const res = runScript(['--status']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('synthetic profiles present: 0');
  });
});

describe('seed-doctors seeding', () => {
  beforeAll(async () => {
    usersRepo = await importCjs('../src/repos/users.js');
  });

  // The exact situation on the Neon preview branch: 10 rows already exist
  // with id = username = doctor_seed_NN but manually chosen field values.
  it('REGRESSION: existing manual-seed identities (id = username = doctor_seed_NN) are neither crashed on, duplicated, nor overwritten', async () => {
    const bcrypt = await importBcrypt();
    for (let i = 1; i <= 10; i++) {
      const nn = String(i).padStart(2, '0');
      await rawQuery(
        `INSERT INTO users (id, username, password_hash, role, name, email, phone,
                            specialty, license_number, rating, is_available, biography)
         VALUES ($1, $1, $2, 'doctor', $3, NULL, NULL,
                 'Neurologie', $4, NULL, true, $5)`,
        [`doctor_seed_${nn}`, bcrypt.hashSync('ManualSeedPass!1', 10),
          `Dr Manuel Seed ${nn}`, `DEMO-LIC-M${nn}`,
          'Profil manuel préexistant — semé à la main avant le script.'],
      );
    }

    const res = await seedRun();
    expect(res.status).toBe(0); // no crash despite id AND username collisions
    expect(res.stdout).toContain('inserted: 0, already present (untouched): 10');

    const rows = await doctorRows();
    expect(rows.length).toBe(10); // no duplicates
    for (let i = 0; i < rows.length; i++) {
      const nn = String(i + 1).padStart(2, '0');
      expect(rows[i].id).toBe(`doctor_seed_${nn}`);
      expect(rows[i].username).toBe(`doctor_seed_${nn}`);
      expect(rows[i].name).toBe(`Dr Manuel Seed ${nn}`); // not overwritten
      expect(rows[i].specialty).toBe('Neurologie');
      expect(rows[i].license_number).toBe(`DEMO-LIC-M${nn}`);
      expect(rows[i].biography).toContain('semé à la main');
      expect(rows[i].rating).toBeNull();
    }
  });

  it('on a fresh database a confirmed run inserts the 10 profiles with NULL ratings', async () => {
    await rawQuery(`DELETE FROM users WHERE id LIKE 'doctor\\_seed\\_%'`);
    const res = await seedRun();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('inserted: 10, already present (untouched): 0');
    const rows = await doctorRows();
    expect(rows.length).toBe(10);
    for (const r of rows) {
      // Explicit NULL, never the schema default of 5.0: no fabricated ratings.
      expect(r.rating).toBeNull();
    }
  });

  it('re-running is idempotent: nothing inserted, nothing duplicated, nothing overwritten', async () => {
    const res = await seedRun();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('inserted: 0, already present (untouched): 10');
    const rows = await doctorRows();
    expect(rows.length).toBe(10);
    expect(rows[0].name).toBe('Dr Alain Dariste');
    expect(rows[9].name).toBe('Dr Sylvie Larose');
  });

  it('the doctor search (listDoctors semantics) returns the synthetic profiles', async () => {
    const all = await usersRepo.listDoctors();
    const seeded = all.filter((d) => d.username.startsWith('doctor_seed_'));
    expect(seeded.length).toBe(10);
    for (const d of seeded) expect(d.rating).toBeNull();
  });

  it('specialty filtering returns the matching synthetic profiles only', async () => {
    // The suite shares one database: earlier files leave fixture doctors
    // behind, so assert on the seeded subset (username prefix) rather than
    // absolute counts.
    const cardio = await usersRepo.listDoctors('Cardiologie');
    const cardioSeeded = cardio.filter((d) => d.username.startsWith('doctor_seed_'));
    expect(cardioSeeded.length).toBe(1);
    expect(cardioSeeded[0].username).toBe('doctor_seed_01');
    expect(cardioSeeded[0].id).toBe('doctor_seed_01');
    expect(cardioSeeded[0].name).toBe('Dr Alain Dariste');

    const nutrition = await usersRepo.listDoctors('Nutrition');
    const nutritionSeeded = nutrition.filter((d) => d.username.startsWith('doctor_seed_'));
    expect(nutritionSeeded.length).toBe(1);
    expect(nutritionSeeded[0].username).toBe('doctor_seed_10');

    // A specialty with no synthetic doctor returns none of them.
    const neuro = await usersRepo.listDoctors('Neurologie');
    expect(neuro.filter((d) => d.username.startsWith('doctor_seed_')).length).toBe(0);
  });

  it('profiles are honest: synthetic markers, no contact PII, no ratings, real password hashes', async () => {
    const rows = await doctorRows();
    for (const r of rows) {
      expect(r.role).toBe('doctor');
      expect(r.biography).toContain('démonstration');
      expect(r.biography).toContain('fictif');
      expect(r.license_number).toMatch(/^DEMO-LIC-\d{4}$/);
      expect(r.email).toBeNull();
      expect(r.phone).toBeNull();
      expect(r.rating).toBeNull(); // no fabricated ratings
      expect(r.hospital).toContain('Démo');
      // Real bcrypt hash ($2a$/$2b$ prefix), not a placeholder.
      expect(r.password_hash).toMatch(/^\$2[ab]\$/);
    }
  });

  it('the password hashes do not authenticate with any guessable password', async () => {
    const rows = await doctorRows();
    const bcrypt = await importBcrypt();
    const guesses = ['password', 'demo1234', 'demo', '1234', 'seed', 'medika', ''];
    for (const r of rows) {
      for (const g of guesses) {
        expect(bcrypt.compareSync(g, r.password_hash)).toBe(false);
      }
    }
  });

  it('a seed username claimed by a different real row is skipped and reported, never overwritten', async () => {
    const bcrypt = await importBcrypt();
    // Isolate the scenario: start from a clean slate, then claim ONLY the
    // username of one seed identity with a different (real) row — the seed
    // insert for that identity then collides on the username constraint
    // alone (its own id is free).
    await rawQuery(`DELETE FROM users WHERE id LIKE 'doctor\\_seed\\_%'`);
    await rawQuery(
      `INSERT INTO users (id, username, password_hash, role, name, specialty, license_number)
       VALUES ('doctor_real_1', 'doctor_seed_07', $1, 'doctor', 'Dr Real Existing', 'Neurologie', 'REAL-LIC-1')`,
      [bcrypt.hashSync('Passw0rd!', 10)],
    );

    const res = await seedRun();
    // No crash: the username-only conflict is skipped like any other.
    expect(res.stdout).toContain('inserted: 9, already present (untouched): 1');
    // The post-verify count (9 id-prefixed rows, not 10) is reported honestly.
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('WARNING');

    const { rows: claimed } = await rawQuery(`SELECT name, specialty FROM users WHERE username = 'doctor_seed_07'`);
    expect(claimed.length).toBe(1);
    expect(claimed[0].name).toBe('Dr Real Existing'); // not overwritten
    expect(claimed[0].specialty).toBe('Neurologie');
    // The free id was NOT used to sneak a second row in for that identity.
    const { rows: byId } = await rawQuery(`SELECT id FROM users WHERE id = 'doctor_seed_07'`);
    expect(byId.length).toBe(0);
  });

  it('the script data only uses canonical specialties and coherent identities', async () => {
    const { rows } = await rawQuery('SELECT name FROM specialties');
    const canonical = rows.map((r) => r.name);
    const { SYNTHETIC_DOCTORS } = await importCjs('../scripts/seed-doctors.js');
    expect(SYNTHETIC_DOCTORS.length).toBe(10);
    for (const d of SYNTHETIC_DOCTORS) {
      expect(canonical).toContain(d.specialty);
      // Identity contract with the existing Neon preview records.
      expect(d.username).toBe(d.id);
      expect(d.id).toMatch(/^doctor_seed_\d{2}$/);
      // The dataset carries no ratings — rating must stay NULL in SQL.
      expect(d.rating).toBeUndefined();
    }
    // Stable, non-colliding ids.
    const ids = SYNTHETIC_DOCTORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(10);
  });
});

async function importCjs(modulePath) {
  const m = await import(modulePath);
  return m.default ?? m;
}
