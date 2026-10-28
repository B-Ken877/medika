/**
 * Admin routes — legacy endpoints preserved, plus the RECONSTRUCTED admin
 * ticket endpoints used by the medika-admin customer-care pages (audit §3.2).
 *
 * Authorization: JWT + role==='admin' for everything (audit C1 fix — the old
 * Bearer-user-id "admin" check authenticated nothing).
 *
 * Finance note (audit M2): revenue is computed from CURRENT specialty pricing
 * exactly like the legacy server (compatibility); the authoritative financial
 * record going forward is the payments table.
 */
'use strict';

const express = require('express');
const usersRepo = require('../repos/users');
const consultationsRepo = require('../repos/consultations');
const specialtiesRepo = require('../repos/specialties');
const ticketsRepo = require('../repos/tickets');
const walletRepo = require('../repos/wallet');
const payoutCycles = require('../payout-cycles');
const notifications = require('../notifications/emit');
const { query } = require('../db');
const { authenticateAdmin, hashPassword } = require('../auth');
const { config } = require('../config');

const router = express.Router();

const MONTH_NAMES = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const MONTH_NAMES_SHORT = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec'];

router.use(authenticateAdmin);

// ─── Stats ───────────────────────────────────────────────────────────────────

router.get('/stats', async (req, res, next) => {
  try {
    const [usersRes, consRows, msgCount, specPrices] = await Promise.all([
      query(`SELECT id, role, name, specialty, rating FROM users`),
      consultationsRepo.listAll({}),
      consultationsRepo.countAll(),
      specialtiesRepo.list(),
    ]);
    const users = usersRes.rows;
    const consultations = consRows.map(consultationsRepo.consToApi);
    const priceOf = (name) => specPrices.find((s) => s.name === name)?.price ?? 750;

    const doctors = users.filter((u) => u.role === 'doctor');
    const patients = users.filter((u) => u.role === 'patient');
    const completed = consultations.filter((c) => c.status === 'TERMINE');
    const active = consultations.filter((c) => c.status === 'EN_COURS');
    const pending = consultations.filter((c) => c.status === 'RECHERCHE_MEDECIN');

    const calcRevenue = (list) => {
      let total = 0, doctorTotal = 0, medikaTotal = 0;
      for (const c of list) {
        const price = priceOf(c.specialty_needed);
        total += price;
        doctorTotal += price - config.platformFee;
        medikaTotal += config.platformFee;
      }
      return { total, doctorTotal, medikaTotal };
    };

    const now = new Date();
    const cm = now.getMonth(), cy = now.getFullYear();
    const monthlyCompleted = completed.filter((c) => {
      const d = new Date((c.created_at || 0) * 1000);
      return d.getMonth() === cm && d.getFullYear() === cy;
    });

    const monthlyBreakdown = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(cy, cm - i, 1);
      const mc = completed.filter((c) => {
        const cd = new Date((c.created_at || 0) * 1000);
        return cd.getMonth() === d.getMonth() && cd.getFullYear() === d.getFullYear();
      });
      const mr = calcRevenue(mc);
      monthlyBreakdown.push({ month: MONTH_NAMES[d.getMonth()], year: d.getFullYear(), count: mc.length, revenue: mr.total, doctorEarnings: mr.doctorTotal, medikaEarnings: mr.medikaTotal });
    }

    const doctorEarnings = doctors.map((doc) => {
      const docCompleted = completed.filter((c) => c.doctor_id === doc.id);
      const docMonthly = docCompleted.filter((c) => {
        const d = new Date((c.created_at || 0) * 1000);
        return d.getMonth() === cm && d.getFullYear() === cy;
      });
      const dt = calcRevenue(docCompleted);
      const dm = calcRevenue(docMonthly);
      return {
        id: doc.id, name: doc.name, specialty: doc.specialty || 'N/A',
        totalConsultations: docCompleted.length, totalEarnings: dt.doctorTotal,
        monthlyConsultations: docMonthly.length, monthlyEarnings: dm.doctorTotal,
        rating: doc.rating || 0,
      };
    }).sort((a, b) => b.monthlyEarnings - a.monthlyEarnings);

    const allRev = calcRevenue(completed);
    const monthRev = calcRevenue(monthlyCompleted);
    res.json({
      totalDoctors: doctors.length, totalPatients: patients.length,
      totalConsultations: consultations.length, completedConsultations: completed.length,
      activeConsultations: active.length, pendingConsultations: pending.length,
      totalMessages: msgCount, totalRevenue: allRev.total, monthlyRevenue: monthRev.total,
      totalDoctorEarnings: allRev.doctorTotal, totalMedikaEarnings: allRev.medikaTotal,
      monthlyDoctorEarnings: monthRev.doctorTotal, monthlyMedikaEarnings: monthRev.medikaTotal,
      monthlyCompleted: monthlyCompleted.length, monthlyBreakdown, doctorEarnings,
    });
  } catch (err) { next(err); }
});

// ─── Doctor CRUD ─────────────────────────────────────────────────────────────

router.get('/doctors', async (req, res, next) => {
  try {
    const [rows, consRows, specPrices] = await Promise.all([
      usersRepo.adminListDoctors({
        specialty: req.query.specialty ? String(req.query.specialty) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
      }),
      consultationsRepo.listAll({}),
      specialtiesRepo.list(),
    ]);
    const priceOf = (name) => specPrices.find((s) => s.name === name)?.price ?? 750;
    res.json(rows.map((d) => {
      const dc = consRows.filter((c) => c.doctor_id === d.id);
      const completedCount = dc.filter((c) => c.status === 'TERMINE').length;
      const totalEarnings = dc
        .filter((c) => c.status === 'TERMINE')
        .reduce((sum, c) => sum + priceOf(c.specialty_needed) - config.platformFee, 0);
      return { ...usersRepo.toApi(d), consultationCount: dc.length, completedCount, totalEarnings };
    }));
  } catch (err) { next(err); }
});

router.post('/doctors', async (req, res, next) => {
  try {
    const { username, password, name, email, phone, age, gender, specialty, licenseNumber, location, hospital, biography, avatarUrl } = req.body || {};
    if (!username || !password || !name || !specialty) {
      return res.status(400).json({ error: 'Username, password, name, and specialty are required' });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    const doctor = await usersRepo.create({
      id: require('uuid').v4().substring(0, 8).replace(/^/, 'doctor_'),
      username: String(username),
      password_hash: hashPassword(String(password)),
      role: 'doctor',
      name: String(name),
      email: email ?? null,
      phone: phone ?? null,
      age: age === undefined ? null : (parseInt(age, 10) || null),
      gender: gender || 'Homme',
      specialty: String(specialty),
      license_number: licenseNumber ?? null,
      location: location ?? null,
      hospital: hospital ?? null,
      biography: biography ?? null,
      avatar_url: avatarUrl ?? null,
    });
    if (!doctor) return res.status(409).json({ error: 'Username already taken' });
    res.status(201).json(usersRepo.toApi(doctor));
  } catch (err) { next(err); }
});

router.get('/doctors/:id', async (req, res, next) => {
  try {
    const user = await usersRepo.findById(req.params.id);
    if (!user || user.role !== 'doctor') return res.status(404).json({ error: 'Doctor not found' });
    res.json(usersRepo.toApi(user));
  } catch (err) { next(err); }
});

router.put('/doctors/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const patch = { ...body };
    if (body.password !== undefined) {
      if (String(body.password).length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters' });
      }
      patch.password_hash = hashPassword(String(body.password));
    }
    // Issue #32: an admin edit of professional credential fields is recorded
    // in the verification audit trail (no automatic status change — admins
    // stay in explicit control of the verification state).
    const CREDENTIAL_FIELDS = [
      ['specialty', 'specialty'], ['licenseNumber', 'license_number'],
      ['location', 'location'], ['hospital', 'hospital'], ['biography', 'biography'],
    ];
    const before = await usersRepo.findById(req.params.id);
    if (!before || before.role !== 'doctor') {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    const changed = CREDENTIAL_FIELDS
      .filter(([camel, snake]) => body[camel] !== undefined && String(body[camel] ?? '') !== String(before[snake] ?? ''))
      .map(([camel]) => camel);
    const user = await usersRepo.adminUpdateDoctor(req.params.id, patch);
    if (!user) return res.status(404).json({ error: 'Doctor not found' });
    if (changed.length) {
      await usersRepo.logCredentialFieldsEdit(req.params.id, req.user.id, changed)
        .catch(() => undefined); // audit write must not fail the edit
    }
    res.json(usersRepo.toApi(user));
  } catch (err) { next(err); }
});

// ─── Doctor credential verification (issue #32) ─────────────────────────────

/**
 * PUT /api/admin/doctors/:id/verification — transition the credential
 * verification status. Admin-only (this router authenticates admin for every
 * route). Statuses: pending | verified | rejected; verified_at/verified_by
 * are maintained server-side; every change lands in the audit trail with the
 * acting admin. Doctors/patients have no route that writes this state.
 */
router.put('/doctors/:id/verification', async (req, res, next) => {
  try {
    const { status, note } = req.body || {};
    if (!usersRepo.VERIFICATION_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be one of pending, verified, rejected' });
    }
    if (note !== undefined && note !== null && String(note).length > 500) {
      return res.status(400).json({ error: 'Note too long (max 500)' });
    }
    const user = await usersRepo.setDoctorVerification(req.params.id, {
      status,
      actorId: req.user.id,
      note: note === undefined || note === null ? null : String(note),
    });
    if (!user) return res.status(404).json({ error: 'Doctor not found' });
    res.json(usersRepo.toApi(user));
  } catch (err) { next(err); }
});

/** GET /api/admin/doctors/:id/verification — the audit trail (admin-only). */
router.get('/doctors/:id/verification', async (req, res, next) => {
  try {
    const user = await usersRepo.findById(req.params.id);
    if (!user || user.role !== 'doctor') return res.status(404).json({ error: 'Doctor not found' });
    const audit = await usersRepo.listVerificationAudit(req.params.id);
    res.json({ verification_status: user.verification_status ?? null, audit });
  } catch (err) { next(err); }
});

router.delete('/doctors/:id', async (req, res, next) => {
  try {
    const user = await usersRepo.findById(req.params.id);
    const ok = await usersRepo.adminDeleteUser(req.params.id, 'doctor');
    if (!ok) return res.status(404).json({ error: 'Doctor not found' });
    res.json({ success: true, deleted: req.params.id, name: user?.name });
  } catch (err) { next(err); }
});

// ─── Patients ────────────────────────────────────────────────────────────────

router.get('/patients', async (req, res, next) => {
  try {
    const rows = await usersRepo.adminListPatients({
      search: req.query.search ? String(req.query.search) : undefined,
    });
    const consRows = await consultationsRepo.listAll({});
    res.json(rows.map((p) => ({
      ...usersRepo.toApi(p),
      consultationCount: consRows.filter((c) => c.patient_id === p.id).length,
    })));
  } catch (err) { next(err); }
});

router.delete('/patients/:id', async (req, res, next) => {
  try {
    const user = await usersRepo.findById(req.params.id);
    const ok = await usersRepo.adminDeleteUser(req.params.id, 'patient');
    if (!ok) return res.status(404).json({ error: 'Patient not found' });
    res.json({ success: true, deleted: req.params.id, name: user?.name });
  } catch (err) { next(err); }
});

// ─── Consultations ───────────────────────────────────────────────────────────

router.get('/consultations', async (req, res, next) => {
  try {
    const consRows = await consultationsRepo.listAll({
      status: req.query.status ? String(req.query.status) : undefined,
      doctor_id: req.query.doctor_id ? String(req.query.doctor_id) : undefined,
      patient_id: req.query.patient_id ? String(req.query.patient_id) : undefined,
    });
    const usersRes = await query(`SELECT id, email, phone, name, specialty FROM users`);
    const users = usersRes.rows;
    res.json(consRows.map((c) => ({
      ...consultationsRepo.consToApi(c),
      patient_email: users.find((u) => u.id === c.patient_id)?.email || null,
      patient_phone: users.find((u) => u.id === c.patient_id)?.phone || null,
      doctor_name: users.find((u) => u.id === c.doctor_id)?.name || null,
      doctor_specialty: users.find((u) => u.id === c.doctor_id)?.specialty || null,
    })));
  } catch (err) { next(err); }
});

router.get('/consultations/:id', async (req, res, next) => {
  try {
    const c = await consultationsRepo.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(consultationsRepo.consToApi(c));
  } catch (err) { next(err); }
});

router.get('/consultations/:id/messages', async (req, res, next) => {
  try {
    res.json(await consultationsRepo.listMessages(req.params.id));
  } catch (err) { next(err); }
});

router.delete('/consultations/:id', async (req, res, next) => {
  try {
    const ok = await consultationsRepo.adminDelete(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Consultation not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── Finance (legacy price-based computation preserved) ─────────────────────

router.get('/finance', async (req, res, next) => {
  try {
    const [consRows, usersRes, specPrices] = await Promise.all([
      consultationsRepo.listAll({}),
      query(`SELECT id, role, name, specialty FROM users`),
      specialtiesRepo.list(),
    ]);
    const users = usersRes.rows;
    const priceOf = (name) => specPrices.find((s) => s.name === name)?.price ?? 750;
    const completed = consRows.filter((c) => c.status === 'TERMINE').map(consultationsRepo.consToApi);

    const now = new Date();
    const cm = now.getMonth(), cy = now.getFullYear();
    const monthlyCompleted = completed.filter((c) => {
      const d = new Date((c.created_at || 0) * 1000);
      return d.getMonth() === cm && d.getFullYear() === cy;
    });

    const calcFin = (list) => {
      let total = 0, docTotal = 0, medikaTotal = 0;
      for (const c of list) {
        const p = priceOf(c.specialty_needed);
        total += p; docTotal += p - config.platformFee; medikaTotal += config.platformFee;
      }
      return { total, doctorEarnings: docTotal, medikaEarnings: medikaTotal };
    };

    const doctors = users.filter((u) => u.role === 'doctor');
    const doctorEarnings = doctors.map((doc) => {
      const dm = monthlyCompleted.filter((c) => c.doctor_id === doc.id);
      const dt = completed.filter((c) => c.doctor_id === doc.id);
      return {
        id: doc.id, name: doc.name, specialty: doc.specialty || 'N/A',
        monthlyConsultations: dm.length, monthlyEarnings: calcFin(dm).doctorEarnings,
        totalConsultations: dt.length, totalEarnings: calcFin(dt).doctorEarnings,
      };
    }).sort((a, b) => b.monthlyEarnings - a.monthlyEarnings);

    const history = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(cy, cm - i, 1);
      const mc = completed.filter((c) => {
        const cd = new Date((c.created_at || 0) * 1000);
        return cd.getMonth() === d.getMonth() && cd.getFullYear() === d.getFullYear();
      });
      const mf = calcFin(mc);
      history.push({ month: MONTH_NAMES_SHORT[d.getMonth()], year: d.getFullYear(), label: `${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getFullYear()}`, count: mc.length, revenue: mf.total, doctorEarnings: mf.doctorEarnings, medikaEarnings: mf.medikaEarnings });
    }

    const recentTransactions = monthlyCompleted.slice(-20).reverse().map((c) => {
      const doctor = users.find((u) => u.id === c.doctor_id);
      const p = priceOf(c.specialty_needed);
      return {
        id: c.id, patientName: c.patient_name, doctorName: doctor?.name || 'N/A',
        specialty: c.specialty_needed || 'N/A', amount: p, doctorEarning: p - config.platformFee,
        medikaEarning: config.platformFee, date: c.created_at,
      };
    });

    const mFin = calcFin(monthlyCompleted);
    const tFin = calcFin(completed);
    res.json({
      currentMonth: { name: MONTH_NAMES_SHORT[cm], year: cy, label: `${MONTH_NAMES_SHORT[cm]} ${cy}`, consultations: monthlyCompleted.length, revenue: mFin.total, doctorEarnings: mFin.doctorEarnings, medikaEarnings: mFin.medikaEarnings },
      total: { consultations: completed.length, revenue: tFin.total, doctorEarnings: tFin.doctorEarnings, medikaEarnings: tFin.medikaEarnings },
      doctorEarnings, history, recentTransactions,
    });
  } catch (err) { next(err); }
});

// ─── Doctor payouts (issue #24: wallet ledger + manual MonCash workflow) ─────

/**
 * GET /api/admin/payouts — payout management view:
 *   * cycles: every cycle that still has AVAILABLE earnings, oldest first,
 *     each with the per-doctor eligible amounts (reconcilable against the
 *     underlying earnings) and a `due` flag (cycle end date reached);
 *   * currentCycle: the accumulating cycle;
 *   * payouts: full settlement history (doctor, cycle, amount, admin actor,
 *     MonCash reference, timestamp).
 */
router.get('/payouts', async (req, res, next) => {
  try {
    res.json(await walletRepo.payoutOverview());
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/payouts/settle — mark a doctor's payout for one cycle as
 * PAID ("Payé"). The admin performs the manual MonCash transfer FIRST and
 * records the reference; this call settles the ledger atomically:
 *   * the (doctor, cycle) pair is validated against the real cycle calendar
 *     (arbitrary date ranges are rejected);
 *   * an already-settled cycle returns the existing payout (idempotent —
 *     repeated clicks / retries can never double-pay);
 *   * DB-level UNIQUE(doctor_id, cycle_start, cycle_end) + advisory lock +
 *     FOR UPDATE on the earnings make concurrent settles impossible;
 *   * every included earning flips AVAILABLE→PAID in the same transaction.
 */
router.post('/payouts/settle', async (req, res, next) => {
  try {
    const { doctorId, cycleStart, cycleEnd, moncashReference } = req.body || {};

    if (typeof doctorId !== 'string' || !doctorId.trim()) {
      return res.status(400).json({ error: 'doctorId requis' });
    }
    if (typeof cycleStart !== 'string' || typeof cycleEnd !== 'string') {
      return res.status(400).json({ error: 'cycleStart et cycleEnd (YYYY-MM-DD) requis' });
    }
    if (moncashReference !== undefined && moncashReference !== null) {
      if (typeof moncashReference !== 'string' || moncashReference.length > 200) {
        return res.status(400).json({ error: 'Reference MonCash invalide (200 caracteres max)' });
      }
    }

    const cycle = payoutCycles.isValidCyclePair(cycleStart, cycleEnd);
    if (!cycle) {
      return res.status(400).json({ error: 'Cycle de paiement invalide (bornes reelles du calendrier attendues)' });
    }
    // Payouts run on the cycle date: a cycle can only be settled once its end
    // date has arrived (today or earlier, app timezone).
    if (cycle.endDate > payoutCycles.latestDueCycleEndIso(new Date())) {
      return res.status(400).json({ error: 'Ce cycle de paiement n\'est pas encore termine' });
    }

    const doctor = await usersRepo.findById(doctorId);
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ error: 'Medecin introuvable' });
    }

    const result = await walletRepo.settle({
      doctorId: doctor.id,
      cycle,
      adminId: req.user.id,
      adminName: req.user.name || 'Admin',
      moncashReference: moncashReference ? moncashReference.trim() : null,
    });

    if (result.error === 'no_earnings') {
      return res.status(409).json({ error: 'Aucun gain eligible pour ce medecin sur ce cycle' });
    }
    if (result.error === 'actor_not_found') {
      return res.status(404).json({ error: 'Medecin introuvable' });
    }

    // Issue #36: notify the doctor AFTER the payout state is committed —
    // including the idempotent alreadyPaid path (same stable key → the
    // duplicate settle click cannot double-notify).
    notifications.emit({
      userId: doctor.id,
      eventType: 'payout:paid',
      idempotencyKey: `payout:${result.payout.id}:paid`,
      ...notifications.COPY.payoutPaid,
    });

    res.status(result.alreadyPaid ? 200 : 201).json(result);
  } catch (err) { next(err); }
});

// ─── Reset password ──────────────────────────────────────────────────────────

router.put('/users/:id/reset-password', async (req, res, next) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    const name = await usersRepo.adminResetPassword(req.params.id, hashPassword(String(newPassword)));
    if (name === null) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, message: `Password reset for ${name}` });
  } catch (err) { next(err); }
});

// ─── Specialty pricing ───────────────────────────────────────────────────────

router.get('/specialties', async (req, res, next) => {
  try {
    res.json(await specialtiesRepo.list());
  } catch (err) { next(err); }
});

router.put('/specialties', async (req, res, next) => {
  try {
    const { specialties } = req.body || {};
    if (!Array.isArray(specialties)) return res.status(400).json({ error: 'specialties array required' });
    await specialtiesRepo.updatePrices(specialties);
    res.json({ success: true, count: (await specialtiesRepo.list()).length });
  } catch (err) { next(err); }
});

router.put('/specialties/:id', async (req, res, next) => {
  try {
    const { price } = req.body || {};
    if (typeof price !== 'number' || price <= 0) return res.status(400).json({ error: 'Valid price required' });
    const spec = await specialtiesRepo.updatePrice(req.params.id, price);
    if (!spec) return res.status(404).json({ error: 'Specialty not found' });
    res.json({ success: true, specialty: spec });
  } catch (err) { next(err); }
});

// ─── Admin tickets (RECONSTRUCTED — medika-admin customer-care contract) ────

router.get('/tickets', async (req, res, next) => {
  try {
    let tickets = await ticketsRepo.listForUser({ role: 'admin', id: req.user.id });
    if (req.query.status && ['open', 'closed'].includes(String(req.query.status))) {
      tickets = tickets.filter((t) => t.status === String(req.query.status));
    }
    res.json({ tickets });
  } catch (err) { next(err); }
});

router.get('/tickets/:id', async (req, res, next) => {
  try {
    const found = await ticketsRepo.findWithMessages(req.params.id);
    if (!found) return res.status(404).json({ error: 'Not found' });
    res.json({
      ticket: ticketsRepo.ticketToApi(found.ticket, {
        withUserName: true,
        lastMessage: found.messages.length ? found.messages[found.messages.length - 1].content : '',
      }),
      messages: found.messages,
    });
  } catch (err) { next(err); }
});

router.post('/tickets/:id/messages', async (req, res, next) => {
  try {
    const ticket = await ticketsRepo.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    const body = req.body || {};
    const content = body.content ?? body.message ?? '';
    if (!content) return res.status(400).json({ error: 'Message requis' });
    const row = await ticketsRepo.addMessage({
      ticket_id: req.params.id,
      sender_role: 'admin',
      sender_id: req.user.id,
      sender_name: req.user.name || 'Support Medika',
      content: String(content),
    });
    res.status(201).json(ticketsRepo.msgToApi(row));
  } catch (err) { next(err); }
});

router.put('/tickets/:id/close', async (req, res, next) => {
  try {
    const t = await ticketsRepo.setStatus(req.params.id, 'closed');
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json(ticketsRepo.ticketToApi(t));
  } catch (err) { next(err); }
});

router.put('/tickets/:id/reopen', async (req, res, next) => {
  try {
    const t = await ticketsRepo.setStatus(req.params.id, 'open');
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json(ticketsRepo.ticketToApi(t));
  } catch (err) { next(err); }
});

module.exports = router;
