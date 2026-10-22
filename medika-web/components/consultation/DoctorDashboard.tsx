"use client";

/**
 * Doctor dashboard — web port of DoctorDashboardScreen.kt.
 * Availability toggle (PUT /api/doctor/availability), queue tabs
 * (pending / active / done), accept / reject actions, and live updates
 * over the WebSocket (consultation:new / consultation:updated).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, CalendarCheck, Check, ChevronRight, X } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import {
  acceptConsultation,
  getConsultations,
  rejectConsultation,
  updateAvailability,
} from "@/lib/api/endpoints";
import type { Consultation } from "@/lib/api/types";
import { formatDateTime, relativeTime } from "@/lib/format";
import { ApiError } from "@/lib/api/client";
import { Avatar, EmptyState, ErrorAlert, SkeletonRows, StatusBadge } from "@/components/ui/primitives";

type Tab = "queue" | "active" | "done";

export default function DoctorDashboard() {
  const { user, token } = useAuth();
  const { socket } = useSocket();
  const router = useRouter();

  const [consultations, setConsultations] = useState<Consultation[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>("queue");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean>(user?.is_available === 1);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  }, []);

  const load = useCallback(() => {
    if (!token) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    getConsultations(token, controller.signal)
      .then((list) => {
        setConsultations(Array.isArray(list) ? list : []);
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err);
        setConsultations([]);
      });
  }, [token]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  // Live updates over WS
  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event) => {
      if (event.type === "consultation:new" && !available) return;
      if (event.type === "consultation:new") {
        showToast(`Nouvelle demande : ${String((event as { patientName?: string }).patientName ?? "patient")}`);
        load();
      } else if (event.type === "consultation:updated") {
        load();
      }
    });
  }, [socket, load, available, showToast]);

  const buckets = useMemo(() => {
    const list = consultations ?? [];
    return {
      // Queue: requests awaiting acceptance — either broadcast (doctor_id
      // null) or direct requests addressed to this doctor.
      queue: list.filter(
        (c) => c.status === "RECHERCHE_MEDECIN" && (c.doctor_id == null || c.doctor_id === user?.id),
      ),
      active: list.filter((c) => c.status === "EN_COURS" && c.doctor_id === user?.id),
      done: list.filter((c) => (c.status === "TERMINE" || c.status === "REFUSE") && c.doctor_id === user?.id),
    };
  }, [consultations, user?.id]);

  const toggleAvailability = async () => {
    if (!token || availabilityBusy) return;
    setAvailabilityBusy(true);
    const next = !available;
    try {
      await updateAvailability(token, next);
      setAvailable(next);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Impossible de changer votre statut. Réessayez.");
    } finally {
      setAvailabilityBusy(false);
    }
  };

  const onAccept = async (id: string) => {
    if (!token || busyId) return; // single in-flight mutation
    setBusyId(id);
    try {
      await acceptConsultation(token, id);
      showToast("Consultation acceptée.");
      router.push(`/app/consultations/${encodeURIComponent(id)}`);
    } catch (err) {
      // 404/409 → someone else took it or it changed; refresh the list.
      showToast(err instanceof ApiError ? err.message : "Action impossible. La liste est rafraîchie.");
      load();
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (id: string) => {
    if (!token || busyId) return;
    setBusyId(id);
    try {
      await rejectConsultation(token, id);
      showToast("Demande refusée.");
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Action impossible. La liste est rafraîchie.");
      load();
    } finally {
      setBusyId(null);
    }
  };

  const list = tab === "queue" ? buckets.queue : tab === "active" ? buckets.active : buckets.done;
  const doctorName = user?.name?.replace(/^Dr\.?\s*/i, "") ?? "";

  return (
    <div className="stack">
      <div className="flex-between">
        <div>
          <h1 className="page-title">Dr. {doctorName}</h1>
          <p className="muted small">
            {available ? "Vous recevez des consultations" : "Aucune consultation ne vous sera assignée"}
          </p>
        </div>
        <button
          className={`availability-pill ${available ? "on" : ""}`}
          onClick={toggleAvailability}
          disabled={availabilityBusy}
          aria-pressed={available}
          title="Changer votre disponibilité"
        >
          <span className="pulse" aria-hidden />
          {available ? "En ligne" : "Hors ligne"}
        </button>
      </div>

      <div className="tabs" role="tablist" aria-label="Filtres de consultations">
        <button
          role="tab"
          aria-selected={tab === "queue"}
          className={tab === "queue" ? "active" : ""}
          onClick={() => setTab("queue")}
        >
          File d&apos;attente <span className="count">{buckets.queue.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "active"}
          className={tab === "active" ? "active" : ""}
          onClick={() => setTab("active")}
        >
          En cours <span className="count">{buckets.active.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "done"}
          className={tab === "done" ? "active" : ""}
          onClick={() => setTab("done")}
        >
          Terminées <span className="count">{buckets.done.length}</span>
        </button>
      </div>

      {consultations === null && !error && <SkeletonRows count={3} />}
      <ErrorAlert error={error} onRetry={load} />

      {consultations !== null && list.length === 0 && !error && (
        <div className="card">
          {tab === "queue" && (
            <EmptyState
              icon={<BellRing size={26} />}
              title={available ? "Aucune demande en attente" : "Vous êtes hors ligne"}
              description={
                available
                  ? "Les nouvelles demandes apparaîtront ici automatiquement."
                  : "Mettez-vous en ligne pour recevoir des demandes de consultation."
              }
            />
          )}
          {tab === "active" && (
            <EmptyState
              icon={<CalendarCheck size={26} />}
              title="Aucune consultation active"
              description="Vos consultations en cours apparaîtront ici."
            />
          )}
          {tab === "done" && (
            <EmptyState
              icon={<CalendarCheck size={26} />}
              title="Aucune consultation terminée"
              description="Vos consultations terminées apparaîtront ici."
            />
          )}
        </div>
      )}

      <div className="list">
        {list.map((c) => {
          const isQueue = tab === "queue";
          return (
            <div key={c.id} className="row" style={{ flexWrap: "wrap" }}>
              <Avatar name={c.patient_name} size="md" alt={`Avatar de ${c.patient_name}`} />
              <div className="row-body">
                <div className="row-title">
                  <span>{c.patient_name}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div className="row-sub">{c.description || "Sans description"}</div>
                <div className="row-meta">
                  {c.specialty_needed}
                  {c.patient_age != null && c.patient_age !== "" ? ` · ${c.patient_age} ans` : ""} ·{" "}
                  {relativeTime(c.created_at)}
                  {c.urgency_level ? ` · Urgence : ${c.urgency_level}` : ""}
                </div>
              </div>
              <div className="row-actions">
                {isQueue ? (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => onAccept(c.id)}
                      disabled={busyId !== null}
                    >
                      <Check size={14} aria-hidden /> Accepter
                    </button>
                    <button
                      className="btn btn-outline-danger btn-sm"
                      onClick={() => onReject(c.id)}
                      disabled={busyId !== null}
                    >
                      <X size={14} aria-hidden /> Refuser
                    </button>
                  </>
                ) : (
                  <Link className="btn btn-secondary btn-sm" href={`/app/consultations/${encodeURIComponent(c.id)}`}>
                    Voir <ChevronRight size={14} aria-hidden />
                  </Link>
                )}
              </div>
              {tab === "done" && c.status === "TERMINE" && (
                <div className="row-meta nowrap" style={{ flexBasis: "100%" }}>
                  Clôturée le {formatDateTime(c.updated_at)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {toast && (
        <div className="toast-stack" role="status" aria-live="polite">
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
}
