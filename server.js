/**
 * Medika backend — single entry point for BOTH deployment modes:
 *
 *  1. Vercel (zero-config Express + WebSocket): this file is auto-detected as
 *     the Express entry ("server.js" at the repo root). We export the raw
 *     HTTP server (Express app as request listener + WebSocketServer attached
 *     on /ws) — the officially documented pattern for Express apps that also
 *     serve WebSockets on Vercel Functions. REST paths and the /ws protocol
 *     are identical to the legacy deployment, so Android, the web PWA and the
 *     admin panel keep working (DNS cutover only).
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
const { createApp } = require('./src/app');
const { attachRealtime } = require('./src/realtime');
const { assertProductionSafety } = require('./src/config');

assertProductionSafety();

const app = createApp();
const server = http.createServer(app);
const hub = attachRealtime(server);
app.locals.hub = hub;

// Export the HTTP server — this is what Vercel's runtime consumes (Express +
// WebSocket in one Function), and what tests can listen on ephemeral ports.
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
