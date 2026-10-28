/**
 * Users repository — replaces data/users.json.
 * Row → API shape mapping preserves the legacy JSON field names, including
 * is_available emitted as 1/0 (integer) exactly like the JSON files did.
 */
'use strict';

const { query, withTransaction } = require('../db');

const COLS = `id, username, role, name, email, phone, age, gender, specialty,
  license_number, location, hospital, biography, avatar_url, rating,
  is_available, created_at, verification_status, verified_at, verified_by`;

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    name: row.name,
    email: row.email ?? null,
    phone: row.phone ?? null,
    age: row.age ?? null,
    gender: row.gender ?? null,
    specialty: row.specialty ?? null,
    license_number: row.license_number ?? null,
    location: row.location ?? null,
    hospital: row.hospital ?? null,
    biography: row.biography ?? null,
    avatar_url: row.avatar_url ?? null,
    rating: row.rating === null ? null : Number(row.rating),
    is_available: row.is_available ? 1 : 0,
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
    // Issue #32: explicit, server-owned credential verification status.
    // NULL = unknown/legacy (NOT verified — never inferred from a populated
    // license_number). Additive field: legacy consumers ignore it.
    verification_status: row.verification_status ?? null,
    verified_at: row.verified_at ? Math.floor(new Date(row.verified_at).getTime() / 1000) : null,
  };
}

/** Row without password_hash (the "safeUser" legacy shape). */
function safe(row) {
  const u = toApi(row);
  delete u.password_hash; // never present — kept for explicitness
  return u;
}

async function findById(id) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function findByUsername(username) {
  const { rows } = await query(`SELECT * FROM users WHERE username = $1`, [username]);
  return rows[0] || null;
}

async function login(username, password, compare) {
  const row = await findByUsername(username);
  if (!row) return null;
  if (!compare(password, row.password_hash)) return null;
  return row;
}

async function create({ id, username, password_hash, role, name, email, phone, age, gender, specialty, license_number, location, hospital, biography, avatar_url, rating }) {
  const { rows } = await query(
    `INSERT INTO users (id, username, password_hash, role, name, email, phone, age, gender,
       specialty, license_number, location, hospital, biography, avatar_url, rating)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (username) DO NOTHING
     RETURNING *`,
    [id, username, password_hash, role, name, email ?? null, phone ?? null,
     age ?? null, gender ?? null, specialty ?? null, license_number ?? null,
     location ?? null, hospital ?? null, biography ?? null, avatar_url ?? null,
     rating ?? (role === 'doctor' ? 5.0 : null)]
  );
  return rows[0] || null; // null = username taken
}

async function listDoctors(specialty) {
  const params = [];
  let sql = `SELECT ${COLS} FROM users WHERE role = 'doctor'`;
  if (specialty) {
    params.push(specialty);
    sql += ` AND specialty = $1`;
  }
  const { rows } = await query(sql, params);
  return rows.map(toApi);
}

/** Patient-facing doctor list: strips direct contact PII (email/phone). */
function publicDoctor(u) {
  if (!u) return u;
  const { email, phone, ...rest } = u;
  void email; void phone;
  return rest;
}

async function updateProfile(id, { name, email, phone, age, gender, avatarUrl }) {
  const { rows } = await query(
    `UPDATE users SET
       name = COALESCE($2, name),
       email = CASE WHEN $3 THEN $4::text ELSE email END,
       phone = CASE WHEN $5 THEN $6::text ELSE phone END,
       age = CASE WHEN $7 THEN $8::int ELSE age END,
       gender = COALESCE($9, gender),
       avatar_url = CASE WHEN $10 THEN $11::text ELSE avatar_url END
     WHERE id = $1 RETURNING *`,
    [id,
     name ?? null,
     email !== undefined, email ?? null,
     phone !== undefined, phone ?? null,
     age !== undefined, age ?? null,
     gender ?? null,
     avatarUrl !== undefined, avatarUrl ?? null]
  );
  return rows[0] || null;
}

async function setAvailability(id, isAvailable) {
  const { rows } = await query(
    `UPDATE users SET is_available = $2 WHERE id = $1 RETURNING is_available`,
    [id, Boolean(isAvailable)]
  );
  return rows[0] ? rows[0].is_available : null;
}

async function listByRole(role) {
  const { rows } = await query(`SELECT id FROM users WHERE role = $1`, [role]);
  return rows.map((r) => r.id);
}

// ─── Admin management ────────────────────────────────────────────────────────

async function adminListDoctors({ specialty, search }) {
  const params = [];
  const where = [`role = 'doctor'`];
  if (specialty) { params.push(specialty); where.push(`specialty = $${params.length}`); }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    const i = params.length;
    where.push(`(LOWER(name) LIKE $${i} OR LOWER(username) LIKE $${i} OR LOWER(COALESCE(email,'')) LIKE $${i})`);
  }
  const { rows } = await query(
    `SELECT * FROM users WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, params);
  return rows;
}

async function adminListPatients({ search }) {
  const params = [];
  const where = [`role = 'patient'`];
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    const i = params.length;
    where.push(`(LOWER(name) LIKE $${i} OR LOWER(username) LIKE $${i} OR LOWER(COALESCE(email,'')) LIKE $${i})`);
  }
  const { rows } = await query(
    `SELECT * FROM users WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, params);
  return rows;
}

async function adminUpdateDoctor(id, patch) {
  const { rows } = await query(
    `UPDATE users SET
       name = COALESCE($2, name),
       email = CASE WHEN $3 THEN $4::text ELSE email END,
       phone = CASE WHEN $5 THEN $6::text ELSE phone END,
       age = CASE WHEN $7 THEN $8::int ELSE age END,
       gender = COALESCE($9, gender),
       specialty = COALESCE($10, specialty),
       license_number = CASE WHEN $11 THEN $12::text ELSE license_number END,
       location = CASE WHEN $13 THEN $14::text ELSE location END,
       hospital = CASE WHEN $15 THEN $16::text ELSE hospital END,
       biography = CASE WHEN $17 THEN $18::text ELSE biography END,
       avatar_url = CASE WHEN $19 THEN $20::text ELSE avatar_url END,
       is_available = CASE WHEN $21 THEN $22::boolean ELSE is_available END,
       rating = CASE WHEN $23 THEN $24::numeric ELSE rating END,
       password_hash = COALESCE($25, password_hash)
     WHERE id = $1 AND role = 'doctor' RETURNING *`,
    [id,
     patch.name ?? null,
     patch.email !== undefined, patch.email ?? null,
     patch.phone !== undefined, patch.phone ?? null,
     patch.age !== undefined, patch.age ?? null,
     patch.gender ?? null,
     patch.specialty ?? null,
     patch.licenseNumber !== undefined, patch.licenseNumber ?? null,
     patch.location !== undefined, patch.location ?? null,
     patch.hospital !== undefined, patch.hospital ?? null,
     patch.biography !== undefined, patch.biography ?? null,
     patch.avatarUrl !== undefined, patch.avatarUrl ?? null,
     patch.isAvailable !== undefined, patch.isAvailable ? true : false,
     patch.rating !== undefined, patch.rating ?? null,
     patch.password_hash ?? null]
  );
  return rows[0] || null;
}

async function adminDeleteUser(id, role) {
  const { rowCount } = await query(
    `DELETE FROM users WHERE id = $1 AND role = $2`, [id, role]);
  return rowCount > 0;
}

async function adminResetPassword(id, password_hash) {
  const { rows } = await query(
    `UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING name`, [id, password_hash]);
  return rows[0]?.name || null;
}

// ─── Doctor credential verification (issue #32) ──────────────────────────────

const VERIFICATION_STATUSES = ['pending', 'verified', 'rejected'];

/** Audit trail for one doctor, newest first. Admin-facing only — never part
 *  of public doctor responses. */
async function listVerificationAudit(doctorId, limit = 50) {
  const { rows } = await query(
    `SELECT a.id, a.doctor_id, a.actor_id, a.action, a.from_status, a.to_status,
            a.note, a.created_at, u.name AS actor_name
       FROM verification_audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.doctor_id = $1
      ORDER BY a.id DESC LIMIT $2`,
    [doctorId, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    doctor_id: r.doctor_id,
    actor_id: r.actor_id,
    actor_name: r.actor_name ?? null,
    action: r.action,
    from_status: r.from_status ?? null,
    to_status: r.to_status ?? null,
    note: r.note ?? null,
    created_at: r.created_at ? Math.floor(new Date(r.created_at).getTime() / 1000) : null,
  }));
}

/** Transition a doctor's verification status (admin-only at the route
 *  layer). Writes the audit row in the SAME transaction as the status
 *  change; verified_at/verified_by are set on the verified edge and cleared
 *  when leaving it. Returns the updated row, or null when the doctor does
 *  not exist. */
async function setDoctorVerification(doctorId, { status, actorId, note = null }) {
  if (!VERIFICATION_STATUSES.includes(status)) {
    const err = new Error('invalid status');
    err.code = 'EINVAL';
    throw err;
  }
  return withTransaction(async (client) => {
    // Capture the PRE-transition status for the audit trail.
    const cur = await client.query(
      `SELECT verification_status FROM users WHERE id = $1 AND role = 'doctor' FOR UPDATE`,
      [doctorId]
    );
    if (!cur.rows[0]) return null;
    const fromStatus = cur.rows[0].verification_status ?? null;

    const { rows } = await client.query(
      `UPDATE users SET
         verification_status = $2,
         verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE NULL END,
         verified_by  = CASE WHEN $2 = 'verified' THEN $3 ELSE NULL END
       WHERE id = $1 AND role = 'doctor'
       RETURNING *`,
      [doctorId, status, actorId ?? null]
    );
    const row = rows[0];
    if (!row) return null;
    await client.query(
      `INSERT INTO verification_audit_log
         (doctor_id, actor_id, action, from_status, to_status, note)
       VALUES ($1, $2, 'status_changed', $3, $4, $5)`,
      [doctorId, actorId ?? null, fromStatus, status, note]
    );
    return row;
  });
}

/** Record an admin edit of credential fields (audit only — no automatic
 *  status change: admins stay in explicit control of the verification
 *  state, and every credential edit is visible in the trail). */
async function logCredentialFieldsEdit(doctorId, actorId, changedFields) {
  if (!changedFields.length) return;
  await query(
    `INSERT INTO verification_audit_log
       (doctor_id, actor_id, action, note)
     VALUES ($1, $2, 'credential_fields_edited', $3)`,
    [doctorId, actorId ?? null, changedFields.join(', ')]
  );
}

module.exports = {
  toApi,
  safe,
  findById,
  findByUsername,
  login,
  create,
  listDoctors,
  publicDoctor,
  updateProfile,
  setAvailability,
  listByRole,
  adminListDoctors,
  adminListPatients,
  adminUpdateDoctor,
  adminDeleteUser,
  adminResetPassword,
  VERIFICATION_STATUSES,
  listVerificationAudit,
  setDoctorVerification,
  logCredentialFieldsEdit,
};
