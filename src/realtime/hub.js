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
const { createRedisBus, createLocalBus } = require('./redis-bus');

const MAX_CATCHUP = 50;

/** WS event envelope (camelCase, ms timestamps) — legacy shape. */
function messageEnvelope(msg) {
  return {
    type: 'message:new',
    id: Number(msg.id),
    consultationId: msg.consultation_id,
    senderId: msg.sender_id,
    senderName: msg.sender_name,
    text: msg.text || '',
    timestamp: Math.floor(new Date().getTime()), // legacy behavior: server clock, ms
    messageType: msg.message_type || 'text',
    fileUrl: msg.file_url || null,
    duration: msg.duration ?? null,
    fileSize: msg.file_size === null ? null : Number(msg.file_size),
  };
}

class RealtimeHub {
  constructor({ bus = null } = {}) {
    this.sockets = new Map(); // userId -> Set<ws>
    this.instanceId = uuidv4();
    this.bus = bus || createLocalBus();
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
            await this.handleEphemeral(user, data, (recipientId) => ({
              type: 'typing', consultationId: data.consultationId, senderId: user.id, isTyping: Boolean(data.isTyping),
            }));
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
    if (!text && type !== 'voice' && type !== 'image' && type !== 'video') return;

    const consultation = await consultationsRepo.findById(consultationId);
    if (!consultation ||
        (consultation.patient_id !== user.id && consultation.doctor_id !== user.id)) {
      ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized for this consultation' }));
      return;
    }

    const msg = await consultationsRepo.createMessage({
      consultation_id: consultationId,
      sender_id: user.id, // authoritative: never trust client-supplied senderId
      sender_name: senderName || user.name,
      text: text || '',
      message_type: type,
      file_url: fileUrl || null,
      duration: duration ?? null,
      file_size: fileSize ?? null,
    });

    const envelope = messageEnvelope(msg);
    this.publishToUser(user.id, envelope);
    const recipientId =
      consultation.patient_id === user.id ? consultation.doctor_id : consultation.patient_id;
    if (recipientId) this.publishToUser(recipientId, envelope);
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
    if (recipientId) this.publishToUser(recipientId, buildEvent(recipientId));
  }

  // ─── Delivery ────────────────────────────────────────────────────────────

  register(userId, ws) {
    if (!this.sockets.has(userId)) this.sockets.set(userId, new Set());
    this.sockets.get(userId).add(ws);
  }

  unregister(userId, ws) {
    const set = this.sockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.sockets.delete(userId);
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
}

/**
 * Attach the hub to an HTTP server (Express + WS in ONE function — the
 * pattern documented by Vercel's WebSockets guide for Express).
 */
function attachRealtime(server, opts = {}) {
  const hub = new RealtimeHub(opts);
  hub.attach(server);
  // Heartbeat: same 30s ping/terminate cycle as the legacy server. On Vercel
  // this doubles as dead-socket cleanup within the instance lifetime.
  const interval = setInterval(() => {
    if (hub.wss) {
      hub.wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }
  }, 30_000);
  interval.unref?.();
  return hub;
}

module.exports = { attachRealtime, RealtimeHub, messageEnvelope };
