'use strict';

const express = require('express');
const crypto = require('crypto');
const { authenticateAdmin, hashPassword, newUserId } = require('../auth');
const { query } = require('../db');
const deliveries = require('../repos/deliveries');
const notifications = require('../notifications/emit');

const router = express.Router();
router.use(authenticateAdmin);

function haitiDate(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return parts.find((p) => p.type === 'year').value + '-' + parts.find((p) => p.type === 'month').value + '-' + parts.find((p) => p.type === 'day').value;
}

router.get('/delivery-employees', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, username, name, phone, is_available, created_at
         FROM users WHERE role = 'delivery' ORDER BY name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/delivery-employees', async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    if (!/^[a-z0-9._-]{3,40}$/.test(username) || name.length < 2 || name.length > 120 ||
        password.length < 12 || password.length > 200) {
      return res.status(400).json({ error: 'Nom, identifiant (3 à 40 caractères) et mot de passe sécurisé (12 caractères minimum) requis.' });
    }
    const id = newUserId('delivery');
    const { rows } = await query(
      `INSERT INTO users (id, username, password_hash, role, name, phone, is_available)
       VALUES ($1,$2,$3,'delivery',$4,$5,TRUE)
       ON CONFLICT (username) DO NOTHING
       RETURNING id, username, name, phone, is_available, created_at`,
      [id, username, hashPassword(password), name, phone.slice(0, 40)]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Cet identifiant est déjà utilisé.' });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/delivery-employees/:id/availability', async (req, res, next) => {
  try {
    if (typeof req.body?.is_available !== 'boolean') return res.status(400).json({ error: 'Statut de disponibilité invalide.' });
    const { rows } = await query(
      `UPDATE users SET is_available = $2 WHERE id = $1 AND role = 'delivery'
       RETURNING id, username, name, phone, is_available`,
      [req.params.id, req.body.is_available]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Livreur introuvable.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/delivery-zones', async (req, res, next) => {
  try { res.json(await deliveries.listZones()); } catch (err) { next(err); }
});

router.post('/delivery-zones', async (req, res, next) => {
  try {
    const result = await deliveries.upsertZone({
      id: req.body?.id, city: req.body?.city, zoneName: req.body?.zone_name, active: req.body?.active,
    });
    if (result.outcome !== 'UPDATED') return res.status(400).json({ error: 'Ville et zone sont obligatoires.' });
    res.status(201).json(result.zone);
  } catch (err) { next(err); }
});

router.get('/deliveries', async (req, res, next) => {
  try { res.json(await deliveries.listAll({ status: req.query.status })); } catch (err) { next(err); }
});

router.post('/deliveries/assign', async (req, res, next) => {
  try {
    const result = await deliveries.assignDelivery({
      orderId: req.body?.medication_order_id,
      employeeId: req.body?.employee_id,
      zoneId: req.body?.zone_id,
      scheduledFor: req.body?.scheduled_for,
      urgent: req.body?.urgent === true,
      urgentReason: req.body?.urgent_reason,
      admin: req.user,
    });
    const errors = {
      NOT_FOUND: [404, 'Commande introuvable.'],
      NOT_PAID: [409, 'La commande doit être payée et vérifiée avant toute affectation.'],
      INVALID_EMPLOYEE: [400, 'Compte de livreur invalide.'],
      INVALID_ZONE: [400, 'Zone de livraison inactive ou non correspondante à la commande.'],
      NO_ACTIVE_QUOTE: [409, 'Aucun devis confirmé pour cette commande.'],
      ALREADY_ASSIGNED: [409, 'Une livraison est déjà affectée à cette commande.'],
      INVALID_DATE: [400, 'Date de livraison invalide.'],
      FRIDAY_ONLY: [400, 'Les livraisons régulières sont planifiées le vendredi. Utilisez l’exception urgente si nécessaire.'],
      URGENT_REASON_REQUIRED: [400, 'Une justification est obligatoire pour une livraison urgente.'],
    };
    if (errors[result.outcome]) return res.status(errors[result.outcome][0]).json({ error: errors[result.outcome][1], code: result.outcome });
    const { rows } = await query('SELECT patient_id FROM medication_orders WHERE id = $1', [req.body.medication_order_id]);
    if (rows[0]?.patient_id) {
      notifications.emit({
        userId: rows[0].patient_id,
        eventType: 'medication:delivery-assigned',
        idempotencyKey: 'delivery:' + result.id + ':assigned',
        title: 'Medika',
        body: req.body.urgent === true
          ? 'Votre livraison prioritaire a été planifiée.'
          : 'Votre livraison est planifiée pour vendredi.',
        url: '/app/consultations',
      });
    }
    res.status(201).json({ success: true, delivery_id: result.id });
  } catch (err) { next(err); }
});

router.post('/deliveries/:id/expenses', async (req, res, next) => {
  try {
    const amount = req.body?.amount_htg;
    if (!Number.isSafeInteger(amount) || amount < 0) return res.status(400).json({ error: 'Montant de dépense invalide.' });
    const result = await deliveries.recordExpense({
      deliveryId: req.params.id, amount, category: req.body?.category,
      notes: req.body?.notes, admin: req.user,
    });
    if (result.outcome === 'NOT_FOUND') return res.status(404).json({ error: 'Livraison introuvable.' });
    res.status(201).json({ success: true, expense: result.expense });
  } catch (err) { next(err); }
});

router.get('/delivery-reports', async (req, res, next) => {
  try {
    const now = new Date();
    const today = haitiDate(now);
    const from = String(req.query.from || today.slice(0, 7) + '-01');
    const to = String(req.query.to || today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return res.status(400).json({ error: 'Période de rapport invalide.' });
    }
    res.json(await deliveries.report({ from, to }));
  } catch (err) { next(err); }
});

router.put('/delivery-budget', async (req, res, next) => {
  try {
    const result = await deliveries.setBudget({
      monthlyBudget: req.body?.monthly_budget_htg,
      thresholdPercent: req.body?.alert_threshold_percent,
      admin: req.user,
    });
    if (result.outcome !== 'UPDATED') return res.status(400).json({ error: 'Budget ou seuil d’alerte invalide.' });
    res.json(result.budget);
  } catch (err) { next(err); }
});

module.exports = router;
