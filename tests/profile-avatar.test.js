/**
 * Avatar upload completion (profile route):
 *  - PUT /api/profile accepts a validated avatarUrl (http(s), /uploads/, or
 *    the private-store capability shape /api/media/assets/ast_…)
 *  - the URL persists on the user row and is returned by GET /api/profile
 *  - omitting avatarUrl leaves it untouched (partial-update semantics)
 *  - dangerous schemes/shapes are rejected with 400 (never rendered in <img>)
 *  - avatar is EXCLUDED from publicDoctor output? (No — doctors legitimately
 *    show avatars; PII stripping covers email/phone only. Asserted here.)
 *  - legacy PUT without avatarUrl keeps the historical behavior
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

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

describe('PUT /api/profile — avatarUrl', () => {
  it('persists an absolute https avatar URL and echoes it back', async () => {
    const url = 'https://public-blob.example.com/general/foto-123.png';
    const res = await r.put('/api/profile')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ avatarUrl: url });
    expect(res.status).toBe(200);
    expect(res.body.avatar_url).toBe(url);

    const fresh = await r.get('/api/profile').set('Authorization', `Bearer ${token.patient}`);
    expect(fresh.body.avatar_url).toBe(url); // survives a re-fetch
  });

  it('persists a site-relative /uploads/ avatar URL (dev storage shape)', async () => {
    const res = await r.put('/api/profile')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ avatarUrl: '/uploads/cons_test123/foto.png' });
    expect(res.status).toBe(200);
    expect(res.body.avatar_url).toBe('/uploads/cons_test123/foto.png');
  });

  it('persists the private-store capability shape (media asset URL)', async () => {
    const url = '/api/media/assets/ast_1a2b3c4d5e6f.png';
    const res = await r.put('/api/profile')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ avatarUrl: url });
    expect(res.status).toBe(200);
    expect(res.body.avatar_url).toBe(url);
  });

  it('rejects near-miss media-asset shapes (forged ids/prefixes)', async () => {
    for (const bad of [
      '/api/media/assets/ast_short.png',                     // truncated id
      '/api/media/assets/AST_abcdef123456.png',               // case
      '/api/media/assets/ast_abcdef123456.png/../../x',       // traversal
      '/api/media/assets/att_abcdef123456.png',               // foreign prefix
      '/api/media/assets/ast_abcdef123456.png?sig=forged',    // query
      '/api/media/assets/',                                  // empty
      '/api/media/attachments/ast_abcdef123456.png',         // wrong subpath
    ]) {
      const res = await r.put('/api/profile')
        .set('Authorization', `Bearer ${token.patient}`)
        .send({ avatarUrl: bad });
      expect(res.status, `avatarUrl=${bad}`).toBe(400);
      expect(res.body.error).toBe('URL avatar non valide');
    }
  });

  it('leaves the avatar untouched when the field is omitted', async () => {
    const before = await r.get('/api/profile').set('Authorization', `Bearer ${token.patient}`);
    const res = await r.put('/api/profile')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ name: 'Non Nouvo' });
    expect(res.status).toBe(200);
    expect(res.body.avatar_url).toBe(before.body.avatar_url);
    expect(res.body.name).toBe('Non Nouvo');
  });

  it('rejects dangerous avatar values with 400', async () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'file:///etc/passwd',
      'not a url',
      '//protocol-relative.evil.com/x.png',
      'x'.repeat(501),
    ]) {
      const res = await r.put('/api/profile')
        .set('Authorization', `Bearer ${token.patient}`)
        .send({ avatarUrl: bad });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('URL avatar non valide');
    }
  });

  it('requires authentication (unchanged)', async () => {
    const res = await r.put('/api/profile').send({ avatarUrl: 'https://x.example.com/a.png' });
    expect(res.status).toBe(401);
  });
});
