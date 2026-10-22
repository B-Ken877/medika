/**
 * Medika backend — single entry point for BOTH deployment modes:
 *
 *  1. Vercel (Express framework preset): this file is the auto-detected
 *     Express entry point. The preset's entrypoint detection
 *     (@vercel/express findEntrypoint) scans app/index/server (+src/)
 *     candidates in order and requires the entry file to import the
 *     `express` package DIRECTLY — an indirect import through ./src/*
 *     modules is not recognized, so this file requires('express') itself.
 *     We export the composed HTTP server (Express app as request listener +
 *     WebSocketServer attached on /ws) — the documented pattern for Express
 *     apps that also serve WebSockets on Vercel Functions (the runtime
 *     accepts "a function or server"; the server shape keeps the /ws
 *     upgrade path working). REST paths and the /ws protocol
 *     are identical to the legacy deployment, so Android, the web PWA and the
 *     admin panel keep working (DNS cutover only). The app factory itself
 *     lives in src/create-app.js — deliberately NOT one of Vercel's
 *     entrypoint candidate paths, so internal modules can never be mistaken
 *     for the request handler (regression-checked by
 *     tests/vercel-entrypoint.test.js).
 *
 *  2. Standalone / Docker / PM2: `node server.js` starts the same composition
 *     on PORT (legacy behavior). realtime/server.js reuses this module for an
 *     always-on realtime host, if you prefer that over Vercel's WS beta.
 *
 * Migration notes (vs the legacy server.js):
 *  - Storage: JSON files → PostgreSQL (DATABASE_URL). Run `npm run migrate`
 *    and `npm run import-json` to migrate existing data.
 *  - Auth: Bearer tokens are JWTs now; previously stored user-id tokens are
 *    rejected (one-time re-login for all clients — documented).
 *  - WebSocket auth frames must carry {type:'auth', token} (JWT).
 *  - Uploads: Vercel Blob (BLOB_READ_WRITE_TOKEN); bodies capped at 4 MB
 *    (Vercel function limit).
 *  - LiveKit + MonCash credentials: environment variables only.
 */
'use strict';

const http = require('http');
// Load-bearing for Vercel's Express preset entrypoint detection: the entry
// file must import `express` directly, or detection falls through to another
// candidate (previously src/app.js, which exports only the { createApp }
// factory → "Invalid export found in module … The default export must be a
// function or server" → HTTP 500 on every request). The Express app itself
// is composed by createApp() below; this require is what makes THIS file the
// unambiguous entry point.
// eslint-disable-next-line no-unused-vars
const express = require('express');
const { createApp } = require('./src/create-app');
const { attachRealtime } = require('./src/realtime');
const { assertProductionSafety } = require('./src/config');

assertProductionSafety();

const app = createApp();
const server = http.createServer(app);
const hub = attachRealtime(server);
app.locals.hub = hub;

// Export the HTTP server — this is what Vercel's runtime consumes (it accepts
// "a function or server"; the server shape is what keeps WebSocket upgrades
// flowing to the attached hub), and what tests can listen on ephemeral ports.
module.exports = server;
// Some tooling introspects `module.exports.app` — expose it for convenience.
module.exports.app = app;
module.exports.hub = hub;

if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n=== Medika Backend ===');
    console.log(`  REST:      http://0.0.0.0:${PORT}/api`);
    console.log(`  WS:        ws://0.0.0.0:${PORT}/ws`);
    console.log(`  Payments:  http://0.0.0.0:${PORT}/payment/api/payment`);
    console.log(`  Health:    http://0.0.0.0:${PORT}/api/health\n`);
  });
}
