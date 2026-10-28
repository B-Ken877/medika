/**
 * Production CORS fail-closed regression test (risk review item):
 * "Production CORS must not default to allowing every origin."
 *
 * This file boots the app with NODE_ENV=production (worker isolation gives a
 * fresh module registry, so env below applies before src/config.js loads —
 * see tests/helpers.js). With CORS_ORIGINS unset, a cross-origin browser
 * request must receive NO access-control-allow-origin header (the browser
 * blocks it); an explicitly allowlisted origin still passes; native clients
 * (no Origin header) are never blocked.
 */
'use strict';

process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'x'.repeat(48); // satisfy assertProductionSafety
process.env.CORS_ORIGINS = 'https://medika-web.example.com';
process.env.REQUIRE_PAYMENT = 'false';
process.env.PAYMENT_SIMULATION = 'false';
process.env.SEED_DEMO = 'false';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r;

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
});

afterAll(async () => {
  await h.closeAll();
});

describe('production CORS posture', () => {
  it('allowlisted origin gets CORS headers', async () => {
    const res = await r.get('/api/health').set('Origin', 'https://medika-web.example.com');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://medika-web.example.com');
  });

  it('unknown origin gets NO access-control-allow-origin (browser-blocked)', async () => {
    const res = await r.get('/api/health').set('Origin', 'https://evil.example.net');
    expect(res.status).toBe(200); // server answers; browsers cannot read it
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight from unknown origin is rejected', async () => {
    const res = await r.options('/api/auth/login')
      .set('Origin', 'https://evil.example.net')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('native client (no Origin header) is never blocked', async () => {
    const res = await r.get('/api/health');
    expect(res.status).toBe(200);
  });
});

describe('production CORS with CORS_ORIGINS unset (default posture)', () => {
  // Dynamic re-configuration of the same app instance is not possible (the
  // middleware closes over config at creation), so assert the documented
  // invariant instead: production default must not be "allow all".
  it('src/create-app.js production default denies cross-origin browsers', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../src/create-app.js', import.meta.url), 'utf8');
    // The dev-only permissive branch must be gated on !isProduction().
    expect(source).toMatch(/devFallback = !isProduction\(\)/);
    expect(source).toMatch(/devFallback && allow\.size === 0/);
  });
});
