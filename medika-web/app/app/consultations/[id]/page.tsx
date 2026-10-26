"use client";

/**
 * Consultation chat — port of ChatScreen.kt.
 * REST bootstrap (consultation + messages) + live WebSocket events,
 * typing indicators, image sharing, voice/video call launch, and
 * doctor-only actions (consultation notes, prescription).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ClipboardList,
  ImagePlus,
  Info,
  NotebookPen,
  Phone,
  Send,
  Video,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { getConsultation, getMessages, uploadFile } from "@/lib/api/endpoints";
import type { Consultation, ServerMessage } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { fileSizeLabel, formatDaySeparator, formatTime } from "@/lib/format";
import { specialtyLabel, urgencyLabel } from "@/lib/labels";
import { wsEventToServerMessage } from "@/lib/ws/socket";
import { Avatar, ErrorAlert, Spinner } from "@/components/ui/primitives";
import { PrescriptionModal } from "@/components/consultation/PrescriptionModal";
import { PrescriptionPanel } from "@/components/consultation/PrescriptionPanel";

export default function ConsultationChatPage() {
  const { id } = useParams<{ id: string }>();
  const consultationId = String(id ?? "");
  const { token, user } = useAuth();
  const { socket } = useSocket();
  const router = useRouter();

  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [messages, setMessages] = useState<ServerMessage[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [showRx, setShowRx] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSent = useRef(0);

  const isDoctor = user?.role === "doctor";

  // ── Data bootstrap ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !consultationId) return;
    const controller = new AbortController();
    getConsultation(token, consultationId, controller.signal)
      .then((c) => {
        if (c == null) setNotFound(true);
        else {
          setConsultation(c);
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
  }, [token, consultationId]);

  // ── Live events ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event) => {
      if (event.type === "message:new") {
        const e = event as Parameters<typeof wsEventToServerMessage>[0];
        if (e.consultationId !== consultationId) return;
        setMessages((prev) => {
          const list = prev ?? [];
          if (list.some((m) => m.id === e.id)) return list;
          return [...list, wsEventToServerMessage(e)];
        });
      } else if (event.type === "typing") {
        const e = event as { consultationId: string; senderId: string; isTyping: boolean };
        if (e.consultationId !== consultationId || e.senderId === user?.id) return;
        setPartnerTyping(Boolean(e.isTyping));
        if (e.isTyping) {
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setPartnerTyping(false), 4000);
        }
      } else if (event.type === "consultation:updated") {
        const e = event as { id?: string };
        if (e.id === consultationId && token) {
          const controller = new AbortController();
          getConsultation(token, consultationId, controller.signal)
            .then((c) => {
              if (c) setConsultation(c);
            })
            .catch(() => undefined);
        }
      }
    });
  }, [socket, consultationId, user?.id, token]);

  // Auto-scroll to latest
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, partnerTyping]);

  // ── Composer ──────────────────────────────────────────────────────────────
  const notifyTyping = useCallback(
    (text: string) => {
      if (!socket || !user) return;
      const now = Date.now();
      if (text && now - lastTypingSent.current > 2000) {
        lastTypingSent.current = now;
        socket.sendTyping(consultationId, user.id, true);
      }
    },
    [socket, user, consultationId],
  );

  const onSend = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending || !socket || !user) return;
    setSending(true);
    const ok = socket.sendMessage(consultationId, user.id, user.name, text);
    setDraft("");
    if (ok) {
      socket.sendTyping(consultationId, user.id, false);
    } else {
      setError(
        new ApiError("network", 0, "Mesaj la pa t ale — n ap rekonekte. Tanpri, eseye ankò nan yon ti moman."),
      );
    }
    setSending(false);
  };

  const onPickImage = () => fileInputRef.current?.click();

  const onImageSelected = async (file: File | undefined) => {
    if (!file || !token || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const up = await uploadFile(token, file, consultationId);
      if (socket && user) {
        socket.sendMediaMessage(consultationId, user.id, user.name, {
          messageType: file.type.startsWith("video/") ? "video" : "image",
          fileUrl: up.url,
          fileSize: up.size,
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nou pa t kapab voye fichye a. Tanpri, eseye ankò.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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

  const partnerName = isDoctor ? consultation.patient_name : null;
  const canChat = consultation.status === "EN_COURS";
  const waiting = consultation.status === "RECHERCHE_MEDECIN";
  const refused = consultation.status === "REFUSE";
  const finished = consultation.status === "TERMINE";

  return (
    <div className="chat-shell">
      {/* Header */}
      <header className="app-header">
        <button
          className="icon-btn"
          onClick={() => router.push("/app/consultations")}
          aria-label="Retounen sou konsiltasyon yo"
        >
          <ArrowLeft size={20} />
        </button>
        <Avatar name={partnerName ?? user?.name} size="sm" alt={`Foto pwofil ${partnerName ?? "lòt moun nan"}`} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "0.95rem" }} className="nowrap">
            {partnerName ?? specialtyLabel(consultation.specialty_needed)}
          </div>
          <div className="tiny muted nowrap">
            {canChat
              ? partnerTyping
                ? "n ap ekri..."
                : "Konsiltasyon an ap dewoule"
              : waiting
                ? "N ap tann doktè a."
                : finished
                  ? "Konsiltasyon an fini."
                  : refused
                    ? "Demann lan refize"
                    : "—"}
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
      {refused && (
        <div className="alert alert-error" style={{ margin: 12, marginBottom: 0 }} role="status">
          Demann sa a refize. Ou ka{" "}
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
        {messages === null && <Spinner />}
        {messages !== null && (messages ?? []).length === 0 && (
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
              const isSystem = m.sender_id === "system";
              if (isSystem) {
                return (
                  <div key={m.id} className="chat-day">
                    <span className="tiny">{m.text}</span>
                  </div>
                );
              }
              return (
                <div key={m.id} className={`bubble-row ${isMine ? "mine" : ""}`}>
                  <div className="bubble">
                    {m.message_type === "image" && m.file_url && (
                      <a href={m.file_url} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.file_url} alt="Imaj pataje" className="bubble-image" loading="lazy" />
                      </a>
                    )}
                    {m.message_type === "video" && m.file_url && (
                      <video src={m.file_url} controls preload="metadata" style={{ maxWidth: "100%", borderRadius: 10 }} />
                    )}
                    {m.message_type === "voice" && m.file_url && (
                      <span className="audio-chip">
                        <Phone size={14} aria-hidden /> Mesaj vwa
                        <audio src={m.file_url} controls preload="metadata" />
                      </span>
                    )}
                    {m.text && <div>{m.text}</div>}
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
        {partnerTyping && (
          <div
            className="typing-row"
            role="status"
            aria-label="Lòt moun nan ap ekri"
          >
            <span className="typing-label">Lòt moun nan ap ekri</span>
            <div className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "0 12px" }}>
        <ErrorAlert error={error} />
      </div>

      {/* Composer */}
      {canChat ? (
        <form className="chat-composer" onSubmit={onSend}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(e) => onImageSelected(e.target.files?.[0])}
            aria-hidden
            tabIndex={-1}
          />
          <button
            type="button"
            className="composer-btn"
            onClick={onPickImage}
            disabled={uploading}
            aria-label="Vwayaje yon imaj oswa yon videyo"
            title="Vwayaje yon imaj oswa yon videyo"
          >
            {uploading ? (
              <span
                className="spin"
                style={{ borderColor: "var(--gray-300)", borderTopColor: "var(--gray-600)" }}
              />
            ) : (
              <ImagePlus size={20} />
            )}
          </button>
          <input
            className="input"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              notifyTyping(e.target.value);
            }}
            placeholder="Ekri mesaj ou..."
            aria-label="Mesaj ou"
            maxLength={4000}
          />
          <button
            type="submit"
            className="composer-btn send"
            disabled={!draft.trim() || sending}
            aria-label="Voye"
          >
            <Send size={19} />
          </button>
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
