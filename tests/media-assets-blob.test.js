/**
 * Shared media assets — PRIVATE BLOB storage mode (@vercel/blob MOCKED; no
 * real store, no real patient files; synthetic bytes only).
 *
 * Audit fix under test: the Blob store's access mode is PRIVATE. The legacy
 * upload path used to request access:'public' — the store rejected it with
 * the historical BlobError. Now:
 *  - POST /api/upload puts with access:'private' + the explicit token
 *  - the response url is the capability path /api/media/assets/ast_….…
 *  - GET /api/media/assets/:id reads with access:'private' and streams
 *  - a missing blob answers 404; a storage auth failure answers a sanitized 503
 *  - a put() failure surfaces the stable sanitized 503, never internals
 *
 * Mocking note: the src modules require('@vercel/blob') LAZILY through
 * Node's native require (vitest externalizes node_modules, so vi.mock does
 * NOT intercept it). The mock is therefore injected into require.cache at
 * the package's resolved CJS entry BEFORE any src module loads it.
 */
'use strict';

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Inject the mock into the NATIVE require cache ───────────────────────────
const nativeRequire = createRequire(path.resolve(__dirname, '../src/uploads.js'));
const blobResolvedPath = nativeRequire.resolve('@vercel/blob');
const putMock = vi.fn();
const getMock = vi.fn();
nativeRequire.cache[blobResolvedPath] = {
  id: blobResolvedPath,
  filename: blobResolvedPath,
  loaded: true,
  exports: {
    put: putMock,
    get: getMock,
    del: vi.fn(),
    issueSignedToken: vi.fn(),
    presignUrl: vi.fn(),
  },
};

process.env.REQUIRE_PAYMENT = 'false';
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_private_rw_mocktoken';
delete process.env.LOCAL_UPLOADS_DIR;

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

/** Web ReadableStream carrying exactly `buf` (what the real SDK returns). */
function webStreamOf(buf) {
  return Readable.toWeb(Readable.from([buf]));
}

function blobGetResult(buf) {
  return {
    statusCode: 200,
    stream: webStreamOf(buf),
    headers: new Headers(),
    blob: {
      contentType: 'application/octet-stream', // server ignores this — ext map wins
      size: buf.length,
    },
  };
}

describe('POST /api/upload → private Blob storage', () => {
  it('stores PRIVATELY with the explicit token and answers the capability URL', async () => {
    putMock.mockResolvedValueOnce({ url: 'https://private.store/assets/x' });

    const res = await r.post('/api/upload')
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', PNG_BYTES, { filename: 'avatar.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(putMock).toHaveBeenCalledTimes(1);

    const [pathname, body, options] = putMock.mock.calls[0];
    expect(pathname).toMatch(/^assets\/ast_[a-f0-9]{12}\.png$/);
    expect(Buffer.compare(body, PNG_BYTES)).toBe(0);
    expect(options.access).toBe('private');   // THE audit fix — never 'public'
    expect(options.token).toBe('vercel_blob_private_rw_mocktoken');
    expect(options.addRandomSuffix).toBe(false);

    expect(res.body.url).toBe(`/api/media/assets/${pathname.slice('assets/'.length)}`);
    expect(res.body.mimetype).toBe('image/png');
    expect(res.body.size).toBe(PNG_BYTES.length);
    expect(JSON.stringify(res.body)).not.toMatch(/blob|token|vercel|https/i);
  });

  it('maps a storage auth failure to the stable sanitized 503', async () => {
    class BlobAccessError extends Error {}
    putMock.mockRejectedValueOnce(new BlobAccessError('store secrets'));

    const res = await r.post('/api/upload')
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', PNG_BYTES, 'avatar.png');

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Stockage de fichiers indisponible. Tanpri, eseye ankò pi ta.');
    expect(JSON.stringify(res.body)).not.toMatch(/secret|token|store/i);
  });

  it('rejects unservable types (svg) before any storage call', async () => {
    putMock.mockClear();
    const res = await r.post('/api/upload')
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
        filename: 'malfezan.svg',
        contentType: 'image/svg+xml',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Type de fichier non supporte');
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/media/assets/:fileId — private Blob storage', () => {
  it('reads PRIVATELY and streams the bytes with the server-derived type', async () => {
    getMock.mockResolvedValueOnce(blobGetResult(PNG_BYTES));

    const res = await r.get('/api/media/assets/ast_abcdef123456.png');

    expect(res.status).toBe(200);
    expect(getMock).toHaveBeenCalledTimes(1);
    const [pathname, options] = getMock.mock.calls[0];
    expect(pathname).toBe('assets/ast_abcdef123456.png');
    expect(options.access).toBe('private');
    expect(options.token).toBe('vercel_blob_private_rw_mocktoken');

    // Type comes from the SERVER's extension map — not the stored metadata.
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toMatch(/^private,/);
    expect(Buffer.compare(res.body, PNG_BYTES)).toBe(0);
  });

  it('uploads then re-serves through the returned capability URL (round trip)', async () => {
    putMock.mockResolvedValueOnce({ url: 'https://private.store/assets/y' });
    const up = await r.post('/api/upload')
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', PNG_BYTES, { filename: 'foto.png', contentType: 'image/png' });
    expect(up.status).toBe(200);

    getMock.mockResolvedValueOnce(blobGetResult(PNG_BYTES));
    const res = await r.get(up.body.url); // capability URL — no Authorization header
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, PNG_BYTES)).toBe(0);
  });

  it('answers a uniform 404 when the blob is missing (get → null)', async () => {
    getMock.mockResolvedValueOnce(null);
    const res = await r.get('/api/media/assets/ast_000000000000.png');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });

  it('answers a sanitized 503 on a storage auth failure (no internals)', async () => {
    class BlobAccessError extends Error {}
    getMock.mockRejectedValueOnce(new BlobAccessError('store id + secret'));
    const res = await r.get('/api/media/assets/ast_abcdef123456.png');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|store id|token/i);
  });

  it('rejects malformed ids without touching storage', async () => {
    getMock.mockClear();
    for (const bad of [
      '/api/media/assets/../../../etc/passwd',
      '/api/media/assets/AST_abcdef123456.png',
      '/api/media/assets/ast_abcdef123456.svg',
      '/api/media/assets/att_abcdef123456.png',
      '/api/media/assets/ast_short.png',
    ]) {
      const res = await r.get(bad);
      expect(res.status, `GET ${bad}`).toBe(404);
    }
    expect(getMock).not.toHaveBeenCalled();
  });
});
