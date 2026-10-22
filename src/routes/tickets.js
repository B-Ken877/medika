/**
 * Support ticket routes (RECONSTRUCTED endpoints — audit §3.2).
 *
 * Client contract notes:
 *  - Android sends POST body {content, file_url, file_type, file_size};
 *    the web PWA sends {message} — both are accepted (audit M6);
 *  - GET /api/tickets/:id embeds messages[] (Android + web read it there);
 *  - closed tickets refuse new messages (matches the Android UI copy).
 */
'use strict';

const express = require('express');
const ticketsRepo = require('../repos/tickets');
const { authenticate } = require('../auth');
const { badRequest, notFound, conflict } = require('../errors');

const router = express.Router();

function ownTicket(user, ticket) {
  return user.role === 'admin' || ticket.user_id === user.id;
}

router.get('/tickets', authenticate, async (req, res, next) => {
  try {
    res.json(await ticketsRepo.listForUser(req.user));
  } catch (err) { next(err); }
});

router.post('/tickets', authenticate, async (req, res, next) => {
  try {
    const { subject, message, priority } = req.body || {};
    if (!subject || !String(subject).trim()) {
      return res.status(400).json({ error: 'Sujet requis' });
    }
    const ticket = await ticketsRepo.create({
      user_id: req.user.id,
      subject: String(subject).trim(),
      priority: priority ? String(priority) : 'normal',
    });
    if (message && String(message).trim()) {
      await ticketsRepo.addMessage({
        ticket_id: ticket.id,
        sender_role: 'user',
        sender_id: req.user.id,
        sender_name: req.user.name,
        content: String(message).trim(),
      });
    }
    const out = ticketsRepo.ticketToApi(ticket, { lastMessage: message ? String(message) : '' });
    res.status(201).json(out);
  } catch (err) { next(err); }
});

router.get('/tickets/:id', authenticate, async (req, res, next) => {
  try {
    const found = await ticketsRepo.findWithMessages(req.params.id);
    if (!found || !ownTicket(req.user, found.ticket)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const out = ticketsRepo.ticketToApi(found.ticket, {
      withUserName: req.user.role === 'admin',
      lastMessage: found.messages.length ? found.messages[found.messages.length - 1].content : '',
    });
    out.messages = found.messages;
    res.json(out);
  } catch (err) { next(err); }
});

router.post('/tickets/:id/messages', authenticate, async (req, res, next) => {
  try {
    const ticket = await ticketsRepo.findById(req.params.id);
    if (!ticket || !ownTicket(req.user, ticket)) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (ticket.status === 'closed') {
      return res.status(409).json({ error: 'Ce ticket est ferme. Vous ne pouvez plus envoyer de messages.' });
    }
    const body = req.body || {};
    const content = body.content ?? body.message ?? '';
    if (!content && !body.file_url) {
      return res.status(400).json({ error: 'Message requis' });
    }
    const row = await ticketsRepo.addMessage({
      ticket_id: req.params.id,
      sender_role: 'user',
      sender_id: req.user.id,
      sender_name: req.user.name,
      content: String(content || ''),
      file_url: body.file_url ?? null,
      file_type: body.file_type ?? null,
      file_size: body.file_size ?? null,
    });
    res.status(201).json(ticketsRepo.msgToApi(row));
  } catch (err) { next(err); }
});

module.exports = router;
