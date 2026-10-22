/**
 * File uploads.
 *
 * Legacy behavior (multer disk → /uploads static) is incompatible with Vercel:
 * the filesystem is ephemeral and express.static() is ignored there. Storage
 * moves to Vercel Blob (managed object storage); the endpoint contract stays
 * identical: POST /api/upload (multipart, field "file") →
 * { url, filename, mimetype, size }.
 *
 * Size cap: Vercel Functions reject request bodies > 4.5 MB with
 * 413 FUNCTION_PAYLOAD_TOO_LARGE, so uploads are capped at 4 MB by default
 * (MAX_UPLOAD_MB). Web clients can bypass the cap in the future via
 * client-direct Blob uploads; Android large-media handling is documented in
 * docs/ANDROID_COMPATIBILITY.md.
 */
'use strict';

const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { config, isProduction } = require('./config');
const { badRequest, serviceUnavailable } = require('./errors');

const EXT_TO_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.3gp': 'video/3gp', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.weba': 'audio/webm',
  '.amr': 'audio/amr', '.flac': 'audio/flac',
};

function fileFilter(req, file, cb) {
  if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    return cb(null, true);
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (EXT_TO_MIME[ext]) {
    file.mimetype = EXT_TO_MIME[ext];
    return cb(null, true);
  }
  cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
}

function safeConsultationId(consultationId) {
  return consultationId && /^[a-zA-Z0-9_-]+$/.test(consultationId) ? consultationId : 'general';
}

/** Memory storage — required for serverless (no writable disk in production). */
function createUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
    fileFilter,
  }).single('file');
}

/**
 * Store an accepted upload. Prefers Vercel Blob; falls back to a local disk
 * directory ONLY outside production (dev parity with the legacy server).
 * Returns the legacy response shape.
 */
async function storeUpload({ file, consultationId }) {
  const filename = `${Date.now()}_${uuidv4().substring(0, 8)}${path.extname(file.originalname) || '.bin'}`;
  const key = `${safeConsultationId(consultationId)}/${filename}`;

  if (config.blobReadWriteToken) {
    const { put } = require('@vercel/blob');
    const blob = await put(key, file.buffer, {
      access: 'public',
      contentType: file.mimetype,
      addRandomSuffix: false,
    });
    return { url: blob.url, filename, mimetype: file.mimetype, size: file.size };
  }

  if (!isProduction() && config.localUploadsDir) {
    const fs = require('fs');
    const dir = path.join(config.localUploadsDir, safeConsultationId(consultationId));
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, filename);
    fs.writeFileSync(fp, file.buffer);
    return { url: `/uploads/${key}`, filename, mimetype: file.mimetype, size: file.size };
  }

  throw serviceUnavailable('Stockage de fichiers non configuré (BLOB_READ_WRITE_TOKEN requis)');
}

/** Express handler for POST /api/upload (legacy contract preserved). */
function uploadHandler(req, res, next) {
  createUploadMiddleware()(req, res, async (err) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: `File too large (max ${config.maxUploadMb}MB)` });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ error: 'File type not allowed' });
        }
        return res.status(400).json({ error: 'Upload invalide' });
      }
      if (!req.file) return res.status(400).json({ error: 'No file provided' });
      const consultationId = req.query.consultationId || req.body?.consultationId;
      const result = await storeUpload({ file: req.file, consultationId });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
}

/** Local-dev static serving of the fallback disk directory (ignored on Vercel). */
function localStaticMiddleware() {
  if (isProduction() || !config.localUploadsDir) return null;
  const express = require('express');
  return express.static(config.localUploadsDir);
}

module.exports = { uploadHandler, localStaticMiddleware, badRequest, safeConsultationId };
