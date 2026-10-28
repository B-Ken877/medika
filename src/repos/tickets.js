/**
 * Support tickets repository — RECONSTRUCTED from client contracts.
 * (The production VPS implementation was never committed; shapes follow
 * TicketChatScreen.kt / TicketListScreen.kt / medika-admin customer-care pages
 * / medika-web endpoints.ts — see docs/VERCEL_MIGRATION_AUDIT.md §3.2.)
 *
 * Ticket list item: { id, subject, status, priority, created_at, updated_at,
 * user_name (admin view), last_message (string) }.
 * Ticket detail embeds messages[]: { id, sender_role, sender_id, sender_name,
 * content, file_url, file_type, file_size, created_at }.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');

function ticketToApi(row, { withUserName = false, lastMessage = undefined } = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    subject: row.subject,
    status: row.status,
    priority: row.priority ?? 'normal',
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
    updated_at: row.updated_at ? Math.floor(new Date(row.updated_at).getTime() / 1000) : null,
  };
  if (withUserName) out.user_name = row.user_name ?? '';
  if (lastMessage !== undefined) out.last_message = lastMessage;
  return out;
}

function msgToApi(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    sender_role: row.sender_role,
    sender_id: row.sender_id ?? null,
    sender_name: row.sender_name ?? '',
    content: row.content ?? '',
    file_url: row.file_url ?? null,
    file_type: row.file_type ?? null,
    file_size: row.file_size === null ? null : Number(row.file_size),
    created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
  };
}

async function create({ user_id, subject, priority }) {
  const id = 'ticket_' + uuidv4().substring(0, 8);
  const { rows } = await query(
    `INSERT INTO tickets (id, user_id, subject, priority) VALUES ($1,$2,$3,$4) RETURNING *`,
    [id, user_id, subject, priority || 'normal']
  );
  return rows[0];
}

/** Non-admin users see their own tickets; admins see everything (admin view adds user_name + last_message). */
async function listForUser(user) {
  if (user.role === 'admin') {
    const { rows } = await query(
      `SELECT t.*, u.name AS user_name,
              (SELECT content FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_message
       FROM tickets t LEFT JOIN users u ON u.id = t.user_id
       ORDER BY t.updated_at DESC`);
    return rows.map((r) => ticketToApi(r, { withUserName: true, lastMessage: r.last_message ?? '' }));
  }
  const { rows } = await query(
    `SELECT t.*, u.name AS user_name,
            (SELECT content FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_message
     FROM tickets t LEFT JOIN users u ON u.id = t.user_id
     WHERE t.user_id = $1
     ORDER BY t.updated_at DESC`,
    [user.id]);
  return rows.map((r) => ticketToApi(r, { lastMessage: r.last_message ?? '' }));
}

async function findById(id) {
  const { rows } = await query(
    `SELECT t.*, u.name AS user_name FROM tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = $1`,
    [id]);
  return rows[0] || null;
}

async function findWithMessages(id) {
  const ticket = await findById(id);
  if (!ticket) return null;
  const { rows } = await query(
    `SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY id ASC`, [id]);
  return { ticket, messages: rows.map(msgToApi) };
}

async function addMessage({ ticket_id, sender_role, sender_id, sender_name, content, file_url, file_type, file_size }) {
  const { rows } = await query(
    `INSERT INTO ticket_messages (ticket_id, sender_role, sender_id, sender_name, content, file_url, file_type, file_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [ticket_id, sender_role, sender_id ?? null, sender_name ?? '', content || '',
     file_url ?? null, file_type ?? null, file_size ?? null]
  );
  await query(`UPDATE tickets SET updated_at = now() WHERE id = $1`, [ticket_id]);
  return rows[0];
}

async function setStatus(id, status) {
  const { rows } = await query(
    `UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`, [id, status]);
  return rows[0] || null;
}

module.exports = { ticketToApi, msgToApi, create, listForUser, findById, findWithMessages, addMessage, setStatus };
