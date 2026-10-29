/**
 * Central environment configuration.
 *
 * All secrets come from environment variables — nothing is hardcoded.
 * Boot-time safety checks (assertProductionSafety) enforce that unsafe
 * combinations (e.g. payment simulation in production) refuse to start.
 */
'use strict';

const env = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
};
const bool = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Deployment-stage detection for payment simulation gating.
 *
 * On Vercel, VERCEL_ENV is a platform-injected system variable
 * ('development' | 'preview' | 'production') that cannot be overridden from
 * project settings, and PREVIEW deployments build with NODE_ENV=production —
 * so NODE_ENV alone cannot distinguish a Preview from a Production
 * deployment. When VERCEL_ENV is present it is authoritative; any UNKNOWN
 * value fails CLOSED (treated as production — simulation stays disabled).
 * Off Vercel (legacy VPS, local dev, tests) NODE_ENV remains the signal.
 */
function isProductionDeployment() {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv !== undefined && vercelEnv !== '') {
    return vercelEnv !== 'preview' && vercelEnv !== 'development';
  }
  return isProduction();
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction,

  port: parseInt(env('PORT', '3000'), 10),

  // ─── Database ──────────────────────────────────────────────────────────────
  databaseUrl: env('DATABASE_URL', 'postgres://medika:medika@localhost:5432/medika'),
  // Managed providers (Neon/Supabase/RDS) require TLS. Local dev does not.
  databaseSsl: (() => {
    const explicit = process.env.DATABASE_SSL;
    if (explicit !== undefined) return bool('DATABASE_SSL', true);
    const u = env('DATABASE_URL', '');
    return !/localhost|127\.0\.0\.1/.test(u);
  })(),

  // ─── Auth ──────────────────────────────────────────────────────────────────
  jwtSecret: env('JWT_SECRET', 'dev-insecure-secret-change-me'),
  jwtExpiresDays: parseInt(env('JWT_EXPIRES_DAYS', '30'), 10),

  // ─── CORS ──────────────────────────────────────────────────────────────────
  // Comma-separated browser origins allowed to call the API cross-origin.
  // Native clients (Android/OkHttp) send no Origin header and are always allowed.
  corsOrigins: env('CORS_ORIGINS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // ─── ZEGOCLOUD (the sole video-call provider) ──────────────────────────────
  // APP_ID and SERVER_URL are client-visible (the browser engine needs both);
  // SERVER_SECRET and APP_SIGN are server-only and must NEVER reach client
  // bundles or logs. Use the intended ZEGO project credentials in each scope.
  zegoCloudAppId: (() => {
    const raw = env('ZEGOCLOUD_APP_ID', '');
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })(),
  zegoCloudServerUrl: env('ZEGOCLOUD_SERVER_URL', '').trim(), // public WS endpoint from the ZEGO console; trimmed so validation and the engine see the same value
  zegoCloudServerSecret: env('ZEGOCLOUD_SERVER_SECRET', ''), // backend only; exactly 32 chars
  zegoCloudAppSign: env('ZEGOCLOUD_APP_SIGN', ''),        // backend only; unused by token04 auth

  // ─── MonCash payments ──────────────────────────────────────────────────────
  moncashMode: env('MONCASH_MODE', 'sandbox'), // 'sandbox' | 'production'
  moncashClientId: env('MONCASH_CLIENT_ID', ''),
  moncashClientSecret: env('MONCASH_CLIENT_SECRET', ''),
  paymentSimulation: bool('PAYMENT_SIMULATION', false),
  // Exact username resolved from the authenticated DB user; never trust client input.
  paymentSimulationTestUsername: env('PAYMENT_SIMULATION_TEST_USERNAME', '').trim(),
  requirePayment: bool('REQUIRE_PAYMENT', isProduction()),

  // ─── Uploads ───────────────────────────────────────────────────────────────
  blobReadWriteToken: env('BLOB_READ_WRITE_TOKEN', ''),
  legacyUploadsOrigin: env('LEGACY_UPLOADS_ORIGIN', ''), // e.g. https://medikahaiti.site
  maxUploadMb: parseInt(env('MAX_UPLOAD_MB', '4'), 10),  // Vercel body limit is 4.5MB
  localUploadsDir: env('LOCAL_UPLOADS_DIR', ''),

  // ─── Realtime fan-out (optional) ───────────────────────────────────────────
  redisUrl: env('REDIS_URL', ''),

  // ─── Business ──────────────────────────────────────────────────────────────
  platformFee: parseInt(env('PLATFORM_FEE', '250'), 10),

  // ─── Consultation request lifecycle (issue #25) ────────────────────────────
  // Server-authoritative deadlines. Values are minutes/hours so tests and
  // staged rollouts can tune them; the product defaults are exactly the
  // specified 1 hour and 5 hours.
  offerWindowMinutes: parseInt(env('OFFER_WINDOW_MINUTES', '60'), 10),
  consultationExpiryHours: parseInt(env('CONSULTATION_EXPIRY_HOURS', '5'), 10),
  rerouteRetryMinutes: parseInt(env('REROUTE_RETRY_MINUTES', '15'), 10),
  // Issue #71: ONE gentle pre-expiration reminder per party, emitted by the
  // deadline processor when an EN_COURS consultation's expires_at falls
  // within this many minutes. Delivery is idempotent by the notification
  // idempotency_key (no schema change, no duplicate on repeated scans) and
  // respects the existing per-category notification preferences at dispatch.
  // It is a calm heads-up, NOT a deadline change and NOT a live timer.
  expiryReminderMinutes: parseInt(env('EXPIRY_REMINDER_MINUTES', '45'), 10),
  // Issue #60: bounded pending-request timeout. A RECHERCHE_MEDECIN request
  // older than this many hours is expired by the deadline processor (with a
  // visible system message and close_reason='pending_timeout') so no pending
  // request is stuck indefinitely. In-progress (EN_COURS) consultations are
  // NEVER expired by this knob — their five-hour deadline
  // (consultationExpiryHours) is a separate, deliberate product rule.
  pendingExpiryHours: parseInt(env('PENDING_EXPIRY_HOURS', '4'), 10),
  // NOTE: CRON_SECRET (the shared secret for /api/crons/* — the scheduled
  // deadline processor) is deliberately NOT snapshotted here: the route reads
  // the environment at request time so it can be rotated without a redeploy.

  // ─── Seeding ───────────────────────────────────────────────────────────────
  adminUsername: env('ADMIN_USERNAME', ''),
  adminPassword: env('ADMIN_PASSWORD', ''),
  seedDemo: bool('SEED_DEMO', false),
  demoPassword: env('DEMO_PASSWORD', 'demo1234'),
};

/**
 * Refuse to boot in production when the configuration is unsafe.
 * Called from server.js at startup (never at module import — tests import
 * modules with development defaults).
 */
function assertProductionSafety() {
  if (!isProduction()) return;
  const problems = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be set to a strong random value (>= 32 chars)');
  }
  if (!process.env.DATABASE_URL) {
    problems.push('DATABASE_URL is required');
  }
  if (config.paymentSimulation && isProductionDeployment() && !config.paymentSimulationTestUsername) {
    // Production simulation is permitted only when bound to one server-verified
    // username. Routes must call simulationAllowed(req.user), never the global form.
    problems.push('PAYMENT_SIMULATION on production requires PAYMENT_SIMULATION_TEST_USERNAME');
  }
  if (config.seedDemo) {
    problems.push('SEED_DEMO must NOT be enabled when NODE_ENV=production');
  }
  if (config.moncashMode === 'production' && (!config.moncashClientId || !config.moncashClientSecret)) {
    problems.push('MONCASH_MODE=production requires MONCASH_CLIENT_ID and MONCASH_CLIENT_SECRET');
  }
  if (problems.length) {
    throw new Error('Refusing to start in production:\n  - ' + problems.join('\n  - '));
  }
}

/** True when MonCash credentials are usable. */
function moncashConfigured() {
  return Boolean(config.moncashClientId && config.moncashClientSecret);
}

/** Simulation is allowed only on NON-production deployments AND sandbox mode.
 * Deployment stage comes from isProductionDeployment() — VERCEL_ENV-aware so
 * Vercel Preview deployments (NODE_ENV=production, VERCEL_ENV=preview) can
 * run the isolated simulation, while true production fails closed. */
function simulationAllowed(user) {
  if (!config.paymentSimulation || config.moncashMode === 'production') return false;
  if (!isProductionDeployment()) return true;
  return Boolean(
    config.paymentSimulationTestUsername &&
    user &&
    typeof user.username === 'string' &&
    user.username === config.paymentSimulationTestUsername
  );
}

module.exports = { config, assertProductionSafety, moncashConfigured, simulationAllowed, isProduction, isProductionDeployment };
