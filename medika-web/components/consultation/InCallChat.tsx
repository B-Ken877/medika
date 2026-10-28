"use client";

/**
 * In-call chat panel (issue #45) — the consultation chat INSIDE the call
 * screen, so patients and doctors switch between video and messages without
 * navigating away (which would unmount the LiveKit-owning call page and tear
 * down the call).
 *
 * NOT a second chat or message store: the panel reuses the exact server
 * endpoints (getMessages / sendConsultationMessage / markConsultationRead),
 * the SAME shared WebSocket (message:new / typing / messages:read events)
 * and the same pure libs (receipts, delivery, typing) as the full chat page.
 * It is one more VIEW over the same server-backed conversation, holding only
 * ephemeral view state that dies with the panel.
 *
 * Scope: text messages + typing + read receipts while in a call. Attachments,
 * voice notes, prescriptions and the full history UI stay on the consultation
 * chat page (reachable once the call ends) — deliberately, to keep the in-call
 * surface small, accessible and reliable on mobile.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ArrowLeft, PhoneOff, Send } from "lucide-react";
import type { MedikaSocket } from "@/lib/ws/socket";
import { wsEventToServerMessage } from "@/lib/ws/socket";
import { TypingNotifier, PartnerTypingTracker } from "@/lib/ws/typing";
import { applyMessagesRead, receiptFor, unreadIncomingIds } from "@/lib/chat/receipts";
import { waitForMessageEcho, mergePersistedMessage } from "@/lib/chat/delivery";
import {
  getMessages,
  markConsultationRead,
  sendConsultationMessage,
} from "@/lib/api/endpoints";
import type { ServerMessage } from "@/lib/api/types";
import { formatDaySeparator, formatTime } from "@/lib/format";
import { ReceiptTick } from "@/components/consultation/ReceiptTick";

export interface InCallChatUser {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface InCallChatProps {
  consultationId: string;
  token: string | null;
  user: InCallChatUser | null;
  /** The shared app socket — passed in, never created here. */
  socket: MedikaSocket | null;
  /** "Back to video" — closes the panel; MUST NOT touch the room. */
  onClose: () => void;
  /** Distinct "End call" action — the ONLY path that ends the call. */
  onEndCall: () => void;
}

/** Optimistic text entry — a subset of the chat page's PendingMessage. */
interface PendingText {
  clientMsgId: string;
  text: string;
  createdAt: number;
  failed: boolean;
}

function newClientMsgId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `ic-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function InCallChat({
  consultationId,
  token,
  user,
  socket,
  onClose,
  onEndCall,
}: InCallChatProps) {
  const [messages, setMessages] = useState<ServerMessage[] | null>(null);
  const [pending, setPending] = useState<PendingText[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);

  const markedRef = useRef<Set<number>>(new Set());
  const pendingRef = useRef<PendingText[]>([]);
  const notifierRef = useRef<TypingNotifier | null>(null);
  const trackerRef = useRef<PartnerTypingTracker | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // ── Bootstrap: load history through the SAME endpoint as the chat page ──
  useEffect(() => {
    if (!token || !consultationId) return;
    markedRef.current = new Set();
    const controller = new AbortController();
    getMessages(token, consultationId, controller.signal)
      .then((list) => setMessages(Array.isArray(list) ? list : []))
      .catch(() => {
        if (!controller.signal.aborted) setMessages([]);
      });
    return () => controller.abort();
  }, [token, consultationId]);

  // ── Mark incoming messages read while the panel is open and visible ────
  useEffect(() => {
    if (!token || !consultationId || !user || messages === null) return;
    if (typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    const unread = unreadIncomingIds(messages, user.id).filter(
      (mid) => !markedRef.current.has(mid),
    );
    if (unread.length === 0) return;
    unread.forEach((mid) => markedRef.current.add(mid));
    markConsultationRead(token, consultationId)
      .then((res) => {
        if (!res?.messageIds?.length || res.readAt == null) return;
        const ids = new Set(res.messageIds);
        setMessages((prev) =>
          prev && prev.some((m) => ids.has(m.id) && m.read_at == null)
            ? prev.map((m) => (ids.has(m.id) && m.read_at == null ? { ...m, read_at: res.readAt } : m))
            : prev,
        );
      })
      .catch(() => {
        // Allow a later retry — the panel re-marks on next open otherwise.
        unread.forEach((mid) => markedRef.current.delete(mid));
      });
  }, [messages, token, consultationId, user]);

  // ── Outgoing typing (throttled; explicit stop on close/unmount) ─────────
  useEffect(() => {
    if (!socket || !user) return;
    notifierRef.current = new TypingNotifier((isTyping) => {
      socket.sendTyping(consultationId, user.id, isTyping);
    });
    return () => {
      notifierRef.current?.stop();
      notifierRef.current = null;
    };
  }, [socket, user, consultationId]);

  // ── Incoming typing (timeout-safe) ──────────────────────────────────────
  useEffect(() => {
    const tracker = new PartnerTypingTracker();
    tracker.onExpire = () => setPartnerTyping(false);
    trackerRef.current = tracker;
    return () => {
      tracker.clear();
      trackerRef.current = null;
    };
  }, [consultationId]);

  // A dropped socket must not leave a stale "typing" indicator behind.
  useEffect(() => {
    if (!socket) {
      trackerRef.current?.clear();
      setPartnerTyping(false);
    }
  }, [socket]);

  // ── Live events over the SAME shared socket ─────────────────────────────
  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event) => {
      if (event.type === "message:new") {
        const e = event as Parameters<typeof wsEventToServerMessage>[0];
        if (e.clientMsgId) {
          setPending((prev) => prev.filter((p) => p.clientMsgId !== e.clientMsgId));
        }
        if (e.consultationId !== consultationId) return;
        setMessages((prev) => {
          const list = prev ?? [];
          if (list.some((m) => m.id === e.id)) return list;
          return [...list, wsEventToServerMessage(e)];
        });
      } else if (event.type === "typing") {
        const e = event as { consultationId: string; senderId: string; isTyping: boolean };
        const next = trackerRef.current?.applyEvent(
          { type: "typing", consultationId: e.consultationId, senderId: e.senderId, isTyping: e.isTyping },
          { consultationId, selfId: user?.id },
        );
        if (next !== undefined) setPartnerTyping(next);
      } else if (event.type === "messages:read") {
        const e = event as Parameters<typeof applyMessagesRead>[1];
        if (e.consultationId !== consultationId || !user || e.readerId === user.id) return;
        setMessages((prev) => (prev ? applyMessagesRead(prev, e) : prev));
      }
    });
  }, [socket, consultationId, user]);

  // Stick to the bottom while sending — the log is short-lived view state.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, partnerTyping]);

  // Focus the composer when the panel opens; Escape returns to video.
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Send: same dual path as the chat page (WS echo-confirmed, REST
  //    fallback with the SAME clientMsgId — never duplicated server-side).
  const sendText = useCallback(
    (text: string, clientMsgId: string): Promise<boolean> => {
      if (!user) return Promise.resolve(false);
      const restFallback = (): Promise<boolean> => {
        if (!token) return Promise.resolve(false);
        return sendConsultationMessage(token, consultationId, {
          text,
          messageType: "text",
          clientMsgId,
        })
          .then((msg) => {
            setMessages((prev) => (prev ? mergePersistedMessage(prev, msg) : [msg]));
            return true;
          })
          .catch(() => false);
      };
      if (!socket) return restFallback();
      const buffered = socket.sendMessage(consultationId, user.id, user.name ?? "M", text, clientMsgId);
      if (!buffered) return restFallback();
      return waitForMessageEcho(socket, clientMsgId).then((echoed) =>
        echoed ? true : restFallback(),
      );
    },
    [socket, user, consultationId, token],
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (!text || sending) return;
      const clientMsgId = newClientMsgId();
      setDraft("");
      setSending(true);
      setPending((prev) => [
        ...prev,
        { clientMsgId, text, createdAt: Math.floor(Date.now() / 1000), failed: false },
      ]);
      notifierRef.current?.notify("");
      sendText(text, clientMsgId)
        .then((ok) => {
          setPending((prev) =>
            prev.map((p) => (p.clientMsgId === clientMsgId ? { ...p, failed: !ok } : p)),
          );
        })
        .finally(() => setSending(false));
    },
    [draft, sending, sendText],
  );

  const onDraftChange = useCallback((value: string) => {
    setDraft(value);
    notifierRef.current?.notify(value);
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e as unknown as FormEvent);
      }
    },
    [handleSubmit],
  );

  // ── Rendering helpers ────────────────────────────────────────────────────
  const rows = useMemo(() => {
    const list = messages ?? [];
    const out: Array<
      | { kind: "day"; label: string; key: string }
      | { kind: "msg"; msg: ServerMessage; own: boolean; receipt: ReturnType<typeof receiptFor> }
      | { kind: "pending"; p: PendingText; key: string }
    > = [];
    let lastDay: string | null = null;
    for (const m of list) {
      const day = m.created_at != null ? formatDaySeparator(m.created_at) : null;
      if (day && day !== lastDay) {
        out.push({ kind: "day", label: day, key: `d-${m.id}` });
        lastDay = day;
      }
      out.push({
        kind: "msg",
        msg: m,
        own: !!user && m.sender_id === user.id,
        receipt: receiptFor(m, user?.id),
      });
    }
    for (const p of pending) {
      out.push({ kind: "pending", p, key: `p-${p.clientMsgId}` });
    }
    return out;
  }, [messages, pending, user]);

  return (
    <section className="call-chat-panel" role="region" aria-label="Chat pandan apèl la">
      <header className="call-chat-header">
        <button
          type="button"
          className="call-chat-back"
          onClick={onClose}
          aria-label="Retounen nan videyo a"
          title="Retounen nan videyo a"
        >
          <ArrowLeft size={18} aria-hidden />
          <span>Videyo</span>
        </button>
        <div className="call-chat-title" aria-live="polite">
          Chat
          {partnerTyping && <span className="call-chat-typing"> · lòt moun nan ekri...</span>}
        </div>
        {/* End call stays DISTINCT from Chat and Back to video: different
            action, different styling, explicit label. */}
        <button
          type="button"
          className="call-chat-end"
          onClick={onEndCall}
          aria-label="Fini apèl la"
          title="Fini apèl la"
        >
          <PhoneOff size={16} aria-hidden />
          <span>Fini apèl</span>
        </button>
      </header>

      <div className="call-chat-log" ref={logRef} role="log" aria-label="Istorik chat la">
        {messages === null && (
          <p className="call-chat-empty" role="status">
            N ap chaje mesaj yo...
          </p>
        )}
        {messages !== null && rows.length === 0 && (
          <p className="call-chat-empty">
            Pa gen mesaj pou kounye a. Ekri youn anba a — apèl la ap kontinye.
          </p>
        )}
        {rows.map((r) => {
          if (r.kind === "day") {
            return (
              <div className="call-chat-day" key={r.key} role="separator">
                <span>{r.label}</span>
              </div>
            );
          }
          if (r.kind === "pending") {
            return (
              <div className={`call-chat-row own ${r.p.failed ? "failed" : ""}`} key={r.key}>
                <div className="call-chat-bubble">
                  <p>{r.p.text}</p>
                  <span className="call-chat-meta">
                    {r.p.failed ? "Pa pase — eseye ankò" : "Ap voye..."}
                  </span>
                </div>
              </div>
            );
          }
          return (
            <div className={`call-chat-row ${r.own ? "own" : "partner"}`} key={r.msg.id}>
              <div className="call-chat-bubble">
                {r.msg.message_type === "text" || !r.msg.file_url ? (
                  <p>{r.msg.text}</p>
                ) : (
                  <p className="call-chat-meta">[Pyès ki ansèk — ouvri chat la pou wè l]</p>
                )}
                <span className="call-chat-meta">
                  {formatTime(r.msg.created_at)}
                  {r.own && r.receipt && <ReceiptTick state={r.receipt} />}
                </span>
              </div>
            </div>
          );
        })}
        {partnerTyping && (
          <div className="call-chat-row partner">
            <div className="call-chat-bubble typing" aria-label="Lòt moun nan ekri">
              <span className="dot" aria-hidden /> <span className="dot" aria-hidden />{" "}
              <span className="dot" aria-hidden />
            </div>
          </div>
        )}
      </div>

      <form className="call-chat-composer" onSubmit={handleSubmit}>
        <label htmlFor="call-chat-input" className="sr-only">
          Ekri yon mesaj
        </label>
        <input
          id="call-chat-input"
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ekri yon mesaj..."
          autoComplete="off"
          disabled={!token}
        />
        <button
          type="submit"
          className="call-chat-send"
          disabled={!token || sending || draft.trim().length === 0}
          aria-label="Voye mesaj la"
          title="Voye mesaj la"
        >
          <Send size={18} aria-hidden />
        </button>
      </form>
    </section>
  );
}

export default InCallChat;
