/**
 * Cold-start auto-migration (production incident fix, Nov 2026).
 *
 * These tests boot the REAL entry point (server.js) in child processes
 * against FRESH, EMPTY PostgreSQL databases — exactly what a fresh deploy's
 * serverless cold start sees — and assert that the API self-migrates:
 *
 *   1. healing      — an empty database comes up with the full schema
 *                     (migrations 001–013), including every prescription /
 *                     medication-order / delivery table, so the endpoints
 *                     that 500'd in production ("Impossible de charger
 *                     l'ordonnance", "Erreur interne du serveur") work.
 *   2. idempotency  — a second cold start on the same database applies
 *                     nothing, logs no failure, and leaves exactly 13 rows
 *                     in schema_migrations.
 *   3. opt-out      — AUTO_MIGRATE=0 leaves a fresh database untouched.
 *
 * Child processes are used because the auto-migration runs at module-load
 * time in the entry point; a child is the only honest way to exercise that
 * path with a different DATABASE_URL than the workers' shared database.
 */
'use strict';

import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { Pool } = await import('pg');

/** Parse the worker DATABASE_URL (set by global-setup) into parts. */
function baseUrlParts() {
  const url = new URL(process.env.DATABASE_URL);
  return { url, host: url.hostname, port: Number(url.port), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
}

const createdDatabases = [];

/** Fresh, EMPTY database (no migrations) on the shared embedded instance. */
async function createFreshDatabase(name) {
  const { url, user, password, host, port } = baseUrlParts();
  const admin = new Pool({ host, port, user, password, database: 'postgres' });
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  createdDatabases.push(name);
  const fresh = new URL(url.toString());
  fresh.pathname = `/${name}`;
  return fresh.toString();
}

function freePort() {
  // Keep clear of the embedded PostgreSQL range (5400-5499).
  return 4600 + randomInt(300);
}

/** Boot server.js as a real child process; resolve once /api/health answers. */
function bootServer({ databaseUrl, port, autoMigrate }) {
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: String(port),
    NODE_ENV: 'development',
    ...(autoMigrate === undefined ? {} : { AUTO_MIGRATE: autoMigrate }),
  };
  const child = spawn(process.execPath, [path.join(repoRoot, 'server.js')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (d) => stdout.push(String(d)));
  child.stderr.on('data', (d) => stderr.push(String(d)));
  child.exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));

  const waitHealthy = async (timeoutMs = 25_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode}):\n${stdout.join('')}${stderr.join('')}`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (res.ok) return;
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`server did not become healthy within ${timeoutMs}ms\n${stdout.join('')}${stderr.join('')}`);
  };

  const stop = async () => {
    if (child.exitCode === null) child.kill('SIGKILL');
    await child.exited;
  };

  return { child, stdout: () => stdout.join(''), stderr: () => stderr.join(''), waitHealthy, stop };
}

async function tableExists(dbUrl, table) {
  const pool = new Pool({ connectionString: dbUrl });
  try {
    const { rows } = await pool.query(
      `SELECT to_regclass($1) AS oid`,
      [`public.${table}`]
    );
    return rows[0].oid !== null;
  } finally {
    await pool.end();
  }
}

async function appliedMigrations(dbUrl) {
  const pool = new Pool({ connectionString: dbUrl });
  try {
    const { rows } = await pool.query(`SELECT id FROM schema_migrations ORDER BY id`);
    return rows.map((r) => r.id);
  } finally {
    await pool.end();
  }
}

/** The tables behind the endpoints that broke in production. */
const PROD_OUTAGE_TABLES = [
  'prescription_documents',     // migration 009 — GET prescription
  'medication_orders',          // migration 010 — GET medication-order
  'partner_pharmacies',         // migration 010 — ops quoting
  'medication_payments',        // migration 011/012 — MonCash payments
  'delivery_zones',             // migration 013 — coverage zones
  'medication_deliveries',      // migration 013 — delivery tracking
];

const EXPECTED_MIGRATIONS = Array.from({ length: 13 }, (_, i) => {
  const n = String(i + 1).padStart(3, '0');
  return migrationFiles().find((f) => f.startsWith(`${n}_`));
});

function migrationFiles() {
  return fs.readdirSync(path.join(repoRoot, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
}

afterAll(async () => {
  // Best-effort cleanup of the scratch databases (the embedded instance is
  // torn down with the run anyway).
  for (const name of createdDatabases) {
    const { user, password, host, port } = baseUrlParts();
    const admin = new Pool({ host, port, user, password, database: 'postgres' });
    try { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); } catch { /* best effort */ }
    await admin.end();
  }
});

describe('auto-migrate: the API self-heals a fresh production database', () => {
  it('a cold start on an EMPTY database applies every migration (001–013), including the prescription tables', async () => {
    const dbUrl = await createFreshDatabase(`medika_auto_heal_${randomInt(100000)}`);
    const port = freePort();
    const server = bootServer({ databaseUrl: dbUrl, port });

    try {
      await server.waitHealthy();

      // The whole schema exists — especially the tables whose absence caused
      // the Nov 2026 production outage.
      for (const table of PROD_OUTAGE_TABLES) {
        expect(await tableExists(dbUrl, table), `${table} must exist after cold start`).toBe(true);
      }

      // Every migration file is recorded as applied.
      expect(await appliedMigrations(dbUrl)).toEqual(EXPECTED_MIGRATIONS);

      // The logs name what was applied (Vercel log visibility for support).
      expect(server.stdout()).toMatch(/\[auto-migrate\] applied 009_prescription_documents\.sql/);
      expect(server.stdout()).toMatch(/\[auto-migrate\] 13 migration\(s\) applied at cold start/);

      // The failure path is gone: the exact endpoint that answered 500
      // "Erreur interne du serveur" in production now answers a proper,
      // authenticated 401/404 — i.e. the route reaches its SQL.
      const res = await fetch(`http://127.0.0.1:${port}/api/consultations/nonexistent/prescription`);
      expect(res.status).toBe(401); // auth gate, NOT a 500 from a missing table
    } finally {
      await server.stop();
    }
  }, 40_000);

  it('a SECOND cold start on the same database is a clean no-op', async () => {
    const dbUrl = await createFreshDatabase(`medika_auto_idem_${randomInt(100000)}`);
    const first = bootServer({ databaseUrl: dbUrl, port: freePort() });
    await first.waitHealthy();
    await first.stop();

    const second = bootServer({ databaseUrl: dbUrl, port: freePort() });
    try {
      await second.waitHealthy();
      expect(await appliedMigrations(dbUrl)).toEqual(EXPECTED_MIGRATIONS);
      expect(second.stdout()).not.toMatch(/\[auto-migrate\] applied/);
      expect(second.stderr()).not.toMatch(/\[auto-migrate\] FAILED/);
    } finally {
      await second.stop();
    }
  }, 40_000);

  it('AUTO_MIGRATE=0 opts out: a fresh database stays untouched (and the API still boots)', async () => {
    const dbUrl = await createFreshDatabase(`medika_auto_off_${randomInt(100000)}`);
    const server = bootServer({ databaseUrl: dbUrl, port: freePort(), autoMigrate: '0' });
    try {
      await server.waitHealthy(); // the gate is fail-open: /api/health serves
      expect(await tableExists(dbUrl, 'schema_migrations')).toBe(false);
      expect(await tableExists(dbUrl, 'prescription_documents')).toBe(false);
    } finally {
      await server.stop();
    }
  }, 40_000);
});
