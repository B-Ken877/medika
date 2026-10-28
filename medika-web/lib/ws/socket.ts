"use client";

/**
 * WebSocket manager for the Medika realtime channel (/ws).
 *
 * Mirrors the Android client's protocol, with the hardened auth frame:
 *  - connect, then send {type:"auth", token: <JWT>}
 *    (the legacy {type:"auth", userId} frame authenticated nothing and is
 *    rejected by the migrated backend — see docs/VERCEL_MIGRATION_AUDIT.md C2)
 *  - server sends catch-up messages, then live events
 *  - client sends message:send / typing / call:start / call:accept / call:reject / call:end
 *
 * Adds web-specific resilience: exponential backoff reconnect, dedup of
 * message ids, and a strict allow-list so unknown server events are ignored
 * instead of crashing the UI.
 */
import type { ServerMessage, WsServerEvent } from "../api/types";

export interface SendFileMeta {
  messageType: "voice" | "image" | "video" | "file";
  fileUrl: string;
  duration?: number | null;
  fileSize?: number | null;
}

type Listener = (event: WsServerEvent) => void;
type StatusListener = (status: "connecting" | "open" | "closed") => void;

export function wsUrl(apiBase = ""): string {
  // Explicit override (e.g. local development, where Next.js rewrites cannot
  // proxy WebSocket upgrades): NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws
  const override = process.env.NEXT_PUBLIC_WS_URL;
  if (override) return override.replace(/\/$/, "");
  if (apiBase && /^https?:\/\//i.test(apiBase)) {
    return apiBase.replace(/^http/i, "ws") + "/ws";
  }
  if (typeof window === "undefined") return "/ws";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export class MedikaSocket {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;
  private seenMessageIds = new Set<number>();

  private static MAX_BACKOFF_MS = 30_000;
  private static BASE_BACKOFF_MS = 1_000;

  connect(token: string): void {
    if (typeof window === "undefined") return;
    this.manuallyClosed = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.token === token) return;
      // Different user (re-login): reset before reconnecting.
      this.teardownSocket();
    }
    this.token = token;
    this.openSocket();
  }

  private openSocket(): void {
    this.notifyStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      if (this.token) {
        socket.send(JSON.stringify({ type: "auth", token: this.token }));
      }
      this.notifyStatus("open");
    };

    socket.onmessage = (raw) => {
      let event: WsServerEvent;
      try {
        event = JSON.parse(String(raw.data)) as WsServerEvent;
      } catch {
        return;
      }
      if (!event || typeof event.type !== "string") return;
      // Dedup message:new by id (catch-up + live echo can overlap).
      if (event.type === "message:new") {
        const id = (event as { id?: number }).id;
        if (typeof id === "number") {
          if (this.seenMessageIds.has(id)) return;
          this.seenMessageIds.add(id);
          if (this.seenMessageIds.size > 2000) this.seenMessageIds.clear();
        }
      }
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // A broken listener must not break the socket loop.
        }
      }
    };

    socket.onclose = () => {
      this.notifyStatus("closed");
      if (!this.manuallyClosed) this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose will follow; nothing else to do.
    };
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || this.reconnectTimer) return;
    const attempt = ++this.reconnectAttempts;
    const delay = Math.min(
      MedikaSocket.BASE_BACKOFF_MS * Math.pow(2, attempt - 1),
      MedikaSocket.MAX_BACKOFF_MS,
    ) + Math.random() * 500;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private teardownSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.manuallyClosed = true;
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
      this.manuallyClosed = false;
    }
  }

  disconnect(): void {
    this.token = null;
    this.seenMessageIds.clear();
    this.reconnectAttempts = 0;
    this.teardownSocket();
    this.notifyStatus("closed");
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private notifyStatus(status: "connecting" | "open" | "closed"): void {
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // ignore
      }
    }
  }

  private send(payload: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  // ── Client → server messages (exact Android protocol) ─────────────────────

  /**
   * Send a text message. `clientMsgId` (optional, additive) is echoed back on
   * the message:new event so the sender can reconcile its optimistic UI with
   * the persisted message — never as an identity/authorization signal.
   */
  sendMessage(
    consultationId: string,
    senderId: string,
    senderName: string,
    text: string,
    clientMsgId?: string,
  ): boolean {
    return this.send({
      type: "message:send",
      consultationId,
      senderId,
      senderName,
      text,
      messageType: "text",
      ...(clientMsgId ? { clientMsgId } : {}),
    });
  }

  sendMediaMessage(
    consultationId: string,
    senderId: string,
    senderName: string,
    meta: SendFileMeta,
    clientMsgId?: string,
  ): boolean {
    return this.send({
      type: "message:send",
      consultationId,
      senderId,
      senderName,
      text: "",
      messageType: meta.messageType,
      fileUrl: meta.fileUrl,
      duration: meta.duration ?? null,
      fileSize: meta.fileSize ?? null,
      ...(clientMsgId ? { clientMsgId } : {}),
    });
  }

  sendTyping(consultationId: string, senderId: string, isTyping: boolean): boolean {
    return this.send({ type: "typing", consultationId, senderId, isTyping });
  }

  /** Voice-recording ACTIVITY signal (issue #26). Ephemeral, membership-checked
   *  server-side; the payload carries the activity boolean only — never audio,
   *  waveform, duration or filenames. */
  sendRecording(consultationId: string, isRecording: boolean): boolean {
    return this.send({ type: "recording", consultationId, isRecording });
  }

  /** Ask the server for the counterpart's CURRENT presence in one
   *  consultation (membership-checked server-side; reply arrives as a
   *  presence:update event). Used when a chat view mounts after the socket
   *  already authenticated, and after reconnects. */
  sendPresenceSubscribe(consultationId: string): boolean {
    return this.send({ type: "presence:subscribe", consultationId });
  }

  startCall(consultationId: string, callerName: string, callType: "voice" | "video", roomName: string): boolean {
    return this.send({
      type: "call:start",
      consultationId,
      callerName,
      callType,
      roomName,
    });
  }

  acceptCall(consultationId: string): boolean {
    return this.send({ type: "call:accept", consultationId });
  }

  rejectCall(consultationId: string): boolean {
    return this.send({ type: "call:reject", consultationId });
  }

  endCall(consultationId: string): boolean {
    return this.send({ type: "call:end", consultationId });
  }
}

/** Normalize a message:new WS event into the REST message shape.
 *  `timestamp` is milliseconds of the PERSISTED creation time; converted to
 *  seconds exactly ONCE here. Read state is not part of the envelope —
 *  callers must not let an echo overwrite an existing message's read_at
 *  (dedup by id happens at the page level). */
export function wsEventToServerMessage(event: {
  id: number;
  consultationId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  messageType?: string;
  fileUrl?: string | null;
  duration?: number | null;
  fileSize?: number | null;
  clientMsgId?: string;
}): ServerMessage {
  return {
    id: event.id,
    consultation_id: event.consultationId,
    sender_id: event.senderId,
    sender_name: event.senderName,
    text: event.text ?? "",
    created_at: Math.floor((event.timestamp ?? Date.now()) / 1000),
    message_type: event.messageType ?? "text",
    file_url: event.fileUrl ?? null,
    duration: event.duration ?? null,
    file_size: event.fileSize ?? null,
    read_at: null,
  };
}
