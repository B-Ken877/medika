/**
 * PostgreSQL access layer.
 *
 * A single module-level Pool is reused across requests within a function
 * instance (Vercel Fluid compute keeps instances warm), which is the
 * recommended pattern for serverless + `pg`.
 */
'use strict';

const { Pool } = require('pg');
const { config } = require('./config');

let pool = null;

function getPool() {
  // Recreate after end() (tests simulate new function instances this way).
  if (pool && !pool.ended && !pool.__destroyed) return pool;
  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10, // keep well under the 1024 fd/instance limit
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    // Never log connection strings or data — category only.
    console.error('[DB] idle client error:', err.code || err.message);
  });
  return pool;
}

/** Replace the pool (used by tests). */
function setPool(p) {
  pool = p;
}

async function query(text, params) {
  return getPool().query(text, params);
}

/**
 * Run `fn` inside a transaction. `fn` receives a client with query().
 * Any UI-independent data errors roll back automatically on throw.
 */
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { getPool, setPool, query, withTransaction };
