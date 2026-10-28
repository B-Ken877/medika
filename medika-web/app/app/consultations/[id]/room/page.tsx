"use client";

/**
 * Consultation ROOM — the video-first home of an active consultation
 * (issue #33, testing phase).
 *
 * Klinik Medika is a face-to-face teleconsultation service, not a chat app:
 * this screen makes the VIDEO surface dominant, while the existing chat
 * remains one tap away as the supporting tool.
 *
 * IMPORTANT scope constraint honored here: the video area is a PLACEHOLDER.
 * This page never joins a LiveKit room, never requests camera/microphone
 * permissions, never mints call tokens and never claims a call is live.
 * Real calling stays on the existing /call routes (unchanged).
 *
 * State handling follows the existing architecture: the server state from
 * GET /api/consultations is authoritative; realtime consultation:updated
 * events (and socket reconnects) trigger a REFETCH, so refresh, delayed
 * events, offline/reconnect and duplicate events are all safe — no
 * navigation loops, no second consultation or message store.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Hourglass,
  MessageCircle,
  Phone,
  Video as VideoIcon,
  VideoOff,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { getConsultation } from "@/lib/api/endpoints";
import type { Consultation } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { specialtyLabel, urgencyLabel } from "@/lib/labels";
import { presenceFromEvent, presenceLabel, type PresenceState } from "@/lib/ws/presence";
import { Avatar, ErrorAlert, Spinner } from "@/components/ui/primitives";
import OfferCountdown from "@/components/consultation/OfferCountdown";

export default function ConsultationRoomPage() {
  const { id } = useParams<{ id: string }>();
  const consultationId = String(id ?? "");
  const { token, user } = useAuth();
  const { socket, status: socketStatus } = useSocket();
  const router = useRouter();

  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(false);
  const [presence, setPresence] = useState<PresenceState>("unknown");

  const isDoctor = user?.role === "doctor";

  // ── Data bootstrap (server state is the single source of truth) ──────────
  const load = useCallback(() => {
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
    return () => controller.abort();
  }, [token, consultationId]);

  useEffect(() => {
    const cleanup = load();
    return () => cleanup?.();
  }, [load]);

  const partnerId = useMemo(() => {
    if (!consultation) return null;
    return isDoctor ? consultation.patient_id : consultation.doctor_id ?? null;
  }, [consultation, isDoctor]);

  const partnerName = useMemo(() => {
    if (!consultation) return null;
    // Same contract as the chat page: doctors see the patient's name;
    // patients fall back to the specialty label (no doctor_name in the API).
    return isDoctor ? consultation.patient_name : null;
  }, [consultation, isDoctor]);

  // ── Realtime: refetch on consultation:updated; duplicate/delayed events are
  //    harmless because state is always RE-DERIVED from the server response.
  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event) => {
      if (event.type === "consultation:updated") {
        const e = event as { id?: string };
        if (e.id === consultationId) load();
      } else if (event.type === "presence:update") {
        const next = presenceFromEvent(event as Parameters<typeof presenceFromEvent>[0], { partnerId });
        if (next) setPresence(next);
      }
    });
  }, [socket, consultationId, partnerId, load]);

  // Reconnect safety: a socket that dropped and came back may have missed
  // events — resubscribe to the partner's presence and refetch the state.
  useEffect(() => {
    if (socketStatus === "open" && socket && consultationId) {
      socket.sendPresenceSubscribe(consultationId);
      load();
    }
  }, [socketStatus, socket, consultationId, load]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const canChat = consultation?.status === "EN_COURS";
  const waiting = consultation?.status === "RECHERCHE_MEDECIN";
  const finished = consultation?.status === "TERMINE";
  const refused = consultation?.status === "REFUSE";
  const expired = consultation?.status === "EXPIRE";

  const chatHref = `/app/consultations/${encodeURIComponent(consultationId)}`;

  if (notFound) {
    return (
      <div className="stack" style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}>
        <div className="empty-state">
          <h3>Nou pa jwenn konsiltasyon sa a.</h3>
          <p className="small">Li ka te retire, oswa lyen an pa bon.</p>
          <Link href="/app/consultations" className="btn btn-secondary">
            <ArrowLeft size={16} aria-hidden /> Retounen sur konsiltasyon yo
          </Link>
        </div>
      </div>
    );
  }

  if (!consultation) {
    // Loading (no error yet) or a failed bootstrap — distinct, accessible.
    if (!error) {
      return (
        <div style={{ minHeight: "60dvh", display: "grid", placeItems: "center" }}>
          <Spinner label="N ap chaje sal konsiltasyon an..." />
        </div>
      );
    }
    // Room-specific message while preserving the original error category
    // (kept out of the UI; never leak backend internals to users).
    const displayError = new ApiError(
      error instanceof ApiError ? error.code : "server",
      error instanceof ApiError ? error.status : 0,
      "Nou pa t kapab chaje sal konsiltasyon an. Tanpri, eseye ankò.",
    );
    return (
      <div className="stack" style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}>
        <ErrorAlert error={displayError} onRetry={load} />
        <Link href="/app/consultations" className="btn btn-secondary">
          <ArrowLeft size={16} aria-hidden /> Retounen sur konsiltasyon yo
        </Link>
      </div>
    );
  }

  return (
    <div className="room-shell">
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
          <Avatar
            name={partnerName ?? user?.name}
            size="sm"
            alt={`Foto pwofil ${partnerName ?? "lòt moun nan"}`}
          />
          {canChat && presence !== "unknown" && partnerId && (
            <span className={`presence-dot ${presence}`} aria-hidden />
          )}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "0.95rem" }} className="nowrap">
            {partnerName ?? specialtyLabel(consultation.specialty_needed)}
          </div>
          <div className="tiny muted nowrap" aria-live="polite">
            {canChat
              ? presence !== "unknown" && partnerId
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
                      : "—"}
          </div>
        </div>
        <div className="header-actions">
          <Link href={chatHref} className="btn btn-secondary btn-sm room-chat-btn" aria-label="Ouvri chat la">
            <MessageCircle size={16} aria-hidden /> Chat
          </Link>
        </div>
      </header>

      {/* Dominant video stage (PLACEHOLDER — no call is ever started here) */}
      <main className="room-stage">
        <div
          className={`room-placeholder ${waiting ? "waiting" : canChat ? "active" : "terminal"}`}
          role="region"
          aria-label="Zòn videyo konsiltasyon an"
        >
          <div className="room-avatar-wrap">
            <Avatar name={partnerName ?? specialtyLabel(consultation.specialty_needed)} size="lg" alt="" />
            {canChat && presence === "online" && (
              <span className="presence-dot online room-presence" aria-hidden />
            )}
          </div>

          <h2 className="room-title">
            {partnerName ?? specialtyLabel(consultation.specialty_needed)}
          </h2>
          <p className="room-subtitle">{specialtyLabel(consultation.specialty_needed)}</p>

          {waiting && (
            <p className="room-status waiting" role="status">
              <Hourglass size={16} aria-hidden /> N ap tann doktè a aksepte demann lan. Sal la ap
              louvri otomatikman le li pare.
            </p>
          )}
          {canChat && (
            <p className="room-status active" role="status">
              <VideoOff size={16} aria-hidden /> Zòn videyo a pare pou konsiltasyon sa a. Koneksyon
              videyo dirèk ap disponib byento — pou kounye a, sèvi ak chat la oswa apèl yo anba a.
            </p>
          )}
          {finished && (
            <p className="room-status" role="status">
              <CheckCircle2 size={16} aria-hidden /> Konsiltasyon sa a fini. Istorik mesaj yo ak
              òrdònans lan rete disponib nan chat la.
            </p>
          )}
          {(refused || expired) && (
            <p className="room-status" role="status">
              <CalendarCheck size={16} aria-hidden />{" "}
              {expired
                ? "Konsiltasyon sa a ekspire otomatikman apre 5 zè."
                : "Demann sa a refize."}{" "}
              Ou ka kreye yon nouvo demann konsiltasyon.
            </p>
          )}

          {canChat && consultation.expires_at != null && (
            <div className="room-countdown">
              <Clock size={14} aria-hidden />
              <OfferCountdown deadline={consultation.expires_at} label="Konsiltasyon an ekspire nan:" compact warnUnderSeconds={30 * 60} />
            </div>
          )}
        </div>

        {/* Consultation context */}
        <div className="room-context" aria-label="Kontèks konsiltasyon an">
          <span className="nowrap">{specialtyLabel(consultation.specialty_needed)}</span>
          <span aria-hidden>·</span>
          <span>Ijans: {urgencyLabel(consultation.urgency_level)}</span>
          {consultation.patient_age != null && consultation.patient_age !== "" && (
            <>
              <span aria-hidden>·</span>
              <span>{consultation.patient_age} an</span>
            </>
          )}
        </div>

        {/* Controls */}
        <div className="room-controls" role="group" aria-label="Aksyon konsiltasyon">
          <Link href={chatHref} className="btn btn-primary">
            <MessageCircle size={17} aria-hidden /> Ouvri chat la
          </Link>
          {canChat && (
            <>
              <Link
                href={`/app/consultations/${encodeURIComponent(consultationId)}/call?mode=voice`}
                className="btn btn-secondary"
                aria-label="Apèl vwa"
              >
                <Phone size={17} aria-hidden /> Apèl vwa
              </Link>
              <Link
                href={`/app/consultations/${encodeURIComponent(consultationId)}/call?mode=video`}
                className="btn btn-secondary"
                aria-label="Apèl videyo"
              >
                <VideoIcon size={17} aria-hidden /> Apèl videyo
              </Link>
            </>
          )}
          {(waiting || refused || expired) && (
            <Link href="/app/consult" className="btn btn-secondary">
              Nouvo demann
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
