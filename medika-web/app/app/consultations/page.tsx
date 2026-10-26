"use client";

/**
 * Consultation history — port of ConsultationHistoryScreen.kt.
 * Role-aware: patients see their requests; doctors see accepted + queue.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarCheck, ChevronRight, ClipboardList, Stethoscope } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { getConsultations } from "@/lib/api/endpoints";
import type { Consultation } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { specialtyLabel } from "@/lib/labels";
import { EmptyState, ErrorAlert, SkeletonRows, StatusBadge } from "@/components/ui/primitives";

type Tab = "all" | "active" | "done";

export default function ConsultationsPage() {
  const { token, user } = useAuth();
  const [consultations, setConsultations] = useState<Consultation[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>("all");
  const abortRef = useRef<AbortController | null>(null);

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

  const filtered = useMemo(() => {
    const list = consultations ?? [];
    if (tab === "active") return list.filter((c) => c.status === "EN_COURS" || c.status === "RECHERCHE_MEDECIN");
    if (tab === "done") return list.filter((c) => c.status === "TERMINE" || c.status === "REFUSE");
    return list;
  }, [consultations, tab]);

  const isDoctor = user?.role === "doctor";

  return (
    <div className="stack">
      <div className="flex-between">
        <div>
          <h1 className="page-title">Istwa konsiltasyon</h1>
          <p className="muted small">{consultations?.length ?? "..."} konsiltasyon an total</p>
        </div>
        {!isDoctor && (
          <Link href="/app/consult" className="btn btn-primary btn-sm">
            <Stethoscope size={15} aria-hidden /> Nouvo
          </Link>
        )}
      </div>

      <div className="tabs" role="tablist" aria-label="Filtè konsiltasyon yo">
        <button role="tab" aria-selected={tab === "all"} className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
          Tout
        </button>
        <button role="tab" aria-selected={tab === "active"} className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>
          K ap dewoule / An atant
        </button>
        <button role="tab" aria-selected={tab === "done"} className={tab === "done" ? "active" : ""} onClick={() => setTab("done")}>
          Ki fini
        </button>
      </div>

      {consultations === null && !error && <SkeletonRows count={4} />}
      <ErrorAlert error={error} onRetry={load} />

      {consultations !== null && filtered.length === 0 && !error && (
        <div className="card">
          <EmptyState
            icon={<ClipboardList size={26} />}
            title="Pa gen konsiltasyon"
            description={
              isDoctor
                ? "Aksepte yon demann sou tablo travay ou pou w ka wè li isit."
                : "Kòmanse premye konsiltasyon ou ak yon doktè kounye a."
            }
            action={
              !isDoctor ? (
                <Link href="/app/consult" className="btn btn-primary">
                  Kòmanse yon konsiltasyon
                </Link>
              ) : undefined
            }
          />
        </div>
      )}

      <div className="list">
        {filtered.map((c) => (
          <Link key={c.id} href={`/app/consultations/${encodeURIComponent(c.id)}`} className="row">
            <span className="brand-mark" aria-hidden>
              <Stethoscope size={16} />
            </span>
            <div className="row-body">
              <div className="row-title">
                <span>{isDoctor ? c.patient_name : specialtyLabel(c.specialty_needed)}</span>
                <StatusBadge status={c.status} />
              </div>
              <div className="row-sub">{c.description || "Pa gen deskripsyon"}</div>
              <div className="row-meta flex" style={{ gap: 10 }}>
                <span>{formatDateTime(c.created_at)}</span>
                {c.prescription && (
                  <span className="badge badge-green" style={{ padding: "1px 8px" }}>
                    <ClipboardList size={11} aria-hidden /> Ordonnans
                  </span>
                )}
              </div>
            </div>
            <ChevronRight size={18} className="muted" aria-hidden />
          </Link>
        ))}
      </div>

      {consultations !== null && filtered.length > 0 && (
        <p className="tiny muted text-center" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <CalendarCheck size={13} aria-hidden /> Konsiltasyon yo klase soti nan pi resan a rive nan pi ansyen an.
        </p>
      )}
    </div>
  );
}
