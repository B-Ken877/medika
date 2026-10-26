/**
 * Upload tests:
 *  - contract shape preserved { url, filename, mimetype, size }
 *  - 4MB cap (Vercel function body limit) enforced with 413
 *  - dev disk fallback via LOCAL_UPLOADS_DIR
 *  - unauthenticated requests rejected
 *  - LiveKit token endpoint: contract shape + authorization + 503 when unset
 */
'use strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.REQUIRE_PAYMENT = 'false';
process.env.LOCAL_UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'medika-uploads-'));
// Dummy LiveKit credentials — JWT signing works offline.
process.env.LIVEKIT_URL = 'wss://livekit.example.com';
process.env.LIVEKIT_API_KEY = 'testkey';
process.env.LIVEKIT_API_SECRET = 'testsecret-testsecret-testsecret-testsecret';

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

describe('POST /api/upload', () => {
  it('stores a small image with the legacy response shape (dev disk fallback)', async () => {
    const res = await r.post('/api/upload')
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', Buffer.from('89504e470d0a1a0a', 'hex'), 'petite.png');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('url');
    expect(res.body.url).toMatch(/^\/uploads\//);
    expect(res.body.filename).toMatch(/\.png$/);
    expect(res.body.mimetype).toBe('image/png');
    expect(res.body.size).toBe(8);
  });

  it('associates the file with a consultation folder', async () => {
    const res = await r.post('/api/upload')
      .set('Authorization', `Bearer ${token.patient}`)
      .query({ consultationId: 'cons_test123' })
      .attach('file', Buffer.from('89504e470d0a1a0a', 'hex'), 'x.png');
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/uploads\/cons_test123\//);
  });

  it('rejects oversized files with 413 (Vercel body limit)', async () => {
    const fiveMb = Buffer.alloc(5 * 1024 * 1024, 1);
    const res = await r.post('/api/upload')
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', fiveMb, 'big.png');
    expect(res.status).toBe(413);
  });

  it('rejects disallowed file types with 400', async () => {
    const res = await r.post('/api/upload')
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', Buffer.from('MZ executable'), 'virus.exe');
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await r.post('/api/upload')
      .attach('file', Buffer.from('89504e470d0a1a0a', 'hex'), 'y.png');
    expect(res.status).toBe(401);
  });

  it('rejects an EMPTY file with 400 (legacy contract, explicit guard)', async () => {
    const res = await r.post('/api/upload')
      .set('Authorization', `Bearer ${token.patient}`)
      .attach('file', Buffer.alloc(0), 'vid.png');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Fichye a vid');
  });
});

describe('classifyStorageError — sanitized storage failure categories', () => {
  // Local stand-ins for the @vercel/blob error classes: classification keys on
  // the constructor NAME (stable across versions), never on the message.
  class BlobAccessError extends Error {}
  class BlobStoreNotFoundError extends Error {}
  class BlobClientTokenExpiredError extends Error {}
  class BlobFileTooLargeError extends Error {}
  class BlobServiceRateLimited extends Error {}
  class BlobServiceNotAvailable extends Error {}
  class BlobRequestAbortedError extends Error {}
  class BlobError extends Error {}

  it('maps auth/config-class failures to storage_auth 503', async () => {
    const { classifyStorageError } = await import('../src/uploads.js');
    expect(classifyStorageError(new BlobAccessError('secret'))).toEqual({ category: 'storage_auth', status: 503 });
    expect(classifyStorageError(new BlobStoreNotFoundError('store-x'))).toEqual({ category: 'storage_auth', status: 503 });
    expect(classifyStorageError(new BlobClientTokenExpiredError('t'))).toEqual({ category: 'storage_auth', status: 503 });
  });

  it('maps size/rate/availability/abort classes to their categories', async () => {
    const { classifyStorageError } = await import('../src/uploads.js');
    expect(classifyStorageError(new BlobFileTooLargeError())).toEqual({ category: 'storage_too_large', status: 413 });
    expect(classifyStorageError(new BlobServiceRateLimited())).toEqual({ category: 'storage_rate_limited', status: 503 });
    expect(classifyStorageError(new BlobServiceNotAvailable())).toEqual({ category: 'storage_unavailable', status: 503 });
    expect(classifyStorageError(new BlobRequestAbortedError())).toEqual({ category: 'storage_aborted', status: 400 });
  });

  it('maps the BASE BlobError (e.g. an unparseable read-write token) to storage_error 503', async () => {
    const { classifyStorageError } = await import('../src/uploads.js');
    expect(classifyStorageError(new BlobError('Invalid `BLOB_READ_WRITE_TOKEN`')))
      .toEqual({ category: 'storage_error', status: 503 });
    expect(classifyStorageError(new Error('anything else'))).toEqual({ category: 'storage_error', status: 503 });
    expect(classifyStorageError(null)).toEqual({ category: 'storage_error', status: 503 });
  });
});

describe('POST /api/call/token (LiveKit)', () => {
  let consId;

  beforeAll(async () => {
    const cons = await h.createConsultationFixture({ patientId: users.patient.id, doctorId: users.doctor.id, status: 'EN_COURS' });
    consId = cons.id;
  });

  it('returns the legacy shape { token, url, roomName, participantIdentity }', async () => {
    const res = await r.post('/api/call/token')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ consultationId: consId, isVideo: true });
    expect(res.status).toBe(200);
    expect(res.body.token.split('.')).toHaveLength(3); // LiveKit JWT
    expect(res.body.url).toBe('wss://livekit.example.com'); // public URL from env
    expect(res.body.roomName).toBe('medika_' + consId);
    expect(res.body.participantIdentity).toBe(users.patient.id);
  });

  it('rejects non-participants (403)', async () => {
    token.patient2 = token.patient2 || await h.loginToken(r, 't.patient2');
    const res = await r.post('/api/call/token')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ consultationId: consId, isVideo: false });
    expect(res.status).toBe(403);
  });

});
