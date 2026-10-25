/**
 * Seed-doctors script tests — run against the embedded PostgreSQL booted by
 * the global setup (migrations + canonical specialties already applied).
 *
 * Proves:
 *   1. The safety gate refuses to run without CONFIRM_NON_PRODUCTION_SEED=1
 *      (and writes nothing).
 *   2. A confirmed run inserts the 10 synthetic profiles exactly once.
 *   3. Re-running is idempotent (no duplicates, no overwrites).
 *   4. The doctor-search query (listDoctors semantics: role='doctor' AND
 *      specialty=…) returns the synthetic profiles, with specialty filtering.
 *   5. The profiles are honest: synthetic biography + DEMO license, no
 *      email/phone, and real (bcrypt) password hashes that do not match any
 *      guessable password.
 *   6. Pre-existing rows are never overwritten (a real doctor with a
 *      colliding username keeps its data).
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
    expect(res.stdout).toContain('dr.seed.dariste');
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

  it('inserts the 10 synthetic profiles on a confirmed run', async () => {
    const res = await seedRun();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('inserted: 10, already present (untouched): 0');
    const rows = await doctorRows();
    expect(rows.length).toBe(10);
  });

  it('re-running is idempotent: nothing inserted, nothing duplicated', async () => {
    const res = await seedRun();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('inserted: 0, already present (untouched): 10');
    const rows = await doctorRows();
    expect(rows.length).toBe(10);
  });

  it('the doctor search (listDoctors semantics) returns the synthetic profiles', async () => {
    const all = await usersRepo.listDoctors();
    const seeded = all.filter((d) => d.username.startsWith('dr.seed.'));
    expect(seeded.length).toBe(10);
  });

  it('specialty filtering returns the matching synthetic profiles only', async () => {
    // The suite shares one database: earlier files leave fixture doctors
    // behind, so assert on the seeded subset (username prefix) rather than
    // absolute counts.
    const cardio = await usersRepo.listDoctors('Cardiologie');
    const cardioSeeded = cardio.filter((d) => d.username.startsWith('dr.seed.'));
    expect(cardioSeeded.length).toBe(1);
    expect(cardioSeeded[0].username).toBe('dr.seed.dariste');
    expect(cardioSeeded[0].name).toBe('Dr Alain Dariste');

    const nutrition = await usersRepo.listDoctors('Nutrition');
    const nutritionSeeded = nutrition.filter((d) => d.username.startsWith('dr.seed.'));
    expect(nutritionSeeded.length).toBe(1);
    expect(nutritionSeeded[0].username).toBe('dr.seed.larose');

    // A specialty with no synthetic doctor returns none of them.
    const neuro = await usersRepo.listDoctors('Neurologie');
    expect(neuro.filter((d) => d.username.startsWith('dr.seed.')).length).toBe(0);
  });

  it('profiles are honest: synthetic markers, no contact PII, real password hashes', async () => {
    const rows = await doctorRows();
    for (const r of rows) {
      expect(r.role).toBe('doctor');
      expect(r.biography).toContain('démonstration');
      expect(r.biography).toContain('fictif');
      expect(r.license_number).toMatch(/^DEMO-LIC-\d{4}$/);
      expect(r.email).toBeNull();
      expect(r.phone).toBeNull();
      expect(r.hospital).toContain('Démo');
      // Real bcrypt hash ($2a$/$2b$ prefix), not a placeholder.
      expect(r.password_hash).toMatch(/^\$2[ab]\$/);
    }
  });

  it('the password hashes do not authenticate with any guessable password', async () => {
    const rows = await doctorRows();
    const bcrypt = (await import('bcryptjs')).default ?? (await import('bcryptjs'));
    const guesses = ['password', 'demo1234', 'demo', '1234', 'seed', 'medika', ''];
    for (const r of rows) {
      for (const g of guesses) {
        expect(bcrypt.compareSync(g, r.password_hash)).toBe(false);
      }
    }
  });

  it('never overwrites a pre-existing doctor with a colliding username', async () => {
    // A "real" doctor that reuses a seed username but with different data.
    const { query } = await import('../src/db.js');
    const bcrypt = (await import('bcryptjs')).default ?? (await import('bcryptjs'));
    await query(
      `INSERT INTO users (id, username, password_hash, role, name, specialty, license_number)
       VALUES ('doctor_real_1', 'dr.seed.dariste', $1, 'doctor', 'Dr Real Existing', 'Neurologie', 'REAL-LIC-1')
       ON CONFLICT (username) DO UPDATE SET name = 'Dr Real Existing', specialty = 'Neurologie', license_number = 'REAL-LIC-1'`,
      [bcrypt.hashSync('Passw0rd!', 10)],
    );
    const res = await seedRun();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('inserted: 0, already present (untouched): 10');
    const { rows } = await query(`SELECT name, specialty FROM users WHERE username = 'dr.seed.dariste'`);
    expect(rows[0].name).toBe('Dr Real Existing');
    expect(rows[0].specialty).toBe('Neurologie');
  });

  it('the script data only uses canonical specialties from the database', async () => {
    const { query } = await import('../src/db.js');
    const { rows } = await query('SELECT name FROM specialties');
    const canonical = rows.map((r) => r.name);
    const { SYNTHETIC_DOCTORS } = await importCjs('../scripts/seed-doctors.js');
    expect(SYNTHETIC_DOCTORS.length).toBe(10);
    for (const d of SYNTHETIC_DOCTORS) {
      expect(canonical).toContain(d.specialty);
    }
    // Stable, non-colliding ids.
    const ids = SYNTHETIC_DOCTORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(10);
    for (const id of ids) expect(id).toMatch(/^doctor_seed_\d{2}$/);
  });
});

async function importCjs(modulePath) {
  const m = await import(modulePath);
  return m.default ?? m;
}
