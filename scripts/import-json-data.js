#!/usr/bin/env node
/**
 * JSON → PostgreSQL importer — migrates the legacy file-based data.
 *
 *   DATABASE_URL=postgres://… DATA_DIR=/path/to/server/data \
 *     node scripts/import-json-data.js [--dry-run]
 *
 * DATA_DIR is the directory that contained the legacy JSON files on the VPS
 * (users.json, consultations.json, messages.json, specialties.json,
 * tickets.json, ticket_messages.json, consultation-notes.json,
 * medical-histories.json). Files may be missing — only present ones import.
 *
 * Safety:
 *  - INSERT … ON CONFLICT DO NOTHING (idempotent, re-runnable);
 *  --dry-run prints what would be imported without writing;
 *  - NEVER deletes or modifies the source JSON files.
 *
 * After importing, run scripts/smoke-verify.js to compare row counts.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const toDate = (unixSeconds) =>
  Number.isFinite(Number(unixSeconds)) && Number(unixSeconds) > 0
    ? new Date(Number(unixSeconds) * 1000).toISOString()
    : null;

function readJson(dir, name) {
  const fp = path.join(dir, name);
  if (!fs.existsSync(fp)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return Array.isArray(data) ? data : [data];
  } catch (err) {
    console.warn(`[import] ${name}: parse error (${err.message}) — skipped`);
    return null;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) {
    console.error('DATA_DIR is required (directory containing the legacy *.json files).');
    process.exit(1);
  }
  if (!fs.existsSync(dataDir)) {
    console.error(`DATA_DIR does not exist: ${dataDir}`);
    process.exit(1);
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  const ssl = !/localhost|127\.0\.0\.1/.test(connectionString) ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString, ssl });

  const users = readJson(dataDir, 'users.json');
  const consultations = readJson(dataDir, 'consultations.json');
  const messages = readJson(dataDir, 'messages.json');
  const specialties = readJson(dataDir, 'specialties.json');
  const tickets = readJson(dataDir, 'tickets.json');
  const ticketMessages = readJson(dataDir, 'ticket_messages.json');
  const notes = readJson(dataDir, 'consultation-notes.json');
  const histories = readJson(dataDir, 'medical-histories.json');

  const stats = {};
  const record = (k, n) => { stats[k] = { imported: n, source: n }; };
  const recordSkips = (k, imported, skipped, source) => {
    stats[k] = { imported, skipped, source };
  };

  async function insert(sql, params) {
    if (dryRun) return;
    await pool.query(sql, params);
  }

  // ─── users ─────────────────────────────────────────────────────────────────
  if (users) {
    let n = 0;
    for (const u of users) {
      if (!u.id || !u.username) continue;
      await insert(
        `INSERT INTO users (id, username, password_hash, role, name, email, phone, age, gender,
            specialty, license_number, location, hospital, biography, avatar_url, rating,
            is_available, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.username, u.password_hash || '!', ['patient', 'doctor', 'admin'].includes(u.role) ? u.role : 'patient',
         u.name || u.username, u.email ?? null, u.phone ?? null,
         u.age === undefined || u.age === null || u.age === '' ? null : parseInt(u.age, 10) || null,
         u.gender ?? null, u.specialty ?? null, u.license_number ?? null, u.location ?? null,
         u.hospital ?? null, u.biography ?? null, u.avatar_url ?? null,
         u.rating ?? 5.0, u.is_available === undefined ? true : Boolean(u.is_available),
         toDate(u.created_at)]
      );
      n++;
    }
    record('users', n);
  }

  // ─── specialties (if the VPS copy exists; repo copy seeds via migrate) ────
  if (specialties) {
    let n = 0;
    for (let i = 0; i < specialties.length; i++) {
      const s = specialties[i];
      if (!s.id || !s.name) continue;
      await insert(
        `INSERT INTO specialties (id, name, price, position) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO NOTHING`,
        [s.id, s.name, s.price ?? 750, i]
      );
      n++;
    }
    record('specialties', n);
  }

  // ─── consultations ─────────────────────────────────────────────────────────
  if (consultations) {
    let n = 0;
    for (const c of consultations) {
      if (!c.id) continue;
      await insert(
        `INSERT INTO consultations (id, patient_id, patient_name, patient_age, doctor_id, description,
            specialty_needed, urgency_level, ai_summary, ai_explanation, status, prescription, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.patient_id ?? null, c.patient_name || 'Inconnu',
         c.patient_age === undefined || c.patient_age === null || c.patient_age === '' ? null : parseInt(c.patient_age, 10) || null,
         c.doctor_id ?? null, c.description || '',
         c.specialty_needed || 'Medecine Generale', c.urgency_level || 'Moyenne',
         c.ai_summary || '', c.ai_explanation || '',
         ['RECHERCHE_MEDECIN', 'EN_COURS', 'TERMINE', 'REFUSE'].includes(c.status) ? c.status : 'RECHERCHE_MEDECIN',
         c.prescription ?? null, toDate(c.created_at), toDate(c.updated_at ?? c.created_at)]
      );
      n++;
    }
    record('consultations', n);
  }

  // ─── messages ──────────────────────────────────────────────────────────────
  if (messages) {
    // messages have no natural PRIMARY KEY (BIGSERIAL id only), so ON CONFLICT
    // cannot apply. Idempotency is enforced with an existence check on the
    // message's natural identity (consultation, sender, text, instant): a
    // re-run after a partial failure — or a grown source file — imports each
    // legacy message exactly once. Genuinely identical duplicate frames in the
    // legacy export collapse to a single row (they are indistinguishable
    // anyway). See tests/import-idempotency.test.js.
    let n = 0;
    let skipped = 0;
    for (const m of messages) {
      if (!m.consultation_id) continue;
      const createdAt = toDate(m.created_at);
      const senderId = m.sender_id || 'unknown';
      const text = m.text || '';
      if (!dryRun) {
        const { rows } = await pool.query(
          `SELECT 1 FROM messages
            WHERE consultation_id = $1 AND sender_id = $2 AND text = $3
              AND created_at IS NOT DISTINCT FROM $4
            LIMIT 1`,
          [m.consultation_id, senderId, text, createdAt]
        );
        if (rows.length) { skipped++; continue; }
      }
      await insert(
        `INSERT INTO messages (consultation_id, sender_id, sender_name, text, message_type, file_url, duration, file_size, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [m.consultation_id, senderId, m.sender_name || '',
         text, m.message_type || 'text', m.file_url ?? null,
         m.duration === undefined || m.duration === null ? null : parseInt(m.duration, 10) || null,
         m.file_size === undefined || m.file_size === null ? null : parseInt(m.file_size, 10) || null,
         createdAt]
      );
      n++;
    }
    recordSkips('messages', n, skipped, n + skipped);
  }

  // ─── tickets + ticket_messages (legacy production files) ──────────────────
  if (tickets) {
    let n = 0;
    for (const t of tickets) {
      if (!t.id) continue;
      await insert(
        `INSERT INTO tickets (id, user_id, subject, status, priority, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [String(t.id), t.user_id || t.patient_id || 'unknown', t.subject || 'Sans sujet',
         t.status === 'closed' ? 'closed' : 'open', t.priority || 'normal',
         toDate(t.created_at), toDate(t.updated_at ?? t.created_at)]
      );
      n++;
    }
    record('tickets', n);
  }
  if (ticketMessages) {
    // ticket_messages: same keyless-table idempotency strategy as messages
    // (existence check on natural identity; see the messages block above).
    let n = 0;
    let skipped = 0;
    for (const m of ticketMessages) {
      if (!m.ticket_id) continue;
      const createdAt = toDate(m.created_at);
      const senderRole = ['user', 'admin', 'system'].includes(m.sender_role) ? m.sender_role : 'user';
      const senderId = m.sender_id ?? null;
      const content = m.content || m.message || m.text || '';
      if (!dryRun) {
        const { rows } = await pool.query(
          `SELECT 1 FROM ticket_messages
            WHERE ticket_id = $1 AND sender_role = $2
              AND sender_id IS NOT DISTINCT FROM $3 AND content = $4
              AND created_at IS NOT DISTINCT FROM $5
            LIMIT 1`,
          [String(m.ticket_id), senderRole, senderId, content, createdAt]
        );
        if (rows.length) { skipped++; continue; }
      }
      await insert(
        `INSERT INTO ticket_messages (ticket_id, sender_role, sender_id, sender_name, content, file_url, file_type, file_size, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [String(m.ticket_id), senderRole,
         senderId, m.sender_name || '', content,
         m.file_url ?? null, m.file_type ?? null,
         m.file_size === undefined || m.file_size === null ? null : parseInt(m.file_size, 10) || null,
         createdAt]
      );
      n++;
    }
    recordSkips('ticket_messages', n, skipped, n + skipped);
  }

  // ─── consultation notes ────────────────────────────────────────────────────
  if (notes) {
    let n = 0;
    for (const note of notes) {
      if (!note.consultation_id) continue;
      await insert(
        `INSERT INTO consultation_notes (consultation_id, patient_id, doctor_id, doctor_name, diagnosis,
            symptoms, notes, prescriptions, follow_up, flag_allergy, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
         ON CONFLICT (consultation_id) DO NOTHING`,
        [note.consultation_id, note.patient_id ?? null, note.doctor_id ?? null, note.doctor_name ?? null,
         note.diagnosis || '', note.symptoms || '', note.notes || '',
         JSON.stringify(note.prescriptions || []), note.follow_up || '',
         Boolean(note.flag_allergy), toDate(note.created_at), toDate(note.updated_at ?? note.created_at)]
      );
      n++;
    }
    record('consultation_notes', n);
  }

  // ─── medical histories ────────────────────────────────────────────────────
  if (histories) {
    let n = 0;
    for (const h of histories) {
      if (!h.patient_id) continue;
      await insert(
        `INSERT INTO medical_histories (patient_id, basic_info, allergies, chronic_conditions,
            current_medications, vaccinations, emergency_contact, surgical_history, created_at, last_updated)
         VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)
         ON CONFLICT (patient_id) DO NOTHING`,
        [h.patient_id,
         h.basic_info ? JSON.stringify(h.basic_info) : null,
         JSON.stringify(h.allergies || []),
         JSON.stringify(h.chronic_conditions || []),
         JSON.stringify(h.current_medications || []),
         JSON.stringify(h.vaccinations || []),
         h.emergency_contact ? JSON.stringify(h.emergency_contact) : null,
         JSON.stringify(h.surgical_history || []),
         toDate(h.created_at), toDate(h.last_updated ?? h.created_at)]
      );
      n++;
    }
    record('medical_histories', n);
  }

  // ─── Report ────────────────────────────────────────────────────────────────
  console.log(`\n[import] ${dryRun ? 'DRY RUN — nothing written' : 'import complete'}:`);
  for (const [table, s] of Object.entries(stats)) {
    const skipped = s.skipped ? ` (${s.skipped} already present)` : '';
    console.log(`  ${table.padEnd(22)} ${s.imported} row(s)${skipped}`);
  }
  const missing = ['users', 'consultations', 'messages']
    .filter((k) => !(k in stats));
  if (missing.length) {
    console.warn(`[import] note: no source file for: ${missing.join(', ')}`);
  }
  console.log('[import] source JSON files were NOT modified or deleted.');
  console.log('[import] next step: node scripts/smoke-verify.js');
  await pool.end();
}

main().catch((err) => {
  console.error('[import] fatal:', err.message);
  process.exit(1);
});
