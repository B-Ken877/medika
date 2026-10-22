/**
 * Medical history routes (RECONSTRUCTED endpoint — audit §3.2).
 *
 * Authorization:
 *  - full history: the patient themself, an admin, or a doctor who has (or had)
 *    a consultation with that patient ("doctors access only authorized
 *    consultations" — a care relationship is required, not mere curiosity);
 *  - snapshot: same rules (it is the doctor-facing context card);
 *  - update: the patient themself only (legacy: "Patient updates own history").
 */
'use strict';

const express = require('express');
const notesRepo = require('../repos/notes');
const usersRepo = require('../repos/users');
const { authenticate } = require('../auth');

const router = express.Router();

async function canReadPatientHistory(user, patientId) {
  if (user.role === 'admin') return true;
  if (user.id === patientId) return true;
  if (user.role === 'doctor') return notesRepo.doctorKnowsPatient(user.id, patientId);
  return false;
}

router.get('/medical-history/:patientId', authenticate, async (req, res, next) => {
  try {
    const patientId = req.params.patientId;
    if (!(await canReadPatientHistory(req.user, patientId))) {
      return res.json(null); // legacy-style: do not reveal existence
    }
    const patient = await usersRepo.findById(patientId);
    if (!patient || (patient.role !== 'patient' && patient.role !== 'doctor')) {
      return res.json(null);
    }
    res.json(await notesRepo.fullHistory(patientId));
  } catch (err) { next(err); }
});

router.get('/medical-history/:patientId/snapshot', authenticate, async (req, res, next) => {
  try {
    const patientId = req.params.patientId;
    if (!(await canReadPatientHistory(req.user, patientId))) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(await notesRepo.snapshot(patientId));
  } catch (err) { next(err); }
});

router.put('/medical-history/:patientId', authenticate, async (req, res, next) => {
  try {
    const patientId = req.params.patientId;
    if (req.user.id !== patientId) {
      return res.status(403).json({ error: 'Seul le patient peut modifier son dossier' });
    }
    const patch = req.body || {};
    // camelCase request → JSONB columns (legacy client contract).
    await notesRepo.upsertHistory(patientId, patch);
    res.json(await notesRepo.fullHistory(patientId));
  } catch (err) { next(err); }
});

module.exports = router;
