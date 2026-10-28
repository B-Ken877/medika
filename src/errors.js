/**
 * Typed HTTP errors + a final Express error handler that never leaks
 * backend internals (stack traces, SQL, file paths) to clients.
 */
'use strict';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (msg) => new ApiError(400, 'bad_request', msg);
const unauthorized = (msg) => new ApiError(401, 'unauthorized', msg);
const forbidden = (msg) => new ApiError(403, 'forbidden', msg);
const notFound = (msg) => new ApiError(404, 'not_found', msg);
const conflict = (msg) => new ApiError(409, 'conflict', msg);
const paymentRequired = (msg) => new ApiError(402, 'payment_required', msg);
const serviceUnavailable = (msg) => new ApiError(503, 'service_unavailable', msg);

/** Express error middleware — must be registered last. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  // Log only operational metadata — never payloads (medical data) or secrets.
  console.error('[HTTP] unhandled error:', req.method, req.path, err.constructor?.name);
  res.status(500).json({ error: 'Erreur interne du serveur' });
}

/** 404 for unmatched API routes. */
function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Ressource introuvable' });
}

module.exports = {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  paymentRequired,
  serviceUnavailable,
  errorHandler,
  notFoundHandler,
};
