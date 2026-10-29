/**
 * ZEGOCLOUD server-side token support (the sole video-call provider).
 *
 * `generateToken04` is vendored from ZEGOCLOUD's official server assistant
 * (github.com/ZEGOCLOUD/zego_server_assistant, token/nodejs/server/zegoServerAssistant.js,
 * retrieved 2026-10-29). Upstream publishes this file expressly for copying
 * into server projects. Local changes: the upstream debug `console.log` calls
 * are REMOVED — the token plaintext (user/room data) must never reach logs —
 * and the file is adapted to this repo's lint style. Algorithm, byte layout
 * and semantics are upstream-identical so ZEGO's official verification steps
 * remain applicable.
 *
 * Token format ("04"): base64( expire[8B big-endian] | ivLen[2B BE] |
 * iv[16B] | cipherLen[2B BE] | AES-CBC( JSON{app_id, user_id, nonce, ctime,
 * expire, payload}, serverSecret ) ), prefixed with the ASCII "04" version
 * tag. The ServerSecret must be exactly 32 bytes (aes-256-cbc).
 *
 * NEVER log the secret, the token plaintext or the generated token.
 */
'use strict';

const crypto = require('crypto');

const ErrorCode = {
  success: 0,
  appIDInvalid: 1,
  userIDInvalid: 3,
  secretInvalid: 5,
  effectiveTimeInSecondsInvalid: 6,
};

/** Random integer in [a, b] (upstream semantics). */
function RndNum(a, b) {
  return Math.ceil((a + (b - a)) * Math.random());
}

/** Random 16-character IV string (upstream semantics). */
function makeRandomIv() {
  const str = '0123456789abcdefghijklmnopqrstuvwxyz';
  const result = [];
  for (let i = 0; i < 16; i++) {
    const r = Math.floor(Math.random() * str.length);
    result.push(str.charAt(r));
  }
  return result.join('');
}

/** AES-CBC key size from secret length: 16/24/32 → 128/192/256. */
function getAlgorithm(keyBase64) {
  const key = Buffer.from(keyBase64);
  switch (key.length) {
    case 16: return 'aes-128-cbc';
    case 24: return 'aes-192-cbc';
    case 32: return 'aes-256-cbc';
  }
  throw new Error('Invalid key length: ' + key.length);
}

function aesEncrypt(plainText, key, iv) {
  const cipher = crypto.createCipheriv(getAlgorithm(key), key, iv);
  cipher.setAutoPadding(true);
  const encrypted = cipher.update(plainText);
  const final = cipher.final();
  const out = Buffer.concat([encrypted, final]);
  return Uint8Array.from(out).buffer;
}

/**
 * Generate a ZEGOCLOUD token04.
 *
 * @param {number} appId   ZEGO AppID (number, from the ZEGO console).
 * @param {string} userId  User identity (Medika user id — server-derived).
 * @param {string} secret  ServerSecret (exactly 32 chars; NEVER client-side).
 * @param {number} effectiveTimeInSeconds  Token validity in seconds.
 * @param {string} payload JSON string (room_id / privilege / stream_id_list).
 * @returns {string} token04 string ("04" + base64 payload).
 */
function generateToken04(appId, userId, secret, effectiveTimeInSeconds, payload) {
  if (!appId || typeof appId !== 'number') {
    throw { errorCode: ErrorCode.appIDInvalid, errorMessage: 'appID invalid' };
  }
  if (!userId || typeof userId !== 'string') {
    throw { errorCode: ErrorCode.userIDInvalid, errorMessage: 'userId invalid' };
  }
  if (!secret || typeof secret !== 'string' || secret.length !== 32) {
    throw { errorCode: ErrorCode.secretInvalid, errorMessage: 'secret must be a 32 byte string' };
  }
  if (!effectiveTimeInSeconds || typeof effectiveTimeInSeconds !== 'number') {
    throw {
      errorCode: ErrorCode.effectiveTimeInSecondsInvalid,
      errorMessage: 'effectiveTimeInSeconds invalid',
    };
  }

  const createTime = Math.floor(new Date().getTime() / 1000);
  const tokenInfo = {
    app_id: appId,
    user_id: userId,
    nonce: RndNum(-2147483648, 2147483647),
    ctime: createTime,
    expire: createTime + effectiveTimeInSeconds,
    payload: payload || '',
  };
  const plainText = JSON.stringify(tokenInfo);
  const iv = makeRandomIv();
  const encryptBuf = aesEncrypt(plainText, secret, iv);

  const [b1, b2, b3] = [new Uint8Array(8), new Uint8Array(2), new Uint8Array(2)];
  new DataView(b1.buffer).setBigInt64(0, BigInt(tokenInfo.expire), false);
  new DataView(b2.buffer).setUint16(0, iv.length, false);
  new DataView(b3.buffer).setUint16(0, encryptBuf.byteLength, false);
  const buf = Buffer.concat([
    Buffer.from(b1),
    Buffer.from(b2),
    Buffer.from(iv),
    Buffer.from(b3),
    Buffer.from(encryptBuf),
  ]);
  const dv = new DataView(Uint8Array.from(buf).buffer);
  return '04' + Buffer.from(dv.buffer).toString('base64');
}

/**
 * Mint a short-lived ZEGOCLOUD call token for a VERIFIED consultation
 * participant. The token payload pins the user to THIS room, grants
 * loginRoom + publishStream, and restricts publishing to exactly THEIR
 * stream — room and stream identity are decided by the server (from the
 * consultation id), never trusted from client input (issue #62).
 *
 * @returns {string} token04 string.
 */
function zegoCallGrant({ appId, serverSecret, userId, roomName, streamId, ttlSeconds }) {
  const payload = JSON.stringify({
    room_id: roomName,
    // privilege "1" = loginRoom, "2" = publishStream (ZEGO token04 spec).
    privilege: { 1: 1, 2: 1 },
    stream_id_list: [streamId],
  });
  return generateToken04(appId, userId, serverSecret, ttlSeconds, payload);
}

module.exports = { ErrorCode, generateToken04, zegoCallGrant };
