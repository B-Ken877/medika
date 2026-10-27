/**
 * Shared media assets — LOCAL-DEV storage mode (no BLOB token):
 *  - upload → /api/media/assets/ast_… capability URL → route re-serves the bytes
 *  - unknown id / hostile shapes (traversal, foreign prefixes, wrong charset,
 *    uppercase, truncated ids) → uniform 404
 *  - server-derived Content-Type + nosniff + private caching
 *  - capability URL persists as the avatar through PUT /api/profile
 *
 * Blob-storage mode is covered by tests/media-assets-blob.test.js.
 */
'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.REQUIRE_PAYMENT = 'false';
process.env.LOCAL_UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'medika-media-'));

const h = await import('./helpers');

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000a49444154789c6300010000050001' + '0d0a2db4'.repeat(4), 'hex');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
});

afterAll(async () => {
  await h.closeAll();
});

describe('media assets — local-dev storage (capability URLs)', () => {
  let uploaded;

  it('uploads an avatar and answers with the capability URL shape', async () => {
    const res = await r.post('/api/upload')
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', PNG_BYTES, { filename: 'avatar.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/api\/media\/assets\/ast_[a-f0-9]{12}\.png$/);
    uploaded = res.body;
  });

  it('re-serves the exact bytes with a server-derived Content-Type', async () => {
    const res = await r.get(uploaded.url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toMatch(/^private,/);
    expect(Buffer.compare(res.body, PNG_BYTES)).toBe(0);
  });

  it('serves the same asset again (idempotent, no auth required)', async () => {
    const res = await r.get(uploaded.url);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, PNG_BYTES)).toBe(0);
  });

  it('answers a uniform 404 for an unknown (well-formed) id', async () => {
    const res = await r.get('/api/media/assets/ast_000000000000.png');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });

  it('answers a uniform 404 for hostile or malformed shapes', async () => {
    for (const bad of [
      '/api/media/assets/../../../etc/passwd',
      '/api/media/assets/..%2f..%2fetc%2fpasswd',
      '/api/media/assets/consultations%2fcons_x%2fatt_y',
      '/api/media/assets/AST_abcdef123456.png',          // uppercase id
      '/api/media/assets/ast_abcdef12345.PNG',           // uppercase ext
      '/api/media/assets/ast_abcdef123456.svg',          // non-servable ext
      '/api/media/assets/ast_abcdef123456.png/extra',    // extra segment
      '/api/media/assets/ast_short.png',                 // id too short
      '/api/media/assets/att_abcdef123456.png',          // foreign prefix
      '/api/media/assets/.png',
      '/api/media/assets/ast_abcdef123456.png.exe',      // double ext
    ]) {
      const res = await r.get(bad);
      expect(res.status, `GET ${bad}`).toBe(404);
    }
  });

  it('persists the capability URL as the avatar (profile integration)', async () => {
    const res = await r.put('/api/profile')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ avatarUrl: uploaded.url });
    expect(res.status).toBe(200);
    expect(res.body.avatar_url).toBe(uploaded.url);

    const fresh = await r.get('/api/profile').set('Authorization', `Bearer ${token.patient}`);
    expect(fresh.body.avatar_url).toBe(uploaded.url);
  });
});
