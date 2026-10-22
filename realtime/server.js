/**
 * Standalone realtime/API host — OPTIONAL alternative to Vercel's WebSocket
 * (public beta) for operators who want an always-on /ws without connection
 * duration ceilings. Runs the EXACT same Express + WebSocket composition as
 * server.js, so the protocol is identical.
 *
 * Deploy anywhere with persistent processes (Railway / Render / Fly.io / the
 * existing VPS behind nginx). Point clients at this host's /ws.
 *
 *   PORT=3001 node realtime/server.js
 */
'use strict';

const server = require('../server.js');

const PORT = parseInt(process.env.REALTIME_PORT || process.env.PORT || '3001', 10);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[realtime] Medika standalone host listening on :${PORT} (REST /api + WS /ws)`);
});
