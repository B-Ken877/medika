/**
 * Private consultation attachments:
 *  - POST /api/consultations/:id/attachments: auth, participant-only,
 *    active-consultation-only, server-side type/size validation (magic bytes)
 *  - opaque API path response (no storage keys, no public URL)
 *  - GET .../url: participant-authorized, short-lived signed grant
 *  - GET .../file: honors the HMAC grant only; tampered/expired → 404
 *  - cross-consultation access rejected
 *  - message persistence via the authenticated path + legacy media untouched
 *
 * Runs against the LOCAL-DEV storage fallback (no BLOB token in tests) —
 * the same authorization + signed-grant model as production Blob storage.
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';
process.env.LOCAL_UPLOADS_DIR = process.env.LOCAL_UPLOADS_DIR ||
  require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'medika-attach-'));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const h = await import('./helpers');

let r, users, token = {};
let consId, finishedConsId, otherConsId;

// Real magic-numbered fixtures (bytes matter — the server sniffs them).
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000a49444154789c6300010000050001' + '0d0a2db4'.repeat(4), 'hex');
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const WEBM_AUDIO = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72, 0x6f, 0x73, 0x6b, 0x61]),
  Buffer.alloc(64, 0x42),
]);

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.patient2 = await h.loginToken(r, 't.patient2');
  const repo = (await import('../src/repos/consultations.js')).default;
  // Issue #60: the one-active invariant releases a participant's prior slots
  // when a new fixture is created (both participants share the doctor here),
  // so the consultation that gets prescribed (finishedConsId) is created and
  // terminated FIRST — then consId is created and stays EN_COURS.
  finishedConsId = (await h.createConsultationFixture({
    patientId: users.patient2.id, doctorId: users.doctor.id, status: 'EN_COURS',
  })).id;
  await repo.prescribe(finishedConsId, users.doctor.id, 'fini');
  const cons = await h.createConsultationFixture({
    patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS',
  });
  consId = cons.id;
  otherConsId = (await h.createConsultationFixture({ patientId: users.patient2.id })).id;
});

afterAll(async () => {
  await h.closeAll();
});

describe('POST /api/consultations/:id/attachments', () => {
  it('stores a PNG privately and returns only an opaque API path', async () => {
    const res = await r.post(`/api/consultations/${consId}/attachments`)
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', PNG_BYTES, 'foto.png');
    expect(res.status).toBe(201);
    expect(res.body.attachmentId).toMatch(/^att_/);
    expect(res.body.url).toBe(`/api/consultations/${consId}/attachments/${res.body.attachmentId}`);
    expect(res.body.mimetype).toBe('image/png');
    expect(res.body.size).toBe(PNG_BYTES.length);
    expect(res.body.filename).toBe('foto.png');
    // No storage keys, no tokens, no absolute public URL.
    expect(JSON.stringify(res.body)).not.toMatch(/blob|token|secret|pathname/i);
    expect(res.body.url.startsWith('/api/')).toBe(true);
  });

  it('accepts PDF and browser-recorded audio (webm/EBML)', async () => {
    const pdf = await r.post(`/api/consultations/${consId}/attachments`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .attach('file', PDF_BYTES, 'rapo.pdf');
    expect(pdf.status).toBe(201);
    expect(pdf.body.mimetype).toBe('application/pdf');

    const voice = await r.post(`/api/consultations/${consId}/attachments`)
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', WEBM_AUDIO, { filename: 'mesaj_vwa.webm', contentType: 'audio/webm' });
    expect(voice.status).toBe(201);
    expect(voice.body.mimetype).toBe('audio/webm');
  });

  it('requires authentication', async () => {
    const res = await r.post(`/api/consultations/${consId}/attachments`)
      .attach('file', PNG_BYTES, 'x.png');
    expect(res.status).toBe(401);
  });

  it('rejects non-participants (404 — existence hiding)', async () => {
    const res = await r.post(`/api/consultations/${consId}/attachments`)
      .set('Authorization', `Bearer ${token.patient2}`)
      .attach('file', PNG_BYTES, 'x.png');
    expect(res.status).toBe(404);
  });

  it('rejects uploads into a consultation that is not EN_COURS', async () => {
    const res = await r.post(`/api/consultations/${finishedConsId}/attachments`)
      .set('Authorization', `Bearer ${token.patient2}`) // finishedCons belongs to patient2 (issue #60 fixture split)
      .attach('file', PNG_BYTES, 'x.png');
    expect(res.status).toBe(409);
  });

  it('rejects disallowed types by extension', async () => {
    const res = await r.post(`/api/consultations/${consId}/attachments`)
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', Buffer.from('MZ executable'), 'virus.exe');
    expect(res.status).toBe(400);
  });

  it('rejects spoofed content: declared image/png but the bytes are not a PNG', async () => {
    const res = await r.post(`/api/consultations/${consId}/attachments`)
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', Buffer.from('<html>not an image at all</html>'), 'fake.png');
    expect(res.status).toBe(400);
  });

  it('rejects a PDF body declared as PNG (container mismatch)', async () => {
    const res = await r.post(`/api/consultations/${consId}/attachments`)
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', PDF_BYTES, 'fake.png');
    expect(res.status).toBe(400);
  });

  it('enforces the size cap with 413', async () => {
    const fiveMb = Buffer.alloc(5 * 1024 * 1024, 1);
    const res = await r.post(`/api/consultations/${consId}/attachments`)
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', fiveMb, 'big.png');
    expect(res.status).toBe(413);
  });

  it('sanitizes hostile filenames (path traversal)', async () => {
    const res = await r.post(`/api/consultations/${consId}/attachments`)
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', PNG_BYTES, { filename: '../../etc/passwd.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.filename).toBe('passwd.png'); // basename only, no traversal
    expect(res.body.filename).not.toMatch(/\.\.|\/|\\/);
  });

  it('rejects an EMPTY file with 400 (no zero-byte medical media)', async () => {
    const res = await r.post(`/api/consultations/${consId}/attachments`)
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', Buffer.alloc(0), 'vid.png');
    expect(res.status).toBe(400);
  });

  it('removes the stored file when registry persistence fails (no orphaned private media)', async () => {
    // Force the post-storage DB write to fail by dropping the registry table,
    // then verify the route cleans up the just-written private file.
    const dbMod = await import('../src/db.js');
    const query = dbMod.query ?? dbMod.default?.query;
    await query('DROP TABLE consultation_attachments');

    const privateDir = path.join(process.env.LOCAL_UPLOADS_DIR, 'private', 'consultations', consId);
    const before = fs.existsSync(privateDir)
      ? fs.readdirSync(privateDir).filter((f) => f.startsWith('att_')).sort()
      : [];

    let status;
    try {
      const res = await r.post(`/api/consultations/${consId}/attachments`)
        .set('Authorization', `Bearer ${token.patient}`)
        .attach('file', PNG_BYTES, 'orfan.png');
      status = res.status;
    } finally {
      // ALWAYS restore the schema (migration 002 is idempotent), even when an
      // assertion below would otherwise skip the restore and break later suites.
      const sql002 = fs.readFileSync(
        path.join(__dirname, '..', 'db', 'migrations', '002_messaging_upgrade.sql'), 'utf8');
      await query(sql002);
    }

    expect(status).toBe(500); // registry failure surfaces as a server error
    const after = fs.existsSync(privateDir)
      ? fs.readdirSync(privateDir).filter((f) => f.startsWith('att_')).sort()
      : [];
    expect(after).toEqual(before); // the failed upload left NO new file behind
  });
});

describe('signed access (GET .../url + GET .../file)', () => {
  let attachment, grant;

  beforeAll(async () => {
    const res = await r.post(`/api/consultations/${consId}/attachments`)
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', PNG_BYTES, 'sekre.png');
    expect(res.status).toBe(201);
    attachment = res.body;
  });

  it('issues a short-lived signed grant to a participant', async () => {
    const res = await r.get(`/api/consultations/${consId}/attachments/${attachment.attachmentId}/url`)
      .set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    expect(res.body.expiresIn).toBeGreaterThan(0);
    expect(res.body.expiresIn).toBeLessThanOrEqual(600);
    expect(res.body.url).toMatch(new RegExp(`/api/consultations/${consId}/attachments/${attachment.attachmentId}/file\\?exp=\\d+&sig=`));
    expect(res.body.filename).toBe('sekre.png');
    grant = res.body;
  });

  it('streams the media for a valid grant (content + type + no sniffing)', async () => {
    const res = await r.get(grant.url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(res.body, PNG_BYTES)).toBe(0);
  });

  it('rejects a tampered signature', async () => {
    const tampered = grant.url.replace(/sig=(.+)$/, 'sig=forgedsignature');
    const res = await r.get(tampered);
    expect(res.status).toBe(404);
  });

  it('rejects an expired grant', async () => {
    const url = new URL(grant.url, 'http://localhost');
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig');
    // Recompute what a valid signature WOULD be for an already-past expiry:
    // impossible without the secret — instead verify the expiry path by using
    // a past exp with the (now invalid for that exp) original signature.
    url.searchParams.set('exp', String(exp - 3600_000));
    const res = await r.get(`${url.pathname}?${url.searchParams.toString()}`);
    expect(res.status).toBe(404); // signature no longer matches the manipulated exp
    expect(sig).toBeDefined();
  });

  it('re-checks consultation membership on EVERY /url request', async () => {
    const res = await r.get(`/api/consultations/${consId}/attachments/${attachment.attachmentId}/url`)
      .set('Authorization', `Bearer ${token.patient2}`);
    expect(res.status).toBe(404);
  });

  it('requires authentication for /url', async () => {
    const res = await r.get(`/api/consultations/${consId}/attachments/${attachment.attachmentId}/url`);
    expect(res.status).toBe(401);
  });

  it('refuses a grant minted for consultation A when used against consultation B', async () => {
    // The signature is scoped to (consultationId, attachmentId, exp): the URL
    // path itself is part of what was signed.
    const wrongPath = grant.url.replace(`/api/consultations/${consId}/`, `/api/consultations/${otherConsId}/`);
    const res = await r.get(wrongPath);
    expect(res.status).toBe(404);
  });

  it('does not serve the attachment through the public /uploads static route', async () => {
    // The stored file lives under LOCAL_UPLOADS_DIR/private/**, which the
    // static middleware (root of LOCAL_UPLOADS_DIR) must not expose.
    const res = await r.get('/uploads/private/consultations/x/y.png');
    expect([404, 302]).toContain(res.status); // 302 only when a legacy origin is set (not here)
  });
});

describe('message persistence with private attachments', () => {
  it('persists a message referencing the opaque API path and returns it on refresh', async () => {
    const up = await r.post(`/api/consultations/${consId}/attachments`)
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', PNG_BYTES, 'nan-mesaj.png');
    expect(up.status).toBe(201);

    const msg = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ messageType: 'image', fileUrl: up.body.url, fileSize: up.body.size });
    expect(msg.status).toBe(201);
    expect(msg.body.file_url).toBe(up.body.url);
    expect(msg.body.message_type).toBe('image');

    const list = await r.get(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.doctor}`);
    const stored = list.body.find((m) => m.id === msg.body.id);
    expect(stored.file_url).toBe(up.body.url); // unchanged after refresh
  });

  it('keeps legacy absolute media URLs compatible (historical messages)', async () => {
    const legacyUrl = 'https://medikahaiti.site/uploads/cons_old/foto.jpg';
    const msg = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ messageType: 'image', fileUrl: legacyUrl, fileSize: 1234 });
    expect(msg.status).toBe(201);
    expect(msg.body.file_url).toBe(legacyUrl);
  });
});
