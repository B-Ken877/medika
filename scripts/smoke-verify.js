#!/usr/bin/env node
/**
 * Post-migration smoke verification.
 *
 *   DATABASE_URL=postgres://… [DATA_DIR=/path/to/legacy/data] node scripts/smoke-verify.js
 *
 * Compares PostgreSQL row counts against the legacy JSON files (when DATA_DIR
 * is provided), verifies referential integrity, checks the admin account and
 * specialties exist, and prints a pass/fail report. Read-only: it never
 * modifies or deletes data. The legacy JSON files are the rollback source —
 * keep them until this verification passes AND the team signs off.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function readJson(dir, name) {
  const fp = path.join(dir, name);
  if (!fs.existsSync(fp)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return Array.isArray(data) ? data : [data];
  } catch {
    return null;
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  const ssl = !/localhost|127\.0\.0\.1/.test(connectionString) ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString, ssl });

  const failures = [];
  const checks = [];

  const tables = ['users', 'specialties', 'consultations', 'messages', 'payments', 'tickets', 'ticket_messages', 'consultation_notes', 'medical_histories'];
  const counts = {};
  for (const t of tables) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
    counts[t] = rows[0].n;
  }
  console.log('\n[verify] PostgreSQL row counts:');
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(22)} ${n}`);

  // JSON comparison when DATA_DIR provided
  const dataDir = process.env.DATA_DIR;
  if (dataDir && fs.existsSync(dataDir)) {
    console.log('\n[verify] JSON source comparison:');
    const pairs = [
      ['users', 'users.json'],
      ['specialties', 'specialties.json'],
      ['consultations', 'consultations.json'],
      ['tickets', 'tickets.json'],
      ['consultation_notes', 'consultation-notes.json'],
      ['medical_histories', 'medical-histories.json'],
    ];
    for (const [table, file] of pairs) {
      const json = readJson(dataDir, file);
      if (json === null) {
        console.log(`  ${file.padEnd(24)} (not present — skipped)`);
        continue;
      }
      const ok = counts[table] >= json.length;
      console.log(`  ${file.padEnd(24)} json=${json.length}  db=${counts[table]}  ${ok ? 'OK' : 'MISMATCH'}`);
      if (!ok) failures.push(`${table}: db has fewer rows than ${file}`);
    }
    // messages/ticket_messages: no stable ids in JSON → count comparison only
    for (const [table, file] of [['messages', 'messages.json'], ['ticket_messages', 'ticket_messages.json']]) {
      const json = readJson(dataDir, file);
      if (json === null) continue;
      const ok = counts[table] >= json.length;
      console.log(`  ${file.padEnd(24)} json=${json.length}  db=${counts[table]}  ${ok ? 'OK (>=)' : 'MISMATCH'}`);
      if (!ok) failures.push(`${table}: db has fewer rows than ${file}`);
    }
  } else {
    checks.push('DATA_DIR not provided — JSON source comparison skipped');
  }

  // Referential integrity
  const orphans = await pool.query(
    `SELECT count(*)::int AS n FROM messages m
     LEFT JOIN consultations c ON c.id = m.consultation_id
     WHERE c.id IS NULL`
  );
  if (orphans.rows[0].n > 0) {
    failures.push(`${orphans.rows[0].n} messages reference missing consultations`);
  } else {
    checks.push('messages → consultations referential integrity OK');
  }

  const orphanNotes = await pool.query(
    `SELECT count(*)::int AS n FROM consultation_notes n
     LEFT JOIN consultations c ON c.id = n.consultation_id WHERE c.id IS NULL`
  );
  if (orphanNotes.rows[0].n > 0) failures.push(`${orphanNotes.rows[0].n} notes reference missing consultations`);
  else checks.push('consultation_notes → consultations referential integrity OK');

  // Sanity: admin + specialties
  const admins = await pool.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin'`);
  if (admins.rows[0].n < 1) failures.push('no admin account exists');
  else checks.push('admin account exists');

  if (counts.specialties < 1) failures.push('specialties table is empty');
  else checks.push(`specialties present (${counts.specialties})`);

  // Unique constraints active (spot check: duplicate usernames impossible)
  const dupUsernames = await pool.query(
    `SELECT count(*)::int AS n FROM (SELECT username FROM users GROUP BY username HAVING count(*) > 1) d`
  );
  if (dupUsernames.rows[0].n > 0) failures.push('duplicate usernames found');
  else checks.push('username uniqueness OK');

  console.log('\n[verify] checks:');
  for (const c of checks) console.log(`  ✔ ${c}`);
  if (failures.length) {
    console.log('\n[verify] FAILURES:');
    for (const f of failures) console.log(`  ✘ ${f}`);
    console.log('\n[verify] RESULT: FAILED — DO NOT decommission the legacy JSON files.');
    await pool.end();
    process.exit(1);
  }
  console.log('\n[verify] RESULT: PASSED. (Keep the JSON files until the team signs off on the migration — they are the rollback source.)');
  await pool.end();
}

main().catch((err) => {
  console.error('[verify] fatal:', err.message);
  process.exit(1);
});
