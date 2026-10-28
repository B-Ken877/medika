/**
 * WebSocket protocol tests (real ws clients against a real listening server):
 *  - JWT auth frame accepted; legacy {userId} frame REJECTED (audit C2)
 *  - message:send persists and is delivered to both parties
 *  - unauthorized consultation messaging is rejected
 *  - typing + call signaling relay to the other participant
 *  - catch-up replays recent messages on (re)connect
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let server, httpServer, port, users, token = {};
let patientWs, doctorWs; // file scope so afterAll can close them
let r;

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
      try { evt = JSON.parse(raw.toString()); } catch (e) { reject(e); return; }
      if (filter && !filter(evt)) return; // skip non-matching frames
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

async function authSocket(role) {
  const ws = await connect();
  const first = nextMessage(ws);
  ws.send(JSON.stringify({ type: 'auth', token: token[role] }));
  const evt = await first;
  if (evt.type !== 'auth:ok') throw new Error('auth failed: ' + JSON.stringify(evt));
  return ws;
}

function drain(ws) {
  const msgs = [];
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), 400);
    ws.on('message', (raw) => msgs.push(JSON.parse(raw.toString())));
    ws.on('close', () => { clearTimeout(timer); resolve(); });
  }).then(() => msgs);
}

beforeAll(async () => {
  ({ server: httpServer, app: server, request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.patient2 = await h.loginToken(r, 't.patient2');
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

afterAll(async () => {
  try { patientWs?.close(); } catch { /* already closed */ }
  try { doctorWs?.close(); } catch { /* already closed */ }
  // Force-destroy any lingering sockets so server.close() resolves.
  httpServer.closeAllConnections?.();
  await new Promise((resolve) => httpServer.close(resolve));
  await h.closeAll();
});

describe('WS authentication', () => {
  it('accepts {type:"auth", token:<JWT>} and answers auth:ok', async () => {
    const ws = await connect();
    const first = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'auth', token: token.patient }));
    const evt = await first;
    expect(evt.type).toBe('auth:ok');
    expect(evt.userId).toBe(users.patient.id);
    ws.close();
  });

  it('REJECTS the legacy {type:"auth", userId} frame (audit C2)', async () => {
    const ws = await connect();
    const first = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'auth', userId: users.doctor.id })); // impersonation attempt
    const evt = await first;
    expect(evt.type).toBe('auth:error');
    // Socket must be closed by the server
    const closed = new Promise((resolve) => ws.on('close', resolve));
    await Promise.race([closed, waitFor(2000)]);
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });

  it('rejects an invalid JWT', async () => {
    const ws = await connect();
    const first = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'auth', token: 'not.a.jwt' }));
    const evt = await first;
    expect(evt.type).toBe('auth:error');
    ws.close();
  });
});

describe('WS messaging', () => {
  let consId;

  beforeAll(async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS' });
    consId = cons.id;
    patientWs = await authSocket('patient');
    doctorWs = await authSocket('doctor');
    await drain(patientWs);
    await drain(doctorWs);
  });

  afterAll(() => {
    patientWs?.close();
    doctorWs?.close();
  });

  it('message:send persists and both parties receive message:new', async () => {
    const patientRecv = nextMessage(patientWs);
    const doctorRecv = nextMessage(doctorWs);
    patientWs.send(JSON.stringify({
      type: 'message:send', consultationId: consId,
      senderId: users.patient.id, senderName: 'Pat Test',
      text: 'Bonjour docteur via WS', messageType: 'text',
    }));
    const p1 = await patientRecv; // echo to sender
    const d1 = await doctorRecv;  // delivery to recipient
    for (const evt of [p1, d1]) {
      expect(evt.type).toBe('message:new');
      expect(evt.consultationId).toBe(consId);
      expect(evt.senderId).toBe(users.patient.id);
      expect(evt.text).toBe('Bonjour docteur via WS');
      expect(typeof evt.id).toBe('number');
      expect(typeof evt.timestamp).toBe('number'); // ms (legacy envelope)
    }
    // Persisted server-side
    const msgs = await r.get(`/api/consultations/${consId}/messages`).set('Authorization', `Bearer ${token.doctor}`);
    expect(msgs.body.some((m) => m.text === 'Bonjour docteur via WS')).toBe(true);
  });

  it('rejects messages for a consultation the user does not belong to', async () => {
    const other = await h.createConsultationFixture({ patientId: users.patient2.id });
    const recv = nextMessage(patientWs);
    patientWs.send(JSON.stringify({
      type: 'message:send', consultationId: other.id,
      senderId: users.patient.id, senderName: 'Pat Test', text: 'intrusion', messageType: 'text',
    }));
    const evt = await recv;
    expect(evt.type).toBe('error');
    const msgs = await r.get(`/api/consultations/${other.id}/messages`).set('Authorization', `Bearer ${token.patient2}`);
    expect(msgs.status).toBe(200);
    expect(msgs.body.some((m) => m.text === 'intrusion')).toBe(false);
  });

  it('relays typing indicators to the other participant only', async () => {
    const doctorRecv = nextMessage(doctorWs);
    patientWs.send(JSON.stringify({ type: 'typing', consultationId: consId, isTyping: true }));
    const evt = await doctorRecv;
    expect(evt.type).toBe('typing');
    expect(evt.consultationId).toBe(consId);
    expect(evt.senderId).toBe(users.patient.id);
    expect(evt.isTyping).toBe(true);
  });

  it('relays call signaling (call:start → call:incoming)', async () => {
    const doctorRecv = nextMessage(doctorWs);
    patientWs.send(JSON.stringify({
      type: 'call:start', consultationId: consId, callType: 'video',
      roomName: 'medika_' + consId, callerName: 'Pat Test',
    }));
    const evt = await doctorRecv;
    expect(evt.type).toBe('call:incoming');
    expect(evt.callType).toBe('video');
    expect(evt.from).toBe(users.patient.id);
    expect(evt.consultationId).toBe(consId);
  });

  it('catch-up replays recent messages on reconnect', async () => {
    patientWs.close();
    await waitFor(200);
    const ws = await authSocket('patient');
    const events = [];
    const done = new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      ws.on('message', (raw) => {
        const evt = JSON.parse(raw.toString());
        if (evt.type === 'message:new') events.push(evt);
        if (events.length >= 1) { clearTimeout(timer); resolve(); }
      });
    });
    await done;
    expect(events.some((e) => e.text === 'Bonjour docteur via WS')).toBe(true);
    ws.close();
  });
});

describe('WS messaging — messaging upgrade contracts', () => {
  let consId, closedConsId;

  beforeAll(async () => {
    const cons = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    consId = cons.id;
    const repo = (await import('../src/repos/consultations.js')).default;
    const closed = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    closedConsId = (await repo.prescribe(closed.id, users.doctor.id, 'òrdònans')).id;
    patientWs = await authSocket('patient');
    doctorWs = await authSocket('doctor');
    await drain(patientWs);
    await drain(doctorWs);
  });

  afterAll(() => {
    patientWs?.close();
    doctorWs?.close();
  });

  it('echoes an additive clientMsgId for optimistic-UI reconciliation', async () => {
    const echoP = nextMessage(patientWs, 5000, (e) => e.type === 'message:new' && e.clientMsgId === 'web-abc-1');
    const doctorP = nextMessage(doctorWs, 5000, (e) => e.type === 'message:new' && e.clientMsgId === 'web-abc-1');
    patientWs.send(JSON.stringify({
      type: 'message:send', consultationId: consId,
      senderId: users.patient.id, senderName: 'Pat Test',
      text: 'ak id kliyan', messageType: 'text', clientMsgId: 'web-abc-1',
    }));
    const [echo, delivered] = await Promise.all([echoP, doctorP]);
    expect(echo.clientMsgId).toBe('web-abc-1');
    expect(delivered.clientMsgId).toBe('web-abc-1');
  });

  it('omits clientMsgId when the client sent none (legacy shape untouched)', async () => {
    const echoP = nextMessage(patientWs, 5000, (e) => e.type === 'message:new' && e.text === 'san id kliyan');
    patientWs.send(JSON.stringify({
      type: 'message:send', consultationId: consId,
      senderId: users.patient.id, senderName: 'Pat Test',
      text: 'san id kliyan', messageType: 'text',
    }));
    const echo = await echoP;
    expect(echo.clientMsgId).toBeUndefined();
    expect(Object.keys(echo).sort()).toEqual([
      'consultationId', 'duration', 'fileSize', 'fileUrl', 'id', 'messageType',
      'senderId', 'senderName', 'text', 'timestamp', 'type',
    ]);
  });

  it('uses the PERSISTED created_at (not the delivery clock) as event timestamp', async () => {
    const echoP = nextMessage(patientWs, 5000, (e) => e.type === 'message:new' && e.text === 'tan pèsepte');
    patientWs.send(JSON.stringify({
      type: 'message:send', consultationId: consId,
      senderId: users.patient.id, senderName: 'Pat Test',
      text: 'tan pèsepte', messageType: 'text',
    }));
    const echo = await echoP;

    const list = await r.get(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`);
    const rest = list.body.find((m) => m.id === echo.id);
    // REST gives epoch seconds; the WS envelope is the same instant in ms.
    expect(rest.created_at).toBeGreaterThan(0);
    expect(echo.timestamp).toBe(rest.created_at * 1000);
  });

  it('does NOT relay typing for a closed consultation (lifecycle gate)', async () => {
    patientWs.send(JSON.stringify({
      type: 'typing', consultationId: closedConsId, isTyping: true,
    }));
    await expect(nextMessage(doctorWs, 700, (e) =>
      e.type === 'typing' && e.consultationId === closedConsId)).rejects.toThrow('timeout');
  });

  it('still relays typing for an active consultation (no regression)', async () => {
    const doctorRecv = nextMessage(doctorWs, 5000, (e) =>
      e.type === 'typing' && e.consultationId === consId);
    patientWs.send(JSON.stringify({ type: 'typing', consultationId: consId, isTyping: true }));
    const evt = await doctorRecv;
    expect(evt.senderId).toBe(users.patient.id);
    expect(evt.isTyping).toBe(true);
  });

  it('derives the typing sender from the authenticated socket (spoofed ids ignored)', async () => {
    const doctorRecv = nextMessage(doctorWs, 5000, (e) =>
      e.type === 'typing' && e.consultationId === consId && e.isTyping === false);
    patientWs.send(JSON.stringify({
      type: 'typing', consultationId: consId, isTyping: false, senderId: users.doctor.id,
    }));
    const evt = await doctorRecv;
    expect(evt.senderId).toBe(users.patient.id); // authenticated identity, not the frame
  });

  it('keeps emoji (incl. ZWJ families and skin tones) intact end-to-end', async () => {
    const emojiText = 'Santé 👨‍👩‍👧‍👦 👍🏽 🇭🇹 ❤️ 🩺 bonjou 😀';
    const echoP = nextMessage(patientWs, 5000, (e) => e.type === 'message:new' && e.text === emojiText);
    patientWs.send(JSON.stringify({
      type: 'message:send', consultationId: consId,
      senderId: users.patient.id, senderName: 'Pat Test',
      text: emojiText, messageType: 'text',
    }));
    const echo = await echoP;
    expect(echo.text).toBe(emojiText); // WS delivery intact
    // Persistence + REST bootstrap intact (PostgreSQL UTF-8, no stripping).
    const list = await r.get(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`);
    const stored = list.body.find((m) => m.id === echo.id);
    expect(stored.text).toBe(emojiText);
  });
});

describe('WS recording activity relay (issue #26)', () => {
  let consId, closedConsId, outsiderWs;

  beforeAll(async () => {
    const cons = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    consId = cons.id;
    const repo = (await import('../src/repos/consultations.js')).default;
    const closed = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    closedConsId = (await repo.prescribe(closed.id, users.doctor.id, 'òrdònans')).id;
    patientWs = await authSocket('patient');
    doctorWs = await authSocket('doctor');
    outsiderWs = await authSocket('patient2');
    await drain(patientWs);
    await drain(doctorWs);
    await drain(outsiderWs);
  });

  afterAll(() => {
    patientWs?.close();
    doctorWs?.close();
    outsiderWs?.close();
  });

  it('relays recording activity to the other participant with a MINIMAL payload', async () => {
    const doctorRecv = nextMessage(doctorWs, 5000, (e) => e.type === 'recording' && e.consultationId === consId);
    patientWs.send(JSON.stringify({ type: 'recording', consultationId: consId, isRecording: true }));
    const evt = await doctorRecv;
    expect(evt.isRecording).toBe(true);
    expect(evt.senderId).toBe(users.patient.id);
    // Exactly the four contract keys — no audio/waveform/duration/filename.
    expect(Object.keys(evt).sort()).toEqual(['consultationId', 'isRecording', 'senderId', 'type']);
  });

  it('relays the stop signal (isRecording:false)', async () => {
    const doctorRecv = nextMessage(doctorWs, 5000, (e) => e.type === 'recording' && e.consultationId === consId && e.isRecording === false);
    patientWs.send(JSON.stringify({ type: 'recording', consultationId: consId, isRecording: false }));
    const evt = await doctorRecv;
    expect(evt.senderId).toBe(users.patient.id);
  });

  it('does NOT relay recording activity for a closed consultation (lifecycle gate)', async () => {
    patientWs.send(JSON.stringify({ type: 'recording', consultationId: closedConsId, isRecording: true }));
    await expect(nextMessage(doctorWs, 700, (e) =>
      e.type === 'recording' && e.consultationId === closedConsId)).rejects.toThrow('timeout');
  });

  it('does NOT relay for a consultation the sender does not belong to', async () => {
    const other = await h.createConsultationFixture({ patientId: users.patient2.id });
    patientWs.send(JSON.stringify({ type: 'recording', consultationId: other.id, isRecording: true }));
    await expect(nextMessage(outsiderWs, 700, (e) =>
      e.type === 'recording' && e.consultationId === other.id)).rejects.toThrow('timeout');
  });

  it('derives the recording sender from the authenticated socket (spoofed ids ignored)', async () => {
    const doctorRecv = nextMessage(doctorWs, 5000, (e) =>
      e.type === 'recording' && e.consultationId === consId);
    patientWs.send(JSON.stringify({
      type: 'recording', consultationId: consId, isRecording: true, senderId: users.doctor.id,
    }));
    const evt = await doctorRecv;
    expect(evt.senderId).toBe(users.patient.id); // authenticated identity, not the frame
  });

  it('never persists recording activity as a message', async () => {
    const before = await r.get(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`);
    patientWs.send(JSON.stringify({ type: 'recording', consultationId: consId, isRecording: true }));
    patientWs.send(JSON.stringify({ type: 'recording', consultationId: consId, isRecording: false }));
    await waitFor(300);
    const after = await r.get(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`);
    expect(after.body.length).toBe(before.body.length);
  });

  it('typing indicators still work independently alongside recording', async () => {
    const doctorRecv = nextMessage(doctorWs, 5000, (e) => e.type === 'typing' && e.consultationId === consId);
    patientWs.send(JSON.stringify({ type: 'typing', consultationId: consId, isTyping: true }));
    const evt = await doctorRecv;
    expect(evt.isTyping).toBe(true);
  });
});
