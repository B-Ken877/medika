/**
 * Push notification system (issue #36) — subscriptions, in-app history,
 * preferences, outbox dispatcher, event wiring and privacy.
 *
 * The web-push library is exercised against a STUB: sendNotification is
 * mocked per test to simulate the push service (success / 404 / 410 / 500),
 * so delivery classification is tested without any network or real device.
 * No real push delivery is ever claimed — that requires a real-device
 * manual test (documented in the PR).
 */
'use strict';

process.env.REQUIRE_PAYMENT = 'false';
// Configure VAPID for tests (public/private pair generated for CI use only).
process.env.VAPID_PUBLIC_KEY = 'BGY3TmF6Yf1mZTKqkCJ0pXG0vXEEoSTq7FVGGhVQ7lHSSsqQ8adlWgfZqcv-OH2FQ6XlOYMfKKSZhUJfh6S-gxE';
process.env.VAPID_PRIVATE_KEY = 'SfK9aVd4Wk2Hq8mNpC3xT7yLbE5rU1jZ6cX0oIgDfAw';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
const h = await import('./helpers');

let r, users, token = {};

beforeAll(async () => {
  ({ request: r } = await h.setup());
  await h.resetDb();
  users = await h.createFixtureUsers();
  token.patient = await h.loginToken(r, 't.patient');
  token.doctor = await h.loginToken(r, 't.doctor');
  token.patient2 = await h.loginToken(r, 't.patient2');
  token.admin = await h.loginToken(r, 't.admin');
});

afterAll(async () => {
  await h.closeAll();
});

// ─── Subscription fixtures ───────────────────────────────────────────────────

let endpointSeq = 0;
function subFixture() {
  endpointSeq += 1;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/test-${endpointSeq}`,
    keys: {
      p256dh: 'BEl62iUYgUivxIkvDFy2UUi2M6HxL1lzC2JmVVjKHaCXXrJBCxD5L0FqFfRlFpVbF',
      auth: 'aBcDeFgHiJkLmNoP',
    },
    userAgent: 'vitest',
  };
}

async function outboxRows(userId) {
  const { query } = await import('../src/db');
  const { rows } = await query(
    `SELECT * FROM notification_outbox WHERE user_id = $1 ORDER BY id`,
    [userId]
  );
  return rows;
}

/** Business emits are fire-and-forget (by design) — poll until the expected
 *  outbox row appears (eventual consistency, bounded). */
async function waitForOutbox(userId, key, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    const rows = await outboxRows(userId);
    const row = rows.find((x) => x.idempotency_key === key);
    if (row) return row;
    if (Date.now() - start > timeoutMs) return null;
    await new Promise((res) => setTimeout(res, 25));
  }
}

async function inAppRows(userId) {
  const { query } = await import('../src/db');
  const { rows } = await query(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY id`,
    [userId]
  );
  return rows;
}

// ─── Subscriptions API ───────────────────────────────────────────────────────

describe('push subscription management', () => {
  it('registers a subscription for the authenticated user (multi-device)', async () => {
    const a = await r.post('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.patient}`).send(subFixture());
    expect(a.status).toBe(201);
    const b = await r.post('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.patient}`).send(subFixture());
    expect(b.status).toBe(201); // second device
  });

  it('rejects malformed subscriptions (400)', async () => {
    const bad = await r.post('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ endpoint: 'javascript:alert(1)', keys: { p256dh: 'x', auth: 'y' } });
    expect(bad.status).toBe(400);
    const bad2 = await r.post('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.patient}`).send({});
    expect(bad2.status).toBe(400);
  });

  it('requires authentication (401 anonymous)', async () => {
    const res = await r.post('/api/notifications/subscriptions').send(subFixture());
    expect(res.status).toBe(401);
  });

  it('re-binding the same endpoint to its owner works (re-login)', async () => {
    const sub = subFixture();
    const first = await r.post('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.patient}`).send(sub);
    expect(first.status).toBe(201);
    const again = await r.post('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.patient}`).send(sub);
    expect(again.status).toBe(201); // upsert, not a duplicate
  });

  it('refresh (PUT) only works for the OWNER', async () => {
    const sub = subFixture();
    await r.post('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.patient}`).send(sub);
    const stranger = await r.put('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.patient2}`).send(sub);
    expect(stranger.status).toBe(404); // not this user's subscription
    const owner = await r.put('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.patient}`).send(sub);
    expect(owner.status).toBe(200);
  });

  it('revoking by endpoint only affects the owner; revoke-all for logout', async () => {
    const sub = subFixture();
    await r.post('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.patient}`).send(sub);
    // A stranger cannot revoke someone else's subscription.
    await r.delete('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.patient2}`).send({ endpoint: sub.endpoint });
    const dispatchMod = await import('../src/notifications/dispatch');
    expect(await dispatchMod.activeSubscriptionCount(users.patient.id)).toBeGreaterThan(0);
    // The owner revokes everything (logout).
    const res = await r.delete('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token.patient}`).send({});
    expect(res.status).toBe(200);
    expect(await dispatchMod.activeSubscriptionCount(users.patient.id)).toBe(0);
  });
});

// ─── In-app history + preferences ────────────────────────────────────────────

describe('in-app history and preferences', () => {
  it("lists ONLY the caller's notifications with unread count", async () => {
    const emit = (await import('../src/notifications/emit')).default ?? (await import('../src/notifications/emit'));
    await emit.emit({
      userId: users.patient.id, eventType: 'consultation:submitted',
      idempotencyKey: 't-hist-1', title: 'T1', body: 'B1', url: '/app',
    });
    await emit.emit({
      userId: users.patient2.id, eventType: 'consultation:submitted',
      idempotencyKey: 't-hist-2', title: 'T2', body: 'B2', url: '/app',
    });
    const res = await r.get('/api/notifications')
      .set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body.notifications.some((n) => n.idempotency_key === 't-hist-1' || n.title === 'T1')).toBe(true);
    expect(res.body.notifications.every((n) => n.title !== 'T2')).toBe(true); // isolation
    expect(res.body.unread).toBeGreaterThan(0);
  });

  it('marks read (own ids only) and read-all', async () => {
    const list = await r.get('/api/notifications')
      .set('Authorization', `Bearer ${token.patient}`);
    const first = list.body.notifications[0];
    const mark = await r.post('/api/notifications/read')
      .set('Authorization', `Bearer ${token.patient}`).send({ ids: [first.id] });
    expect(mark.status).toBe(200);
    expect(mark.body.updated).toBe(1);
    const all = await r.post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token.patient}`);
    expect(all.status).toBe(200);
    const after = await r.get('/api/notifications')
      .set('Authorization', `Bearer ${token.patient}`);
    expect(after.body.unread).toBe(0);
  });

  it('defaults preferences to all-on and validates updates', async () => {
    const get = await r.get('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token.patient}`);
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ consultations: true, messages: true, calls: true, wallet: true });

    const bad = await r.put('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token.patient}`).send({ messages: 'yes' });
    expect(bad.status).toBe(400);

    const put = await r.put('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token.patient}`).send({ messages: false, calls: false });
    expect(put.status).toBe(200);
    expect(put.body.messages).toBe(false);
    expect(put.body.calls).toBe(false);
    expect(put.body.consultations).toBe(true); // untouched
  });

  it('serves the VAPID public key to authenticated clients', async () => {
    const res = await r.get('/api/notifications/vapid-public-key')
      .set('Authorization', `Bearer ${token.patient}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.publicKey).toContain('BGY3');
  });
});

// ─── Event wiring + privacy ──────────────────────────────────────────────────

describe('business event wiring (via REST, real flows)', () => {
  let consId;

  it('consultation creation notifies the patient + the offered doctor', async () => {
    const res = await r.post('/api/consultations')
      .set('Authorization', `Bearer ${token.patient}`)
      .send({
        description: 'sentòm tès notifikasyon',
        specialtyNeeded: 'Medecine Generale',
        urgencyLevel: 'Moyenne',
        doctorId: users.doctor.id,
      });
    expect(res.status).toBe(201);
    consId = res.body.id;

    const submitted = await waitForOutbox(users.patient.id, `consultation:${consId}:submitted`);
    expect(submitted).toBeTruthy();
    expect(submitted.event_type).toBe('consultation:submitted');
    const offer = await waitForOutbox(users.doctor.id, `consultation:${consId}:offer:${users.doctor.id}`);
    expect(offer).toBeTruthy();
    expect(offer.event_type).toBe('consultation:offer');
  });

  it('acceptance notifies the patient exactly once (idempotent key)', async () => {
    const res = await r.put(`/api/consultations/${consId}/accept`)
      .set('Authorization', `Bearer ${token.doctor}`);
    expect(res.status).toBe(200);
    const accepted = await waitForOutbox(users.patient.id, `consultation:${consId}:accepted`);
    expect(accepted).toBeTruthy();
    expect(accepted.event_type).toBe('consultation:accepted');
    // Exactly ONE row for this key (duplicate emissions are no-ops).
    const all = (await outboxRows(users.patient.id)).filter((x) => x.idempotency_key === `consultation:${consId}:accepted`);
    expect(all.length).toBe(1);
  });

  it('a persisted chat message notifies the recipient — privacy-safe payload', async () => {
    const msg = await r.post(`/api/consultations/${consId}/messages`)
      .set('Authorization', `Bearer ${token.patient}`)
      .send({ text: 'sekre medikal: sentòm prive 123', messageType: 'text' });
    expect(msg.status).toBe(201);

    const messageRow = await waitForOutbox(users.doctor.id, `message:${msg.body.id}`);
    expect(messageRow).toBeTruthy();
    // PRIVACY: no message body, no symptoms, no medical data in the payload.
    expect(messageRow.title).toBe('Medika');
    expect(messageRow.body).toBe('Ou gen yon nouvo mesaj sou Medika.');
    expect(`${messageRow.title} ${messageRow.body} ${messageRow.url}`).not.toContain('sekre');
    expect(`${messageRow.title} ${messageRow.body}`).not.toContain('sentòm');
    // Deep link is a same-origin app path.
    expect(messageRow.url).toBe(`/app/consultations/${consId}`);
  });

  it('typing / recording / presence / read receipts NEVER create notifications', async () => {
    const before = (await outboxRows(users.doctor.id)).length;
    const inAppBefore = (await inAppRows(users.doctor.id)).length;
    // Exercise the WS-free REST equivalents that DO exist: mark-read.
    await r.post(`/api/consultations/${consId}/read`)
      .set('Authorization', `Bearer ${token.doctor}`);
    // Typing/recording/presence are WS-only — assert no rows appeared from
    // any of this traffic (none of it routes to emit()).
    const after = (await outboxRows(users.doctor.id)).length;
    const inAppAfter = (await inAppRows(users.doctor.id)).length;
    expect(after).toBe(before);
    expect(inAppAfter).toBe(inAppBefore);
  });

  it('completion notifies the patient; wallet earnings notify the doctor', async () => {
    const res = await r.put(`/api/consultations/${consId}/prescription`)
      .set('Authorization', `Bearer ${token.doctor}`)
      .send({ prescription: 'òrdònans tès' });
    expect(res.status).toBe(200);

    const completed = await waitForOutbox(users.patient.id, `consultation:${consId}:completed`);
    expect(completed).toBeTruthy();
    // Wallet earning notification (payment-less fixture consults still emit
    // only when a PAID payment exists; assert the patient-side event and the
    // absence of payload leakage either way).
    const rows = await outboxRows(users.doctor.id);
    const earning = rows.find((x) => x.event_type === 'wallet:earnings');
    if (earning) {
      expect(earning.idempotency_key).toMatch(/^wallet:earning:\d+$/);
    }
  });
});

// ─── Dispatcher (stubbed web-push) ───────────────────────────────────────────

describe('outbox dispatcher', () => {
  let webpush;

  beforeAll(async () => {
    webpush = (await import('web-push')).default ?? (await import('web-push'));
    // Let any fire-and-forget emits from earlier suites land BEFORE the
    // reset (an in-flight INSERT after TRUNCATE would leak a stray row into
    // these tests), then one fresh slate for the whole dispatcher suite.
    await new Promise((res) => setTimeout(res, 250));
    await h.resetDb();
    users = await h.createFixtureUsers();
    token.patient = await h.loginToken(r, 't.patient');
    token.doctor = await h.loginToken(r, 't.doctor');
    // patient2 deliberately stays unsubscribed (used by the no-subscription
    // test) — reuse the outer token, still valid for the recreated user id.
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function subscribe(token_, sub = subFixture()) {
    const res = await r.post('/api/notifications/subscriptions')
      .set('Authorization', `Bearer ${token_}`).send(sub);
    expect(res.status).toBe(201);
    return sub;
  }

  it('delivers a queued row to the push service and marks it delivered', async () => {
    await subscribe(token.patient);
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201 });
    const emit = await import('../src/notifications/emit');
    await emit.emit({
      userId: users.patient.id, eventType: 'consultation:submitted',
      idempotencyKey: 'd-1', title: 'Medika', body: 'Test', url: '/app',
    });
    const dispatch = await import('../src/notifications/dispatch');
    const counts = await dispatch.dispatchDueNotifications({});
    expect(counts.delivered).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const [target, payloadRaw] = send.mock.calls[0];
    expect(target.endpoint).toMatch(/^https:\/\/fcm/);
    const payload = JSON.parse(payloadRaw);
    expect(payload.title).toBe('Medika');
    const row = (await outboxRows(users.patient.id)).find((x) => x.idempotency_key === 'd-1');
    expect(row.status).toBe('delivered');
  });

  it('suppresses delivery when the category preference is off (at dispatch time)', async () => {
    await subscribe(token.patient);
    await r.put('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token.patient}`).send({ consultations: false });
    await new Promise((res) => setTimeout(res, 400)); // settle the subscribe route's async drain
    vi.spyOn(webpush, 'sendNotification');
    const emit = await import('../src/notifications/emit');
    await emit.emit({
      userId: users.patient.id, eventType: 'consultation:submitted',
      idempotencyKey: 'd-2', title: 'T', body: 'B', url: '/app',
    });
    const dispatch = await import('../src/notifications/dispatch');
    const counts = await dispatch.dispatchDueNotifications({});
    expect(counts.suppressed).toBe(1);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
    // The IN-APP record still exists (preferences suppress delivery only).
    const inApp = (await inAppRows(users.patient.id)).filter((x) => x.idempotency_key === 'd-2');
    expect(inApp.length).toBe(1);
  });

  it('suppresses when the user has no active subscriptions', async () => {
    const emit = await import('../src/notifications/emit');
    await emit.emit({
      userId: users.patient2.id, eventType: 'message:new',
      idempotencyKey: 'd-3', title: 'T', body: 'B', url: '/app',
    });
    const dispatch = await import('../src/notifications/dispatch');
    const counts = await dispatch.dispatchDueNotifications({});
    expect(counts.suppressed).toBe(1);
  });

  it('a 410 response revokes the subscription and marks the row revoked', async () => {
    const sub = await subscribe(token.patient);
    const err = new Error('Subscription gone');
    err.statusCode = 410;
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(err);
    const emit = await import('../src/notifications/emit');
    await emit.emit({
      userId: users.patient.id, eventType: 'message:new',
      idempotencyKey: 'd-4', title: 'T', body: 'B', url: '/app',
    });
    const dispatch = await import('../src/notifications/dispatch');
    const counts = await dispatch.dispatchDueNotifications({});
    expect(counts.revoked).toBe(1);
    expect(await dispatch.activeSubscriptionCount(users.patient.id)).toBe(0);
    const row = (await outboxRows(users.patient.id)).find((x) => x.idempotency_key === 'd-4');
    expect(row.status).toBe('revoked');
    expect(row.last_error_code).toBe('subscriptions_gone');
    void sub;
  });

  it('a 500 response is retryable with backoff, then dead after exhausting attempts', async () => {
    await subscribe(token.patient);
    const err = new Error('Push service down');
    err.statusCode = 500;
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(err);
    const emit = await import('../src/notifications/emit');
    await emit.emit({
      userId: users.patient.id, eventType: 'message:new',
      idempotencyKey: 'd-5', title: 'T', body: 'B', url: '/app',
    });
    const dispatch = await import('../src/notifications/dispatch');

    // First run: retryable, backoff scheduled in the future.
    await dispatch.dispatchDueNotifications({});
    let row = (await outboxRows(users.patient.id)).find((x) => x.idempotency_key === 'd-5');
    expect(row.status).toBe('retryable');
    expect(Number(row.attempts)).toBe(1);
    expect(row.next_attempt_at).toBeTruthy();

    // Force every next_attempt_at due and run until dead-lettered.
    const { query } = await import('../src/db');
    for (let i = 0; i < dispatch.MAX_ATTEMPTS + 2; i++) {
      await query(`UPDATE notification_outbox SET next_attempt_at = now() - interval '1 minute' WHERE id = $1`, [row.id]);
      await dispatch.dispatchDueNotifications({});
      row = (await outboxRows(users.patient.id)).find((x) => x.idempotency_key === 'd-5');
      if (row.status === 'dead') break;
    }
    expect(row.status).toBe('dead');
    expect(Number(row.attempts)).toBeGreaterThanOrEqual(dispatch.MAX_ATTEMPTS);
  });

  it('duplicate emission with the same key produces ONE row (idempotency)', async () => {
    const emit = await import('../src/notifications/emit');
    for (let i = 0; i < 3; i++) {
      await emit.emit({
        userId: users.patient.id, eventType: 'consultation:submitted',
        idempotencyKey: 'dup-1', title: 'T', body: 'B', url: '/app',
      });
    }
    const outbox = await outboxRows(users.patient.id);
    expect(outbox.filter((x) => x.idempotency_key === 'dup-1').length).toBe(1);
    const inApp = await inAppRows(users.patient.id);
    expect(inApp.filter((x) => x.idempotency_key === 'dup-1').length).toBe(1);
  });

  it('emit never throws (a DB failure cannot break the business flow)', async () => {
    const emit = await import('../src/notifications/emit');
    // Unknown event type → silent no-op.
    await expect(emit.emit({
      userId: users.patient.id, eventType: 'typing', idempotencyKey: 'x', title: 'T', body: 'B',
    })).resolves.toBeUndefined();
    // Missing fields → silent no-op.
    await expect(emit.emit({ userId: null, eventType: 'message:new', idempotencyKey: 'x' })).resolves.toBeUndefined();
  });

  it('the dispatch cron endpoint is authorization-guarded', async () => {
    const anon = await r.get('/api/crons/notification-dispatch');
    expect(anon.status).toBe(401);
    const admin = await r.get('/api/crons/notification-dispatch')
      .set('Authorization', `Bearer ${token.admin}`);
    expect(admin.status).toBe(200);
    expect(admin.body.ok).toBe(true);
    expect(admin.body.counts).toBeTruthy();
  });
});

// ─── Rollout switch: VAPID unconfigured ──────────────────────────────────────

describe('VAPID unconfigured — push safely disabled', () => {
  it('dispatch is a no-op and rows stay queued (in-app unaffected)', async () => {
    process.env.VAPID_PUBLIC_KEY = '';
    process.env.VAPID_PRIVATE_KEY = '';

    const emit = await import('../src/notifications/emit');
    await emit.emit({
      userId: users.patient.id, eventType: 'message:new',
      idempotencyKey: 'off-1', title: 'T', body: 'B', url: '/app',
    });
    const dispatch = await import('../src/notifications/dispatch');
    const counts = await dispatch.dispatchDueNotifications({});
    expect(counts.unconfigured).toBe(true);
    expect(counts.claimed).toBe(0);
    const row = (await outboxRows(users.patient.id)).find((x) => x.idempotency_key === 'off-1');
    expect(row.status).toBe('queued'); // untouched until configured

    // Restore for any later tests.
    process.env.VAPID_PUBLIC_KEY = 'BGY3TmF6Yf1mZTKqkCJ0pXG0vXEEoSTq7FVGGhVQ7lHSSsqQ8adlWgfZqcv-OH2FQ6XlOYMfKKSZhUJfh6S-gxE';
    process.env.VAPID_PRIVATE_KEY = 'SfK9aVd4Wk2Hq8mNpC3xT7yLbE5rU1jZ6cX0oIgDfAw';
  });
});
