/**
 * JSON importer idempotency regression tests (audit follow-up):
 *
 * scripts/import-json-data.js documents itself as "idempotent, re-runnable"
 * (INSERT … ON CONFLICT DO NOTHING). messages and ticket_messages have no
 * natural PRIMARY KEY (BIGSERIAL only), so a naive re-import used to duplicate
 * every row. This test imports a FAKE legacy data directory TWICE and asserts
 * the resulting row counts are identical — the exact scenario of re-running
 * the importer after a partial failure during the VPS migration.
 *
 * All data below is synthetic (no real patient information).
 */
'use strict';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const { execFileSync } = await import('node:child_process');
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');

let query, dataDir;

const IMPORTER = path.join(__dirname, '..', 'scripts', 'import-json-data.js');

function runImporter() {
  return execFileSync(process.execPath, [IMPORTER], {
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  }).toString();
}

async function counts() {
  const tables = [
    'users', 'consultations', 'messages', 'tickets',
    'ticket_messages', 'consultation_notes', 'medical_histories',
  ];
  const out = {};
  for (const t of tables) {
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    out[t] = rows[0].n;
  }
  return out;
}

beforeAll(async () => {
  ({ query } = await import('../src/db.js'));
  await query(`TRUNCATE messages, ticket_messages, tickets, consultation_notes,
               medical_histories, payments, consultations, users RESTART IDENTITY CASCADE`);

  // ─── FAKE legacy JSON export (synthetic patients/doctors only) ─────────────
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medika-import-test-'));
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([
    {
      id: 'patient_fake01', username: 'fake.patient01', password_hash: '!',
      role: 'patient', name: 'Patient Factice Un', email: 'fake.patient01@example.invalid',
      phone: '+509 0000 0000', age: 34, gender: 'F', created_at: now - 86400 * 30,
    },
    {
      id: 'doctor_fake01', username: 'fake.doctor01', password_hash: '!',
      role: 'doctor', name: 'Dr Factice', email: 'fake.doctor01@example.invalid',
      specialty: 'Cardiologie', license_number: 'FAKE-0000', hospital: 'Hopital Factice',
      rating: 4.9, is_available: true, created_at: now - 86400 * 90,
    },
  ]));
  fs.writeFileSync(path.join(dataDir, 'consultations.json'), JSON.stringify([
    {
      id: 'c_fake_001', patient_id: 'patient_fake01', patient_name: 'Patient Factice Un',
      patient_age: 34, doctor_id: 'doctor_fake01', description: 'Douleur factice au genou',
      specialty_needed: 'Cardiologie', urgency_level: 'Normale', status: 'TERMINE',
      prescription: 'Repos factice', created_at: now - 3600, updated_at: now - 1800,
    },
    {
      id: 'c_fake_002', patient_id: 'patient_fake01', patient_name: 'Patient Factice Un',
      patient_age: 34, doctor_id: null, description: 'Symptomes factices',
      specialty_needed: 'Medecine Generale', urgency_level: 'Moyenne',
      status: 'RECHERCHE_MEDECIN', created_at: now - 60,
    },
  ]));
  fs.writeFileSync(path.join(dataDir, 'messages.json'), JSON.stringify([
    { consultation_id: 'c_fake_001', sender_id: 'patient_fake01', sender_name: 'Patient Factice Un', text: 'Bonjour docteur', message_type: 'text', created_at: now - 3500 },
    { consultation_id: 'c_fake_001', sender_id: 'doctor_fake01', sender_name: 'Dr Factice', text: 'Bonjour, comment puis-je aider ?', message_type: 'text', created_at: now - 3400 },
    { consultation_id: 'c_fake_001', sender_id: 'doctor_fake01', sender_name: 'Dr Factice', text: 'Voici une note vocale factice', message_type: 'voice', file_url: '/uploads/c_fake_001/fake.amr', duration: 12, file_size: 48000, created_at: now - 3300 },
  ]));
  fs.writeFileSync(path.join(dataDir, 'tickets.json'), JSON.stringify([
    { id: 'ticket_fake01', user_id: 'patient_fake01', subject: 'Question factice', status: 'open', priority: 'normal', created_at: now - 7200 },
  ]));
  fs.writeFileSync(path.join(dataDir, 'ticket_messages.json'), JSON.stringify([
    { ticket_id: 'ticket_fake01', sender_role: 'user', sender_id: 'patient_fake01', sender_name: 'Patient Factice Un', content: 'Bonjour, question factice', created_at: now - 7200 },
    { ticket_id: 'ticket_fake01', sender_role: 'admin', sender_id: 'admin_fake', sender_name: 'Support', content: 'Reponse factice', created_at: now - 7000 },
  ]));
  fs.writeFileSync(path.join(dataDir, 'consultation-notes.json'), JSON.stringify([
    {
      consultation_id: 'c_fake_001', patient_id: 'patient_fake01', doctor_id: 'doctor_fake01',
      doctor_name: 'Dr Factice', diagnosis: 'Diagnostic factice', symptoms: 'Symptomes factices',
      notes: 'Note factice', prescriptions: [{ medication: 'Placebo factice', dosage: '1/jour' }],
      follow_up: 'Aucun', flag_allergy: false, created_at: now - 1700,
    },
  ]));
  fs.writeFileSync(path.join(dataDir, 'medical-histories.json'), JSON.stringify([
    {
      patient_id: 'patient_fake01',
      basic_info: { blood_type: 'O+', height: 170, weight: 65 },
      allergies: ['Factice-allergene'],
      chronic_conditions: [], current_medications: [], vaccinations: [],
      emergency_contact: { name: 'Contact Factice', phone: '+509 0000 0001' },
      surgical_history: [], created_at: now - 86400 * 29,
    },
  ]));
});

afterAll(async () => {
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  const { getPool } = await import('../src/db.js');
  await getPool().end();
});

describe('json importer idempotency', () => {
  it('first import inserts the expected rows', async () => {
    runImporter();
    const c = await counts();
    expect(c.users).toBe(2);
    expect(c.consultations).toBe(2);
    expect(c.messages).toBe(3);
    expect(c.tickets).toBe(1);
    expect(c.ticket_messages).toBe(2);
    expect(c.consultation_notes).toBe(1);
    expect(c.medical_histories).toBe(1);
  });

  it('re-importing the same files changes nothing (idempotent)', async () => {
    const before = await counts();
    runImporter();
    runImporter(); // twice, to also cover a third pass
    const after = await counts();
    expect(after).toEqual(before);
  });

  it('grew source files import only the new rows, not duplicates', async () => {
    // A message appended on the VPS after the first import must be additive;
    // re-running the importer on the grown file must not duplicate old rows.
    const now = Math.floor(Date.now() / 1000);
    const msgs = JSON.parse(fs.readFileSync(path.join(dataDir, 'messages.json'), 'utf8'));
    msgs.push({ consultation_id: 'c_fake_001', sender_id: 'patient_fake01', sender_name: 'Patient Factice Un', text: 'Merci docteur', message_type: 'text', created_at: now - 30 });
    fs.writeFileSync(path.join(dataDir, 'messages.json'), JSON.stringify(msgs));
    runImporter();
    const c = await counts();
    expect(c.messages).toBe(4); // 3 old (not duplicated) + 1 new
    expect(c.users).toBe(2);
    expect(c.consultations).toBe(2);
  });
});
