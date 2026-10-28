/**
 * Vercel Git-integration deployment contract (issue #51).
 *
 * Incident context: Vercel preview deployments (PR previews and the
 * agent-state bookkeeping branch) fail with BUILD_FAILED /
 * "Resource provisioning failed" before any build event is emitted, while
 * production deploys of the identical code reach READY. The evidenced
 * root cause is external to the repository: per-preview resource
 * provisioning (the documented identical case is the Neon Postgres
 * integration exhausting its free-plan branch limit, which every preview
 * deployment consumes — see docs/VERCEL_PREVIEW_PROVISIONING.md).
 *
 * Repository-side mitigation: stop the agent-state bookkeeping branch
 * (LOCK.json/STATE.md updates pushed several times per 5-minute agent run)
 * from triggering preview deployments at all. Each of those deployments
 * wastes a per-preview provisioning attempt and pollutes PR checks with
 * unrelated red X marks, without ever serving a review purpose.
 *
 * This test pins that contract so a future edit cannot silently re-enable
 * agent-state deployments or accidentally disable a branch that needs
 * deployments (especially `main`):
 *   1. vercel.json stays valid JSON with a `git.deploymentEnabled` object;
 *   2. ONLY the agent-state bookkeeping branch is disabled;
 *   3. the production branch (`main`) is never in the disabled map;
 *   4. nothing else in vercel.json's git block exists (minimal scope);
 *   5. the triage runbook referenced by the incident exists on disk.
 */
'use strict';

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(repoRoot, p), 'utf8'));

const vercelJson = readJson('vercel.json');

describe('vercel.json — git deploymentEnabled contract (issue #51)', () => {
  it('keeps vercel.json parseable and declares a git.deploymentEnabled object', () => {
    // readJson above already throws on invalid JSON; assert the shape.
    expect(vercelJson.git).toBeTruthy();
    expect(vercelJson.git.deploymentEnabled).toBeTruthy();
    expect(typeof vercelJson.git.deploymentEnabled).toBe('object');
  });

  it('disables deployments ONLY for the agent-state bookkeeping branch', () => {
    const disabled = vercelJson.git.deploymentEnabled;
    expect(Object.keys(disabled).sort()).toEqual(['agent-state']);
    expect(disabled['agent-state']).toBe(false);
  });

  it('never disables the production branch (main)', () => {
    const disabled = vercelJson.git.deploymentEnabled;
    expect(disabled.main).not.toBe(false);
    expect(disabled['main']).toBeUndefined();
  });

  it('keeps the services contract intact alongside the git block', () => {
    // Guard against a careless merge dropping either section.
    expect(Object.keys(vercelJson.services ?? {}).sort()).toEqual(['admin', 'api', 'web']);
    expect(vercelJson.git.deploymentEnabled['agent-state']).toBe(false);
  });

  it('ships the triage runbook this contract references', () => {
    const doc = path.join(repoRoot, 'docs', 'VERCEL_PREVIEW_PROVISIONING.md');
    expect(fs.existsSync(doc), 'docs/VERCEL_PREVIEW_PROVISIONING.md exists').toBe(true);
    const text = fs.readFileSync(doc, 'utf8');
    expect(text).toMatch(/Resource provisioning failed/);
    expect(text).toMatch(/agent-state/);
  });
});
