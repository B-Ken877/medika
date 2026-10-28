/**
 * Vendored token04 unit tests (issue #62).
 *
 * Validates src/zego.js against the documented ZEGOCLOUD token04 format:
 * "04" + base64( expire[8B BE] | ivLen[2B BE] | iv[16B] | cipherLen[2B BE] |
 * AES-CBC( JSON{app_id,user_id,nonce,ctime,expire,payload}, secret ) ).
 * The round-trip here decrypts with the SAME test secret and asserts the
 * plaintext structure — proving the token is well-formed for ZEGO servers.
 * Only THROWAWAY test secrets are used; never real credentials.
 */
'use strict';

import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
const { ErrorCode, generateToken04, zegoCallGrant } = await import('../src/zego.js');

// Exactly 32 chars — the ZEGO ServerSecret requirement (aes-256-cbc).
const TEST_SECRET = '0123456789abcdef0123456789abcdef';

/** Decode a token04 back to its plaintext tokenInfo (test-only). */
function decodeToken04(token, secret) {
  const raw = Buffer.from(token.slice(2), 'base64');
  const expire = Number(new DataView(raw.buffer, raw.byteOffset, 8).getBigInt64(0, false));
  const ivLen = raw.readUInt16BE(8);
  const iv = raw.subarray(10, 10 + ivLen);
  const cipherLen = raw.readUInt16BE(10 + ivLen);
  // Layout: ... iv[ivLen] | cipherLen[2B] | cipher[cipherLen] — the cipher
  // starts AFTER the 2-byte cipherLen field.
  const cipherStart = 10 + ivLen + 2;
  const cipher = raw.subarray(cipherStart, cipherStart + cipherLen);
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(secret), iv);
  const plain = Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8');
  return { tokenInfo: JSON.parse(plain), expire };
}

/** generateToken04 throws plain objects — assert via try/catch. */
function expectZegoError(fn, code) {
  try {
    fn();
  } catch (e) {
    expect(e.errorCode).toBe(code);
    return;
  }
  throw new Error('expected generateToken04 to throw');
}

describe('generateToken04 (vendored, issue #62)', () => {
  it('produces an "04" token that decodes to the expected plaintext structure', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = generateToken04(123456789, 'user-1', TEST_SECRET, 3600, '{"k":1}');
    const after = Math.floor(Date.now() / 1000);

    expect(token.startsWith('04')).toBe(true);
    const { tokenInfo } = decodeToken04(token, TEST_SECRET);
    expect(tokenInfo.app_id).toBe(123456789);
    expect(tokenInfo.user_id).toBe('user-1');
    expect(tokenInfo.payload).toBe('{"k":1}');
    expect(tokenInfo.ctime).toBeGreaterThanOrEqual(before);
    expect(tokenInfo.ctime).toBeLessThanOrEqual(after);
    expect(tokenInfo.expire - tokenInfo.ctime).toBe(3600);
    expect(Number.isInteger(tokenInfo.nonce)).toBe(true);
  });

  it('produces distinct tokens for identical inputs (random IV + nonce)', () => {
    const a = generateToken04(1, 'u', TEST_SECRET, 60, '');
    const b = generateToken04(1, 'u', TEST_SECRET, 60, '');
    expect(a).not.toBe(b);
  });

  it('rejects invalid inputs with the documented error codes', () => {
    expectZegoError(() => generateToken04('not-a-number', 'u', TEST_SECRET, 60, ''), ErrorCode.appIDInvalid);
    expectZegoError(() => generateToken04(1, '', TEST_SECRET, 60, ''), ErrorCode.userIDInvalid);
    expectZegoError(() => generateToken04(1, 'u', 'short', 60, ''), ErrorCode.secretInvalid);
    expectZegoError(() => generateToken04(1, 'u', TEST_SECRET, 0, ''), ErrorCode.effectiveTimeInSecondsInvalid);
  });
});

describe('zegoCallGrant (issue #62 server-side pinning)', () => {
  it('pins the room, grants login+publish, and restricts streams to the server-derived one', () => {
    const token = zegoCallGrant({
      appId: 42,
      serverSecret: TEST_SECRET,
      userId: 'doctor-7',
      roomName: 'medika_cons-1',
      streamId: 'medika_cons-1_doctor-7',
      ttlSeconds: 1800,
    });
    const { tokenInfo } = decodeToken04(token, TEST_SECRET);
    const payload = JSON.parse(tokenInfo.payload);
    expect(payload.room_id).toBe('medika_cons-1');
    expect(payload.privilege).toEqual({ 1: 1, 2: 1 });
    expect(payload.stream_id_list).toEqual(['medika_cons-1_doctor-7']);
  });
});
