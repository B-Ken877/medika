/**
 * Upload route — POST /api/upload (legacy contract) and the admin variant.
 * Storage: Vercel Blob in production, local disk fallback in development.
 */
'use strict';

const express = require('express');
const { authenticate, authenticateAdmin } = require('../auth');
const { uploadHandler } = require('../uploads');

const router = express.Router();

router.post('/upload', authenticate, uploadHandler);
router.post('/admin/upload', authenticateAdmin, uploadHandler);

module.exports = router;
