/**
 * Participant presence — per-connection leases, locally or in Redis.
 *
 *  LocalPresence: an in-instance registry. Authoritative only for sockets
 *  pinned to THIS function instance (single-instance deployments / dev).
 *
 *  RedisPresence: per-connection lease keys with a TTL (SETEX) plus a per-user
 *  registry SET. A lease expires when its owning instance dies without a
 *  clean disconnect, so a crashed function cannot leave a user permanently
 *  "online". Disconnecting one socket removes ONLY its own lease; another
 *  tab's lease stays alive. Registry garbage (members whose lease expired) is
 *  swept lazily on refresh, and isOnline() only trusts live leases — never
 *  registry membership alone. Redis stays OPTIONAL (no REDIS_URL → local).
 *
 * The client passed in is injectable for tests (any object implementing the
 * small command surface: set/del/exists/sadd/srem/smembers).
 */
'use strict';

const { config } = require('../config');

/** Lease TTL > 2× the hub heartbeat (30s) so a live connection never lapses. */
const LEASE_TTL_SECONDS = 65;

function createLocalPresence() {
  const connections = new Map(); // userId -> Set<connId>
  return {
    _localOnly: true,
    async add(userId, connId) {
      if (!connections.has(userId)) connections.set(userId, new Set());
      connections.get(userId).add(connId);
    },
    async remove(userId, connId) {
      connections.get(userId)?.delete(connId);
    },
    async refresh() { /* local registry is authoritative; nothing to renew */ },
    async isOnline(userId) {
      return (connections.get(userId)?.size ?? 0) > 0;
    },
    async close() {},
  };
}

function createRedisPresence({ client } = {}) {
  // Own connection when not injected (tests inject a fake). Lazy require so
  // non-Redis deployments never load ioredis.
  const redis = client || require('ioredis')(config.redisUrl, {
    maxRetriesPerRequest: 3,
    connectTimeout: 10_000,
    lazyConnect: false,
  });
  const ownsClient = !client;
  const leaseKey = (u, c) => `medika:presence:conn:${u}:${c}`;
  const setKey = (u) => `medika:presence:conns:${u}`;

  redis.on?.('error', (err) => {
    // Category only — never credentials or payload.
    console.error('[REDIS] presence error:', err.code || err.constructor?.name);
  });

  return {
    _localOnly: false,
    async add(userId, connId) {
      await redis.sadd(setKey(userId), connId);
      await redis.set(leaseKey(userId, connId), '1', 'EX', LEASE_TTL_SECONDS);
    },
    async remove(userId, connId) {
      // Remove ONLY this connection's lease — other tabs keep theirs.
      await redis.del(leaseKey(userId, connId));
      await redis.srem(setKey(userId), connId);
    },
    async refresh(userId, connId) {
      await redis.set(leaseKey(userId, connId), '1', 'EX', LEASE_TTL_SECONDS);
      // Lazy sweep of dead members (crashed instances elsewhere).
      const members = await redis.smembers(setKey(userId));
      for (const m of members) {
        if (m === connId) continue;
        if (!(await redis.exists(leaseKey(userId, m)))) {
          await redis.srem(setKey(userId), m);
        }
      }
    },
    async isOnline(userId) {
      const members = await redis.smembers(setKey(userId));
      for (const m of members) {
        if (await redis.exists(leaseKey(userId, m))) return true; // live lease only
      }
      return false;
    },
    async close() {
      if (ownsClient) await redis.quit().catch(() => {});
    },
  };
}

function createPresence() {
  return config.redisUrl ? createRedisPresence() : createLocalPresence();
}

module.exports = {
  createPresence,
  createLocalPresence,
  createRedisPresence,
  LEASE_TTL_SECONDS,
};
