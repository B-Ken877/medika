/**
 * ZEGOCLOUD call-token route integration (sole provider).
 *
 * POST /api/call/token must mint a server-side token04 grant ONLY after the
 * full authorization funnel: membership (403) → ZEGO configuration (503) →
 * EN_COURS eligibility (403). The response must expose the public engine
 * data (appId, server URL) and the SERVER-derived room/stream identity —
 * never any secret material.
 * NOTE: there is no way to test the REAL ZEGOCLOUD_APP_ID/SECRET here; these
 * are throwaway test values and never production credentials.
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';
process.env.ZEGOCLOUD_APP_ID = '123456789';
process.env.ZEGOCLOUD_SERVER_URL = 'wss://webliveroom-test.example.com/ws';
process.env.ZEGOCLOUD_SERVER_SECRET = '0123456789abcdef0123456789abcdef';

import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
});

afterAll(async () => {
  await h.closeAll();
});

function callToken(user, consId) {
  return r.post('/api/call/token')
    .set('Authorization', `Bearer ${token[user]}`)
    .send({ consultationId: consId, isVideo: true });
}

/** Test-only token04 decoder (see zego-token04.test.js). */
function decodeToken04(t, secret) {
  const raw = Buffer.from(t.slice(2), 'base64');
  const ivLen = raw.readUInt16BE(8);
  const cipherLen = raw.readUInt16BE(10 + ivLen);
  const iv = raw.subarray(10, 10 + ivLen);
  // The cipher starts AFTER the 2-byte cipherLen field.
  const cipherStart = 10 + ivLen + 2;
  const cipher = raw.subarray(cipherStart, cipherStart + cipherLen);
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(secret), iv);
  return JSON.parse(Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8'));
}

describe('POST /api/call/token (ZEGO sole provider)', () => {
  it('mints a token04 grant for an EN_COURS participant with server-derived identity', async () => {
    const cons = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    const res = await callToken('patient', cons.id);
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('zego');
    expect(res.body.token.startsWith('04')).toBe(true);
    expect(res.body.appId).toBe(123456789);
    expect(res.body.url).toBe('wss://webliveroom-test.example.com/ws');
    expect(res.body.roomName).toBe('medika_' + cons.id);
    expect(res.body.streamId).toBe(`medika_${cons.id}_${users.patient.id}`);
    expect(res.body.participantIdentity).toBe(users.patient.id);
    expect(res.body.tokenTtlSeconds).toBe(3600);
    // No secret material anywhere in the response:
    expect(JSON.stringify(res.body)).not.toContain('0123456789abcdef');
  });

  it('token payload pins the room and the exact allowed stream', async () => {
    const cons = await h.createConsultationFixture({
      patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
    });
    const res = await callToken('doctor', cons.id);
    expect(res.status).toBe(200);
    const info = decodeToken04(res.body.token, '0123456789abcdef0123456789abcdef');
    const payload = JSON.parse(info.payload);
    expect(payload.room_id).toBe('medika_' + cons.id);
    expect(payload.privilege).toEqual({ 1: 1, 2: 1 });
    expect(payload.stream_id_list).toEqual([`medika_${cons.id}_${users.doctor.id}`]);
    expect(info.user_id).toBe(users.doctor.id);
  });

  it('denies a non-member (403) before any token minting', async () => {
    // A consultation owned by patient2 only (no doctor) — doctor_t1 is NOT
    // a member of it and must get the same 403 as any other caller.
    const cons = await h.createConsultationFixture({ patientId: users.patient2.id });
    const res = await r.post('/api/call/token')
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ consultationId: cons.id, isVideo: true });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Not part of this consultation');
  });

  it('denies a RECHERCHE_MEDECIN consultation (403) — lifecycle eligibility fails closed', async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id });
    const res = await callToken('patient', cons.id);
    expect(res.status).toBe(403);
  });
});
