/**
 * Express application factory.
 *
 * Composes every route group under /api (and the legacy /payment mount),
 * preserves the legacy CORS behavior for native clients while restricting
 * browser origins to an explicit allowlist, and installs centralized error
 * handling that never leaks internals.
 *
 * NOTE on the module name: this file is deliberately called create-app.js,
 * NOT app.js. Vercel's Express preset treats files named
 * app/index/server (+ src/) as entrypoint candidates; a factory module at
 * src/app.js was previously auto-selected as the deployment entry and broke
 * the deployment (its { createApp } export is not "a function or server").
 * The real entry point is the root server.js, which imports express directly
 * and exports the composed http.Server — see server.js and
 * tests/vercel-entrypoint.test.js.
 */
'use strict';

const express = require('express');
const cors = require('cors');
const { config, isProduction } = require('./config');
const { errorHandler, notFoundHandler } = require('./errors');
const { localStaticMiddleware } = require('./uploads');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const consultationRoutes = require('./routes/consultations');
const medicalHistoryRoutes = require('./routes/medical-history');
const ticketRoutes = require('./routes/tickets');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const callRoutes = require('./routes/call');
const uploadRoutes = require('./routes/upload');
const mediaRoutes = require('./routes/media');
const walletRoutes = require('./routes/wallet');
const cronRoutes = require('./routes/crons');
const notificationRoutes = require('./routes/notifications');

/**
 * CORS: native clients (Android/OkHttp) send no Origin header and pass
 * through; browser origins must be explicitly allowlisted via CORS_ORIGINS.
 * Credentials are never needed (Bearer tokens, not cookies).
 *
 * Fail-closed default: with CORS_ORIGINS unset, production denies every
 * cross-origin browser request (the PWA/admin are same-origin via the proxy,
 * native apps send no Origin) — it must NEVER default to allowing every
 * origin. Development keeps the permissive fallback for local tooling.
 */
function corsMiddleware() {
  const allow = new Set(config.corsOrigins);
  const devFallback = !isProduction();
  return cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // native clients / same-origin
      if (allow.has(origin)) return cb(null, true); // explicit allowlist
      if (devFallback && allow.size === 0) return cb(null, true); // dev-only
      cb(null, false); // no CORS headers → browser blocks, server still answers
    },
    credentials: false,
  });
}

/**
 * Legacy /uploads/* handling:
 *  - production: 302 redirect to LEGACY_UPLOADS_ORIGIN (old VPS) so historical
 *    consultation media keeps resolving during migration;
 *  - development: static serving from LOCAL_UPLOADS_DIR (parity with the old
 *    server; new uploads carry absolute Blob URLs anyway).
 */
function uploadsRoute() {
  const router = express.Router();
  const local = localStaticMiddleware();
  if (local) {
    router.use('/', local);
  }
  router.use('/', (req, res, next) => {
    if (config.legacyUploadsOrigin) {
      const target = `${config.legacyUploadsOrigin.replace(/\/+$/, '')}/uploads/${encodeURIComponent(req.path).replace(/%2F/g, '/')}`;
      return res.redirect(302, target);
    }
    if (local) return next(); // fall through to 404 handler
    res.status(404).json({ error: 'Uploads non disponibles' });
  });
  return router;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(corsMiddleware());
  app.use(express.json({ limit: '1mb' })); // legacy default was 100kb; 1mb is a safe superset

  app.use('/uploads', uploadsRoute());

  // Payment server contract lives at /payment/api/payment/* on the legacy
  // deployment (nginx proxied /payment → port 9998). The same router is also
  // mounted at /api/payment (canonical) and /payment (aliases).
  app.use('/api/payment', paymentRoutes);
  app.use('/payment/api/payment', paymentRoutes);
  app.use('/payment', paymentRoutes);

  app.use('/api', authRoutes);
  app.use('/api', profileRoutes);
  app.use('/api', consultationRoutes);
  app.use('/api', medicalHistoryRoutes);
  app.use('/api', ticketRoutes);
  app.use('/api', uploadRoutes); // /api/upload + /api/admin/upload
  app.use('/api', mediaRoutes); // /api/media/assets/:fileId (shared, capability-URL media)
  app.use('/api', walletRoutes); // /api/doctor/wallet (doctor's own, read-only)
  app.use('/api', notificationRoutes); // /api/notifications/* (issue #36)
  app.use('/api', cronRoutes); // /api/crons/* (deadline processor — auth guarded)
  app.use('/api/admin', adminRoutes); // router-level admin guard applies to /api/admin/* only
  app.use('/api', callRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
