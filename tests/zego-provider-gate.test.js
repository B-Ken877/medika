/**
 * Call provider rollout gate (issue #62).
 *
 * config.callProvider implements the fail-safe rollout boundary:
 *   'zego' is honored ONLY on preview/development deployments —
 *   any production deployment (VERCEL_ENV other than preview/development,
 *   or NODE_ENV=production off-Vercel) keeps LiveKit, even when
 *   CALL_PROVIDER=zego and the ZEGOCLOUD_* vars are present.
 * Unknown CALL_PROVIDER values fail closed to 'livekit'.
 */
'use strict';

import { afterEach, describe, expect, it, vi } from 'vitest';

const KEYS = ['CALL_PROVIDER', 'VERCEL_ENV', 'NODE_ENV'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

async function providerFor(overrides) {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, overrides);
  const { config } = await import('../src/config.js');
  return config.callProvider;
}

describe('callProvider rollout gate', () => {
  it('defaults to livekit when CALL_PROVIDER is unset', async () => {
    expect(await providerFor({ NODE_ENV: 'test' })).toBe('livekit');
  });

  it('honors zego on Vercel preview deployments', async () => {
    expect(await providerFor({ CALL_PROVIDER: 'zego', VERCEL_ENV: 'preview' })).toBe('zego');
  });

  it('honors zego on Vercel development deployments', async () => {
    expect(await providerFor({ CALL_PROVIDER: 'zego', VERCEL_ENV: 'development' })).toBe('zego');
  });

  it('honors zego in local development (no VERCEL_ENV, NODE_ENV=development)', async () => {
    expect(await providerFor({ CALL_PROVIDER: 'zego', NODE_ENV: 'development' })).toBe('zego');
  });

  it('NEVER honors zego in production (fail-safe rollout boundary)', async () => {
    expect(await providerFor({ CALL_PROVIDER: 'zego', VERCEL_ENV: 'production' })).toBe('livekit');
    // Unknown VERCEL_ENV values fail closed to production semantics:
    expect(await providerFor({ CALL_PROVIDER: 'zego', VERCEL_ENV: 'staging?' })).toBe('livekit');
    // Off-Vercel production build:
    expect(await providerFor({ CALL_PROVIDER: 'zego', NODE_ENV: 'production' })).toBe('livekit');
  });

  it('falls back to livekit for unknown CALL_PROVIDER values', async () => {
    expect(await providerFor({ CALL_PROVIDER: 'agora', VERCEL_ENV: 'preview' })).toBe('livekit');
    expect(await providerFor({ CALL_PROVIDER: 'ZEGO', VERCEL_ENV: 'preview' })).toBe('livekit');
  });
});
