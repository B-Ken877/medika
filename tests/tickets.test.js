/**
 * Support ticket tests (RECONSTRUCTED endpoints — audit §3.2):
 * patient create/list/detail/message, Android {content} AND web {message}
 * bodies, closed-ticket behavior, admin list/detail/reply/close/reopen,
 * and isolation between patients.
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.patient2 = await h.loginToken(r, 't.patient2');
  token.admin = await h.loginToken(r, 't.admin');
});

afterAll(async () => {
  await h.closeAll();
});

describe('patient ticket flow', () => {
  let ticketId;

  it('creates a ticket with an initial message', async () => {
    const res = await r.post('/api/tickets')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ subject: 'Probleme de paiement', message: 'Mon paiement a echoue' });
    expect(res.status).toBe(201);
    expect(res.body.subject).toBe('Probleme de paiement');
    expect(res.body.status).toBe('open');
    expect(res.body.id).toMatch(/^ticket_/);
    ticketId = res.body.id;
  });

  it('lists own tickets with last_message', async () => {
    const res = await r.get('/api/tickets').set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    const mine = res.body.find((t) => t.id === ticketId);
    expect(mine.last_message).toBe('Mon paiement a echoue');
  });

  it('detail embeds messages[] (Android reads them there)', async () => {
    const res = await r.get(`/api/tickets/${ticketId}`).set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toMatchObject({
      sender_role: 'user',
      content: 'Mon paiement a echoue',
      sender_name: 'Pat Test',
    });
    expect(typeof res.body.messages[0].id).toBe('number');
  });

  it('accepts the Android {content} body shape', async () => {
    const res = await r.post(`/api/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ content: 'Voici une capture', file_url: '/uploads/x.png', file_type: 'image/png', file_size: 123 });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe('Voici une capture');
    expect(res.body.file_url).toBe('/uploads/x.png');
  });

  it('accepts the web {message} body shape too', async () => {
    const res = await r.post(`/api/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ message: 'Message depuis le web' });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe('Message depuis le web');
  });

  it('isolates tickets between patients', async () => {
    const res = await r.get(`/api/tickets/${ticketId}`).set('Authorization', `Bearer ${token.patient2}`);
    expect(res.status).toBe(404);
  });
});

describe('admin ticket flow (medika-admin customer-care contract)', () => {
  let ticketId;

  beforeAll(async () => {
    const res = await r.post('/api/tickets')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ subject: 'Question dossier' });
    ticketId = res.body.id;
  });

  it('GET /api/admin/tickets returns { tickets: [...] } with user_name', async () => {
    const res = await r.get('/api/admin/tickets').set('Authorization', `Bearer ${token.admin}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tickets)).toBe(true);
    const t = res.body.tickets.find((x) => x.id === ticketId);
    expect(t.user_name).toBe('Pat Deux');
    expect(t.status).toBe('open');
  });

  it('filters by ?status=', async () => {
    const res = await r.get('/api/admin/tickets').query({ status: 'open' }).set('Authorization', `Bearer ${token.admin}`);
    expect(res.body.tickets.every((t) => t.status === 'open')).toBe(true);
  });

  it('detail returns { ticket, messages }', async () => {
    const res = await r.get(`/api/admin/tickets/${ticketId}`).set('Authorization', `Bearer ${token.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.ticket.id).toBe(ticketId);
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it('admin replies with { content }', async () => {
    const res = await r.post(`/api/admin/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ content: 'Bonjour, nous regardons votre dossier.' });
    expect(res.status).toBe(201);
    expect(res.body.sender_role).toBe('admin');
    expect(res.body.sender_name).toBe('Admin Test');
  });

  it('close → patient message rejected (409) → reopen → allowed again', async () => {
    const close = await r.put(`/api/admin/tickets/${ticketId}/close`).set('Authorization', `Bearer ${token.admin}`);
    expect(close.status).toBe(200);
    expect(close.body.status).toBe('closed');

    const blocked = await r.post(`/api/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ content: 'encore un message' });
    expect(blocked.status).toBe(409);

    const reopen = await r.put(`/api/admin/tickets/${ticketId}/reopen`).set('Authorization', `Bearer ${token.admin}`);
    expect(reopen.status).toBe(200);
    expect(reopen.body.status).toBe('open');

    const ok = await r.post(`/api/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({ content: 'merci!' });
    expect(ok.status).toBe(201);
  });

  it('non-admins are blocked from admin ticket endpoints', async () => {
    const res = await r.get('/api/admin/tickets').set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(403);
  });
});
