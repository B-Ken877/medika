/**
 * Realtime hub — the /ws WebSocket protocol, byte-compatible with the legacy
 * server.js and the Android (OkHttp) / web (browser) clients.
 *
 * SECURITY CHANGE vs legacy: the auth frame must now carry the JWT
 * ({type:'auth', token}). The legacy {type:'auth', userId} frame — which
 * authenticated nothing — is rejected (audit finding C2). The web PWA ships
 * the updated frame in this repository; Android's WS fallback requires an app
 * update, while its primary chat path (Zego ZIM) is unaffected.
 *
 * Serverless notes (Vercel Functions, WebSocket public beta):
 *  - connections pin to one function instance; a module-level socket map is
 *    valid per instance only;
 *  - cross-instance fan-out uses Redis pub/sub when REDIS_URL is configured
 *    (e.g. Upstash via the Vercel Marketplace); without it the hub is
 *    single-instance (fine for dev and small deployments);
 *  - connections close at the function's max duration — clients already
 *    implement reconnect + catch-up (message ids are server-side and the auth
 *    flow re-sends the last 50 messages).
 */
'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('../auth');
const consultationsRepo = require('../repos/consultations');
const usersRepo = require('../repos/users');
const notifications = require('../notifications/emit');
const { createRedisBus, createLocalBus } = require('./redis-bus');
const { createPresence } = require('./presence');

const MAX_CATCHUP = 50;

/** Persisted message creation time → milliseconds (exactly one conversion).
 * Accepts both shapes that reach the envelope: raw DB rows (created_at is a
 * Date) and msgToApi-mapped rows (created_at is epoch SECONDS). A safe
 * clock fallback is used only when no persisted timestamp exists. */
function persistedTimestampMs(msg) {
  const ca = msg && msg.created_at;
  if (ca instanceof Date) {
    const t = ca.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof ca === 'number' && Number.isFinite(ca)) return ca * 1000;
  if (typeof ca === 'string' && ca) {
    const t = Date.parse(ca);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/** WS event envelope (camelCase, ms timestamps) — legacy shape. The event
 * timestamp is the PERSISTED creation time, truncated to whole seconds so
 * REST (epoch seconds) and WS (epoch ms) describe the EXACT same instant for
 * one saved message; the server clock is only a fallback. `clientMsgId` is
 * an ADDITIVE, optional correlation id echoed back to the sender (web
 * optimistic-UI reconciliation; legacy clients ignore it). */
function messageEnvelope(msg, { clientMsgId } = {}) {
  const persistedMs = persistedTimestampMs(msg);
  const envelope = {
    type: 'message:new',
    id: Number(msg.id),
    consultationId: msg.consultation_id,
    senderId: msg.sender_id,
    senderName: msg.sender_name,
    text: msg.text || '',
    timestamp: persistedMs !== null ? Math.floor(persistedMs / 1000) * 1000 : Date.now(),
    messageType: msg.message_type || 'text',
    fileUrl: msg.file_url || null,
    duration: msg.duration ?? null,
    fileSize: msg.file_size === null ? null : Number(msg.file_size),
  };
  if (clientMsgId) envelope.clientMsgId = clientMsgId;
  return envelope;
}

class RealtimeHub {
  constructor({ bus = null, presence = null } = {}) {
    this.sockets = new Map(); // userId -> Set<ws>
    this.instanceId = uuidv4();
    this.bus = bus || createLocalBus();
    this.presence = presence || createPresence();
    // Last presence view THIS instance emitted/evaluated per user. Used to
    // detect transitions (and, on heartbeat, to catch lease-expired users
    // whose owning instance died without a clean disconnect).
    this.presenceState = new Map(); // userId -> boolean
    this.bus.onMessage(({ userId, event, originInstance }) => {
      if (originInstance === this.instanceId) return; // already delivered locally
      this.deliverLocal(userId, event);
    });
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    return this;
  }

  // ─── Connection lifecycle ────────────────────────────────────────────────

  onConnection(ws) {
    let user = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      if (!data || typeof data.type !== 'string') return;

      const handle = async () => {
        if (data.type === 'auth') {
          if (user) return; // already authenticated on this socket
          user = await this.handleAuth(ws, data); // binds the closure-scoped identity
          return;
        }
        if (!user) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
          return;
        }
        switch (data.type) {
          case 'message:send':
            await this.handleMessageSend(ws, user, data);
            break;
          case 'typing':
            await this.handleTyping(user, data);
            break;
          case 'recording':
            await this.handleRecording(user, data);
            break;
          case 'presence:subscribe':
            await this.handlePresenceSubscribe(user, data, ws);
            break;
          case 'call:start':
            await this.handleEphemeral(user, data, (recipientId) => ({
              type: 'call:incoming', from: user.id, fromName: data.callerName || user.name,
              consultationId: data.consultationId, callType: data.callType, roomName: data.roomName,
              timestamp: Date.now(),
            }));
            break;
          case 'call:accept':
            await this.handleEphemeral(user, data, () => ({
              type: 'call:accepted', from: user.id, consultationId: data.consultationId, timestamp: Date.now(),
            }));
            break;
          case 'call:reject':
            await this.handleEphemeral(user, data, () => ({
              type: 'call:rejected', from: user.id, consultationId: data.consultationId, timestamp: Date.now(),
            }));
            break;
          case 'call:end':
            await this.handleEphemeral(user, data, () => ({
              type: 'call:ended', from: user.id, consultationId: data.consultationId, timestamp: Date.now(),
            }));
            break;
          default:
            break; // unknown types ignored (legacy behavior)
        }
      };
      handle().catch((err) => {
        // Log category only — never payload (chat content is medical data).
        console.error('[WS] handler error:', data.type, err.code || err.constructor?.name);
        ws.send(JSON.stringify({ type: 'error', message: 'Erreur de traitement' }));
      });
    });

    ws.on('close', () => {
      if (user) this.unregister(user.id, ws);
    });

    // Dead-socket safety net beyond the close event (heartbeat terminate,
    // dropped connections): sweep any socket the registry still holds.
    ws.on('error', () => {
      try { ws.terminate(); } catch { /* already dead */ }
    });
  }

  async handleAuth(ws, data) {
    const token = typeof data.token === 'string' ? data.token : null;
    if (!token) {
      // Legacy {type:'auth', userId} frames are rejected: a user id is not
      // proof of identity (audit C2).
      ws.send(JSON.stringify({ type: 'auth:error', message: 'Token requis' }));
      ws.close(1008, 'auth required');
      return null;
    }
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      ws.send(JSON.stringify({ type: 'auth:error', message: 'Token invalide ou expire' }));
      ws.close(1008, 'invalid token');
      return null;
    }
    const user = { id: payload.sub, role: payload.role, name: payload.name, username: payload.username };
    this.register(user.id, ws);
    ws.send(JSON.stringify({ type: 'auth:ok', userId: user.id }));
    await this.sendCatchUp(ws, user.id);
    // Presence of the counterparts the new connection may care about.
    await this.sendInitialPresence(ws, user.id);
    return user;
  }

  async sendCatchUp(ws, userId) {
    try {
      const messages = await consultationsRepo.catchUp(userId, MAX_CATCHUP);
      for (const m of messages) {
        ws.send(JSON.stringify(messageEnvelope(m)));
      }
    } catch (err) {
      console.error('[WS] catch-up error:', err.code || err.constructor?.name);
    }
  }

  // ─── message:send ────────────────────────────────────────────────────────

  async handleMessageSend(ws, user, data) {
    const { consultationId, senderId, senderName, text, messageType, fileUrl, duration, fileSize } = data;
    if (!consultationId) return;
    const type = messageType || 'text';
    const trimmedText = typeof text === 'string' ? text.trim() : '';
    if (!trimmedText && type !== 'voice' && type !== 'image' && type !== 'video' && type !== 'file') return;

    const consultation = await consultationsRepo.findById(consultationId);
    if (!consultation ||
        (consultation.patient_id !== user.id && consultation.doctor_id !== user.id)) {
      ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized for this consultation' }));
      return;
    }

    // Optional client correlation id (additive, validated, echoed to sender).
    // ALSO persisted (migration 003) so a retry of the same logical send —
    // e.g. the client's REST fallback after this frame was lost post-
    // persistence — resolves to the already-stored row instead of duplicating.
    const clientMsgId =
      typeof data.clientMsgId === 'string' && data.clientMsgId.length > 0 && data.clientMsgId.length <= 64
        ? data.clientMsgId
        : undefined;
    const msg = await consultationsRepo.createMessage({
      consultation_id: consultationId,
      sender_id: user.id, // authoritative: never trust client-supplied senderId
      sender_name: senderName || user.name,
      text: trimmedText,
      message_type: type,
      file_url: fileUrl || null,
      duration: duration ?? null,
      file_size: fileSize ?? null,
      client_msg_id: clientMsgId || null,
    });

    const envelope = messageEnvelope(msg, { clientMsgId });
    this.publishToUser(user.id, envelope);
    const recipientId =
      consultation.patient_id === user.id ? consultation.doctor_id : consultation.patient_id;
    if (recipientId) {
      this.publishToUser(recipientId, envelope);
      // Issue #36: durable notification for the RECIPIENT after the message
      // is PERSISTED (never before). Push is suppressed when the recipient
      // is connected (they just received the live delivery); the in-app
      // record is always kept. Fire-and-forget: delivery issues can never
      // break chat persistence.
      const recipientOnline = (this.sockets.get(recipientId)?.size ?? 0) > 0;
      notifications.emit({
        userId: recipientId,
        eventType: 'message:new',
        idempotencyKey: `message:${Number(msg.id)}`,
        title: notifications.COPY.messageNew.title,
        body: notifications.COPY.messageNew.body,
        url: `/app/consultations/${consultationId}`,
        push: !recipientOnline,
      });
    }
  }

  /** typing — membership-checked relay to the other participant, gated on the
   * consultation lifecycle: a closed (TERMINE/REFUSE/…) conversation must not
   * show active-chat typing activity. Identity always comes from the
   * authenticated socket; typing is ephemeral (never persisted). */
  async handleTyping(user, data) {
    if (!data.consultationId) return;
    const consultation = await consultationsRepo.findById(data.consultationId);
    if (!consultation ||
        (consultation.patient_id !== user.id && consultation.doctor_id !== user.id)) {
      return; // legacy behavior: silent drop
    }
    if (consultation.status !== 'EN_COURS') return; // closed → no typing relay
    const recipientId =
      consultation.patient_id === user.id ? consultation.doctor_id : consultation.patient_id;
    if (recipientId) {
      this.publishToUser(recipientId, {
        type: 'typing',
        consultationId: data.consultationId,
        senderId: user.id, // authenticated identity, never client-supplied
        isTyping: Boolean(data.isTyping),
      });
    }
  }

  /** recording (issue #26) — membership-checked relay of voice-recording
   *  ACTIVITY to the other participant, mirroring handleTyping(): ephemeral
   *  (never persisted), gated on EN_COURS, identity from the authenticated
   *  socket. The payload is deliberately minimal — activity boolean only:
   *  no audio, waveform, duration, filenames or any sensitive content. */
  async handleRecording(user, data) {
    if (!data.consultationId) return;
    const consultation = await consultationsRepo.findById(data.consultationId);
    if (!consultation ||
        (consultation.patient_id !== user.id && consultation.doctor_id !== user.id)) {
      return; // silent drop: no existence leak
    }
    if (consultation.status !== 'EN_COURS') return; // closed → no activity relay
    const recipientId =
      consultation.patient_id === user.id ? consultation.doctor_id : consultation.patient_id;
    if (recipientId) {
      this.publishToUser(recipientId, {
        type: 'recording',
        consultationId: data.consultationId,
        senderId: user.id, // authenticated identity, never client-supplied
        isRecording: Boolean(data.isRecording),
      });
    }
  }

  /** presence:subscribe — reply with the counterpart's CURRENT presence for
   * one consultation (membership-checked). Lets a client that mounted after
   * its socket authenticated learn the partner status without a reconnect.
   * The reply goes only to the requesting, authenticated user. */
  async handlePresenceSubscribe(user, data, ws) {
    if (!data.consultationId) return;
    const consultation = await consultationsRepo.findById(data.consultationId);
    if (!consultation ||
        (consultation.patient_id !== user.id && consultation.doctor_id !== user.id)) {
      return; // silent drop: no existence leak
    }
    const counterpartId =
      consultation.patient_id === user.id ? consultation.doctor_id : consultation.patient_id;
    if (!counterpartId) return;
    const online = await this.isUserOnline(counterpartId);
    this.presenceState.set(counterpartId, online);
    const event = { type: 'presence:update', userId: counterpartId, online };
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }

  /** typing / call:* — membership-checked relay to the other participant. */
  async handleEphemeral(user, data, buildEvent) {
    if (!data.consultationId) return;
    const consultation = await consultationsRepo.findById(data.consultationId);
    if (!consultation ||
        (consultation.patient_id !== user.id && consultation.doctor_id !== user.id)) {
      return; // legacy behavior: silent drop
    }
    const recipientId =
      consultation.patient_id === user.id ? consultation.doctor_id : consultation.patient_id;
    if (recipientId) {
      this.publishToUser(recipientId, buildEvent(recipientId));
      // Issue #36: urgent push for an INCOMING CALL (only for the intended
      // recipient, never a broadcast). Suppressed when they are connected —
      // the live ring is already in front of them. Typing, recording and
      // presence events NEVER reach this path.
      if (data.type === 'call:start') {
        const recipientOnline = (this.sockets.get(recipientId)?.size ?? 0) > 0;
        const minuteBucket = Math.floor(Date.now() / 60000);
        notifications.emit({
          userId: recipientId,
          eventType: 'call:incoming',
          idempotencyKey: `call:${data.consultationId}:${user.id}:${minuteBucket}`,
          title: notifications.COPY.callIncoming.title,
          body: notifications.COPY.callIncoming.body,
          url: `/app/consultations/${data.consultationId}`,
          push: !recipientOnline,
        });
      }
    }
  }

  // ─── Delivery ────────────────────────────────────────────────────────────

  register(userId, ws) {
    ws.__connId = uuidv4();
    if (!this.sockets.has(userId)) this.sockets.set(userId, new Set());
    this.sockets.get(userId).add(ws);
    this.updatePresenceAndNotify(userId, ws.__connId, true);
  }

  unregister(userId, ws) {
    const set = this.sockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.sockets.delete(userId);
    this.updatePresenceAndNotify(userId, ws.__connId, false);
  }

  deliverLocal(userId, event) {
    const set = this.sockets.get(userId);
    if (!set) return false;
    let sent = false;
    for (const s of set) {
      if (s.readyState === WebSocket.OPEN) {
        s.send(typeof event === 'string' ? event : JSON.stringify(event));
        sent = true;
      }
    }
    return sent;
  }

  /** Deliver to a user everywhere (this instance + other instances via bus). */
  publishToUser(userId, event) {
    this.deliverLocal(userId, event);
    this.bus.publish(userId, event, this.instanceId);
  }

  /** Legacy broadcastToRole: deliver to every user of a role. */
  async publishToRole(role, event) {
    const ids = await usersRepo.listByRole(role);
    for (const id of ids) this.publishToUser(id, event);
  }

  // ─── Presence ─────────────────────────────────────────────────────────────

  /** True when the user has a live socket on THIS instance or a live lease
   *  (Redis mode) anywhere. Local mode: the in-instance registry IS the
   *  truth (single-instance deployments — documented limitation). */
  async isUserOnline(userId) {
    if ((this.sockets.get(userId)?.size ?? 0) > 0) return true;
    if (this.presence._localOnly) return false;
    try {
      return await this.presence.isOnline(userId);
    } catch (err) {
      console.error('[WS] presence lookup failed:', err.code || err.constructor?.name);
      return false; // fail closed: no false "online"
    }
  }

  /** Connection bookkeeping + transition detection. Emits presence:update
   *  ONLY on a change of this instance's view, and only to consultation
   *  counterparts (never a global broadcast). */
  async updatePresenceAndNotify(userId, connId, added) {
    try {
      if (added) await this.presence.add(userId, connId);
      else await this.presence.remove(userId, connId);
      const online = await this.isUserOnline(userId);
      const prev = this.presenceState.get(userId);
      this.presenceState.set(userId, online);
      if (prev === undefined || prev === online) return;
      await this.broadcastPresence(userId, online);
    } catch (err) {
      // Category only — never user data.
      console.error('[WS] presence update failed:', err.code || err.constructor?.name);
    }
  }

  /** presence:update to every user sharing a consultation with `userId`. */
  async broadcastPresence(userId, online) {
    const counterparts = await consultationsRepo.listCounterpartIds(userId);
    const event = { type: 'presence:update', userId, online };
    for (const cid of counterparts) this.publishToUser(cid, event);
  }

  /** After auth: tell the new connection the CURRENT status of each of its
   *  consultation counterparts (seeds this instance's presence view so the
   *  heartbeat can later detect their offline transitions). */
  async sendInitialPresence(ws, userId) {
    try {
      const counterparts = await consultationsRepo.listCounterpartIds(userId);
      for (const cid of counterparts) {
        const online = await this.isUserOnline(cid);
        this.presenceState.set(cid, online);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'presence:update', userId: cid, online }));
        }
      }
    } catch (err) {
      console.error('[WS] initial presence failed:', err.code || err.constructor?.name);
    }
  }

  /** Heartbeat hook: renew this instance's leases and re-evaluate previously
   *  seen users so a lease that expired elsewhere (crashed instance) turns
   *  into an offline event within ~lease TTL + one heartbeat. */
  async recheckPresence() {
    try {
      const renewals = [];
      for (const [userId, set] of this.sockets) {
        for (const ws of set) {
          if (ws.__connId) renewals.push(this.presence.refresh(userId, ws.__connId));
        }
      }
      await Promise.all(renewals);
      for (const [userId, prev] of this.presenceState) {
        const online = await this.isUserOnline(userId);
        if (online !== prev) {
          this.presenceState.set(userId, online);
          await this.broadcastPresence(userId, online);
        }
      }
    } catch (err) {
      console.error('[WS] presence recheck failed:', err.code || err.constructor?.name);
    }
  }
}

/**
 * Attach the hub to an HTTP server (Express + WS in ONE function — the
 * pattern documented by Vercel's WebSockets guide for Express).
 */
function attachRealtime(server, opts = {}) {
  const hub = new RealtimeHub(opts);
  hub.attach(server);
  // Heartbeat: same 30s ping/terminate cycle as the legacy server. On Vercel
  // this doubles as dead-socket cleanup within the instance lifetime, and
  // renews presence leases / re-evaluates known presence so expired leases
  // (crashed instances) surface as offline events.
  const interval = setInterval(() => {
    if (hub.wss) {
      hub.wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }
    hub.recheckPresence();
  }, 30_000);
  interval.unref?.();
  return hub;
}

module.exports = { attachRealtime, RealtimeHub, messageEnvelope };
