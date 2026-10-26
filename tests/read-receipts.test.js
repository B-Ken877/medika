/**
 * Read receipts (POST /api/consultations/:id/read + messages:read relay):
 *  - marks only the OTHER participant's unread, non-system messages
 *  - reader identity always comes from the JWT (payload ids are ignored)
 *  - idempotent (repeat requests are no-ops)
 *  - unauthorized users get 404 (legacy existence-hiding convention)
 *  - persisted read_at is returned by the messages REST route (refresh survival)
 *  - one compact messages:read WS event reaches the original sender
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let server, httpServer, port, r, users, token = {};
let consId;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
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
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

afterAll(async () => {
  httpServer.closeAllConnections?.();
  await new Promise((resolve) => httpServer.close(resolve));
  await h.closeAll();
});

async function sendRestMessage(senderToken, text, extra = {}) {
  const res = await r.post(`/api/consultations/${consId}/messages`)
    .set('Authorization', `Bearer ${senderToken}`)
    .send({ text, ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

describe('POST /api/consultations/:id/read', () => {
  let doctorMsg1, doctorMsg2, patientMsg, systemMsg;

  it('marks the counterpart participant as read (fixture setup + patient read)', async () => {
    doctorMsg1 = await sendRestMessage(token.doctor, 'Bonjou pasyan mwen');
    doctorMsg2 = await sendRestMessage(token.doctor, 'Kouman ou santi ou?');
    patientMsg = await sendRestMessage(token.patient, 'Mwen byen merci');
    const repo = (await import('../src/repos/consultations.js')).default;
    systemMsg = await repo.createMessage({
      consultation_id: consId, sender_id: 'system', sender_name: 'Systeme',
      text: 'mesaj sistèm', message_type: 'text',
    });

    const res = await r.post(`/api/consultations/${consId}/read`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body.consultationId).toBe(consId);
    expect(res.body.readerId).toBe(users.patient.id);
    expect(res.body.readAt).toBeGreaterThan(0);
    const ids = res.body.messageIds;
    expect(ids).toContain(doctorMsg1.id);
    expect(ids).toContain(doctorMsg2.id);
    expect(ids).not.toContain(patientMsg.id);      // own message never marked
    expect(ids).not.toContain(Number(systemMsg.id)); // system never marked
    expect(res.body.messageIds.every((id) => typeof id === 'number')).toBe(true);
  });

  it('persists read_at through the messages REST route (refresh reconstruction)', async () => {
    const res = await r.get(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    const byId = new Map(res.body.map((m) => [m.id, m]));
    expect(byId.get(doctorMsg1.id).read_at).toBeGreaterThan(0);
    expect(byId.get(doctorMsg2.id).read_at).toBeGreaterThan(0);
    expect(byId.get(patientMsg.id).read_at).toBeNull();   // reader's own message
    expect(byId.get(Number(systemMsg.id)).read_at).toBeNull(); // system message
  });

  it('is idempotent — a repeat request marks nothing new', async () => {
    await sendRestMessage(token.doctor, 'dezyèm wonn');
    const first = await r.post(`/api/consultations/${consId}/read`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(first.body.messageIds.length).toBe(1);
    const second = await r.post(`/api/consultations/${consId}/read`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(second.status).toBe(200);
    expect(second.body.messageIds).toEqual([]);
    expect(second.body.readAt).toBeNull();
  });

  it('rejects non-participants with 404 (existence hiding)', async () => {
    const res = await r.post(`/api/consultations/${consId}/read`)
      .set('Authorization', `Bearer ${token.patient2}`);
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await r.post(`/api/consultations/${consId}/read`);
    expect(res.status).toBe(401);
  });

  it('ignores a spoofed reader id in the body (identity from the JWT only)', async () => {
    await sendRestMessage(token.doctor, 'mesaj pou tcheke spoof');
    const res = await r.post(`/api/consultations/${consId}/read`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ readerId: users.doctor.id, senderId: users.doctor.id });
    expect(res.status).toBe(200);
    expect(res.body.readerId).toBe(users.patient.id); // authenticated identity wins
    // The doctor's own copy stays unread — the patient cannot read FOR the doctor.
    const msgs = await r.get(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.doctor}`);
    const spoofed = msgs.body.find((m) => m.text === 'mesaj pou tcheke spoof');
    expect(spoofed.read_at).toBeGreaterThan(0); // doctor→patient message, read by patient
    const mine = msgs.body.find((m) => m.text === 'Mwen byen merci');
    expect(mine.read_at).toBeNull(); // patient's own message still unread
  });
});

describe('messages:read realtime event', () => {
  it('delivers ONE compact event to the original sender with ids + read time', async () => {
    const doctorWs = await authSocket('doctor');
    try {
      // drain catch-up + initial presence
      await waitFor(300);

      const m1 = await sendRestMessage(token.doctor, 'evènman an 1');
      const m2 = await sendRestMessage(token.doctor, 'evènman an 2');
      await waitFor(200); // let the message:new echoes flush

      const eventP = nextMessage(doctorWs, 5000, (e) => e.type === 'messages:read');
      const res = await r.post(`/api/consultations/${consId}/read`)
        .set('Authorization', `Bearer ${token.patient}`);
      expect(res.status).toBe(200);
      expect(res.body.messageIds).toEqual(expect.arrayContaining([m1.id, m2.id]));

      const evt = await eventP;
      expect(evt.consultationId).toBe(consId);
      expect(evt.readerId).toBe(users.patient.id);
      expect(evt.messageIds).toEqual(expect.arrayContaining([m1.id, m2.id]));
      expect(typeof evt.readAt).toBe('number');
      // Same persisted instant on REST and WS transports (epoch seconds).
      expect(evt.readAt).toBe(res.body.readAt);
    } finally {
      doctorWs.close();
    }
  });

  it('sends no event when there was nothing to mark', async () => {
    const doctorWs = await authSocket('doctor');
    try {
      await waitFor(300);
      // Everything is already read; an extra request must stay silent.
      const res = await r.post(`/api/consultations/${consId}/read`)
        .set('Authorization', `Bearer ${token.patient}`);
      expect(res.body.messageIds).toEqual([]);
      await expect(nextMessage(doctorWs, 900, (e) => e.type === 'messages:read'))
        .rejects.toThrow('timeout');
    } finally {
      doctorWs.close();
    }
  });
});

describe('read receipts on closed consultations', () => {
  it('still allows viewing-history read marking on a TERMINE consultation', async () => {
    // Reading a closed conversation is legitimate history browsing: receipts
    // are about messages, not about chat permission.
    const cons = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    const repo = (await import('../src/repos/consultations.js')).default;
    await repo.prescribe(cons.id, users.doctor.id, 'òrdònans tès');
    await repo.createMessage({
      consultation_id: cons.id, sender_id: users.doctor.id,
      sender_name: 'Dr Test', text: 'dènye mesaj', message_type: 'text',
    });
    const res = await r.post(`/api/consultations/${cons.id}/read`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body.messageIds.length).toBe(1);
  });
});
