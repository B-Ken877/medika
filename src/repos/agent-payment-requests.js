/**
 * Agent payment requests repository (migration 017).
 *
 * Lifecycle: pending → paid / failed / expired / cancelled. A request is
 * raised by the AGENT during a live assistance session ("Submit Payment"),
 * surfaced on the MEMBER's device as a payment popup, and confirmed by the
 * member entering their phone number + 4-digit PIN (simulated MonCash —
 * no provider API yet). The consultation it buys is created for the member
 * and linked back to the session — see routes/assist.js confirm handler.
 *
 * Referees:
 *  - uq_agent_payment_pending (patient_id WHERE status='pending') — at most
 *    one pending request per member; the device popup is unambiguous.
 *  - order_id UNIQUE — exactly one payments row per request.
 *  - consultation_id UNIQUE — a request buys exactly one consultation.
 */
'use strict';

const { query } = require('../db');

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    specialty: row.specialty,
    amount: row.amount,
    currency: row.currency,
    orderId: row.order_id,
    status: row.status,
    createdBy: row.created_by,
    consultationId: row.consultation_id,
    paidPhone: row.paid_phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at,
    expiresAt: row.expires_at,
  };
}

async function create({ id, sessionId, patientId, doctorId, specialty, amount, orderId, createdBy, expiresAt }) {
  const { rows } = await query(
    `INSERT INTO agent_payment_requests
       (id, session_id, patient_id, doctor_id, specialty, amount, order_id, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (order_id) DO NOTHING
     RETURNING *`,
    [id, sessionId, patientId, doctorId, specialty, amount, orderId, createdBy, expiresAt],
  );
  return rows[0] || null; // null → order_id collision (never expected; uuid-based)
}

async function byId(id) {
  const { rows } = await query(`SELECT * FROM agent_payment_requests WHERE id = $1`, [id]);
  return rows[0] || null;
}

/** The member's open popup: pending (and still inside its TTL). */
async function pendingForPatient(patientId) {
  const { rows } = await query(
    `SELECT * FROM agent_payment_requests
      WHERE patient_id = $1 AND status = 'pending' AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [patientId],
  );
  return rows[0] || null;
}

/**
 * Latest request relevant to the member: the pending one, or a recently PAID
 * one (bounded window) so a refresh mid-success still shows the confirmation
 * instead of an empty state.
 */
async function latestRelevantForPatient(patientId, paidWindowSeconds = 900) {
  const { rows } = await query(
    `SELECT * FROM agent_payment_requests
      WHERE patient_id = $1
        AND (status = 'pending'
             OR (status = 'paid' AND paid_at > now() - ($2 || ' seconds')::interval))
      ORDER BY created_at DESC LIMIT 1`,
    [patientId, String(paidWindowSeconds)],
  );
  return rows[0] || null;
}

async function latestForSession(sessionId) {
  const { rows } = await query(
    `SELECT * FROM agent_payment_requests
      WHERE session_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [sessionId],
  );
  return rows[0] || null;
}

async function pendingForSession(sessionId) {
  const { rows } = await query(
    `SELECT * FROM agent_payment_requests
      WHERE session_id = $1 AND status = 'pending' AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [sessionId],
  );
  return rows[0] || null;
}

async function markStatus(id, status) {
  const { rows } = await query(
    `UPDATE agent_payment_requests SET status = $2, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, status],
  );
  return rows[0] || null;
}

/** Paid — exactly once per consultation (consultation_id UNIQUE referee). */
async function markPaid(id, { consultationId, paidPhone }) {
  const { rows } = await query(
    `UPDATE agent_payment_requests
        SET status = 'paid', consultation_id = $2, paid_phone = $3,
            paid_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [id, consultationId, paidPhone],
  );
  return rows[0] || null;
}

/** Lazy expiry sweep — pending requests past their TTL flip to expired. */
async function expireDue(now = new Date()) {
  const { rows } = await query(
    `UPDATE agent_payment_requests SET status = 'expired', updated_at = now()
      WHERE status = 'pending' AND expires_at <= $1
      RETURNING id`,
    [now],
  );
  return rows.map((r) => r.id);
}

module.exports = {
  toApi, create, byId, pendingForPatient, latestRelevantForPatient,
  latestForSession, pendingForSession, markStatus, markPaid, expireDue,
};
