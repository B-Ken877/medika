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

  // ─── LiveKit ───────────────────────────────────────────────────────────────
  livekitUrl: env('LIVEKIT_URL', ''),          // public client URL, e.g. wss://…
  livekitApiKey: env('LIVEKIT_API_KEY', ''),
  livekitApiSecret: env('LIVEKIT_API_SECRET', ''),

  // ─── MonCash payments ──────────────────────────────────────────────────────
  moncashMode: env('MONCASH_MODE', 'sandbox'), // 'sandbox' | 'production'
  moncashClientId: env('MONCASH_CLIENT_ID', ''),
  moncashClientSecret: env('MONCASH_CLIENT_SECRET', ''),
  paymentSimulation: bool('PAYMENT_SIMULATION', false),
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
  if (config.paymentSimulation) {
    // Simulated payments must be impossible to enable accidentally in production.
    problems.push('PAYMENT_SIMULATION must NOT be enabled when NODE_ENV=production');
  }
  if (config.seedDemo) {
    problems.push('SEED_DEMO must NOT be enabled when NODE_ENV=production');
  }
  if (config.moncashMode === 'production' && (!config.moncashClientId || !config.moncashClientSecret)) {
    problems.push('MONCASH_MODE=production requires MONCASH_CLIENT_ID and MONCASH_CLIENT_SECRET');
  }
  if (config.livekitUrl && !/^wss:|^https:/i.test(config.livekitUrl)) {
    problems.push('LIVEKIT_URL must use wss:// or https:// in production (plain ws/http leaks video signaling)');
  }
  if (problems.length) {
    throw new Error('Refusing to start in production:\n  - ' + problems.join('\n  - '));
  }
}

/** True when MonCash credentials are usable. */
function moncashConfigured() {
  return Boolean(config.moncashClientId && config.moncashClientSecret);
}

/** Simulation is allowed only in non-production AND sandbox mode. */
function simulationAllowed() {
  return config.paymentSimulation && !isProduction() && config.moncashMode !== 'production';
}

module.exports = { config, assertProductionSafety, moncashConfigured, simulationAllowed, isProduction };
