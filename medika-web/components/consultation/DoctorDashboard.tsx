"use client";

/**
 * Doctor dashboard — Clinical Calm redesign.
 * Page heading with availability control, three queue metrics, and a single
 * consultation-queue panel with tabs. Availability toggle (PUT
 * /api/doctor/availability), accept / reject actions (reject asks for
 * confirmation), and live updates over the WebSocket are unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, CalendarCheck, Check, ChevronRight, RefreshCw, X } from "lucide-react";
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
  const [confirmReject, setConfirmReject] = useState<Consultation | null>(null);
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
      setConfirmReject(null);
    }
  };

  const onConfirmReject = (e: FormEvent) => {
    e.preventDefault();
    if (confirmReject) onReject(confirmReject.id);
  };

  const list = tab === "queue" ? buckets.queue : tab === "active" ? buckets.active : buckets.done;

  return (
    <div className="stack">
      {/* Page heading + availability control */}
      <div className="page-head">
        <div>
          <h1 className="page-title">Espace médecin</h1>
          <p className="page-desc">Gérez vos demandes et suivez vos consultations.</p>
        </div>
        <div className="page-head-actions">
          <div className={`avail ${available ? "on" : "off"}`} aria-label="Disponibilité">
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={available}
              onClick={toggleAvailability}
              disabled={availabilityBusy}
              aria-label={available ? "Vous êtes disponible" : "Vous êtes indisponible"}
            />
            <span className="avail-label">
              {availabilityBusy ? "Mise à jour…" : available ? "Disponible" : "Indisponible"}
            </span>
          </div>
        </div>
      </div>

      {/* Queue summary (real counts) */}
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }} role="group" aria-label="Résumé de la file">
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot yellow" aria-hidden /> En attente
          </div>
          <div className="stat-value" style={{ fontSize: 26 }}>{buckets.queue.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot green" aria-hidden /> En cours
          </div>
          <div className="stat-value" style={{ fontSize: 26 }}>{buckets.active.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot blue" aria-hidden /> Terminées
          </div>
          <div className="stat-value" style={{ fontSize: 26 }}>{buckets.done.length}</div>
        </div>
      </div>

      {/* Consultation queue panel */}
      <section className="panel" aria-labelledby="queue-title">
        <div className="panel-head">
          <h2 id="queue-title" className="panel-title">
            Demandes de consultation
          </h2>
          <div className="panel-tools">
            <button className="btn btn-secondary btn-sm" onClick={load} disabled={consultations === null}>
              <RefreshCw size={14} aria-hidden /> Actualiser
            </button>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="Filtres de consultations">
          <button
            role="tab"
            aria-selected={tab === "queue"}
            className={tab === "queue" ? "active" : ""}
            onClick={() => setTab("queue")}
          >
            En attente <span className="count">{buckets.queue.length}</span>
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

        {consultations === null && !error && (
          <div style={{ padding: 24 }}>
            <SkeletonRows count={3} />
          </div>
        )}
        <ErrorAlert error={error} onRetry={load} />

        {consultations !== null && list.length === 0 && !error && (
          <EmptyState
            icon={tab === "queue" ? <BellRing size={24} /> : <CalendarCheck size={24} />}
            title={tab === "queue" ? (available ? "Aucune demande pour le moment" : "Vous êtes indisponible") : tab === "active" ? "Aucune consultation active" : "Aucune consultation terminée"}
            description={
              tab === "queue"
                ? available
                  ? "Les nouvelles demandes apparaîtront ici."
                  : "Mettez-vous en disponible pour recevoir des demandes de consultation."
                : tab === "active"
                  ? "Vos consultations en cours apparaîtront ici."
                  : "Vos consultations terminées apparaîtront ici."
            }
          />
        )}

        {list.map((c) => {
          const isQueue = tab === "queue";
          return (
            <div key={c.id} className="panel-row" style={{ minHeight: 76 }}>
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
                {tab === "done" && c.status === "TERMINE" && (
                  <div className="row-meta">Clôturée le {formatDateTime(c.updated_at)}</div>
                )}
              </div>
              <div className="row-actions">
                {isQueue ? (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => onAccept(c.id)}
                      disabled={busyId !== null}
                    >
                      <Check size={15} aria-hidden /> Accepter
                    </button>
                    <button
                      className="btn btn-outline-danger btn-sm"
                      onClick={() => setConfirmReject(c)}
                      disabled={busyId !== null}
                    >
                      <X size={15} aria-hidden /> Refuser
                    </button>
                  </>
                ) : (
                  <Link className="btn btn-secondary btn-sm" href={`/app/consultations/${encodeURIComponent(c.id)}`}>
                    Voir <ChevronRight size={14} aria-hidden />
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {toast && (
        <div className="toast-stack" role="status" aria-live="polite">
          <div className="toast">{toast}</div>
        </div>
      )}

      {/* Reject confirmation dialog */}
      {confirmReject && (
        <div className="modal-backdrop" role="presentation" onClick={() => busyId === null && setConfirmReject(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="reject-title" className="modal-title">
              Refuser cette demande ?
            </h2>
            <p className="modal-body">
              La demande de {confirmReject.patient_name} ({confirmReject.specialty_needed}) sera refusée et ne vous
              sera plus proposée. Cette action est définitive.
            </p>
            <form onSubmit={onConfirmReject}>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setConfirmReject(null)}
                  disabled={busyId !== null}
                >
                  Annuler
                </button>
                <button type="submit" className="btn btn-danger" disabled={busyId !== null}>
                  {busyId !== null ? (
                    <>
                      <span className="spin" aria-hidden /> Refus en cours…
                    </>
                  ) : (
                    "Refuser la demande"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
