/**
 * Participant presence:
 *  - real online/offline transitions for authenticated sockets
 *  - multi-tab (one user, several sockets) stays online until the LAST closes
 *  - events reach consultation counterparts only (no leaks to strangers)
 *  - presence:subscribe answers the counterpart's CURRENT status
 *  - identity always from the authenticated socket
 *  - local fallback semantics + Redis lease semantics (fake client, verified
 *    command surface: set/del/exists/sadd/srem/smembers)
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');
const { createLocalPresence, createRedisPresence } = await import('../src/realtime/presence.js');

let server, httpServer, port, r, users, token = {};
let consId, otherConsId;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws, timeoutMs = 5000, filter = null) {
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      let evt;
      try { evt = JSON.parse(raw.toString()); } catch { return; }
      if (filter && !filter(evt)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(evt);
    };
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('ws message timeout'));
    }, timeoutMs);
    ws.on('message', onMessage);
  });
}

async function authSocket(role) {
  const ws = await connect();
  const first = nextMessage(ws, 5000, (e) => e.type === 'auth:ok' || e.type === 'auth:error');
  ws.send(JSON.stringify({ type: 'auth', token: token[role] }));
  const evt = await first;
  if (evt.type !== 'auth:ok') throw new Error('auth failed: ' + JSON.stringify(evt));
  return ws;
}

const waitFor = (ms) => new Promise((res) => setTimeout(res, ms));

beforeAll(async () => {
  ({ server: httpServer, app: server, request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.patient2 = await h.loginToken(r, 't.patient2');
  const cons = await h.createConsultationFixture({
    patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
  });
  consId = cons.id;
  // A consultation the doctor is NOT part of (patient2 + nobody).
  otherConsId = (await h.createConsultationFixture({ patientId: users.patient2.id })).id;
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

afterAll(async () => {
  httpServer.closeAllConnections?.();
  await new Promise((resolve) => httpServer.close(resolve));
  await h.closeAll();
});

describe('WS presence events', () => {
  it('informs a connected counterpart when the partner goes online', async () => {
    const patientWs = await authSocket('patient');
    try {
      await waitFor(300); // let the initial presence burst finish
      const eventP = nextMessage(patientWs, 5000, (e) =>
        e.type === 'presence:update' && e.userId === users.doctor.id);
      const doctorWs = await authSocket('doctor');
      const evt = await eventP;
      expect(evt.online).toBe(true);
      // Register the offline listener BEFORE closing (no race).
      const offP = nextMessage(patientWs, 5000, (e) =>
        e.type === 'presence:update' && e.userId === users.doctor.id && e.online === false);
      doctorWs.close();
      const off = await offP;
      expect(off.online).toBe(false);
    } finally {
      patientWs.close();
    }
  });

  it('multi-tab: closing one of two sockets keeps the user online', async () => {
    const patientWs = await authSocket('patient');
    try {
      await waitFor(300);
      const onlineP = nextMessage(patientWs, 5000, (e) =>
        e.type === 'presence:update' && e.userId === users.doctor.id && e.online === true);
      const tab1 = await authSocket('doctor');
      await onlineP; // first tab → online broadcast
      const tab2 = await authSocket('doctor');
      await waitFor(300);

      tab1.close();
      await waitFor(500);
      // Doctor must STILL be online (tab2 alive) — no offline event may arrive.
      await expect(nextMessage(patientWs, 700, (e) =>
        e.type === 'presence:update' && e.userId === users.doctor.id)).rejects.toThrow('timeout');

      const offP = nextMessage(patientWs, 5000, (e) =>
        e.type === 'presence:update' && e.userId === users.doctor.id && e.online === false);
      tab2.close();
      const off = await offP;
      expect(off.online).toBe(false);
    } finally {
      patientWs.close();
    }
  });

  it('presence:subscribe answers the counterpart status without a reconnect', async () => {
    const patientWs = await authSocket('patient');
    const doctorWs = await authSocket('doctor');
    try {
      await waitFor(300);
      const replyP = nextMessage(patientWs, 5000, (e) =>
        e.type === 'presence:update' && e.userId === users.doctor.id);
      patientWs.send(JSON.stringify({ type: 'presence:subscribe', consultationId: consId }));
      const evt = await replyP;
      expect(evt.online).toBe(true);

      doctorWs.close();
      await waitFor(400);
      const reply2P = nextMessage(patientWs, 5000, (e) =>
        e.type === 'presence:update' && e.userId === users.doctor.id);
      patientWs.send(JSON.stringify({ type: 'presence:subscribe', consultationId: consId }));
      const evt2 = await reply2P;
      expect(evt2.online).toBe(false);
    } finally {
      patientWs.close();
      doctorWs.close();
    }
  });

  it('presence:subscribe is silently dropped for non-participants', async () => {
    const strangerWs = await authSocket('patient2'); // not part of consId
    try {
      await waitFor(300);
      strangerWs.send(JSON.stringify({ type: 'presence:subscribe', consultationId: consId }));
      await expect(nextMessage(strangerWs, 700, (e) => e.type === 'presence:update'))
        .rejects.toThrow('timeout');
    } finally {
      strangerWs.close();
    }
  });

  it('never leaks presence to users without a shared consultation', async () => {
    const strangerWs = await authSocket('patient2');
    try {
      await waitFor(200);
      const doctorWs = await authSocket('doctor');
      await waitFor(500);
      doctorWs.close();
      await waitFor(500);
      // patient2 shares NO consultation with the doctor: nothing may arrive.
      await expect(nextMessage(strangerWs, 500, (e) =>
        e.type === 'presence:update' && e.userId === users.doctor.id)).rejects.toThrow('timeout');
    } finally {
      strangerWs.close();
    }
  });

  it('ignores spoofed identity fields in the subscribe frame', async () => {
    const patientWs = await authSocket('patient');
    try {
      await waitFor(300);
      const replyP = nextMessage(patientWs, 5000, (e) => e.type === 'presence:update');
      patientWs.send(JSON.stringify({
        type: 'presence:subscribe', consultationId: consId, userId: users.doctor.id,
      }));
      const evt = await replyP;
      // The reply describes the DOCTOR's status (counterpart of the authenticated
      // patient) — not whatever userId the frame tried to ask about.
      expect(evt.userId).toBe(users.doctor.id);
      expect(typeof evt.online).toBe('boolean');
    } finally {
      patientWs.close();
    }
  });
});

describe('local presence registry', () => {
  it('tracks connections per user and clears only when the last one leaves', async () => {
    const presence = createLocalPresence();
    await presence.add('u1', 'c1');
    await presence.add('u1', 'c2');
    expect(await presence.isOnline('u1')).toBe(true);
    await presence.remove('u1', 'c1');
    expect(await presence.isOnline('u1')).toBe(true); // second tab alive
    await presence.remove('u1', 'c2');
    expect(await presence.isOnline('u1')).toBe(false);
    expect(await presence.isOnline('nobody')).toBe(false);
  });
});

describe('Redis presence leases (fake client, same command surface)', () => {
  /** Minimal in-memory Redis double: set(EX)/del/exists/sadd/srem/smembers. */
  function fakeRedis() {
    const strings = new Map(); // key -> { value, expiresAt }
    const sets = new Map();    // key -> Set
    const now = () => fakeRedis.__now;
    return {
      strings, sets,
      async set(key, value, ...args) {
        let ttl = null;
        if (args[0] === 'EX') ttl = Number(args[1]) * 1000;
        strings.set(key, { value, expiresAt: ttl ? now() + ttl : null });
      },
      async del(key) { strings.delete(key); },
      async exists(key) {
        const e = strings.get(key);
        return e && (e.expiresAt === null || e.expiresAt > now()) ? 1 : 0;
      },
      async sadd(key, member) {
        if (!sets.has(key)) sets.set(key, new Set());
        sets.get(key).add(member);
      },
      async srem(key, member) { sets.get(key)?.delete(member); },
      async smembers(key) { return [...(sets.get(key) ?? [])]; },
    };
  }
  fakeRedis.__now = Date.now();

  const { createRedisPresence: mkRedis } = { createRedisPresence };

  it('keeps a user online while ANY lease is alive; one disconnect clears only its own lease', async () => {
    const client = fakeRedis();
    const presence = mkRedis({ client });
    await presence.add('u1', 'c1');
    await presence.add('u1', 'c2');
    expect(await presence.isOnline('u1')).toBe(true);
    await presence.remove('u1', 'c1');
    expect(await presence.isOnline('u1')).toBe(true);
    await presence.remove('u1', 'c2');
    expect(await presence.isOnline('u1')).toBe(false);
  });

  it('leases EXPIRE (crashed instance) and isOnline turns false without a clean disconnect', async () => {
    const client = fakeRedis();
    fakeRedis.__now = Date.now();
    const presence = createRedisPresence({ client });
    await presence.add('u1', 'c1');
    expect(await presence.isOnline('u1')).toBe(true);
    // Simulate the lease TTL elapsing with no heartbeat renewal.
    fakeRedis.__now += 65_001;
    expect(await presence.isOnline('u1')).toBe(false);
  });

  it('refresh() renews the lease and sweeps dead registry members', async () => {
    const client = fakeRedis();
    fakeRedis.__now = Date.now();
    const presence = createRedisPresence({ client });
    await presence.add('u1', 'dead');
    fakeRedis.__now += 65_001; // 'dead' lease lapses with no renewal
    // Registry membership alone is NOT presence: the expired lease → offline.
    expect(await presence.isOnline('u1')).toBe(false);
    await presence.add('u1', 'alive');     // a fresh connection gets a fresh lease
    await presence.refresh('u1', 'alive'); // renewal + lazy sweep of 'dead'
    expect(await presence.isOnline('u1')).toBe(true);
    expect(await client.smembers('medika:presence:conns:u1')).toEqual(['alive']);
    fakeRedis.__now += 65_001;             // no further renewals → lease expiry wins
    expect(await presence.isOnline('u1')).toBe(false);
  });
});
