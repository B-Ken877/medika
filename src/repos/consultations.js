/**
 * Consultations + messages repositories — replace data/consultations.json
 * and data/messages.json.
 *
 * Concurrency fixes vs legacy JSON:
 *  - message ids are BIGSERIAL (no read-modify-write Math.max+1 races)
 *  - accept() is an atomic conditional UPDATE (no double-accept / doctor-steal)
 *  - prescription() requires the acting doctor to own the consultation
 */
'use strict';

const { query, withTransaction } = require('../db');

function consToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    patient_id: row.patient_id,
    patient_name: row.patient_name,
    patient_age: row.patient_age ?? null,
    doctor_id: row.doctor_id ?? null,
    description: row.description ?? '',
    specialty_needed: row.specialty_needed ?? 'Medecine Generale',
    urgency_level: row.urgency_level ?? 'Moyenne',
    ai_summary: row.ai_summary ?? '',
    ai_explanation: row.ai_explanation ?? '',
    status: row.status,
    prescription: row.prescription ?? null,
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
    updated_at: row.updated_at ? Math.floor(new Date(row.updated_at).getTime() / 1000) : null,
  };
}

function msgToApi(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    consultation_id: row.consultation_id,
    sender_id: row.sender_id,
    sender_name: row.sender_name,
    text: row.text ?? '',
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
    message_type: row.message_type ?? 'text',
    file_url: row.file_url ?? null,
    duration: row.duration ?? null,
    file_size: row.file_size === null ? null : Number(row.file_size),
  };
}

// ─── Consultations ───────────────────────────────────────────────────────────

async function create({ id, patient_id, patient_name, patient_age, doctor_id, description, specialty_needed, urgency_level, ai_summary, ai_explanation }) {
  const { rows } = await query(
    `INSERT INTO consultations
       (id, patient_id, patient_name, patient_age, doctor_id, description,
        specialty_needed, urgency_level, ai_summary, ai_explanation, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'RECHERCHE_MEDECIN')
     RETURNING *`,
    [id, patient_id, patient_name, patient_age ?? null, doctor_id ?? null,
     description || '', specialty_needed || 'Medecine Generale',
     urgency_level || 'Moyenne', ai_summary || '', ai_explanation || '']
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await query(`SELECT * FROM consultations WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function listForUser(user) {
  let sql;
  const params = [user.id];
  if (user.role === 'patient') {
    sql = `SELECT * FROM consultations WHERE patient_id = $1`;
  } else if (user.role === 'doctor') {
    sql = `SELECT * FROM consultations
           WHERE doctor_id = $1 OR (doctor_id IS NULL AND status = 'RECHERCHE_MEDECIN')`;
  } else {
    sql = `SELECT * FROM consultations`;
    params.length = 0;
  }
  sql += ` ORDER BY created_at DESC`;
  const { rows } = await query(sql, params);
  return rows.map(consToApi);
}

/**
 * Atomic doctor accept. Legacy semantics preserved: only doctors, only
 * unassigned consultations (or ones already assigned to them). Returns the
 * updated row or null when the claim lost / not allowed.
 */
async function accept(id, doctorId) {
  const { rows } = await query(
    `UPDATE consultations
       SET doctor_id = $2, status = 'EN_COURS', updated_at = now()
     WHERE id = $1
       AND status = 'RECHERCHE_MEDECIN'
       AND (doctor_id IS NULL OR doctor_id = $2)
     RETURNING *`,
    [id, doctorId]
  );
  return rows[0] || null;
}

async function reject(id, doctorId) {
  const { rows } = await query(
    `UPDATE consultations
       SET status = 'REFUSE', updated_at = now()
     WHERE id = $1 AND doctor_id = $2
     RETURNING *`,
    [id, doctorId]
  );
  return rows[0] || null;
}

async function prescribe(id, doctorId, prescription) {
  const { rows } = await query(
    `UPDATE consultations
       SET prescription = $3, status = 'TERMINE', updated_at = now()
     WHERE id = $1 AND doctor_id = $2
     RETURNING *`,
    [id, doctorId, prescription]
  );
  return rows[0] || null;
}

async function adminDelete(id) {
  return withTransaction(async (client) => {
    // messages cascade via FK; payments keep the financial record (consultation_id → NULL)
    const { rows } = await client.query(`DELETE FROM consultations WHERE id = $1 RETURNING id`, [id]);
    return rows.length > 0;
  });
}

async function listAll({ status, doctor_id, patient_id } = {}) {
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (doctor_id) { params.push(doctor_id); where.push(`doctor_id = $${params.length}`); }
  if (patient_id) { params.push(patient_id); where.push(`patient_id = $${params.length}`); }
  const sql = `SELECT * FROM consultations ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC`;
  const { rows } = await query(sql, params);
  return rows;
}

// ─── Messages ────────────────────────────────────────────────────────────────

async function listMessages(consultationId) {
  const { rows } = await query(
    `SELECT * FROM messages WHERE consultation_id = $1 ORDER BY id ASC`, [consultationId]);
  return rows.map(msgToApi);
}

async function createMessage({ consultation_id, sender_id, sender_name, text, message_type, file_url, duration, file_size }) {
  const { rows } = await query(
    `INSERT INTO messages
       (consultation_id, sender_id, sender_name, text, message_type, file_url, duration, file_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [consultation_id, sender_id, sender_name, text || '',
     message_type || 'text', file_url ?? null, duration ?? null, file_size ?? null]
  );
  return rows[0];
}

/** Last N messages across all consultations the user belongs to (legacy catch-up semantics). */
async function catchUp(userId, limit = 50) {
  const { rows } = await query(
    `SELECT m.* FROM messages m
     WHERE m.consultation_id IN (
       SELECT id FROM consultations WHERE patient_id = $1 OR doctor_id = $1
     )
     ORDER BY m.id DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.reverse().map(msgToApi);
}

async function countAll() {
  const { rows } = await query(`SELECT count(*)::int AS n FROM messages`);
  return rows[0].n;
}

async function deleteForConsultation(consultationId) {
  await query(`DELETE FROM messages WHERE consultation_id = $1`, [consultationId]);
}

module.exports = {
  consToApi,
  msgToApi,
  create,
  findById,
  listForUser,
  accept,
  reject,
  prescribe,
  adminDelete,
  listAll,
  listMessages,
  createMessage,
  catchUp,
  countAll,
  deleteForConsultation,
};
