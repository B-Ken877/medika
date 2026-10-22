/**
 * Vercel Express entrypoint regression check.
 *
 * Deployment incident (medika-ecru.vercel.app): every request returned HTTP
 * 500 with "Invalid export found in module '/var/task/src/app.js'. The
 * default export must be a function or server."
 *
 * Root cause: Vercel's Express framework preset (the @vercel/express builder)
 * selects the deployment entry by scanning app/index/server (+src/)
 * candidates in a FIXED ORDER and requiring the entry file to import the
 * `express` package DIRECTLY (regex below, verbatim from
 * vercel/vercel packages/express/src/build.ts). The old src/app.js (an
 * application factory exporting { createApp }) imported express and was
 * therefore selected as the entry; root server.js did not import express
 * directly and was skipped. The factory's export shape then failed the
 * runtime's "a function or server" handler check.
 *
 * This test replicates that detection algorithm against the real repository
 * tree and pins the contract:
 *   1. the resolved entrypoint is exactly 'server.js';
 *   2. server.js is the ONLY candidate matching the express-import gate
 *      (no ambiguity, no order-dependent selection, no build warning);
 *   3. package.json#main points at server.js (main-fallback detection path);
 *   4. vercel.json keys the function config at the entry file 'server.js';
 *   5. requiring server.js yields the composed http.Server with the Express
 *      app and the realtime hub attached — the "server" handler shape the
 *      Vercel runtime accepts, which is what keeps /ws upgrades working.
 */
'use strict';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Verbatim from @vercel/express (vercel/vercel packages/express/src/build.ts).
// Do not "simplify" these: the test must fail if the platform contract moves.
const VALID_FILENAMES = ['app', 'index', 'server', 'src/app', 'src/index', 'src/server'];
const VALID_EXTENSIONS = ['js', 'cjs', 'mjs', 'ts', 'cts', 'mts'];
const EXPRESS_IMPORT_REGEX = /(?:from|require|import)\s*(?:\(\s*)?["']express["']\s*(?:\)\s*)?/g;

/**
 * Replicates @vercel/express findEntrypoint(): candidates in declaration
 * order, filtered to existing files, filtered to files whose source matches
 * the express-import gate; first survivor wins.
 */
function detectVercelExpressEntrypoint() {
  const allCandidates = VALID_FILENAMES.flatMap((filename) =>
    VALID_EXTENSIONS.map((extension) => `${filename}.${extension}`)
  );
  const existing = allCandidates.filter((candidate) =>
    fs.existsSync(path.join(repoRoot, candidate))
  );
  const matching = existing.filter((candidate) => {
    const content = fs.readFileSync(path.join(repoRoot, candidate), 'utf8');
    return content.match(EXPRESS_IMPORT_REGEX) !== null;
  });
  return { allCandidates, existing, matching, entrypoint: matching[0] };
}

describe('Vercel Express entrypoint detection (platform contract)', () => {
  const detection = detectVercelExpressEntrypoint();

  it("resolves the deployment entry to 'server.js'", () => {
    expect(detection.entrypoint).toBe('server.js');
  });

  it("server.js imports express directly (the entrypoint import gate)", () => {
    const content = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');
    expect(content.match(EXPRESS_IMPORT_REGEX)).not.toBeNull();
  });

  it('server.js is the ONLY candidate matching the express-import gate', () => {
    // Ambiguity would make selection order-dependent and log a
    // "Multiple entrypoints found" warning on every deploy.
    expect(detection.matching).toEqual(['server.js']);
  });

  it("the application factory is not an entrypoint candidate (no src/app.* file)", () => {
    // The factory exports { createApp } — a plain object, which the Vercel
    // runtime rejects ("The default export must be a function or server").
    // It must live outside the candidate namespace entirely.
    expect(detection.existing).not.toContain('src/app.js');
    expect(detection.existing).toEqual(detection.existing.filter((c) => !c.startsWith('src/app.')));
    // …and its current home must exist.
    expect(fs.existsSync(path.join(repoRoot, 'src/create-app.js'))).toBe(true);
  });

  it("package.json#main points at 'server.js'", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.main).toBe('server.js');
  });

  it("vercel.json keys the function config at the entry file 'server.js'", () => {
    const vercelJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
    expect(Object.keys(vercelJson.functions ?? {})).toContain('server.js');
    expect(typeof vercelJson.functions['server.js'].maxDuration).toBe('number');
  });
});

describe('server.js runtime export contract ("a function or server")', () => {
  let server;

  beforeAll(async () => {
    const h = await import('./helpers');
    ({ server } = await h.setup());
  });

  afterAll(async () => {
    const h = await import('./helpers');
    await h.closeAll();
  });

  it('exports the composed http.Server (not a factory object)', () => {
    // The Vercel runtime accepts a function or an http.Server; the server
    // shape is required for WebSocket upgrades to reach the attached hub.
    expect(server).toBeInstanceOf(http.Server);
    expect(typeof server.listen).toBe('function');
  });

  it('exposes the Express app on .app (request listener composition)', () => {
    expect(typeof server.app).toBe('function'); // Express apps are functions
    expect(typeof server.app.handle).toBe('function');
  });

  it('exposes the realtime hub on .hub (WebSocket handling preserved)', () => {
    expect(server.hub).toBeTruthy();
  });
});
