/**
 * Call provider rollout gate (issue #62).
 *
 * config.callProvider is opt-in in every environment:
 *   'livekit' is the safe default; 'zego' is honored only when explicitly
 *   selected by the server environment. Unknown values fail closed to livekit.
 * The client cannot select the provider.
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

  it('honors explicit zego selection in production deployments', async () => {
    expect(await providerFor({ CALL_PROVIDER: 'zego', VERCEL_ENV: 'production' })).toBe('zego');
    expect(await providerFor({ CALL_PROVIDER: 'zego', NODE_ENV: 'production' })).toBe('zego');
  });

  it('keeps LiveKit as the production default when no provider is configured', async () => {
    expect(await providerFor({ VERCEL_ENV: 'production', NODE_ENV: 'production' })).toBe('livekit');
  });

  it('fails closed for unknown VERCEL_ENV when provider is not explicitly zego', async () => {
    expect(await providerFor({ VERCEL_ENV: 'staging?' })).toBe('livekit');
  });

  it('falls back to livekit for unknown CALL_PROVIDER values', async () => {
    expect(await providerFor({ CALL_PROVIDER: 'agora', VERCEL_ENV: 'preview' })).toBe('livekit');
    expect(await providerFor({ CALL_PROVIDER: 'ZEGO', VERCEL_ENV: 'preview' })).toBe('livekit');
  });
});
