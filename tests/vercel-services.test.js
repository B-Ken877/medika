/**
 * Vercel Services routing contract (single-project consolidation).
 *
 * The whole platform is served by ONE Vercel project ("medika") using
 * Vercel Services:
 *   /                → web   service (medika-web/, Next.js patient/doctor PWA)
 *   /admin, /admin/* → admin service (medika-admin/, Next.js, basePath /admin)
 *   /api, /payment, /uploads (and subpaths) + /ws
 *                    → api   service (repo root, Express + WebSocket)
 *
 * Vercel evaluates the top-level rewrites in order (first match wins) and
 * each service receives the ORIGINAL request path. These tests pin that
 * contract so that:
 *   1. every top-level path prefix the Express app mounts (extracted from
 *      src/create-app.js) plus the /ws WebSocket path is routed to the api
 *      service BEFORE the catch-all — a prefix that falls through to the
 *      web service would silently break the API for the Android app, the
 *      PWA and the admin panel;
 *   2. the admin panel keeps its basePath contract (/admin* → admin service);
 *   3. the catch-all routes everything else to the web service and comes
 *      LAST;
 *   4. every destination is a service object — an external URL destination
 *      could reintroduce the cross-project proxy this repository moved away
 *      from, or even an infinite same-origin rewrite loop;
 *   5. neither Next.js app configures a production API proxy (API_ORIGIN):
 *      with Services the platform router does the routing, and a
 *      server-side proxy would add a hop and a failure mode;
 *   6. the WebSocket function keeps maxDuration 300 (the connection ceiling
 *      clients' reconnect logic is tuned for).
 */
'use strict';

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(repoRoot, p), 'utf8'));
const readText = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

const vercelJson = readJson('vercel.json');

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Rewrite list as [{ source, service, hasExtraDestinationKeys }] (ordered). */
function rewriteTable() {
  return (vercelJson.rewrites ?? []).map((rule) => {
    const destination = rule.destination;
    const isServiceObject =
      destination !== null &&
      typeof destination === 'object' &&
      typeof destination.service === 'string';
    return {
      source: rule.source,
      service: isServiceObject ? destination.service : null,
      isServiceObject,
      destinationKeys: isServiceObject ? Object.keys(destination).sort() : null,
    };
  });
}

/** Top-level path prefixes the Express app mounts (from src/create-app.js). */
function expressMountedPrefixes() {
  const source = readText('src/create-app.js');
  const mounts = [...source.matchAll(/app\.use\(\s*'([^']+)'/g)].map((m) => m[1]);
  const prefixes = new Set(
    mounts.map((mount) => mount.replace(/^\//, '').split('/')[0]),
  );
  // The WebSocket server is attached to the HTTP server (not an Express
  // mount) at path /ws — src/realtime/hub.js: new WebSocketServer({ server,
  // path: '/ws' }). Route it like the mounted prefixes.
  expect(readText('src/realtime/hub.js')).toMatch(/path:\s*'\/ws'/);
  prefixes.add('ws');
  return prefixes;
}

// ─── services definition ─────────────────────────────────────────────────────

describe('vercel.json — services definition', () => {
  it('declares exactly the web, admin and api services', () => {
    expect(Object.keys(vercelJson.services ?? {}).sort()).toEqual(['admin', 'api', 'web']);
    // Service names must match the platform's naming pattern.
    for (const name of Object.keys(vercelJson.services)) {
      expect(name).toMatch(/^[a-z]([a-z_-]*[a-z])?$/);
    }
  });

  it('each service root exists and owns a package.json (independent builds)', () => {
    for (const [name, service] of Object.entries(vercelJson.services)) {
      expect(service.root, `service ${name} root`).toBeTruthy();
      const rootDir = service.root === '.' ? repoRoot : path.join(repoRoot, service.root);
      expect(fs.statSync(rootDir).isDirectory(), `${service.root} is a directory`).toBe(true);
      expect(
        fs.existsSync(path.join(rootDir, 'package.json')),
        `${service.root}/package.json exists`,
      ).toBe(true);
    }
  });

  it('pins the frameworks (web/admin nextjs, api express)', () => {
    expect(vercelJson.services.web.framework).toBe('nextjs');
    expect(vercelJson.services.web.root).toBe('medika-web');
    expect(vercelJson.services.admin.framework).toBe('nextjs');
    expect(vercelJson.services.admin.root).toBe('medika-admin');
    expect(vercelJson.services.api.framework).toBe('express');
    expect(vercelJson.services.api.root).toBe('.');
  });

  it('api service: express entrypoint + server.js function with maxDuration 300', () => {
    const api = vercelJson.services.api;
    expect(api.entrypoint).toBe('server.js');
    expect(api.functions?.['server.js']?.maxDuration).toBe(300);
    // WebSocket connections live until the function's max duration; 300 is
    // the documented Hobby ceiling and the value the clients' reconnect
    // logic is tuned for. Don't let it regress to the 10s default.
    expect(api.functions['server.js'].maxDuration).toBeGreaterThan(60);
  });

  it('declares the Services framework (project-level build mode)', () => {
    // The platform requires the project framework to be "Services" for the
    // services key to take effect; declaring it in vercel.json keeps the
    // repository self-describing (and hedges the dashboard setting).
    expect(vercelJson.framework).toBe('services');
  });

  it('keeps build/runtime config OUT of the top level (invalid once services is present)', () => {
    for (const key of [
      'functions',
      'builds',
      'routes',
      'buildCommand',
      'installCommand',
      'outputDirectory',
    ]) {
      expect(vercelJson[key], `top-level ${key}`).toBeUndefined();
    }
  });
});

// ─── public routing table ────────────────────────────────────────────────────

describe('vercel.json — public routing table', () => {
  const table = rewriteTable();

  it('routes every Express-mounted prefix (incl. /ws) to the api service', () => {
    for (const prefix of expressMountedPrefixes()) {
      // /ws is a single endpoint (the WebSocketServer path), not a prefix
      // family — there is no /ws/(.*) rewrite.
      const sources = prefix === 'ws' ? ['/ws'] : [`/${prefix}/(.*)`, `/${prefix}`];
      for (const source of sources) {
        const rule = table.find((r) => r.source === source);
        expect(rule, `rewrite for ${source}`).toBeTruthy();
        expect(rule.service).toBe('api');
      }
    }
  });

  it('all api-path rewrites sit BEFORE the catch-all (first match wins)', () => {
    const catchAllIndex = table.findIndex((r) => r.source === '/(.*)');
    expect(catchAllIndex).toBeGreaterThan(-1);
    for (const prefix of expressMountedPrefixes()) {
      const sources = prefix === 'ws' ? ['/ws'] : [`/${prefix}/(.*)`, `/${prefix}`];
      for (const source of sources) {
        const index = table.findIndex((r) => r.source === source);
        expect(index, `position of ${source}`).toBeGreaterThan(-1);
        expect(index, `${source} must precede the catch-all`).toBeLessThan(catchAllIndex);
      }
    }
  });

  it('routes /admin and /admin/(.*) to the admin service before the catch-all', () => {
    const catchAllIndex = table.findIndex((r) => r.source === '/(.*)');
    for (const source of ['/admin', '/admin/(.*)']) {
      const rule = table.find((r) => r.source === source);
      expect(rule, `rewrite for ${source}`).toBeTruthy();
      expect(rule.service).toBe('admin');
      expect(table.indexOf(rule)).toBeLessThan(catchAllIndex);
    }
  });

  it('routes the catch-all to the web service and places it LAST', () => {
    const last = table[table.length - 1];
    expect(last.source).toBe('/(.*)');
    expect(last.service).toBe('web');
  });

  it('every destination is a service object — no external/URL destinations (no proxy loops)', () => {
    expect(table.length).toBeGreaterThan(0);
    for (const rule of table) {
      expect(rule.isServiceObject, `destination of ${rule.source}`).toBe(true);
      expect(rule.destinationKeys).toEqual(['service']);
      expect(vercelJson.services[rule.service], `known service ${rule.service}`).toBeTruthy();
    }
  });

  it('keeps the API response hardening headers (no-store etc.)', () => {
    const headers = vercelJson.headers ?? [];
    const apiHeader = headers.find((h) => h.source === '/api/(.*)');
    expect(apiHeader).toBeTruthy();
    const apiHeaderKeys = apiHeader.headers.map((h) => `${h.key}: ${h.value}`);
    expect(apiHeaderKeys).toContain('Cache-Control: no-store');
    expect(apiHeaderKeys).toContain('X-Content-Type-Options: nosniff');
    expect(headers.find((h) => h.source === '/payment/(.*)')).toBeTruthy();
    expect(headers.find((h) => h.source === '/uploads/(.*)')).toBeTruthy();
  });
});

// ─── frontend apps are pure same-origin clients ─────────────────────────────

describe('medika-web — same-origin client (no production proxy)', () => {
  const config = readText('medika-web/next.config.mjs');

  it('no API_ORIGIN cross-project proxy (the platform router owns /api routing)', () => {
    // A production API_ORIGIN proxy (process.env.API_ORIGIN in rewrites())
    // would route /api,/payment,/uploads through the Next.js server to
    // another project — the architecture this consolidation removed.
    expect(config).not.toMatch(/process\.env\.API_ORIGIN/);
  });

  it('keeps the local-dev proxy (mirrors the production nginx routes)', () => {
    expect(config).toContain('DEV_BACKEND_ORIGIN');
    expect(config).toMatch(/source:\s*"\/api\/:path\*"/);
    expect(config).toMatch(/source:\s*"\/uploads\/:path\*"/);
    expect(config).toMatch(/source:\s*"\/payment\/:path\*"/);
  });

  it('PWA assets are served by the web service at the domain root', () => {
    expect(fs.existsSync(path.join(repoRoot, 'medika-web/public/sw.js'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'medika-web/public/manifest.webmanifest'))).toBe(true);
  });
});

describe('medika-admin — basePath contract', () => {
  const config = readText('medika-admin/next.config.mjs');
  const apiLib = readText('medika-admin/lib/api.js');

  it('keeps basePath "/admin" (the platform preserves the original path)', () => {
    expect(config).toContain('basePath: "/admin"');
  });

  it('no API_ORIGIN cross-project proxy', () => {
    expect(config).not.toMatch(/process\.env\.API_ORIGIN/);
  });

  it('raw logout redirects are basePath-aware (/admin/login, not /login)', () => {
    // window.location.href does NOT get the Next basePath prepended (unlike
    // router.push) — an un-prefixed '/login' would land on the PATIENT app's
    // login page once both apps share one domain.
    expect(apiLib).not.toMatch(/location\.href\s*=\s*['"]\/login['"]/);
    expect(apiLib).toMatch(/location\.href\s*=\s*['"]\/admin\/login['"]/);
  });
});

// ─── routing ↔ backend coherence ────────────────────────────────────────────

describe('routing ↔ backend coherence', () => {
  it('the api service entrypoint is the file Vercel Express detection resolves', () => {
    // server.js imports express directly and is the sole candidate — pinned
    // in detail by tests/vercel-entrypoint.test.js; here we just assert the
    // service entrypoint agrees with it.
    expect(vercelJson.services.api.entrypoint).toBe('server.js');
    expect(fs.existsSync(path.join(repoRoot, 'server.js'))).toBe(true);
    expect(readJson('package.json').main).toBe('server.js');
  });

  it('unknown /api/* paths still produce the Express 404 (routing is final per service)', () => {
    // "Routing into a service is final": once /api/(.*) matches, the api
    // service answers — its French JSON 404, byte-identical to today.
    const errors = readText('src/errors.js');
    expect(errors).toContain("res.status(404).json({ error: 'Ressource introuvable' })");
  });
});
