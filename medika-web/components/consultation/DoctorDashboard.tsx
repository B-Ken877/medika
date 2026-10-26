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
import { specialtyLabel, urgencyLabel } from "@/lib/labels";
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
        showToast(`Nouvo demann: ${String((event as { patientName?: string }).patientName ?? "pasyan")}`);
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
      showToast(err instanceof ApiError ? err.message : "Nou pa t kapab chanje estati ou a. Tanpri, eseye ankò.");
    } finally {
      setAvailabilityBusy(false);
    }
  };

  const onAccept = async (id: string) => {
    if (!token || busyId) return; // single in-flight mutation
    setBusyId(id);
    try {
      await acceptConsultation(token, id);
      showToast("Konsiltasyon an aksepte.");
      router.push(`/app/consultations/${encodeURIComponent(id)}`);
    } catch (err) {
      // 404/409 → someone else took it or it changed; refresh the list.
      showToast(err instanceof ApiError ? err.message : "Aksyon an pa t posib. Nou ap refrèchi lis la.");
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
      showToast("Demann lan refize.");
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Aksyon an pa t posib. Nou ap refrèchi lis la.");
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
          <h1 className="page-title">Espas doktè a</h1>
          <p className="page-desc">Jere demann pasyan yo epi swiv konsiltasyon ou yo.</p>
        </div>
        <div className="page-head-actions">
          <div className={`avail ${available ? "on" : "off"}`} aria-label="Disponibilite">
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={available}
              onClick={toggleAvailability}
              disabled={availabilityBusy}
              aria-label={available ? "Ou disponib" : "Ou pa disponib"}
            />
            <span className="avail-label">
              {availabilityBusy ? "N ap mete ajou..." : available ? "Disponib" : "Pa disponib"}
            </span>
          </div>
        </div>
      </div>

      {/* Queue summary (real counts) */}
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }} role="group" aria-label="Rezime demann yo">
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot yellow" aria-hidden /> An atant
          </div>
          <div className="stat-value" style={{ fontSize: 26 }}>{buckets.queue.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot green" aria-hidden /> K ap dewoule
          </div>
          <div className="stat-value" style={{ fontSize: 26 }}>{buckets.active.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot blue" aria-hidden /> Fini
          </div>
          <div className="stat-value" style={{ fontSize: 26 }}>{buckets.done.length}</div>
        </div>
      </div>

      {/* Consultation queue panel */}
      <section className="panel" aria-labelledby="queue-title">
        <div className="panel-head">
          <h2 id="queue-title" className="panel-title">
            Demann pasyan yo
          </h2>
          <div className="panel-tools">
            <button className="btn btn-secondary btn-sm" onClick={load} disabled={consultations === null}>
              <RefreshCw size={14} aria-hidden /> Refrèchi
            </button>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="Filtè konsiltasyon yo">
          <button
            role="tab"
            aria-selected={tab === "queue"}
            className={tab === "queue" ? "active" : ""}
            onClick={() => setTab("queue")}
          >
            An atant <span className="count">{buckets.queue.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === "active"}
            className={tab === "active" ? "active" : ""}
            onClick={() => setTab("active")}
          >
            K ap dewoule <span className="count">{buckets.active.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === "done"}
            className={tab === "done" ? "active" : ""}
            onClick={() => setTab("done")}
          >
            Fini <span className="count">{buckets.done.length}</span>
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
            title={tab === "queue" ? (available ? "Pa gen demann pou kounye a" : "Ou pa disponib") : tab === "active" ? "Pa gen konsiltasyon k ap dewoule" : "Pa gen konsiltasyon ki fini"}
            description={
              tab === "queue"
                ? available
                  ? "Nouvo demann yo ap parèt isit."
                  : "Mete tèt ou disponib pou w ka resevwa demann konsiltasyon."
                : tab === "active"
                  ? "Konsiltasyon k ap dewoule yo ap parèt isit."
                  : "Konsiltasyon ki fini yo ap parèt isit."
            }
          />
        )}

        {list.map((c) => {
          const isQueue = tab === "queue";
          return (
            <div key={c.id} className="panel-row" style={{ minHeight: 76 }}>
              <Avatar name={c.patient_name} size="md" alt={`Foto pwofil ${c.patient_name}`} />
              <div className="row-body">
                <div className="row-title">
                  <span>{c.patient_name}</span>
                  <StatusBadge status={c.status} />
                </div>
                <div className="row-sub">{c.description || "Pa gen deskripsyon"}</div>
                <div className="row-meta">
                  {specialtyLabel(c.specialty_needed)}
                  {c.patient_age != null && c.patient_age !== "" ? ` · ${c.patient_age} an` : ""} ·{" "}
                  {relativeTime(c.created_at)}
                  {c.urgency_level ? ` · Ijans: ${urgencyLabel(c.urgency_level)}` : ""}
                </div>
                {tab === "done" && c.status === "TERMINE" && (
                  <div className="row-meta">Li fèmen {formatDateTime(c.updated_at)}</div>
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
                      <Check size={15} aria-hidden /> Aksepte
                    </button>
                    <button
                      className="btn btn-outline-danger btn-sm"
                      onClick={() => setConfirmReject(c)}
                      disabled={busyId !== null}
                    >
                      <X size={15} aria-hidden /> Refize
                    </button>
                  </>
                ) : (
                  <Link className="btn btn-secondary btn-sm" href={`/app/consultations/${encodeURIComponent(c.id)}`}>
                    Gade <ChevronRight size={14} aria-hidden />
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
              Refize demann sa a?
            </h2>
            <p className="modal-body">
              Demann {confirmReject.patient_name} ({specialtyLabel(confirmReject.specialty_needed)}) ap refize epi li
              pap vin jwenn ou ankò. Aksyon sa a definitif.
            </p>
            <form onSubmit={onConfirmReject}>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setConfirmReject(null)}
                  disabled={busyId !== null}
                >
                  Anile
                </button>
                <button type="submit" className="btn btn-danger" disabled={busyId !== null}>
                  {busyId !== null ? (
                    <>
                      <span className="spin" aria-hidden /> N ap refize l...
                    </>
                  ) : (
                    "Refize demann lan"
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
