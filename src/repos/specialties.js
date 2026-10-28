/**
 * Specialties repository — replaces data/specialties.json at runtime.
 * The repo-root specialties.json remains the SEED source (scripts/migrate.js).
 */
'use strict';

const { query } = require('../db');

async function list() {
  const { rows } = await query(`SELECT * FROM specialties ORDER BY position, name`);
  return rows.map((r) => ({ id: r.id, name: r.name, price: r.price }));
}

async function priceFor(specialtyName) {
  const { rows } = await query(`SELECT price FROM specialties WHERE name = $1`, [specialtyName]);
  return rows[0] ? rows[0].price : 750; // legacy fallback default
}

async function updatePrices(specialties) {
  // Legacy semantics: only prices of known specialties change; unknown ids ignored.
  let changed = 0;
  for (const s of specialties) {
    if (typeof s.price === 'number' && s.price > 0 && s.id) {
      const { rowCount } = await query(
        `UPDATE specialties SET price = $2 WHERE id = $1`, [s.id, s.price]);
      changed += rowCount;
    }
  }
  return changed;
}

async function updatePrice(id, price) {
  const { rows } = await query(
    `UPDATE specialties SET price = $2 WHERE id = $1 RETURNING *`, [id, price]);
  return rows[0] ? { id: rows[0].id, name: rows[0].name, price: rows[0].price } : null;
}

async function count() {
  const { rows } = await query(`SELECT count(*)::int AS n FROM specialties`);
  return rows[0].n;
}

module.exports = { list, priceFor, updatePrices, updatePrice, count };
