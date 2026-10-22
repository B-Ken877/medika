/**
 * Consultation notes + medical histories repositories — RECONSTRUCTED from
 * client DTOs (ConsultationNote / MedicalHistory in GeminiApi.kt and
 * medika-web/lib/api/types.ts).
 *
 * Auto-update behavior follows the documented production feature
 * (README "Medical History & Consultation Notes"):
 *   1. prescriptions → patient's current_medications (dedup by name)
 *   2. diagnosis keywords → chronic_conditions
 *   3. consultation summary → consultation_timeline entry
 */
'use strict';

const { query } = require('../db');

// ─── Notes ───────────────────────────────────────────────────────────────────

function noteToApi(row) {
  if (!row) return null;
  return {
    consultation_id: row.consultation_id,
    patient_id: row.patient_id,
    doctor_id: row.doctor_id,
    doctor_name: row.doctor_name ?? null,
    diagnosis: row.diagnosis ?? '',
    symptoms: row.symptoms ?? '',
    notes: row.notes ?? '',
    prescriptions: row.prescriptions || [],
    follow_up: row.follow_up ?? '',
    flag_allergy: Boolean(row.flag_allergy),
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
    updated_at: row.updated_at ? Math.floor(new Date(row.updated_at).getTime() / 1000) : null,
  };
}

async function findNote(consultationId) {
  const { rows } = await query(
    `SELECT * FROM consultation_notes WHERE consultation_id = $1`, [consultationId]);
  return rows[0] || null;
}

async function upsertNote({ consultation_id, patient_id, doctor_id, doctor_name, diagnosis, symptoms, notes, prescriptions, follow_up, flag_allergy }) {
  const { rows } = await query(
    `INSERT INTO consultation_notes
       (consultation_id, patient_id, doctor_id, doctor_name, diagnosis, symptoms, notes, prescriptions, follow_up, flag_allergy)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
     ON CONFLICT (consultation_id) DO UPDATE SET
       doctor_name = EXCLUDED.doctor_name,
       diagnosis = EXCLUDED.diagnosis,
       symptoms = EXCLUDED.symptoms,
       notes = EXCLUDED.notes,
       prescriptions = EXCLUDED.prescriptions,
       follow_up = EXCLUDED.follow_up,
       flag_allergy = EXCLUDED.flag_allergy,
       updated_at = now()
     RETURNING *`,
    [consultation_id, patient_id, doctor_id, doctor_name, diagnosis || '', symptoms || '',
     notes || '', JSON.stringify(prescriptions || []), follow_up || '', Boolean(flag_allergy)]
  );
  return rows[0];
}

// ─── Medical history ─────────────────────────────────────────────────────────

function historyToApi(row, patientName) {
  if (!row) return null;
  return {
    patient_id: row.patient_id,
    patient_name: patientName ?? null,
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
    last_updated: row.last_updated ? Math.floor(new Date(row.last_updated).getTime() / 1000) : null,
    basic_info: row.basic_info ?? null,
    allergies: row.allergies || [],
    chronic_conditions: row.chronic_conditions || [],
    current_medications: row.current_medications || [],
    vaccinations: row.vaccinations || [],
    emergency_contact: row.emergency_contact ?? null,
    surgical_history: row.surgical_history || [],
    consultation_timeline: [],
  };
}

async function findHistory(patientId) {
  const { rows } = await query(`SELECT * FROM medical_histories WHERE patient_id = $1`, [patientId]);
  return rows[0] || null;
}

async function upsertHistory(patientId, patch) {
  const fields = {
    basic_info: 'basicInfo',
    allergies: 'allergies',
    chronic_conditions: 'chronicConditions',
    current_medications: 'currentMedications',
    vaccinations: 'vaccinations',
    emergency_contact: 'emergencyContact',
    surgical_history: 'surgicalHistory',
  };
  const insertCols = ['patient_id'];
  const insertPh = ['$1'];
  const params = [patientId];
  const setCols = [];
  for (const [col, key] of Object.entries(fields)) {
    if (patch[key] !== undefined) {
      params.push(JSON.stringify(patch[key]));
      insertCols.push(col);
      insertPh.push(`$${params.length}::jsonb`);
      setCols.push(`${col} = $${params.length}::jsonb`);
    }
  }
  setCols.push('last_updated = now()');
  const { rows } = await query(
    `INSERT INTO medical_histories (${insertCols.join(', ')})
     VALUES (${insertPh.join(', ')})
     ON CONFLICT (patient_id) DO UPDATE SET ${setCols.join(', ')}
     RETURNING *`,
    params
  );
  return rows[0];
}

/** Has this doctor ever been assigned a consultation with this patient? */
async function doctorKnowsPatient(doctorId, patientId) {
  const { rows } = await query(
    `SELECT 1 FROM consultations WHERE doctor_id = $1 AND patient_id = $2 LIMIT 1`,
    [doctorId, patientId]);
  return rows.length > 0;
}

// ─── Auto-update (documented production feature) ─────────────────────────────

// Keyword → chronic condition name (French/Haitian medical vocabulary).
const CHRONIC_KEYWORDS = [
  ['hypertension', 'Hypertension arterielle'],
  ['diabete', 'Diabete'],
  ['asthme', 'Asthme'],
  ['epilepsie', 'Epilepsie'],
  ['sickle', 'Drépanocytose'],
  ['drepanocytose', 'Drépanocytose'],
  ['anemie', 'Anemie'],
  ['cancer', 'Cancer'],
  ['vihsida', 'VIH/SIDA'],
  ['vih', 'VIH/SIDA'],
  ['sida', 'VIH/SIDA'],
  ['tuberculose', 'Tuberculose'],
  ['migraine', 'Migraines chroniques'],
  ['obesite', 'Obesite'],
  ['cholecystectomie', 'Cholecystectomie'],
  ['arythmie', 'Arythmie cardiaque'],
];

/**
 * Apply the documented auto-update rules after a doctor saves notes.
 * Pure function over JSONB columns — safe to call repeatedly (idempotent by
 * name-based deduplication).
 */
async function autoUpdateFromNote(consultation, note) {
  const existing = await findHistory(consultation.patient_id);
  const history = existing || (await upsertHistory(consultation.patient_id, {}));

  const medications = [...(history.current_medications || [])];
  let medsChanged = false;
  for (const rx of note.prescriptions || []) {
    const name = String(rx?.medication || '').trim();
    if (!name) continue;
    if (!medications.some((m) => String(m?.name || '').toLowerCase() === name.toLowerCase())) {
      medications.push({
        name,
        dosage: String(rx?.dosage || ''),
        since: null,
        prescribed_by: note.doctor_name || null,
        source: 'consultation:' + note.consultation_id,
      });
      medsChanged = true;
    }
  }

  const conditions = [...(history.chronic_conditions || [])];
  let condsChanged = false;
  const haystack = `${note.diagnosis || ''} ${note.symptoms || ''}`.toLowerCase();
  for (const [kw, label] of CHRONIC_KEYWORDS) {
    if (haystack.includes(kw) && !conditions.some((c) => String(c?.name || '').toLowerCase() === label.toLowerCase())) {
      conditions.push({
        name: label,
        diagnosed_at: null,
        status: 'actif',
        notes: 'Detecte lors de la consultation ' + note.consultation_id,
        source: 'consultation:' + note.consultation_id,
      });
      condsChanged = true;
    }
  }

  if (medsChanged || condsChanged) {
    await query(
      `UPDATE medical_histories SET current_medications = $2::jsonb, chronic_conditions = $3::jsonb,
         last_updated = now() WHERE patient_id = $1`,
      [consultation.patient_id, JSON.stringify(medications), JSON.stringify(conditions)]
    );
  }
}

/**
 * Full history including the derived consultation_timeline (from notes).
 * Kept separate from historyToApi so the timeline (a JOIN) is only computed
 * when the full dossier is requested — the snapshot endpoint skips it.
 */
async function fullHistory(patientId) {
  const { rows: users } = await query(`SELECT name FROM users WHERE id = $1`, [patientId]);
  const row = await findHistory(patientId);
  const base = row || { patient_id: patientId };
  const { rows: timeline } = await query(
    `SELECT n.consultation_id, c.created_at, n.doctor_name, u.specialty, n.diagnosis, n.symptoms, n.prescriptions
       FROM consultation_notes n
       JOIN consultations c ON c.id = n.consultation_id
       LEFT JOIN users u ON u.id = n.doctor_id
      WHERE n.patient_id = $1
      ORDER BY c.created_at DESC`,
    [patientId]);

  const api = historyToApi(base, users[0]?.name || null);
  api.consultation_timeline = timeline.map((t) => ({
    consultation_id: t.consultation_id,
    date: t.created_at ? new Date(t.created_at).toISOString().slice(0, 10) : null,
    doctor_name: t.doctor_name || '',
    specialty: t.specialty || '',
    diagnosis: t.diagnosis || '',
    summary: t.symptoms || '',
    prescriptions: (t.prescriptions || []).map((p) => String(p?.medication || '')).filter(Boolean),
  }));
  if (!row) {
    const { rows: created } = await query(`SELECT now()::timestamptz AS ts`);
    api.created_at = Math.floor(new Date(created[0].ts).getTime() / 1000);
    api.last_updated = api.created_at;
  }
  return api;
}

/** Snapshot: lightweight context card for doctors. */
async function snapshot(patientId) {
  const { rows: users } = await query(`SELECT name FROM users WHERE id = $1`, [patientId]);
  const row = await findHistory(patientId);
  const { rows: recent } = await query(
    `SELECT count(*)::int AS n FROM consultations WHERE patient_id = $1`, [patientId]);
  const allergies = (row?.allergies || []);
  return {
    patient_id: patientId,
    patient_name: users[0]?.name || null,
    has_allergies: allergies.length > 0,
    allergies,
    chronic_conditions: row?.chronic_conditions || [],
    current_medications: row?.current_medications || [],
    recent_consultations: recent[0]?.n || 0,
  };
}

module.exports = {
  noteToApi,
  findNote,
  upsertNote,
  historyToApi,
  findHistory,
  upsertHistory,
  doctorKnowsPatient,
  autoUpdateFromNote,
  fullHistory,
  snapshot,
};
