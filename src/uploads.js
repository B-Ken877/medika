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
const crypto = require('crypto');
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
  '.pdf': 'application/pdf',
};

/**
 * Server-validated content types for CONSULTATION attachments (medical
 * media). The browser-declared MIME is only a hint: the buffer is sniffed
 * and the container family must match the declared type.
 */
const ATTACHMENT_ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/webm', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/ogg',
]);

/** Extension chosen from the validated MIME — never the client filename. */
const MIME_TO_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'application/pdf': '.pdf',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/aac': '.aac',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg',
};

/**
 * Magic-byte sniffing → container family. Returns null for unknown content.
 * Ambiguous containers (mp4/mov share 'ftyp'; webm audio/video share EBML;
 * RIFF covers webp/wav) return a family that the caller matches against the
 * declared MIME — the declared type must itself be allow-listed.
 */
function sniffContainerFamily(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (buf.toString('ascii', 0, 4) === '%PDF') return 'pdf';
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4-family';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'ebml';
  if (buf.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (buf.toString('ascii', 0, 3) === 'ID3') return 'mpeg';
  if (buf[0] === 0xff && (buf[1] & 0xe6) === 0xe2) return 'mpeg';       // MPEG audio frame sync
  if (buf[0] === 0xff && (buf[1] === 0xf1 || buf[1] === 0xf9)) return 'aac'; // ADTS
  return null;
}

/** Declared MIME ↔ sniffed container must agree (family-level). */
function mimeMatchesContainer(mimetype, family) {
  switch (family) {
    case 'png': return mimetype === 'image/png';
    case 'jpeg': return mimetype === 'image/jpeg';
    case 'webp': return mimetype === 'image/webp';
    case 'wav': return mimetype === 'audio/wav';
    case 'pdf': return mimetype === 'application/pdf';
    case 'mp4-family':
      return mimetype === 'video/mp4' || mimetype === 'video/quicktime' || mimetype === 'audio/mp4';
    case 'ebml':
      return mimetype === 'video/webm' || mimetype === 'audio/webm';
    case 'ogg': return mimetype === 'audio/ogg';
    case 'mpeg': return mimetype === 'audio/mpeg';
    case 'aac': return mimetype === 'audio/aac';
    default: return false;
  }
}

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

/** Attachment variant: strictly allow-listed MIME types only. */
function attachmentFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  let mime = file.mimetype && ATTACHMENT_ALLOWED_MIME.has(file.mimetype) ? file.mimetype : null;
  if (!mime && EXT_TO_MIME[ext] && ATTACHMENT_ALLOWED_MIME.has(EXT_TO_MIME[ext])) {
    mime = EXT_TO_MIME[ext]; // normalize from extension when the browser sent none
  }
  if (!mime) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
  file.mimetype = mime;
  cb(null, true);
}

function safeConsultationId(consultationId) {
  return consultationId && /^[a-zA-Z0-9_-]+$/.test(consultationId) ? consultationId : 'general';
}

/** Display filename: strip paths/control chars, cap length. Storage paths never use it. */
function sanitizeFilename(name) {
  const base = String(name || 'fichye').split(/[\\/]/).pop() || 'fichye';
  const cleaned = base.replace(/[\u0000-\u001f<>:"?*]+/g, '_').trim();
  return cleaned.slice(0, 120) || 'fichye';
}

/** Memory storage — required for serverless (no writable disk in production). */
function createUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
    fileFilter,
  }).single('file');
}

/** Attachment upload middleware (same field + cap, strict MIME allow-list). */
function createAttachmentMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
    fileFilter: attachmentFileFilter,
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

// ─── Private consultation attachments ────────────────────────────────────────

/** Lifetime of a signed download grant (seconds). Short by design. */
const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Validate + store an attachment PRIVATELY. Returns registry fields
 * (storage + opaque pathname) — no public URL is ever produced.
 *
 * Storage:
 *  - Vercel Blob with access:'private' when BLOB_READ_WRITE_TOKEN is set
 *    (requires @vercel/blob >= 2.x for private access + presigned reads);
 *  - local-dev disk under LOCAL_UPLOADS_DIR/private/… (never statically
 *    served; only reachable through the signed /file endpoint).
 */
async function storePrivateAttachment({ file, consultationId, attachmentId }) {
  // Defense in depth: the multer filter already allow-listed the declared
  // MIME; re-verify the actual bytes (never trust filename or browser MIME).
  const family = sniffContainerFamily(file.buffer);
  if (!family || !mimeMatchesContainer(file.mimetype, family)) {
    throw badRequest('Type de fichier non valide ou non supporte');
  }

  const ext = MIME_TO_EXT[file.mimetype] || '.bin';
  const pathname = `consultations/${safeConsultationId(consultationId)}/${attachmentId}${ext}`;

  if (config.blobReadWriteToken) {
    const { put } = require('@vercel/blob');
    await put(pathname, file.buffer, {
      access: 'private',
      contentType: file.mimetype,
      addRandomSuffix: false,
      token: config.blobReadWriteToken,
    });
    return { storage: 'blob', blobPathname: pathname };
  }

  if (!isProduction() && config.localUploadsDir) {
    const fs = require('fs');
    const fp = path.join(config.localUploadsDir, 'private', pathname);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, file.buffer);
    return { storage: 'local', blobPathname: pathname };
  }

  throw serviceUnavailable('Stockage de fichiers non configuré (BLOB_READ_WRITE_TOKEN requis)');
}

/** HMAC-signed, expiring download URL for a LOCAL-dev attachment.
 *  The signature authorizes exactly one attachment for TTL seconds; the
 *  /url endpoint re-checks consultation membership before issuing it. */
function signLocalAttachmentUrl({ consultationId, attachmentId }) {
  const exp = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;
  const sig = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`${consultationId}:${attachmentId}:${exp}`)
    .digest('base64url');
  return {
    url: `/api/consultations/${encodeURIComponent(consultationId)}/attachments/${encodeURIComponent(attachmentId)}/file?exp=${exp}&sig=${sig}`,
    exp,
  };
}

function verifyLocalAttachmentSignature({ consultationId, attachmentId, exp, sig }) {
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`${consultationId}:${attachmentId}:${exp}`)
    .digest('base64url');
  const a = Buffer.from(String(sig));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Absolute filesystem path of a local-dev attachment (opaque, under private/). */
function localAttachmentPath(blobPathname) {
  const safe = String(blobPathname || '').replace(/\.\./g, '').replace(/^\/+/, '');
  return path.join(config.localUploadsDir, 'private', safe);
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

module.exports = {
  uploadHandler,
  localStaticMiddleware,
  badRequest,
  safeConsultationId,
  sanitizeFilename,
  createAttachmentMiddleware,
  storePrivateAttachment,
  signLocalAttachmentUrl,
  verifyLocalAttachmentSignature,
  localAttachmentPath,
  SIGNED_URL_TTL_SECONDS,
};
