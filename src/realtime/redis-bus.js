/**
 * Event bus abstraction for WS fan-out.
 *
 *  - LocalBus: no cross-instance delivery (single function instance / dev).
 *  - RedisBus: publish/subscribe via Redis (e.g. Upstash from the Vercel
 *    Marketplace) so sockets pinned to different function instances receive
 *    each other's events — the pattern recommended by Vercel's WebSockets
 *    guide ("keep pub/sub coordination in an external data store").
 */
'use strict';

const { config } = require('../config');

const CHANNEL_PREFIX = 'medika:user:';

function createLocalBus() {
  return {
    publish() { /* single-instance: local delivery already happened */ },
    onMessage() { /* nothing to receive */ },
    async close() {},
  };
}

function createRedisBus() {
  if (!config.redisUrl) return createLocalBus();
  // Lazy require so non-Redis deployments never load the client.
  const Redis = require('ioredis');
  const publisher = new Redis(config.redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    connectTimeout: 10_000,
  });
  const subscriber = new Redis(config.redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: null, // subscriber must keep retrying
    connectTimeout: 10_000,
  });
  let handler = () => {};
  subscriber.psubscribe(`${CHANNEL_PREFIX}*`).catch((err) => {
    console.error('[REDIS] subscribe failed:', err.code || err.constructor?.name);
  });
  subscriber.on('pmessage', (_pattern, channel, raw) => {
    try {
      const userId = channel.substring(CHANNEL_PREFIX.length);
      const event = JSON.parse(raw);
      handler({ userId, event, originInstance: event.__instance });
    } catch {
      /* malformed messages are dropped */
    }
  });
  publisher.on('error', (err) => {
    console.error('[REDIS] publisher error:', err.code || err.constructor?.name);
  });
  subscriber.on('error', (err) => {
    console.error('[REDIS] subscriber error:', err.code || err.constructor?.name);
  });
  return {
    publish(userId, event, instanceId) {
      const payload = { ...event, __instance: instanceId };
      publisher.publish(`${CHANNEL_PREFIX}${userId}`, JSON.stringify(payload)).catch(() => {});
    },
    onMessage(fn) {
      handler = fn;
    },
    async close() {
      await Promise.allSettled([publisher.quit(), subscriber.quit()]);
    },
  };
}

module.exports = { createLocalBus, createRedisBus };
