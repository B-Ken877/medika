/**
 * ZEGO-only call provider configuration tests.
 */
'use strict';

import { afterEach, describe, expect, it, vi } from 'vitest';

const KEYS = [
  'ZEGOCLOUD_APP_ID',
  'ZEGOCLOUD_SERVER_URL',
  'ZEGOCLOUD_SERVER_SECRET',
  'ZEGOCLOUD_APP_SIGN',
  'NODE_ENV',
];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

async function configFor(overrides = {}) {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, overrides);
  const { config } = await import('../src/config.js');
  return config;
}

describe('ZEGO-only call configuration', () => {
  it('loads ZEGO app id and server URL from environment', async () => {
    const config = await configFor({
      ZEGOCLOUD_APP_ID: '5068360',
      ZEGOCLOUD_SERVER_URL: 'wss://example.zegocloud.com/ws',
      ZEGOCLOUD_SERVER_SECRET: 'x'.repeat(32),
    });
    expect(config.zegoCloudAppId).toBe(5068360);
    expect(config.zegoCloudServerUrl).toBe('wss://example.zegocloud.com/ws');
    expect(config.zegoCloudServerSecret).toBe('x'.repeat(32));
  });

  it('returns an empty ZEGO configuration when credentials are absent', async () => {
    const config = await configFor();
    expect(config.zegoCloudAppId).toBe(0);
    expect(config.zegoCloudServerUrl).toBe('');
    expect(config.zegoCloudServerSecret).toBe('');
  });

  it('does not expose a provider switch that could select a legacy engine', async () => {
    const config = await configFor({ NODE_ENV: 'production' });
    expect(Object.hasOwn(config, 'callProvider')).toBe(false);
    expect(Object.keys(config).some((key) => /livekit/i.test(key))).toBe(false);
  });
});
