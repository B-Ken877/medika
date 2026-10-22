/**
 * Vitest global setup: boots an embedded PostgreSQL (real server binaries),
 * applies migrations and seeds specialties, and exports DATABASE_URL to the
 * test workers. Teardown stops the server and removes its data directory.
 */
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { randomInt } = require('crypto');
const EmbeddedPostgres = require('embedded-postgres').default;
const { execFileSync } = require('child_process');

module.exports = async function globalSetup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medika-pg-'));
  const port = 5400 + randomInt(100);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    // The container only ships the C locale; the library's default
    // en_US.UTF-8 message locale makes initdb fail here.
    initdbFlags: ['--lc-messages=C'],
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase('medika');

  const databaseUrl = `postgres://postgres:postgres@localhost:${port}/medika`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';

  // Apply migrations + seed reference data (same runner as production).
  execFileSync(
    process.execPath,
    [path.join(__dirname, '..', 'scripts', 'migrate.js')],
    { env: { ...process.env, DATABASE_URL: databaseUrl, ADMIN_USERNAME: '', ADMIN_PASSWORD: '' }, stdio: 'inherit' }
  );

  console.log(`[global-setup] embedded PostgreSQL ready on port ${port}`);

  return async () => {
    await pg.stop();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
    console.log('[global-setup] embedded PostgreSQL stopped');
  };
};
