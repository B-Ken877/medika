/**
 * Shared (non-medical) media — capability-URL delivery for assets stored
 * PRIVATELY in Vercel Blob.
 *
 * Audit fix (BlobError on POST /api/upload): the Blob store is configured
 * for PRIVATE access, but the legacy upload path used to request
 * access:'public' — the store rejected it. storeUpload() now stores under
 * assets/<opaque-id>.<ext> with access:'private' and answers with the
 * site-relative capability URL /api/media/assets/<opaque-id>.<ext>; this
 * route streams those bytes back.
 *
 * ACCESS MODEL (deliberate, documented):
 *  - Possession of the unguessable 48-bit id IS the grant (capability URL).
 *    These assets are avatar-class, intentionally shared media: they render
 *    in <img> tags that cannot attach Authorization headers, and they were
 *    world-readable PUBLIC blob URLs before the private store existed — this
 *    model is strictly no less private than the historical behavior.
 *  - PRIVATE CONSULTATION MEDICAL MEDIA IS NEVER SERVED HERE. It lives under
 *    the "consultations/" storage prefix (a different prefix than
 *    "assets/"), and its only delivery path remains the
 *    participant-authorized signed-URL endpoint in routes/consultations.js.
 *    The strict file-id charset below makes path traversal and prefix
 *    cross-over impossible.
 *  - The response Content-Type is derived from the server's own extension
 *    map (never from upload-time declarations) and is always accompanied by
 *    X-Content-Type-Options: nosniff, so only known-safe inline types can
 *    ever be served.
 */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { config, isProduction } = require('../config');
const { serviceUnavailable } = require('../errors');
const {
  EXT_TO_MIME,
  MEDIA_ASSET_FILE_RE,
  MEDIA_ASSET_PREFIX,
  classifyStorageError,
  logUploadDiagnostic,
  newUploadRequestId,
} = require('../uploads');

const router = express.Router();

/** Browser-cache window (seconds). The id is immutable content: a new avatar
 *  upload gets a NEW id, so caching cannot serve stale bytes. `private`
 *  keeps capability URLs out of shared proxy caches. */
const MEDIA_CACHE_SECONDS = 86_400;

router.get('/media/assets/:fileId', async (req, res, next) => {
  try {
    const fileId = String(req.params.fileId || '');
    const match = MEDIA_ASSET_FILE_RE.exec(fileId);
    const ext = match ? `.${match[1]}` : '';
    const contentType = ext ? EXT_TO_MIME[ext] : undefined;
    if (!match || !contentType) {
      // Unknown shape, unknown extension, or a traversal attempt — one
      // uniform 404 (no existence information).
      return res.status(404).json({ error: 'Not found' });
    }

    if (config.blobReadWriteToken) {
      const { get } = require('@vercel/blob');
      let result;
      try {
        result = await get(`${MEDIA_ASSET_PREFIX}/${fileId}`, {
          access: 'private',
          token: config.blobReadWriteToken,
        });
      } catch (err) {
        const { category } = classifyStorageError(err);
        logUploadDiagnostic(newUploadRequestId(), 'media_asset_get', { category });
        return res.status(503).json({ error: 'Media temporairement indisponible' });
      }
      if (!result || result.statusCode !== 200 || !result.stream) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(result.blob.size));
      res.setHeader('Cache-Control', `private, max-age=${MEDIA_CACHE_SECONDS}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const { Readable } = require('stream');
      Readable.fromWeb(result.stream)
        .on('error', () => {
          // Mid-stream storage failure: the client sees a truncated body —
          // the safe outcome (never partial content re-labelled 200+complete).
          if (!res.headersSent) res.status(503).json({ error: 'Media temporairement indisponible' });
          else res.destroy();
        })
        .pipe(res);
      return;
    }

    // Local-dev storage (no Blob token): serve the same URL shape from disk
    // so development and production exercise an identical contract. The
    // strict file-id charset above already rules out traversal.
    if (!isProduction() && config.localUploadsDir) {
      const fp = path.join(config.localUploadsDir, MEDIA_ASSET_PREFIX, fileId);
      const exists = await fs.promises.access(fp).then(() => true, () => false);
      if (!exists) return res.status(404).json({ error: 'Not found' });
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', `private, max-age=${MEDIA_CACHE_SECONDS}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      fs.createReadStream(fp)
        .on('error', () => { if (!res.headersSent) res.status(404).json({ error: 'Not found' }); else res.end(); })
        .pipe(res);
      return;
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
