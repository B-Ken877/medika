"use client";

/**
 * Consultation chat — Clinical Calm interface, extended with the messaging
 * upgrade: hardened typing indicators, partner presence, persistent read
 * receipts, private attachments (image/video/PDF), voice messages, an emoji
 * picker, and Haiti-timezone timestamps. The approved design (header,
 * context strip, bubbles, call actions, composer placement) is preserved.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ClipboardList,
  Info,
  MonitorPlay,
  NotebookPen,
  Phone,
  Send,
  Smile,
  Video,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { getConsultation, getMessages, markConsultationRead, sendConsultationMessage } from "@/lib/api/endpoints";
import type { Consultation, ServerMessage } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { fileSizeLabel, formatDaySeparator, formatTime } from "@/lib/format";
import { specialtyLabel, urgencyLabel } from "@/lib/labels";
import { wsEventToServerMessage } from "@/lib/ws/socket";
import { PartnerTypingTracker, TypingNotifier } from "@/lib/ws/typing";
import { PartnerRecordingTracker, RecordingSignaler } from "@/lib/ws/recording";
import { presenceFromEvent, presenceLabel, type PresenceState } from "@/lib/ws/presence";
import { applyMessagesRead, receiptFor, unreadIncomingIds, type ReceiptState } from "@/lib/chat/receipts";
import { insertAtCursor } from "@/lib/chat/emoji";
import { waitForMessageEcho, mergePersistedMessage } from "@/lib/chat/delivery";
import type { VoiceMode } from "@/lib/chat/voice";
import { uploadConsultationAttachment } from "@/lib/api/endpoints";
import { Avatar, ErrorAlert, Spinner } from "@/components/ui/primitives";
import OfferCountdown from "@/components/consultation/OfferCountdown";
import { PrescriptionModal } from "@/components/consultation/PrescriptionModal";
import { PrescriptionPanel } from "@/components/consultation/PrescriptionPanel";
import { SecureMedia } from "@/components/consultation/SecureMedia";
import { ReceiptTick } from "@/components/consultation/ReceiptTick";
import { AttachmentMenu } from "@/components/consultation/AttachmentMenu";
import { EmojiPicker } from "@/components/consultation/EmojiPicker";
import { VoiceRecorder } from "@/components/consultation/VoiceRecorder";
import { RemoteRecordingIndicator } from "@/components/consultation/RemoteRecordingIndicator";
import { useChatScroll } from "@/components/consultation/useChatScroll";

/** Optimistic entry while a durable send is unresolved. `failed` marks a
 *  total delivery failure (WS echo timeout AND REST fallback failed) — the
 *  entry then offers a retry that reuses the SAME clientMsgId (server-side
 *  idempotency) and the already-uploaded attachment when present. */
interface PendingMessage {
  clientMsgId: string;
  createdAt: number;
  text: string;
  messageType: "text" | "image" | "video" | "voice" | "file";
  fileUrl: string | null;
  fileSize: number | null;
  duration: number | null;
  failed?: boolean;
  /** In-memory File for the retry path (never serialized). */
  fileRef?: File | null;
  /** Already-uploaded attachment reference — a retry skips re-uploading. */
  attachmentRef?: { url: string; size: number } | null;
}

const UPLOAD_MAX_BYTES = 4 * 1024 * 1024; // keep in step with the server's MAX_UPLOAD_MB

function newClientMsgId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function ConsultationChatPage() {
  const { id } = useParams<{ id: string }>();
  const consultationId = String(id ?? "");
  const { token, user } = useAuth();
  const { socket, status: socketStatus } = useSocket();
  const router = useRouter();

  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [messages, setMessages] = useState<ServerMessage[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  /** Recipient-side voice-recording activity of the OTHER participant
   *  (issue #26) — ephemeral remote state, never a local chat-log bubble. */
  const [partnerRecording, setPartnerRecording] = useState(false);
  const [presence, setPresence] = useState<PresenceState>("unknown");
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ name: string; pct: number } | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showRx, setShowRx] = useState(false);
  /** Authoritative voice-composer mode — replaces the normal composer while
   *  recording / previewing / uploading a voice message. */
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("idle");

  const inputRef = useRef<HTMLInputElement>(null);
  const typingTrackerRef = useRef<PartnerTypingTracker | null>(null);
  const notifierRef = useRef<TypingNotifier | null>(null);
  const recordingTrackerRef = useRef<PartnerRecordingTracker | null>(null);
  const recordingSignalerRef = useRef<RecordingSignaler | null>(null);
  const markedRef = useRef<Set<number>>(new Set());
  /** Mirror of `pending` for retry lookups (state is async to read). */
  const pendingRef = useRef<PendingMessage[]>([]);
  /** Voice retry bookkeeping: the same File instance across recorder retries
   *  maps to the SAME clientMsgId so uploads/messages are never duplicated. */
  const voiceSendRef = useRef<{ file: File; clientMsgId: string } | null>(null);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const isDoctor = user?.role === "doctor";

  // ── Acceptance transition (issue #33): when a WAITING consultation is
  // confirmed accepted by the SERVER (refetch, not the event payload), guide
  // the patient to the video-first room. Duplicate/delayed events are safe —
  // the transition only ever fires on the real RECHERCHE_MEDECIN → EN_COURS
  // edge seen by THIS page's state.
  const prevStatusRef = useRef<string | null>(null);
  const [justAccepted, setJustAccepted] = useState(false);
  const applyConsultation = useCallback((c: Consultation) => {
    if (prevStatusRef.current === "RECHERCHE_MEDECIN" && c.status === "EN_COURS") {
      setJustAccepted(true);
    }
    prevStatusRef.current = c.status;
    setConsultation(c);
  }, []);

  // ── Data bootstrap ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !consultationId) return;
    markedRef.current = new Set();
    prevStatusRef.current = null;
    setJustAccepted(false);
    const controller = new AbortController();
    getConsultation(token, consultationId, controller.signal)
      .then((c) => {
        if (c == null) setNotFound(true);
        else {
          applyConsultation(c);
          setError(null);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.code === "not_found") setNotFound(true);
        else setError(err);
      });
    getMessages(token, consultationId, controller.signal)
      .then((list) => setMessages(Array.isArray(list) ? list : []))
      .catch(() => {
        if (!controller.signal.aborted) setMessages([]);
      });
    return () => controller.abort();
  }, [token, consultationId, applyConsultation]);

  // ── Outgoing typing signal (throttled, stopped on empty/blur/unmount) ────
  useEffect(() => {
    if (!socket || !user) return;
    notifierRef.current = new TypingNotifier((isTyping) => {
      socket.sendTyping(consultationId, user.id, isTyping);
    });
    return () => {
      // Leaving the conversation / consultation changed → explicit stop.
      notifierRef.current?.stop();
      notifierRef.current = null;
    };
  }, [socket, user, consultationId]);

  // ── Incoming typing state (timeout + reconnect safe) ─────────────────────
  useEffect(() => {
    const tracker = new PartnerTypingTracker();
    tracker.onExpire = () => setPartnerTyping(false);
    typingTrackerRef.current = tracker;
    return () => {
      tracker.clear();
      typingTrackerRef.current = null;
    };
  }, [consultationId]);

  // ── Outgoing recording ACTIVITY (issue #26) ──────────────────────────────
  // One signaler per (socket, consultation); it only ever fires while the
  // recorder's authoritative mode is "recording" — i.e. microphone capture
  // is genuinely running. Permission requests, preview, upload and retries
  // all use other modes, so nothing leaks from them.
  useEffect(() => {
    if (!socket) return;
    const signaler = new RecordingSignaler((isRecording) => {
      socket.sendRecording(consultationId, isRecording);
    });
    recordingSignalerRef.current = signaler;
    return () => {
      // Leaving the conversation / consultation changed / unmount → stop.
      signaler.stop();
      recordingSignalerRef.current = null;
    };
  }, [socket, consultationId]);

  // The recorder's mode IS the trigger: "recording" ⟺ capture active.
  useEffect(() => {
    if (voiceMode === "recording") recordingSignalerRef.current?.start();
    else recordingSignalerRef.current?.stop();
  }, [voiceMode]);

  // ── Incoming recording activity (timeout + reconnect safe) ──────────────
  useEffect(() => {
    const tracker = new PartnerRecordingTracker();
    tracker.onExpire = () => setPartnerRecording(false);
    recordingTrackerRef.current = tracker;
    return () => {
      tracker.clear();
      recordingTrackerRef.current = null;
    };
  }, [consultationId]);

  // A dropped socket must never leave a permanent "typing" or microphone
  // indicator behind.
  useEffect(() => {
    if (socketStatus !== "open") {
      typingTrackerRef.current?.clear();
      setPartnerTyping(false);
      recordingTrackerRef.current?.clear();
      setPartnerRecording(false);
    }
  }, [socketStatus]);

  // ── Partner presence (subscription + periodic correction) ────────────────
  const partnerId = useMemo(() => {
    if (!consultation) return null;
    return isDoctor ? consultation.patient_id : consultation.doctor_id ?? null;
  }, [consultation, isDoctor]);

  useEffect(() => {
    if (!socket || !consultationId || socketStatus !== "open") return;
    socket.sendPresenceSubscribe(consultationId);
    const t = setInterval(() => socket.sendPresenceSubscribe(consultationId), 60_000);
    return () => clearInterval(t);
  }, [socket, consultationId, socketStatus]);

  // ── Live events ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event) => {
      if (event.type === "message:new") {
        const e = event as Parameters<typeof wsEventToServerMessage>[0];
        if (e.clientMsgId) {
          // Persisted echo — resolves the optimistic entry.
          setPending((prev) => prev.filter((p) => p.clientMsgId !== e.clientMsgId));
        }
        if (e.consultationId !== consultationId) return;
        setMessages((prev) => {
          const list = prev ?? [];
          if (list.some((m) => m.id === e.id)) return list; // read state preserved on echo
          return [...list, wsEventToServerMessage(e)];
        });
      } else if (event.type === "typing") {
        const e = event as { consultationId: string; senderId: string; isTyping: boolean };
        const next = typingTrackerRef.current?.applyEvent(
          { type: "typing", consultationId: e.consultationId, senderId: e.senderId, isTyping: e.isTyping },
          { consultationId, selfId: user?.id },
        );
        if (next !== undefined) setPartnerTyping(next);
      } else if (event.type === "recording") {
        const e = event as { consultationId: string; senderId: string; isRecording: boolean };
        const next = recordingTrackerRef.current?.applyEvent(
          { type: "recording", consultationId: e.consultationId, senderId: e.senderId, isRecording: e.isRecording },
          { consultationId, selfId: user?.id },
        );
        if (next !== undefined) setPartnerRecording(next);
      } else if (event.type === "messages:read") {
        const e = event as Parameters<typeof applyMessagesRead>[1];
        if (e.consultationId !== consultationId || !user || e.readerId === user.id) return;
        setMessages((prev) => (prev ? applyMessagesRead(prev, e) : prev));
      } else if (event.type === "presence:update") {
        const next = presenceFromEvent(event as Parameters<typeof presenceFromEvent>[0], { partnerId });
        if (next) setPresence(next);
      } else if (event.type === "consultation:updated") {
        const e = event as { id?: string };
        if (e.id === consultationId && token) {
          const controller = new AbortController();
          getConsultation(token, consultationId, controller.signal)
            .then((c) => {
              if (c) applyConsultation(c);
            })
            .catch(() => undefined);
        }
      }
    });
  }, [socket, consultationId, user, token, partnerId, applyConsultation]);

  // ── Chat scroll (issue #16): open on the latest message, stick to the
  // bottom only while the user is there, count what arrives while reading
  // history, and offer a jump-to-latest affordance. The log content lives
  // inside a single .chat-log-inner wrapper so resizes (late image loads)
  // keep a pinned user pinned.
  const lastMessageId = messages?.length ? messages[messages.length - 1].id : null;
  const scrollContentVersion = `${consultationId}:${messages?.length ?? 0}:${lastMessageId ?? ""}:${pending.length}:${partnerTyping ? 1 : 0}:${partnerRecording ? 1 : 0}`;
  const { logRef, jumpVisible, jumpCount, jumpToLatest } = useChatScroll({
    conversationId: consultationId,
    ready: messages !== null,
    messageCount: (messages?.length ?? 0) + pending.length,
    contentVersion: scrollContentVersion,
  });

  // ── Mark incoming as read (visible conversations only) ───────────────────
  useEffect(() => {
    if (!token || !consultationId || !user || messages === null) return;
    if (typeof document === "undefined") return;
    const markNow = () => {
      if (document.visibilityState !== "visible") return; // background tab ≠ read
      const unread = unreadIncomingIds(messages, user.id).filter((mid) => !markedRef.current.has(mid));
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
          // Allow a later retry (message may still be unread server-side).
          unread.forEach((mid) => markedRef.current.delete(mid));
        });
    };
    markNow();
    document.addEventListener("visibilitychange", markNow);
    return () => document.removeEventListener("visibilitychange", markNow);
  }, [messages, token, consultationId, user]);

  // ── Composer ──────────────────────────────────────────────────────────────
  const notifyTyping = useCallback((text: string) => {
    notifierRef.current?.notify(text);
  }, []);

  /** Send through WS and wait for the PERSISTED echo (the hub emits it only
   *  after the INSERT); on timeout or a dead socket, persist through REST —
   *  a message is only "sent" once the server has actually stored it. Both
   *  paths carry the same clientMsgId, so a retry can never duplicate it. */
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
      const buffered = socket.sendMessage(consultationId, user.id, user.name, text, clientMsgId);
      if (!buffered) return restFallback();
      return waitForMessageEcho(socket, clientMsgId).then((echoed) =>
        echoed ? true : restFallback(),
      );
    },
    [socket, user, consultationId, token],
  );

  /** Media messages: upload privately, then send with durable semantics —
   *  the WS path must be ECHO-CONFIRMED (persisted), otherwise the REST
   *  fallback runs. Resolves true ONLY with persisted evidence, so a voice
   *  recording is never cleared on an unconfirmed send. Retries reuse the
   *  same clientMsgId + already-uploaded attachment (no duplicates, no
   *  redundant uploads). */
  const sendMedia = useCallback(
    async (
      file: File,
      kind: "image" | "video" | "file" | "voice",
      duration?: number,
      opts: {
        clientMsgId?: string;
        onProgress?: (fraction: number) => void;
      } = {},
    ): Promise<boolean> => {
      if (!token || !user || !consultationId) return false;
      const clientMsgId = opts.clientMsgId ?? newClientMsgId();
      const prior = pendingRef.current.find((p) => p.clientMsgId === clientMsgId);
      const showStripProgress = !opts.onProgress; // voice renders its own progress

      // Create-or-retry the optimistic entry.
      setPending((prev) => {
        const idx = prev.findIndex((p) => p.clientMsgId === clientMsgId);
        if (idx === -1) {
          return [
            ...prev,
            {
              clientMsgId,
              createdAt: Math.floor(Date.now() / 1000),
              text: kind === "file" ? file.name : "",
              messageType: kind,
              fileUrl: prior?.attachmentRef?.url ?? null,
              fileSize: prior?.attachmentRef?.size ?? file.size,
              duration: duration ?? null,
              failed: false,
              fileRef: file,
              attachmentRef: prior?.attachmentRef ?? null,
            },
          ];
        }
        const next = prev.slice();
        next[idx] = { ...next[idx], failed: false };
        return next;
      });

      const reportProgress = (fraction: number) => {
        opts.onProgress?.(fraction);
        if (showStripProgress) {
          setUploadProgress({ name: file.name, pct: Math.round(fraction * 100) });
        }
      };

      try {
        if (file.size > UPLOAD_MAX_BYTES) {
          throw new ApiError("validation", 413, "Fichye a twò gwo. Redwi li anvan ou voye l.");
        }
        // Reuse an already-uploaded attachment on retry (skip re-upload).
        let up = prior?.attachmentRef ?? null;
        if (!up) {
          const uploaded = await uploadConsultationAttachment(token, consultationId, file, {
            onProgress: reportProgress,
          });
          up = { url: uploaded.url, size: uploaded.size };
          const attachmentRef = { url: uploaded.url, size: uploaded.size };
          setPending((prev) =>
            prev.map((p) =>
              p.clientMsgId === clientMsgId
                ? { ...p, fileUrl: uploaded.url, fileSize: uploaded.size, attachmentRef }
                : p,
            ),
          );
        }
        reportProgress(1);

        const meta = {
          messageType: kind,
          fileUrl: up.url,
          fileSize: up.size,
          duration: duration ?? null,
        };

        let persisted = false;
        if (socket) {
          const buffered = socket.sendMediaMessage(consultationId, user.id, user.name, meta, clientMsgId);
          if (buffered) {
            persisted = await waitForMessageEcho(socket, clientMsgId);
          }
        }
        if (!persisted) {
          // REST fallback — idempotent: returns the original row when the WS
          // frame actually made it, so no duplicate bubbles ever appear.
          const msg = await sendConsultationMessage(token, consultationId, {
            messageType: kind,
            text: kind === "file" ? file.name : "",
            fileUrl: up.url,
            fileSize: up.size,
            duration: duration ?? null,
            clientMsgId,
          });
          setMessages((prev) => (prev ? mergePersistedMessage(prev, msg) : [msg]));
          persisted = true;
        }
        setPending((prev) => prev.filter((p) => p.clientMsgId !== clientMsgId));
        return true;
      } catch (err) {
        if (showStripProgress) setUploadProgress(null);
        setPending((prev) =>
          prev.map((p) => (p.clientMsgId === clientMsgId ? { ...p, failed: true } : p)),
        );
        setError(
          err instanceof ApiError
            ? err
            : new ApiError("network", 0, "Nou pa t kapab voye fichye a. Tanpri, eseye ankò."),
        );
        return false;
      } finally {
        if (showStripProgress) setUploadProgress(null);
      }
    },
    [token, user, consultationId, socket],
  );

  /** Voice onSend wrapper: recorder retries present the SAME File instance —
   *  map it to the SAME clientMsgId so retries never duplicate. */
  const handleVoiceSend = useCallback(
    async (file: File, duration: number, onProgress?: (fraction: number) => void) => {
      let entry = voiceSendRef.current && voiceSendRef.current.file === file ? voiceSendRef.current : null;
      if (!entry) {
        entry = { file, clientMsgId: newClientMsgId() };
        voiceSendRef.current = entry;
      }
      const ok = await sendMedia(file, "voice", duration, {
        clientMsgId: entry.clientMsgId,
        onProgress,
      });
      if (ok) voiceSendRef.current = null;
      return ok;
    },
    [sendMedia],
  );

  /** Voice discard: drop any failed pending entry for the discarded clip. */
  const handleVoiceDiscard = useCallback(() => {
    const id = voiceSendRef.current?.clientMsgId;
    voiceSendRef.current = null;
    if (!id) return;
    setPending((prev) => prev.filter((p) => p.clientMsgId !== id));
  }, []);

  const retryPending = useCallback(
    (entry: PendingMessage) => {
      // Voice retries through the recorder (clip preserved there); text
      // failures restore the draft instead — only media entries retry here.
      if (!entry.fileRef) return;
      if (entry.messageType !== "image" && entry.messageType !== "video" && entry.messageType !== "file") {
        return;
      }
      void sendMedia(entry.fileRef, entry.messageType, entry.duration ?? undefined, {
        clientMsgId: entry.clientMsgId,
      });
    },
    [sendMedia],
  );

  const dismissPending = useCallback((clientMsgId: string) => {
    setPending((prev) => prev.filter((p) => p.clientMsgId !== clientMsgId));
  }, []);

  const onSend = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending || !socket || !user) return;
    const clientMsgId = newClientMsgId();
    setSending(true);
    setPending((prev) => [
      ...prev,
      {
        clientMsgId,
        createdAt: Math.floor(Date.now() / 1000),
        text,
        messageType: "text",
        fileUrl: null,
        fileSize: null,
        duration: null,
      },
    ]);
    setDraft("");
    sendText(text, clientMsgId)
      .then((ok) => {
        if (ok) {
          notifierRef.current?.stop(); // explicit typing:false after the send
        } else {
          // Neither transport persisted it: restore the draft, drop the bubble.
          setPending((prev) => prev.filter((p) => p.clientMsgId !== clientMsgId));
          setDraft(text);
          setError(
            new ApiError("network", 0, "Mesaj la pa t ale — n ap rekonekte. Tanpri, eseye ankò nan yon ti moman."),
          );
        }
      })
      .finally(() => setSending(false));
  };

  const onEmojiPick = useCallback(
    (emoji: string) => {
      const input = inputRef.current;
      const caret = input ? (input.selectionStart ?? draft.length) : draft.length;
      const result = insertAtCursor(draft, emoji, caret);
      if (!result) return;
      setDraft(result.value);
      notifyTyping(result.value);
      requestAnimationFrame(() => {
        input?.focus();
        try {
          input?.setSelectionRange(result.caret, result.caret);
        } catch {
          /* input not focusable */
        }
      });
    },
    [draft, notifyTyping],
  );

  // ── Render helpers ────────────────────────────────────────────────────────
  const days = useMemo(() => {
    const out: { day: string; items: ServerMessage[] }[] = [];
    for (const m of messages ?? []) {
      const day = formatDaySeparator(m.created_at ?? undefined);
      if (out.length === 0 || out[out.length - 1].day !== day) out.push({ day, items: [m] });
      else out[out.length - 1].items.push(m);
    }
    return out;
  }, [messages]);

  if (notFound) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
        <ErrorAlert error={new ApiError("not_found", 404, "Nou pa jwenn konsiltasyon sa a, oswa ou pa gen otorizasyon pou wè l.")} />
        <Link href="/app/consultations" className="btn btn-secondary btn-block">
          Retounen sou konsiltasyon yo
        </Link>
      </div>
    );
  }

  if (!consultation) {
    return <Spinner label="N ap chaje konsiltasyon an..." />;
  }

  // ── Video-first room affordance (issue #33) ─────────────────────────────
  const roomHref = `/app/consultations/${encodeURIComponent(consultationId)}/room`;

  const partnerName = isDoctor ? consultation.patient_name : null;
  const canChat = consultation.status === "EN_COURS";
  const waiting = consultation.status === "RECHERCHE_MEDECIN";
  const refused = consultation.status === "REFUSE";
  const finished = consultation.status === "TERMINE";
  const expired = consultation.status === "EXPIRE";

  const subtitle = canChat
    ? partnerTyping
      ? "Ap ekri..."
      : presence !== "unknown" && partnerId
        ? presenceLabel(presence)
        : "Konsiltasyon an ap dewoule"
    : waiting
      ? "N ap tann doktè a."
      : finished
        ? "Konsiltasyon an fini."
        : refused
          ? "Demann lan refize"
          : expired
            ? "Konsiltasyon an ekspire."
            : "—";

  const renderBubble = (
    m: {
      id: number | string;
      text: string;
      createdAt: number;
      messageType: string;
      fileUrl: string | null;
      fileSize: number | null;
      duration: number | null;
      senderId: string;
      receipt?: ReceiptState | null;
    },
    optimistic: boolean,
  ) => (
    <div key={m.id} className={`bubble-row mine ${optimistic ? "optimistic" : ""}`}>
      <div className="bubble">
        {m.messageType === "image" && m.fileUrl && token && !optimistic && (
          <SecureMedia
            message={{
              id: Number(m.id),
              consultation_id: consultationId,
              sender_id: m.senderId,
              sender_name: "",
              text: m.text,
              message_type: "image",
              file_url: m.fileUrl,
              file_size: m.fileSize,
              duration: null,
            }}
            token={token}
          />
        )}
        {m.messageType === "image" && (optimistic || !m.fileUrl) && (
          <div className="media-fallback">N ap voye imaj la…</div>
        )}
        {m.messageType === "video" && m.fileUrl && token && !optimistic && (
          <SecureMedia
            message={{
              id: Number(m.id),
              consultation_id: consultationId,
              sender_id: m.senderId,
              sender_name: "",
              text: m.text,
              message_type: "video",
              file_url: m.fileUrl,
              file_size: m.fileSize,
              duration: null,
            }}
            token={token}
          />
        )}
        {m.messageType === "video" && (optimistic || !m.fileUrl) && (
          <div className="media-fallback">N ap voye videyo a…</div>
        )}
        {m.messageType === "voice" && m.fileUrl && token && !optimistic && (
          <SecureMedia
            message={{
              id: Number(m.id),
              consultation_id: consultationId,
              sender_id: m.senderId,
              sender_name: "",
              text: "",
              message_type: "voice",
              file_url: m.fileUrl,
              file_size: m.fileSize,
              duration: m.duration,
            }}
            token={token}
          />
        )}
        {m.messageType === "voice" && (optimistic || !m.fileUrl) && (
          <div className="media-fallback">N ap voye mesaj vwa a…</div>
        )}
        {m.messageType === "file" && m.fileUrl && token && !optimistic && (
          <SecureMedia
            message={{
              id: Number(m.id),
              consultation_id: consultationId,
              sender_id: m.senderId,
              sender_name: "",
              text: m.text,
              message_type: "file",
              file_url: m.fileUrl,
              file_size: m.fileSize,
              duration: null,
            }}
            token={token}
          />
        )}
        {m.messageType === "file" && (optimistic || !m.fileUrl) && (
          <div className="media-fallback">N ap voye dokiman an…</div>
        )}
        {m.text && m.messageType !== "file" && <div>{m.text}</div>}
        <div className="bubble-meta">
          {formatTime(m.createdAt)}
          {m.fileSize ? ` · ${fileSizeLabel(m.fileSize)}` : ""}
          {m.receipt && <ReceiptTick state={m.receipt} />}
        </div>
      </div>
    </div>
  );

  return (
    <div className="chat-shell">
      {/* Header */}
      <header className="app-header">
        <button
          className="icon-btn"
          onClick={() => router.push("/app/consultations")}
          aria-label="Retounen sur konsiltasyon yo"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="presence-avatar">
          <Avatar name={partnerName ?? user?.name} size="sm" alt={`Foto pwofil ${partnerName ?? "lòt moun nan"}`} />
          {canChat && presence !== "unknown" && partnerId && (
            <span
              className={`presence-dot ${presence}`}
              aria-hidden
            />
          )}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "0.95rem" }} className="nowrap">
            {partnerName ?? specialtyLabel(consultation.specialty_needed)}
          </div>
          <div className="tiny muted nowrap" aria-live="polite">
            {subtitle}
            {canChat && presence !== "unknown" && partnerId && (
              <span className="sr-only">{presence === "online" ? " — Sou entènèt" : " — Pa sou entènèt"}</span>
            )}
          </div>
        </div>
        <div className="header-actions">
          {isDoctor && canChat && (
            <Link
              href={`/app/consultations/${encodeURIComponent(consultationId)}/notes`}
              className="icon-btn"
              aria-label="Nòt konsiltasyon"
              title="Nòt konsiltasyon"
            >
              <NotebookPen size={19} />
            </Link>
          )}
          {canChat && (
            <>
              <Link
                href={`/app/consultations/${encodeURIComponent(consultationId)}/call?mode=voice`}
                className="icon-btn"
                aria-label="Apèl vwa"
                title="Apèl vwa"
              >
                <Phone size={19} />
              </Link>
              <Link
                href={`/app/consultations/${encodeURIComponent(consultationId)}/call?mode=video`}
                className="icon-btn"
                aria-label="Apèl videyo"
                title="Apèl videyo"
              >
                <Video size={19} />
              </Link>
            </>
          )}
        </div>
      </header>

      {/* Video-first room entry (issue #33): the consultation's primary
          surface is the video room; chat is the supporting tool. Shown while
          the consultation is active — one tap to the room, one tap back. */}
      {canChat && justAccepted && (
        <div className="alert alert-success room-entry-bar" role="status">
          <MonitorPlay size={17} aria-hidden />
          <span style={{ flex: 1 }}>Doktè a aksepte demann lan — konsiltasyon an kòmanse!</span>
          <Link href={roomHref} className="btn btn-primary btn-sm">
            Antre nan sal videyo a
          </Link>
        </div>
      )}
      {canChat && !justAccepted && (
        <div className="room-entry-bar quiet" role="presentation">
          <MonitorPlay size={15} aria-hidden />
          <span style={{ flex: 1 }} className="tiny">Konsiltasyon an ap dewoule nan sal videyo a.</span>
          <Link href={roomHref} className="btn btn-secondary btn-sm">
            Ouvri sal videyo a
          </Link>
        </div>
      )}

      {/* Context strip */}
      <div
        className="flex"
        style={{
          gap: 8,
          padding: "10px 16px",
          background: "var(--gray-50)",
          borderBottom: "1px solid var(--gray-200)",
          fontSize: "0.8rem",
          color: "var(--text-secondary)",
          flexWrap: "wrap",
        }}
      >
        <Info size={14} aria-hidden style={{ flexShrink: 0 }} />
        <span className="nowrap">{specialtyLabel(consultation.specialty_needed)}</span>
        <span>·</span>
        <span>Ijans: {urgencyLabel(consultation.urgency_level)}</span>
        {consultation.patient_age != null && consultation.patient_age !== "" && (
          <>
            <span>·</span>
            <span>{consultation.patient_age} an</span>
          </>
        )}
      </div>

      {waiting && (
        <div className="alert alert-warning" style={{ margin: 12, marginBottom: 0 }} role="status">
          N ap tann doktè a. Ou ap resevwa yon notifikasyon le li aksepte demann lan.
        </div>
      )}
      {canChat && consultation.expires_at != null && (
        <div className="alert alert-info" style={{ margin: 12, marginBottom: 0 }} role="status">
          <OfferCountdown deadline={consultation.expires_at} label="Konsiltasyon an ekspire nan:" warnUnderSeconds={30 * 60} />{" "}
          L istorik mesaj yo ap konsève.
        </div>
      )}
      {refused && (
        <div className="alert alert-error" style={{ margin: 12, marginBottom: 0 }} role="status">
          Demann sa a refize. Ou ka{" "}
          <Link href="/app/consult" className="nowrap">
            kreye yon nouvo konsiltasyon
          </Link>
          .
        </div>
      )}
      {expired && (
        <div className="alert alert-error" style={{ margin: 12, marginBottom: 0 }} role="status">
          Konsiltasyon sa a ekspire otomatikman apre 5 zè. Istorik mesaj yo konsève. Ou ka{" "}
          <Link href="/app/consult" className="nowrap">
            kreye yon nouvo konsiltasyon
          </Link>
          .
        </div>
      )}

      {/* Prescription (patient view, when finished) */}
      {finished && consultation.prescription && !isDoctor && <PrescriptionPanel consultation={consultation} />}

      {/* Chat log */}
      <div className="chat-log" ref={logRef} role="log" aria-label="Mesaj konsiltasyon an" aria-live="polite">
       <div className="chat-log-inner">
        {messages === null && <Spinner />}
        {messages !== null && (messages ?? []).length === 0 && pending.length === 0 && (
          <div className="empty-state">
            <h3>Kòmanse konvèsasyon an</h3>
            <p className="small">Mesaj ou yo ap parèt isit.</p>
          </div>
        )}
        {days.map((group) => (
          <div key={group.day + String(group.items[0]?.id)}>
            <div className="chat-day">
              <span>{group.day}</span>
            </div>
            {group.items.map((m) => {
              const isMine = m.sender_id === user?.id;
              if (m.sender_id === "system") {
                return (
                  <div key={m.id} className="chat-day">
                    <span className="tiny">{m.text}</span>
                  </div>
                );
              }
              if (isMine) {
                return renderBubble(
                  {
                    id: m.id,
                    text: m.text,
                    createdAt: m.created_at ?? Math.floor(Date.now() / 1000),
                    messageType: String(m.message_type ?? "text"),
                    fileUrl: m.file_url ?? null,
                    fileSize: m.file_size ?? null,
                    duration: m.duration ?? null,
                    senderId: m.sender_id,
                    receipt: receiptFor(m, user?.id),
                  },
                  false,
                );
              }
              return (
                <div key={m.id} className="bubble-row">
                  <div className="bubble">
                    {m.message_type === "image" && m.file_url && token && (
                      <SecureMedia message={m} token={token} />
                    )}
                    {m.message_type === "video" && m.file_url && token && (
                      <SecureMedia message={m} token={token} />
                    )}
                    {m.message_type === "voice" && m.file_url && token && (
                      <SecureMedia message={m} token={token} />
                    )}
                    {m.message_type === "file" && m.file_url && token && (
                      <SecureMedia message={m} token={token} />
                    )}
                    {m.text && m.message_type !== "file" && <div>{m.text}</div>}
                    <div className="bubble-meta">
                      {formatTime(m.created_at ?? undefined)}
                      {m.file_size ? ` · ${fileSizeLabel(m.file_size)}` : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {/* Optimistic (unconfirmed) own messages */}
        {pending.map((p) => (
          <div key={p.clientMsgId}>
            {renderBubble(
              {
                id: p.clientMsgId,
                text: p.text,
                createdAt: p.createdAt,
                messageType: p.messageType,
                fileUrl: p.fileUrl,
                fileSize: p.fileSize,
                duration: p.duration,
                senderId: user?.id ?? "",
                receipt: "pending",
              },
              true,
            )}
            {p.failed && p.messageType !== "voice" && (
              <div className="pending-failed-row" role="alert">
                <span className="tiny">Pake voye. </span>
                {p.fileRef && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => retryPending(p)}
                  >
                    Eseye ankò
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => dismissPending(p.clientMsgId)}
                >
                  Retire
                </button>
              </div>
            )}
          </div>
        ))}
        {/* Remote voice-recording activity (issue #26): the OTHER
            participant's microphone is live — a transient incoming-style
            status row, NOT a message. The sender's own chat log never shows
            a recording bubble; their controls live in the composer. */}
        {partnerRecording && <RemoteRecordingIndicator />}
        {partnerTyping && (
          <div
            className="typing-row"
            role="status"
            aria-label="Lòt moun nan ap ekri"
          >
            <span className="typing-label">Ap ekri...</span>
            <div className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
       </div>
      </div>

      {/* Jump to latest (issue #16): shown while the user is reading older
          messages; counts what arrived in the meantime. */}
      {jumpVisible && (
        <button type="button" className="jump-latest" onClick={jumpToLatest}>
          <ArrowDown size={15} aria-hidden />
          {jumpCount > 0 ? `${jumpCount} mesaj nouvo` : "Dènye mesaj yo"}
        </button>
      )}

      <div style={{ padding: "0 12px" }}>
        <ErrorAlert error={error} />
      </div>

      {/* Composer — the normal row is REPLACED by the voice surface while a
          recording / preview / upload is active (one authoritative mode). */}
      {canChat ? (
        <form className="chat-composer" onSubmit={onSend}>
          {voiceMode === "idle" && uploadProgress ? (
            <div className="upload-progress" role="status" aria-label="N ap voye fichye a">
              <span className="tiny upload-name">{uploadProgress.name}</span>
              <div className="upload-bar" aria-hidden>
                <span style={{ width: `${uploadProgress.pct}%` }} />
              </div>
              <span className="tiny">{uploadProgress.pct}%</span>
            </div>
          ) : (
            <>
              {voiceMode === "idle" && (
                <>
                  <AttachmentMenu
                    disabled={Boolean(uploadProgress) || sending}
                    onFile={(file, kind) => {
                      void sendMedia(file, kind);
                    }}
                  />
                  <div className="emoji-wrap">
                    <button
                      type="button"
                      className="composer-btn"
                      onClick={() => setShowEmoji((v) => !v)}
                      aria-expanded={showEmoji}
                      aria-haspopup="dialog"
                      aria-label="Ajoute yon emoji"
                      title="Ajoute yon emoji"
                    >
                      <Smile size={20} />
                    </button>
                    {showEmoji && <EmojiPicker onPick={onEmojiPick} onClose={() => setShowEmoji(false)} />}
                  </div>
                  <input
                    ref={inputRef}
                    className="input"
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      notifyTyping(e.target.value);
                    }}
                    onBlur={() => notifierRef.current?.stop()}
                    placeholder="Ekri mesaj ou..."
                    aria-label="Mesaj ou"
                    maxLength={4000}
                  />
                  {draft.trim() && (
                    <button
                      type="submit"
                      className="composer-btn send"
                      disabled={sending}
                      aria-label="Voye"
                    >
                      <Send size={19} />
                    </button>
                  )}
                </>
              )}
              <VoiceRecorder
                disabled={Boolean(uploadProgress) || sending || voiceMode !== "idle"}
                maxBytes={UPLOAD_MAX_BYTES}
                onSend={handleVoiceSend}
                onPermissionError={() =>
                  setError(
                    new ApiError(
                      "forbidden",
                      403,
                      "Pèmèt aksè ak mikwofòn pou anrejistre mesaj vwa a.",
                    ),
                  )
                }
                onModeChange={setVoiceMode}
                onDiscard={handleVoiceDiscard}
              />
            </>
          )}
        </form>
      ) : (
        <div
          className="chat-composer"
          style={{ justifyContent: "center", color: "var(--text-secondary)", fontSize: "0.85rem" }}
        >
          {finished
            ? "Konsiltasyon an fini — konvèsasyon an an lekti sèlman."
            : waiting
              ? "Konvèsasyon an ap louvri le yon doktè fin aksepte l."
              : "Konvèsasyon an pa disponib."}
        </div>
      )}

      {/* Doctor: write prescription */}
      {isDoctor && canChat && (
        <div
          style={{
            padding: "10px 12px calc(14px + env(safe-area-inset-bottom, 0px))",
            background: "var(--surface)",
            borderTop: "1px solid var(--gray-200)",
          }}
        >
          <button className="btn btn-secondary btn-block" onClick={() => setShowRx(true)}>
            <ClipboardList size={16} aria-hidden /> Ekri òrdònans lan epi fèmen konsiltasyon an
          </button>
        </div>
      )}

      {showRx && (
        <PrescriptionModal
          consultation={consultation}
          onClose={() => setShowRx(false)}
          onSaved={(c) => {
            setShowRx(false);
            setConsultation(c);
          }}
        />
      )}
    </div>
  );
}
