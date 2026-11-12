/**
 * Read-aware active-conversation push suppression (owner request, Nov 2026).
 *
 * The OLD rule — "recipient has ANY WebSocket connection → no push" — is
 * gone. The new rule, per the spec matrix:
 *
 *   recipient state                                    → push?
 *   in the EXACT conversation + message READ           → no
 *   in the EXACT conversation + message still UNREAD   → yes (grace expiry)
 *   online but browsing another page                   → yes
 *   viewing a DIFFERENT consultation                   → yes
 *   offline                                            → yes
 *   multiple tabs, one reading the exact conversation  → no (one read suppresses)
 *
 * Core invariant under test: LIVE DELIVERY ALONE NEVER SUPPRESSES — only a
 * server-side read receipt does. Unread messages are never silently lost:
 * grace rows dispatch when the window expires. Medication/payment/delivery/
 * consultation lifecycle events are NEVER suppressed by connectivity or
 * viewing state (message-only feature).
 *
 * The hub is the real one from server.js (module.exports.hub); sockets are
 * in-memory stubs registered directly — the per-connection viewing state is
 * exactly what the server tracks for real clients that sent the
 * `consultation:viewing` frame.
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';
// VAPID pair generated for CI use only (same pair as notifications.test.js).
process.env.VAPID_PUBLIC_KEY = 'BGY3TmF6Yf1mZTKqkCJ0pXG0vXEEoSTq7FVGGhVQ7lHSSsqQ8adlWgfZqcv-OH2FQ6XlOYMfKKSZhUJfh6S-gxE';
process.env.VAPID_PRIVATE_KEY = 'SfK9aVd4Wk2Hq8mNpC3xT7yLbE5rU1jZ6cX0oIgDfAw';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
const h = await import('./helpers');

let r, server, hub, users, token = {}, db;

const WS_OPEN = 1; // WebSocket.OPEN ('ws' package)
let stubSeq = 0;

/** A live connection for `userId`. `viewing` seeds the per-connection
 *  active-consultation state exactly like the consultation:viewing frame. */
function connectStub(userId, viewing = null) {
  stubSeq += 1;
  const ws = {
    readyState: WS_OPEN,
    send: vi.fn(),
    __connId: `stub-${stubSeq}`,
    isAlive: true,
  };
  hub.register(userId, ws);
  if (viewing) ws.activeConsultationId = String(viewing);
  return ws;
}

async function outboxRow(userId, key) {
  const { rows } = await db.query(
    `SELECT * FROM notification_outbox WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, key]
  );
  return rows[0] ?? null;
}

async function forceDue(userId) {
  await db.query(
    `UPDATE notification_outbox SET next_attempt_at = now() - interval '1 second'
      WHERE user_id = $1 AND status IN ('queued', 'retryable')`,
    [userId]
  );
}

const nextAttemptIn = (row) => new Date(row.next_attempt_at).getTime() - Date.now();

beforeAll(async () => {
  ({ request: r, server } = await h.setup());
  hub = server.hub;
  expect(hub).toBeTruthy();
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.patient2 = await h.loginToken(r, 't.patient2');
  token.doctor = await h.loginToken(r, 't.doctor');
  db = await import('../src/db.js').then((m) => m.default ?? m);
});

afterAll(async () => {
  await h.closeAll();
});

afterEach(() => {
  // Detach every stub socket so tests never leak connectivity into each other.
  for (const [userId, set] of [...hub.sockets]) {
    for (const ws of [...set]) hub.unregister(userId, ws);
  }
  hub.viewingRemote.clear();
  vi.restoreAllMocks();
});

describe('chat push suppression matrix', () => {
  let consId; // EN_COURS consultation patient_t1 ↔ doctor_t1

  beforeAll(async () => {
    const created = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({
        description: ' suppression fixture', specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne', doctorId: users.doctor.id,
      });
    expect(created.status).toBe(201);
    consId = created.body.id;
    const accepted = await r.put(`/api/consultations/${consId}/accept`)
      .set('Authorization', `Bearer ${token.doctor}`);
    expect(accepted.status).toBe(200);
  });

  it('OFFLINE recipient → immediate, push-eligible row', async () => {
    const msg = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'offline case', messageType: 'text' });
    expect(msg.status).toBe(201);
    const row = await outboxRow(users.doctor.id, `message:${msg.body.id}`);
    expect(row).toBeTruthy();
    expect(row.status).toBe('queued');
    expect(nextAttemptIn(row)).toBeLessThan(2000); // due NOW
  });

  it('ONLINE but browsing ANOTHER PAGE (no viewing state) → immediate row (old rule removed)', async () => {
    connectStub(users.doctor.id, null); // connected, viewing nothing
    const msg = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'online elsewhere', messageType: 'text' });
    const row = await outboxRow(users.doctor.id, `message:${msg.body.id}`);
    expect(row.status).toBe('queued');
    expect(nextAttemptIn(row)).toBeLessThan(2000);
  });

  it('viewing a DIFFERENT consultation → immediate row', async () => {
    connectStub(users.doctor.id, 'cons_some_other');
    const msg = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'other consult', messageType: 'text' });
    const row = await outboxRow(users.doctor.id, `message:${msg.body.id}`);
    expect(row.status).toBe('queued');
    expect(nextAttemptIn(row)).toBeLessThan(2000);
  });

  it('viewing the EXACT conversation → GRACE row (suppressed only by a read)', async () => {
    connectStub(users.doctor.id, consId);
    const msg = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'viewing exact', messageType: 'text' });
    const row = await outboxRow(users.doctor.id, `message:${msg.body.id}`);
    expect(row.status).toBe('queued'); // NOT suppressed at emit time
    expect(nextAttemptIn(row)).toBeGreaterThan(20_000); // inside the grace window
    // The dispatcher must NOT claim a row whose grace window has not expired.
    const dispatch = await import('../src/notifications/dispatch.js').then((m) => m.default ?? m);
    await dispatch.dispatchDueNotifications({ limit: 50 });
    const stillQueued = await outboxRow(users.doctor.id, `message:${msg.body.id}`);
    expect(stillQueued.status).toBe('queued');
  });

  it('viewing exact + READ RECEIPT → row suppressed (the core rule)', async () => {
    connectStub(users.doctor.id, consId);
    const msg = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'read in conversation', messageType: 'text' });
    expect(msg.status).toBe(201);
    const read = await r.post(`/api/consultations/${consId}/read`)
      .set('Authorization', `Bearer ${token.doctor}`);
    expect(read.status).toBe(200);
    expect(read.body.messageIds).toContain(msg.body.id);

    const row = await outboxRow(users.doctor.id, `message:${msg.body.id}`);
    expect(row.status).toBe('suppressed');
    expect(row.last_error_code).toBe('read_in_conversation');
  });

  it('viewing exact + NO read (grace expires) → message is NOT lost: dispatch delivers it', async () => {
    connectStub(users.doctor.id, consId);
    const msg = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'grace expiry unread', messageType: 'text' });
    const key = `message:${msg.body.id}`;
    expect((await outboxRow(users.doctor.id, key)).status).toBe('queued');

    const webpush = (await import('web-push')).default ?? (await import('web-push'));
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201 });
    await subscribeDoctor();
    await forceDue(users.doctor.id);
    const dispatch = await import('../src/notifications/dispatch.js').then((m) => m.default ?? m);
    const counts = await dispatch.dispatchDueNotifications({ limit: 50 });
    expect(counts.delivered).toBeGreaterThan(0);
    expect(send).toHaveBeenCalled();
    const row = await outboxRow(users.doctor.id, key);
    expect(row.status).toBe('delivered');
  });

  it('MULTIPLE TABS: one tab viewing the exact conversation, other not → one read suppresses for all', async () => {
    connectStub(users.doctor.id, consId); // tab A: inside the conversation
    connectStub(users.doctor.id, null);   // tab B: same account, elsewhere
    const msg = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'multi tab', messageType: 'text' });
    const row = await outboxRow(users.doctor.id, `message:${msg.body.id}`);
    expect(nextAttemptIn(row)).toBeGreaterThan(20_000); // any viewing tab arms the grace
    await r.post(`/api/consultations/${consId}/read`)
      .set('Authorization', `Bearer ${token.doctor}`);
    const suppressed = await outboxRow(users.doctor.id, `message:${msg.body.id}`);
    expect(suppressed.status).toBe('suppressed');
    expect(suppressed.last_error_code).toBe('read_in_conversation');
  });

  it('SWITCHING conversations updates tracking (server-side, membership-validated)', async () => {
    const ws = connectStub(users.doctor.id, null);
    // Doctor announces viewing THIS consultation (frame path, validated).
    await hub.handleConsultationViewing(
      { id: users.doctor.id }, { consultationId: consId }, ws
    );
    expect(ws.activeConsultationId).toBe(String(consId));
    expect(hub.isUserViewingConsultation(users.doctor.id, consId)).toBe(true);

    // A consultation the doctor is NOT a participant of must be REJECTED
    // silently (no existence leak, no state change). patient2 owns it —
    // issue #60 forbids a second active consultation for patient_t1.
    const stranger = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient2}`)
      .send({
        description: 'private consult', specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne',
      });
    expect(stranger.status).toBe(201);
    const strangerId = stranger.body.id;
    await hub.handleConsultationViewing(
      { id: users.doctor.id }, { consultationId: strangerId }, ws
    );
    expect(hub.isUserViewingConsultation(users.doctor.id, strangerId)).toBe(false);
    expect(hub.isUserViewingConsultation(users.doctor.id, consId)).toBe(true); // unchanged

    // A fabricated consultation id is equally rejected (no state change).
    await hub.handleConsultationViewing(
      { id: users.doctor.id }, { consultationId: 'cons_fabricated' }, ws
    );
    expect(hub.isUserViewingConsultation(users.doctor.id, consId)).toBe(true);

    // Leaving (null) clears it.
    await hub.handleConsultationViewing({ id: users.doctor.id }, { consultationId: null }, ws);
    expect(hub.isUserViewingConsultation(users.doctor.id, consId)).toBe(false);
    expect(ws.activeConsultationId).toBeNull();
  });

  it('DISCONNECT removes viewing state → subsequent messages push immediately (nothing silently lost)', async () => {
    const ws = connectStub(users.doctor.id, consId);
    expect(hub.isUserViewingConsultation(users.doctor.id, consId)).toBe(true);
    hub.unregister(users.doctor.id, ws);
    expect(hub.isUserViewingConsultation(users.doctor.id, consId)).toBe(false);

    const msg = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'after disconnect', messageType: 'text' });
    const row = await outboxRow(users.doctor.id, `message:${msg.body.id}`);
    expect(row.status).toBe('queued');
    expect(nextAttemptIn(row)).toBeLessThan(2000); // immediate again
  });

  it('WS message path behaves EXACTLY like REST (same grace/immediate decision)', async () => {
    // Viewing exact → grace row, from the WS handler.
    const senderWs = connectStub(users.patient.id, null);
    connectStub(users.doctor.id, consId);
    await hub.handleMessageSend(
      senderWs,
      { id: users.patient.id, role: 'patient', name: 'Pat Test', username: 't.patient' },
      { consultationId: consId, text: 'ws path viewing', messageType: 'text' },
    );
    const { rows } = await db.query(
      `SELECT * FROM notification_outbox WHERE user_id = $1 AND event_type = 'message:new' ORDER BY id DESC LIMIT 1`,
      [users.doctor.id]
    );
    expect(rows[0].status).toBe('queued');
    expect(nextAttemptIn(rows[0])).toBeGreaterThan(20_000);

    // Not viewing (socket dropped) → immediate row, from the WS handler.
    for (const ws of [...(hub.sockets.get(users.doctor.id) ?? [])]) {
      hub.unregister(users.doctor.id, ws);
    }
    await hub.handleMessageSend(
      senderWs,
      { id: users.patient.id, role: 'patient', name: 'Pat Test', username: 't.patient' },
      { consultationId: consId, text: 'ws path offline', messageType: 'text' },
    );
    const { rows: rows2 } = await db.query(
      `SELECT * FROM notification_outbox WHERE user_id = $1 AND event_type = 'message:new' ORDER BY id DESC LIMIT 1`,
      [users.doctor.id]
    );
    expect(rows2[0].status).toBe('queued');
    expect(nextAttemptIn(rows2[0])).toBeLessThan(2000);
  });

  it('MEDICATION events are NEVER suppressed by connectivity or viewing state', async () => {
    // Patient fully "connected" AND actively viewing a conversation — a
    // medication event must still enqueue an immediate push row.
    connectStub(users.patient.id, consId);
    const emit = await import('../src/notifications/emit.js').then((m) => m.default ?? m);
    await emit.emit({
      userId: users.patient.id,
      eventType: 'medication:paid',
      idempotencyKey: `supp-med-not-suppressed:${users.patient.id}`,
      title: 'Medika',
      body: 'Votre paiement a été confirmé. Votre commande est transmise à notre équipe.',
      url: '/app/consultations',
    });
    const row = await outboxRow(users.patient.id, `supp-med-not-suppressed:${users.patient.id}`);
    expect(row.status).toBe('queued');
    expect(nextAttemptIn(row)).toBeLessThan(2000); // immediate despite online+viewing
    // In-app record exists (never suppressed either).
    const { rows } = await db.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND idempotency_key = $2`,
      [users.patient.id, `supp-med-not-suppressed:${users.patient.id}`]
    );
    expect(rows.length).toBe(1);
  });

  async function subscribeDoctor() {
    const res = await r.post('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({
        endpoint: `https://fcm.googleapis.com/fcm/send/supp-${stubSeq}`,
        keys: {
          p256dh: 'BEl62iUYgUivxIkvDFy2UUi2M6HxL1lzC2JmVVjKHaCXXrJBCxD5L0FqFfRlFpVbF',
          auth: 'aBcDeFgHiJkLmNoP',
        },
        userAgent: 'vitest',
      });
    expect(res.status).toBe(201);
  }
});
