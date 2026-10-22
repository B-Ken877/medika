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

function nextMessage(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws message timeout')), timeoutMs);
    ws.on('message', (raw) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(raw.toString())); } catch (e) { reject(e); }
    });
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
