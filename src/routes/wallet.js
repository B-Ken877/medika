/**
 * Doctor wallet routes (issue #24).
 *
 * Read-only by construction: doctors can view their own earnings, payout
 * cycles and payout history, but there is deliberately NO endpoint for a
 * doctor to create, request, modify or withdraw anything — payouts are
 * scheduled and settled exclusively by admins. The doctor id always comes
 * from the authenticated token, never from the request.
 */
'use strict';

const express = require('express');
const walletRepo = require('../repos/wallet');
const { authenticate, requireRole } = require('../auth');

const router = express.Router();

router.get('/doctor/wallet', authenticate, requireRole('doctor'), async (req, res, next) => {
  try {
    res.json(await walletRepo.walletFor(req.user.id));
  } catch (err) { next(err); }
});

module.exports = router;
