/**
 * Consultation attachment registry — private medical media metadata.
 *
 * The registry maps an opaque attachment id to its PRIVATE storage key
 * (Vercel Blob pathname with access:'private', or an opaque disk path in
 * local development). Clients only ever see the API path
 * /api/consultations/{cid}/attachments/{aid}; the storage key, blob tokens
 * and signing secrets never leave the server.
 */
'use strict';

const { query } = require('../db');

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    consultation_id: row.consultation_id,
    uploader_id: row.uploader_id,
    filename: row.filename,
    mimetype: row.mimetype,
    size: row.file_size === null ? null : Number(row.size),
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
  };
}

async function create({ id, consultation_id, uploader_id, storage, blob_pathname, filename, mimetype, size }) {
  const { rows } = await query(
    `INSERT INTO consultation_attachments
       (id, consultation_id, uploader_id, storage, blob_pathname, filename, mimetype, size)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, consultation_id, uploader_id, storage, blob_pathname, filename, mimetype, size]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await query(
    `SELECT * FROM consultation_attachments WHERE id = $1`, [id]);
  return rows[0] || null;
}

module.exports = { create, findById, toApi };
