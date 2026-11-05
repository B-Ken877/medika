'use strict';

/**
 * Delivery operations repository (issue #82 — delivery scope).
 *
 * Integrated and adapted from the unmerged reference PR #95 (audit fixes:
 * syntax error in setBudget's parameter array, server-side day-of-week
 * validation kept in Haiti's timezone, delivery API never leaks clinical
 * data, all mutations row-locked and idempotent).
 *
 * Invariants:
 *  - Only PAID (server-verified payment) medication orders can be assigned.
 *  - Regular deliveries are scheduled on Fridays (America/Port-au-Prince);
 *    any other date requires urgent=true AND a reason (>= 8 chars), recorded
 *    in the audit event.
 *  - Employee transitions are restricted to the custody state machine and
 *    each submission carries a unique Idempotency-Key (duplicates are no-ops).
 *  - DELIVERED requires the patient's own confirmation — never a driver tap.
 *  - Delivery employees see ONLY their own deliveries, enforced in SQL.
 */

const crypto = require('crypto');
const { query, withTransaction } = require('../db');

function normalizeZone(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
}

// Custody state machine: status -> allowed next employee-submitted events.
// AWAITING_CONFIRMATION / DELIVERED / RETURNED_ESCALATED are terminal for
// employees; only the patient confirmation moves AWAITING_CONFIRMATION ->
// DELIVERED (confirmByPatient).
const EMPLOYEE_EVENTS = {
  ASSIGNED: ['PHARMACY_PREPARING'],
  PHARMACY_PREPARING: ['READY_FOR_PICKUP'],
  READY_FOR_PICKUP: ['PICKED_UP'],
  PICKED_UP: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['AWAITING_CONFIRMATION', 'FAILED_ATTEMPT'],
  FAILED_ATTEMPT: ['OUT_FOR_DELIVERY', 'RETURNED_ESCALATED'],
};

function haitiToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Strict YYYY-MM-DD calendar date (no JS Date timezone drift): reject
// malformed input and past dates outright.
function validScheduledDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const d = new Date(String(value) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== String(value)) return false;
  return String(value) >= haitiToday();
}

// Friday check on the calendar date itself (weekday of YYYY-MM-DD at 12:00
// UTC is stable regardless of timezone — midday never crosses a day boundary).
function isFriday(dateStr) {
  return new Date(String(dateStr) + 'T12:00:00Z').getUTCDay() === 5;
}

function deliveryApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    medication_order_id: row.medication_order_id,
    reference: row.order_reference,
    patient_name: row.patient_name,
    delivery_address: row.delivery_address,
    delivery_phone: row.delivery_phone,
    delivery_zone: row.zone_name,
    city: row.city,
    pickup_pharmacy_name: row.pickup_pharmacy_name,
    pickup_reference: row.pickup_reference,
    assigned_employee_id: row.assigned_to,
    scheduled_for: row.scheduled_for,
    urgent: Boolean(row.urgent),
    status: row.status,
    created_at: row.created_at,
    delivered_at: row.delivered_at,
  };
}

async function addEvent(client, { deliveryId, type, actor, reason, idempotencyKey }) {
  const { rows } = await client.query(
    `INSERT INTO medication_delivery_events
      (delivery_id, event_type, actor_id, actor_name, actor_role, reason, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [deliveryId, type, actor.id, actor.name || '', actor.role,
      String(reason || '').trim().slice(0, 500), idempotencyKey]
  );
  return rows.length > 0;
}

async function assignDelivery({ orderId, employeeId, zoneId, scheduledFor, urgent, urgentReason, admin }) {
  if (!validScheduledDate(scheduledFor)) return { outcome: 'INVALID_DATE' };
  const isUrgent = urgent === true;
  if (!isUrgent && !isFriday(scheduledFor)) return { outcome: 'FRIDAY_ONLY' };
  if (isUrgent && String(urgentReason || '').trim().length < 8) return { outcome: 'URGENT_REASON_REQUIRED' };

  return withTransaction(async (client) => {
    const { rows: orders } = await client.query(
      'SELECT * FROM medication_orders WHERE id = $1 FOR UPDATE', [orderId]
    );
    const order = orders[0];
    if (!order) return { outcome: 'NOT_FOUND' };
    if (order.status !== 'PAID') return { outcome: 'NOT_PAID', status: order.status };

    const { rows: employees } = await client.query(
      `SELECT id, name FROM users WHERE id = $1 AND role = 'delivery' AND is_available = TRUE`,
      [employeeId]
    );
    if (!employees[0]) return { outcome: 'INVALID_EMPLOYEE' };

    const { rows: zones } = await client.query(
      'SELECT * FROM delivery_zones WHERE id = $1 AND active = TRUE', [zoneId]
    );
    const zone = zones[0];
    if (!zone) return { outcome: 'INVALID_ZONE' };
    // Orders created by the consolidated flow are bound to the EXACT zone
    // record (delivery_zone_id). Legacy rows (pre-013) only carry the
    // free-text zone name + city — match those by normalized name/city.
    const zoneMatches = order.delivery_zone_id
      ? order.delivery_zone_id === zone.id
      : zone.city === (order.delivery_city || zone.city) &&
        normalizeZone(zone.zone_name) === normalizeZone(order.delivery_zone);
    if (!zoneMatches || zone.city !== (order.delivery_city || zone.city)) {
      return { outcome: 'INVALID_ZONE' };
    }

    const { rows: quotes } = await client.query(
      `SELECT pharmacy_name FROM pharmacy_quotes WHERE order_id = $1 AND superseded_at IS NULL
       ORDER BY confirmed_at DESC LIMIT 1`, [orderId]
    );
    if (!quotes[0]) return { outcome: 'NO_ACTIVE_QUOTE' };

    const { rows: existing } = await client.query(
      'SELECT id FROM medication_deliveries WHERE medication_order_id = $1 FOR UPDATE', [orderId]
    );
    if (existing[0]) return { outcome: 'ALREADY_ASSIGNED', id: existing[0].id };

    const id = 'DL_' + crypto.randomUUID();
    await client.query(
      `INSERT INTO medication_deliveries
        (id, medication_order_id, assigned_to, zone_id, scheduled_for, urgent,
         urgent_reason, pickup_pharmacy_name, pickup_reference, created_by)
       VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10)`,
      [id, orderId, employeeId, zoneId, scheduledFor, isUrgent,
        String(urgentReason || '').trim().slice(0, 500), quotes[0].pharmacy_name,
        order.reference, admin.id]
    );
    await addEvent(client, {
      deliveryId: id, type: 'ASSIGNED',
      actor: { id: admin.id, name: admin.name, role: 'admin' },
      reason: isUrgent ? String(urgentReason).trim() : 'Livraison planifiée pour vendredi.',
      idempotencyKey: 'delivery:' + id + ':assigned',
    });
    return { outcome: 'ASSIGNED', id, employee: employees[0] };
  });
}

const DELIVERY_SELECT = `
  SELECT d.*, o.reference AS order_reference, o.patient_name, o.delivery_address,
         o.delivery_phone, z.city, z.zone_name
    FROM medication_deliveries d
    JOIN medication_orders o ON o.id = d.medication_order_id
    JOIN delivery_zones z ON z.id = d.zone_id
`;

async function listForEmployee(employeeId) {
  const { rows } = await query(
    DELIVERY_SELECT + ' WHERE d.assigned_to = $1 ORDER BY d.scheduled_for, d.created_at',
    [employeeId]
  );
  return rows.map(deliveryApi);
}

async function listAll({ status } = {}) {
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = ' WHERE d.status = $1';
  }
  const { rows } = await query(
    DELIVERY_SELECT + where + ' ORDER BY d.scheduled_for, d.created_at', params
  );
  return rows.map(deliveryApi);
}

async function transition({ deliveryId, employeeId, employeeName, eventType, reason, idempotencyKey }) {
  const knownTarget = Object.values(EMPLOYEE_EVENTS).some((events) => events.includes(eventType));
  if (!knownTarget) return { outcome: 'INVALID_EVENT' };
  const key = String(idempotencyKey || '');
  if (key.length < 8 || key.length > 120) return { outcome: 'INVALID_IDEMPOTENCY_KEY' };

  return withTransaction(async (client) => {
    // Assigned-employee isolation is enforced HERE, in the query — an
    // unassigned employee gets NOT_FOUND, never the delivery.
    const { rows } = await client.query(
      `SELECT d.* FROM medication_deliveries d
        WHERE d.id = $1 AND d.assigned_to = $2 FOR UPDATE`,
      [deliveryId, employeeId]
    );
    const delivery = rows[0];
    if (!delivery) return { outcome: 'NOT_FOUND' };

    const { rows: prior } = await client.query(
      'SELECT event_type FROM medication_delivery_events WHERE idempotency_key = $1',
      [key]
    );
    if (prior[0]) return { outcome: 'DUPLICATE', status: delivery.status };

    const allowed = EMPLOYEE_EVENTS[delivery.status] || [];
    if (!allowed.includes(eventType)) return { outcome: 'INVALID_TRANSITION', status: delivery.status };
    if (['FAILED_ATTEMPT', 'RETURNED_ESCALATED'].includes(eventType) &&
        String(reason || '').trim().length < 5) {
      return { outcome: 'FAILURE_REASON_REQUIRED' };
    }

    await client.query(
      'UPDATE medication_deliveries SET status = $2, updated_at = now() WHERE id = $1',
      [deliveryId, eventType]
    );
    await addEvent(client, {
      deliveryId, type: eventType,
      actor: { id: employeeId, name: employeeName || '', role: 'delivery' },
      reason,
      idempotencyKey: key,
    });
    return { outcome: 'UPDATED', status: eventType };
  });
}

async function trackingForPatient(orderId, patientId) {
  const { rows } = await query(
    DELIVERY_SELECT + ' WHERE d.medication_order_id = $1 AND o.patient_id = $2',
    [orderId, patientId]
  );
  if (!rows[0]) return null;
  const delivery = deliveryApi(rows[0]);
  const { rows: events } = await query(
    `SELECT event_type, actor_role, reason, created_at FROM medication_delivery_events
      WHERE delivery_id = $1 ORDER BY created_at ASC`, [delivery.id]
  );
  return { ...delivery, events };
}

async function confirmByPatient({ orderId, patientId }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT d.* FROM medication_deliveries d
        JOIN medication_orders o ON o.id = d.medication_order_id
        WHERE d.medication_order_id = $1 AND o.patient_id = $2 FOR UPDATE OF d`,
      [orderId, patientId]
    );
    const delivery = rows[0];
    if (!delivery) return { outcome: 'NOT_FOUND' };
    if (delivery.status === 'DELIVERED') return { outcome: 'DELIVERED' };
    if (delivery.status !== 'AWAITING_CONFIRMATION') {
      return { outcome: 'INVALID_TRANSITION', status: delivery.status };
    }
    await client.query(
      `UPDATE medication_deliveries SET status = 'DELIVERED', delivered_at = now(), updated_at = now()
        WHERE id = $1`, [delivery.id]
    );
    await addEvent(client, {
      deliveryId: delivery.id, type: 'DELIVERED',
      actor: { id: patientId, name: 'Patient', role: 'patient' },
      reason: 'Réception confirmée par le patient.',
      idempotencyKey: 'delivery:' + delivery.id + ':patient-confirmed',
    });
    return { outcome: 'DELIVERED' };
  });
}

async function recordExpense({ deliveryId, amount, category, notes, admin }) {
  if (!Number.isSafeInteger(amount) || amount < 0) return { outcome: 'INVALID_AMOUNT' };
  const { rows: deliveries } = await query(
    'SELECT id FROM medication_deliveries WHERE id = $1', [deliveryId]
  );
  if (!deliveries[0]) return { outcome: 'NOT_FOUND' };
  const { rows } = await query(
    `INSERT INTO medication_delivery_expenses
      (delivery_id, amount_htg, category, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [deliveryId, amount, String(category || 'DELIVERY').trim().slice(0, 40) || 'DELIVERY',
      String(notes || '').trim().slice(0, 500), admin.id]
  );
  return { outcome: 'RECORDED', expense: rows[0] };
}

// Report boundaries are explicit Haiti-local calendar days (offset applied in
// SQL), so weekly/monthly groupings are stable and tested.
async function report({ from, to }) {
  const { rows: totals } = await query(
    `SELECT COUNT(DISTINCT d.id)::int AS deliveries,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'DELIVERED')::int AS delivered,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status IN ('FAILED_ATTEMPT','RETURNED_ESCALATED'))::int AS failed,
            COALESCE(SUM(e.amount_htg),0)::int AS expense_htg
       FROM medication_deliveries d
       LEFT JOIN medication_delivery_expenses e ON e.delivery_id = d.id
      WHERE d.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Port-au-Prince')
        AND d.created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'America/Port-au-Prince')`,
    [from, to]
  );
  const row = totals[0];

  const { rows: budgetRows } = await query(
    `SELECT monthly_budget_htg, alert_threshold_percent FROM medication_delivery_budgets
      WHERE id = 'DEFAULT'`
  );
  const budget = budgetRows[0] || null;

  const today = haitiToday();
  const monthStart = today.slice(0, 7) + '-01';
  const { rows: budgetUsageRows } = await query(
    `SELECT COALESCE(SUM(amount_htg),0)::int AS current_month_expense_htg
       FROM medication_delivery_expenses
      WHERE created_at >= ($1::date::timestamp AT TIME ZONE 'America/Port-au-Prince')
        AND created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'America/Port-au-Prince')`,
    [monthStart, today]
  );
  const currentMonthExpense = budgetUsageRows[0]?.current_month_expense_htg || 0;

  const successful = row.delivered || 0;
  const rangeParams = [from, to];
  const { rows: weekly } = await query(
    `SELECT date_trunc('week', d.created_at AT TIME ZONE 'America/Port-au-Prince')::date AS period,
            COUNT(DISTINCT d.id)::int AS deliveries,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'DELIVERED')::int AS delivered,
            COALESCE(SUM(e.amount_htg),0)::int AS expense_htg
       FROM medication_deliveries d LEFT JOIN medication_delivery_expenses e ON e.delivery_id = d.id
      WHERE d.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Port-au-Prince')
        AND d.created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'America/Port-au-Prince')
      GROUP BY 1 ORDER BY period`, rangeParams
  );
  const { rows: monthly } = await query(
    `SELECT date_trunc('month', d.created_at AT TIME ZONE 'America/Port-au-Prince')::date AS period,
            COUNT(DISTINCT d.id)::int AS deliveries,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'DELIVERED')::int AS delivered,
            COALESCE(SUM(e.amount_htg),0)::int AS expense_htg
       FROM medication_deliveries d LEFT JOIN medication_delivery_expenses e ON e.delivery_id = d.id
      WHERE d.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Port-au-Prince')
        AND d.created_at < (($2::date + interval '1 day')::timestamp AT TIME ZONE 'America/Port-au-Prince')
      GROUP BY 1 ORDER BY period`, rangeParams
  );

  return {
    ...row,
    cost_per_successful_delivery_htg: successful > 0 ? Math.round(row.expense_htg / successful) : null,
    budget,
    current_month_expense_htg: currentMonthExpense,
    budget_alert: Boolean(budget &&
      currentMonthExpense >= Math.round(budget.monthly_budget_htg * budget.alert_threshold_percent / 100)),
    weekly,
    monthly,
  };
}

async function setBudget({ monthlyBudget, thresholdPercent, admin }) {
  if (!Number.isSafeInteger(monthlyBudget) || monthlyBudget < 0 ||
      !Number.isInteger(thresholdPercent) || thresholdPercent < 1 || thresholdPercent > 100) {
    return { outcome: 'INVALID_BUDGET' };
  }
  const { rows } = await query(
    `INSERT INTO medication_delivery_budgets
      (id, monthly_budget_htg, alert_threshold_percent, updated_by)
     VALUES ('DEFAULT',$1,$2,$3)
     ON CONFLICT (id) DO UPDATE SET monthly_budget_htg = EXCLUDED.monthly_budget_htg,
       alert_threshold_percent = EXCLUDED.alert_threshold_percent,
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [monthlyBudget, thresholdPercent, admin.id]
  );
  return { outcome: 'UPDATED', budget: rows[0] };
}

async function listZones() {
  const { rows } = await query('SELECT * FROM delivery_zones ORDER BY city, zone_name');
  return rows;
}

async function upsertZone({ id, city, zoneName, active }) {
  const cleanCity = String(city || '').trim().slice(0, 100);
  const cleanZone = String(zoneName || '').trim().slice(0, 100);
  if (!cleanCity || !cleanZone) return { outcome: 'INVALID_ZONE' };
  const zoneId = id || 'ZONE_' + crypto.randomUUID();
  const { rows } = await query(
    `INSERT INTO delivery_zones (id, city, zone_name, active)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (city, zone_name) DO UPDATE SET active = EXCLUDED.active, updated_at = now()
     RETURNING *`,
    [zoneId, cleanCity, cleanZone, active !== false]
  );
  return { outcome: 'UPDATED', zone: rows[0] };
}

module.exports = {
  assignDelivery,
  listForEmployee,
  listAll,
  transition,
  trackingForPatient,
  confirmByPatient,
  recordExpense,
  report,
  setBudget,
  listZones,
  upsertZone,
};
