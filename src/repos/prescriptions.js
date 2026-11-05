/**
 * Prescription documents repository (issue #82).
 *
 * A prescription is a durable, structured, immutable clinical document:
 *  - issued EXACTLY ONCE per consultation, by the assigned doctor, only while
 *    the consultation is EN_COURS — enforced here under the consultation row
 *    lock and backstopped by the partial unique index
 *    uq_prescription_documents_active (database, not API, is the referee);
 *  - issuance is ATOMIC with the consultation completion (one transaction);
 *  - consultations.prescription keeps a plain-text projection for older
 *    Android clients; legacy free-text submissions are stored verbatim;
 *  - item fields are an ALLOWLIST (name, strength, form, dose, route,
 *    frequency, duration, quantity, refills, instructions). Any other key —
 *    price, prix, amount, … — is stripped before persistence so no pricing
 *    data can ever enter a prescription document (issue #82 hard requirement).
 */
'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db');

/** Exactly the clinically meaningful instruction fields (issue #82). */
const ITEM_FIELDS = [
  'name',
  'strength',
  'form',
  'dose',
  'route',
  'frequency',
  'duration',
  'quantity',
  'refills',
  'instructions',
];

const LIMITS = {
  itemField: 300, // any single optional item field
  itemName: 200,  // medication name
  items: 20,      // max medications per prescription
  generalInstructions: 2000,
  legacyText: 4000, // matches the historical client maxLength
};

/** Stable human-readable reference derived from the (unique) consultation id:
 *  no collision is possible and the value can be re-derived for support. */
function buildReference(consultationId, issuedAt = new Date()) {
  const digest = crypto.createHash('sha256').update(`medika-rx:${consultationId}`).digest('hex');
  return `ORD-${issuedAt.getUTCFullYear()}-${digest.slice(0, 10).toUpperCase()}`;
}

/**
 * Allowlist-filter one client-supplied item. Returns
 * { ok: true, item } with every value trimmed and length-capped, or
 * { ok: false, error } with a French validation message (issue #82 copy rule).
 */
function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Chaque médicament doit être un objet structuré.' };
  }
  const name = String(raw.name ?? '').trim();
  if (!name) {
    return { ok: false, error: 'Le nom du médicament est obligatoire pour chaque ligne.' };
  }
  if (name.length > LIMITS.itemName) {
    return { ok: false, error: `Le nom du médicament ne peut pas dépasser ${LIMITS.itemName} caractères.` };
  }
  const item = { name };
  for (const field of ITEM_FIELDS.slice(1)) {
    if (raw[field] === undefined || raw[field] === null) continue;
    const value = String(raw[field]).trim();
    if (!value) continue;
    if (value.length > LIMITS.itemField) {
      return { ok: false, error: `Le champ « ${field} » ne peut pas dépasser ${LIMITS.itemField} caractères.` };
    }
    item[field] = value;
  }
  return { ok: true, item };
}

/**
 * Validate the structured payload. Accepts `null` (legacy text-only path).
 * Returns { ok, items, error }.
 */
function sanitizeItems(rawItems) {
  if (rawItems === null || rawItems === undefined) return { ok: true, items: [] };
  if (!Array.isArray(rawItems)) {
    return { ok: false, error: 'La liste des médicaments doit être un tableau.' };
  }
  if (rawItems.length === 0) {
    return { ok: false, error: 'Ajoutez au moins un médicament à l’ordonnance.' };
  }
  if (rawItems.length > LIMITS.items) {
    return { ok: false, error: `Une ordonnance ne peut pas contenir plus de ${LIMITS.items} médicaments.` };
  }
  const items = [];
  for (const raw of rawItems) {
    const sanitized = sanitizeItem(raw);
    if (!sanitized.ok) return sanitized;
    items.push(sanitized.item);
  }
  return { ok: true, items };
}

function truncate(value, max) {
  const v = String(value ?? '');
  return v.length > max ? v.slice(0, max) : v;
}

/**
 * Human-readable plain-text projection persisted into the legacy
 * consultations.prescription column (older Android clients read exactly this).
 * Pure function — no clinical value is invented; empty fields are omitted.
 */
function buildLegacyProjection(items, generalInstructions) {
  const lines = [];
  items.forEach((item, index) => {
    const parts = [item.name];
    if (item.strength) parts.push(item.strength);
    if (item.form) parts.push(`(${item.form})`);
    let line = `${index + 1}. ${parts.join(' ')}`;
    const details = [
      item.dose ? `Dose : ${item.dose}` : null,
      item.route ? `Voie : ${item.route}` : null,
      item.frequency ? `Fréquence : ${item.frequency}` : null,
      item.duration ? `Durée : ${item.duration}` : null,
      item.quantity ? `Quantité : ${item.quantity}` : null,
      item.refills ? `Renouvellements : ${item.refills}` : null,
      item.instructions ? `Instructions : ${item.instructions}` : null,
    ].filter(Boolean);
    if (details.length) line += ` — ${details.join(' — ')}`;
    lines.push(line);
  });
  if (generalInstructions) lines.push(`Instructions générales : ${generalInstructions}`);
  return lines.join('\n');
}

function docRowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    consultation_id: row.consultation_id,
    reference: row.reference,
    status: row.status,
    version: row.version,
    items: row.items || [],
    general_instructions: row.general_instructions ?? '',
    issued_at: row.issued_at ? Math.floor(new Date(row.issued_at).getTime() / 1000) : null,
  };
}

/**
 * Atomically issue the prescription and complete the consultation.
 *
 * Outcomes (checked under the consultation row lock, so concurrent
 * double-submits serialize and exactly one wins):
 *   NOT_FOUND                — unknown consultation id
 *   FORBIDDEN                — caller is not the assigned doctor
 *   ALREADY_ISSUED           — duplicate submission / double issuance
 *   NOT_ACTIVE               — consultation exists, owned, but not EN_COURS
 *   ISSUED                   — success; { consultation, document }
 */
async function issuePrescription({ consultationId, doctor, items, generalInstructions, legacyText }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM consultations WHERE id = $1 FOR UPDATE`,
      [consultationId]
    );
    const consultation = rows[0];
    if (!consultation) return { outcome: 'NOT_FOUND' };

    if (consultation.doctor_id !== doctor.id) return { outcome: 'FORBIDDEN' };

    if (consultation.status !== 'EN_COURS') {
      const { rows: existing } = await client.query(
        `SELECT * FROM prescription_documents
          WHERE consultation_id = $1 AND status = 'ISSUED'`,
        [consultationId]
      );
      if (existing[0]) return { outcome: 'ALREADY_ISSUED', document: docRowToApi(existing[0]) };
      return { outcome: 'NOT_ACTIVE', status: consultation.status };
    }

    const isLegacyOnly = items.length === 0 && legacyText && !generalInstructions;
    // Legacy free-text submissions keep byte-for-byte compatibility: what the
    // doctor typed is both the projection AND the document's instructions.
    const projection = isLegacyOnly
      ? legacyText
      : truncate(buildLegacyProjection(items, generalInstructions), LIMITS.legacyText);
    const docInstructions = isLegacyOnly ? legacyText : generalInstructions;

    const issuedAt = new Date();
    const reference = buildReference(consultationId, issuedAt);
    const documentId = `RX_${crypto.randomUUID()}`;

    await client.query(
      `INSERT INTO prescription_documents
         (id, consultation_id, patient_id, doctor_id, patient_name, doctor_name,
          reference, status, version, items, general_instructions, issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ISSUED',1,$8::jsonb,$9,$10)`,
      [
        documentId,
        consultationId,
        consultation.patient_id ?? null,
        doctor.id,
        consultation.patient_name ?? '',
        doctor.name ?? '',
        reference,
        JSON.stringify(items),
        docInstructions,
        issuedAt,
      ]
    );

    const { rows: updated } = await client.query(
      `UPDATE consultations
          SET prescription = $2, status = 'TERMINE', updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [consultationId, projection]
    );

    return {
      outcome: 'ISSUED',
      consultation: updated[0],
      document: {
        id: documentId,
        consultation_id: consultationId,
        reference,
        status: 'ISSUED',
        version: 1,
        items,
        general_instructions: docInstructions,
        issued_at: Math.floor(issuedAt.getTime() / 1000),
      },
    };
  });
}

/**
 * The active prescription document for a consultation, enriched with the
 * doctor's identity/credentials and the patient's identity — both derived
 * server-side from the database, never from client input. NULL when the
 * consultation has no issued document (legacy prescriptions remain readable
 * through consultations.prescription).
 */
async function getActiveForConsultation(consultationId) {
  const { rows } = await query(
    `SELECT pd.*,
            d.name        AS d_name,
            d.specialty   AS d_specialty,
            d.license_number AS d_license_number,
            d.hospital    AS d_hospital,
            d.location    AS d_location,
            p.name        AS p_name,
            p.age         AS p_age
       FROM prescription_documents pd
       LEFT JOIN users d ON d.id = pd.doctor_id
       LEFT JOIN users p ON p.id = pd.patient_id
      WHERE pd.consultation_id = $1 AND pd.status = 'ISSUED'`,
    [consultationId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...docRowToApi(row),
    doctor: {
      name: row.d_name ?? row.doctor_name ?? null,
      specialty: row.d_specialty ?? null,
      // Credentials are shown ONLY when actually on record — never invented.
      license_number: row.d_license_number ?? null,
      hospital: row.d_hospital ?? null,
      location: row.d_location ?? null,
    },
    patient: {
      name: row.p_name ?? row.patient_name ?? null,
      age: row.p_age ?? null,
    },
  };
}

module.exports = {
  ITEM_FIELDS,
  LIMITS,
  buildReference,
  buildLegacyProjection,
  sanitizeItems,
  docRowToApi,
  issuePrescription,
  getActiveForConsultation,
};
