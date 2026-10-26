/**
 * Durable message delivery — client correlation id (migration 003):
 *  - REST POST /messages with a clientMsgId is idempotent per sender
 *  - a retry of the same (sender, clientMsgId) returns the ORIGINAL row
 *  - different senders may use the same clientMsgId without conflict
 *  - legacy sends without clientMsgId behave exactly as before (no dedup)
 *  - invalid clientMsgId shapes are ignored, not errors (hub parity)
 *  - the persisted row echoes client_msg_id for client reconciliation
 *  - WS message:send retries with the same clientMsgId do not duplicate
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};
let consId;

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
  const cons = await h.createConsultationFixture({
    patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
  });
  consId = cons.id;
});

afterAll(async () => {
  await h.closeAll();
});

describe('POST /api/consultations/:id/messages — clientMsgId idempotency', () => {
  it('persists client_msg_id and echoes it in the response', async () => {
    const res = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'premye esè', clientMsgId: 'cmp-001' });
    expect(res.status).toBe(201);
    expect(res.body.client_msg_id).toBe('cmp-001');
  });

  it('a retry with the SAME clientMsgId returns the original row (no duplicate)', async () => {
    const first = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'mesaj idanpotan', clientMsgId: 'cmp-dedup' });
    expect(first.status).toBe(201);

    // Simulate the recovery path: the WS frame was lost after persistence and
    // the client falls back to REST with the SAME correlation id.
    const retry = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'mesaj idanpotan', clientMsgId: 'cmp-dedup' });
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.created_at).toBe(first.body.created_at);

    const list = await r.get(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`);
    const matches = list.body.filter((m) => m.client_msg_id === 'cmp-dedup');
    expect(matches).toHaveLength(1);
  });

  it('different senders may reuse the same clientMsgId (per-sender scope)', async () => {
    const a = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'pasyan', clientMsgId: 'shared-id' });
    const b = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ text: 'dokte', clientMsgId: 'shared-id' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('sends WITHOUT clientMsgId are never deduplicated (legacy behavior)', async () => {
    const a = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'menm tèks' });
    const b = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'menm tèks' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
    expect(a.body.client_msg_id).toBeNull();
    expect(b.body.client_msg_id).toBeNull();
  });

  it('ignores invalid clientMsgId shapes instead of erroring (hub parity)', async () => {
    for (const bad of ['', 123, { x: 1 }, 'x'.repeat(65), null]) {
      const res = await r.post(`/api/consultations/${consId}/messages`)
        .set('Authorization', `Bearer ${token.patient}`)
        .send({ text: 'fòm inval', clientMsgId: bad });
      expect(res.status).toBe(201);
      expect(res.body.client_msg_id).toBeNull();
    }
  });

  it('requires participant membership (unchanged authorization)', async () => {
    const outsider = await h.loginToken(r, 't.patient2');
    const res = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${outsider}`)
      .send({ text: 'infosyon', clientMsgId: 'cmp-evil' });
    expect(res.status).toBe(404);
  });

  it('rejects whitespace-only text consistently (no silent empty bubbles)', async () => {
    for (const blank of ['   ', '\t\n  ']) {
      const res = await r.post(`/api/consultations/${consId}/messages`)
        .set('Authorization', `Bearer ${token.patient}`)
        .send({ text: blank, clientMsgId: 'cmp-blank' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Message text required');
    }
  });

  it('trims surrounding whitespace from stored text (consistent with the client)', async () => {
    const res = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: '  bonjou doktè  ', clientMsgId: 'cmp-trim' });
    expect(res.status).toBe(201);
    expect(res.body.text).toBe('bonjou doktè');
  });
});

describe('WS message:send — idempotent retries over the socket', () => {
  it('replaying the same frame does not duplicate the stored message', async () => {
    const { RealtimeHub } = await import('../src/realtime/hub.js');
    const events = [];
    const hub = new RealtimeHub();
    hub.publishToUser = (userId, event) => { events.push({ userId, event }); };

    const frame = {
      consultationId: consId,
      senderName: 'Test Patient',
      text: 'esè WS idanpotan',
      clientMsgId: 'ws-dedup-1',
    };
    await hub.handleMessageSend({ send: () => {} }, { id: users.patient.id, name: 'Test Patient' }, { type: 'message:send', ...frame });
    await hub.handleMessageSend({ send: () => {} }, { id: users.patient.id, name: 'Test Patient' }, { type: 'message:send', ...frame });

    const echoes = events.filter((e) => e.event.type === 'message:new');
    expect(echoes.length).toBeGreaterThanOrEqual(2); // sender echo per attempt
    const ids = new Set(echoes.map((e) => e.event.id));
    expect(ids.size).toBe(1); // all echoes reference ONE persisted row
    expect(echoes[0].event.clientMsgId).toBe('ws-dedup-1');

    const list = await r.get(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`);
    const stored = list.body.filter((m) => m.client_msg_id === 'ws-dedup-1');
    expect(stored).toHaveLength(1);
  });
});
