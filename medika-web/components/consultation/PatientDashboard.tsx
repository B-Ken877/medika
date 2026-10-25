"use client";

/**
 * Patient dashboard — Clinical Calm redesign.
 * Page heading + primary action, four summary metrics, active consultation
 * panel, consultation history, compact quick links, health tips.
 * All data comes from GET /api/consultations (real values only).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  Droplets,
  FolderOpen,
  HeartPulse,
  Moon,
  Plus,
  Salad,
  Stethoscope,
  Sun,
  LifeBuoy,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { getConsultations } from "@/lib/api/endpoints";
import type { Consultation } from "@/lib/api/types";
import { relativeTime } from "@/lib/format";
import { EmptyState, ErrorAlert, SkeletonRows, StatusBadge } from "@/components/ui/primitives";

const HEALTH_TIPS: { icon: typeof Droplets; title: string; text: string }[] = [
  { icon: Droplets, title: "Hydratez-vous", text: "Buvez au moins 8 verres d'eau par jour pour maintenir une bonne santé." },
  { icon: Moon, title: "Sommeil réparateur", text: "Visez 7 à 8 heures de sommeil chaque nuit pour une récupération optimale." },
  { icon: Activity, title: "Activité physique", text: "30 minutes de marche rapide par jour suffisent à améliorer votre santé cardiovasculaire." },
  { icon: Salad, title: "Nutrition équilibrée", text: "Privilégiez les fruits, légumes et protéines maigres à chaque repas." },
  { icon: Sun, title: "Soleil et vitamine D", text: "Exposez-vous au soleil 15 min par jour pour favoriser la vitamine D." },
  { icon: HeartPulse, title: "Santé mentale", text: "Prenez du temps pour vous : méditation, lecture ou simple respiration profonde." },
  { icon: ClipboardList, title: "Vaccination à jour", text: "Vérifiez vos vaccins et faites les rappels recommandés par votre médecin." },
  { icon: Stethoscope, title: "Coeur en forme", text: "Surveillez votre tension artérielle régulièrement pour prévenir les risques." },
];

export default function PatientDashboard() {
  const { user, token, status } = useAuth();
  const [consultations, setConsultations] = useState<Consultation[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    // Guard: issue the protected request only once the session is fully
    // restored (not while "restoring") and both the user and its bearer
    // token are available. The token — never user.id — authorizes the call.
    if (status !== "authenticated" || !user || !token) return;
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
  }, [user, token, status]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const counts = useMemo(() => {
    const list = consultations ?? [];
    return {
      total: list.length,
      active: list.filter((c) => c.status === "EN_COURS").length,
      pending: list.filter((c) => c.status === "RECHERCHE_MEDECIN").length,
      done: list.filter((c) => c.status === "TERMINE").length,
    };
  }, [consultations]);

  const recent = useMemo(() => (consultations ?? []).slice(0, 5), [consultations]);
  const current = useMemo(
    () => (consultations ?? []).find((c) => c.status === "EN_COURS" || c.status === "RECHERCHE_MEDECIN") ?? null,
    [consultations],
  );

  return (
    <div className="stack">
      {/* Page heading */}
      <div className="page-head">
        <div>
          <h1 className="page-title">Mon espace santé</h1>
          <p className="page-desc">Retrouvez vos consultations et gérez votre suivi médical.</p>
        </div>
        <div className="page-head-actions">
          <Link href="/app/consult" className="btn btn-primary">
            <Plus size={18} aria-hidden /> Nouvelle consultation
          </Link>
        </div>
      </div>

      {/* Summary metrics (real counts) */}
      <div className="stat-grid" role="group" aria-label="Résumé des consultations">
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot gray" aria-hidden /> Consultations totales
          </div>
          <div className="stat-value">{counts.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot yellow" aria-hidden /> En attente
          </div>
          <div className="stat-value">{counts.pending}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot green" aria-hidden /> En cours
          </div>
          <div className="stat-value">{counts.active}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            <span className="stat-dot blue" aria-hidden /> Terminées
          </div>
          <div className="stat-value">{counts.done}</div>
        </div>
      </div>

      {/* Active consultation panel */}
      {consultations !== null && current && (
        <section className="panel" aria-labelledby="current-title">
          <div className="panel-head">
            <h2 id="current-title" className="panel-title">
              Consultation en cours
            </h2>
            <StatusBadge status={current.status} />
          </div>
          <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span className="brand-mark" aria-hidden>
              <Stethoscope size={17} />
            </span>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="row-title">
                <span>{current.specialty_needed}</span>
              </div>
              <div className="row-sub">{current.description || "Sans description"}</div>
              <div className="row-meta">Demandée {relativeTime(current.created_at)}</div>
            </div>
            <Link href={`/app/consultations/${encodeURIComponent(current.id)}`} className="btn btn-secondary">
              Voir les détails <ChevronRight size={15} aria-hidden />
            </Link>
          </div>
        </section>
      )}

      {/* Consultation history */}
      <section aria-labelledby="recent-title">
        <div className="flex-between mb-2">
          <h2 id="recent-title" className="section-title" style={{ marginBottom: 0 }}>
            Mes consultations
          </h2>
          <Link href="/app/consultations" className="btn btn-ghost btn-sm">
            Voir tout <ChevronRight size={15} aria-hidden />
          </Link>
        </div>

        {consultations === null && !error && <SkeletonRows count={3} />}
        <ErrorAlert error={error} onRetry={load} />

        {consultations !== null && recent.length === 0 && !error && (
          <div className="panel">
            <EmptyState
              icon={<CalendarCheck size={24} />}
              title="Aucune consultation pour le moment"
              description="Décrivez vos symptômes pour démarrer votre première consultation avec un médecin."
              action={
                <Link href="/app/consult" className="btn btn-primary">
                  <Plus size={16} aria-hidden /> Nouvelle consultation
                </Link>
              }
            />
          </div>
        )}

        {recent.length > 0 && (
          <div className="panel">
            {recent.map((c) => (
              <Link key={c.id} href={`/app/consultations/${encodeURIComponent(c.id)}`} className="panel-row">
                <span className="brand-mark" aria-hidden>
                  <Stethoscope size={16} />
                </span>
                <div className="row-body">
                  <div className="row-title">
                    <span>{c.specialty_needed}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="row-sub">{c.description || "Sans description"}</div>
                  <div className="row-meta">{relativeTime(c.created_at)}</div>
                </div>
                <ChevronRight size={18} className="muted" aria-hidden />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Compact quick links (existing routes only) */}
      <section aria-labelledby="quick-title">
        <h2 id="quick-title" className="section-title">
          Accès rapides
        </h2>
        <div className="quick-links">
          <Link href="/app/doctors" className="quick-link">
            <span className="quick-icon" aria-hidden>
              <Stethoscope size={17} />
            </span>
            <span>
              Trouver un médecin
              <div className="quick-sub">Spécialités et disponibilités</div>
            </span>
          </Link>
          <Link href="/app/dossier" className="quick-link">
            <span className="quick-icon" aria-hidden>
              <FolderOpen size={17} />
            </span>
            <span>
              Mon dossier médical
              <div className="quick-sub">Allergies, traitements, historique</div>
            </span>
          </Link>
          <Link href="/app/tickets" className="quick-link">
            <span className="quick-icon" aria-hidden>
              <LifeBuoy size={17} />
            </span>
            <span>
              Assistance
              <div className="quick-sub">Contacter le service client Medika</div>
            </span>
          </Link>
        </div>
      </section>

      {/* Health tips carousel (static content, same as Android) */}
      <section aria-labelledby="tips-title">
        <h2 id="tips-title" className="section-title">
          Conseils santé
        </h2>
        <div className="tips-track" role="list">
          {HEALTH_TIPS.map((tip) => (
            <div key={tip.title} className="tip-card" role="listitem">
              <div className="tip-icon">
                <tip.icon size={19} aria-hidden />
              </div>
              <h4>{tip.title}</h4>
              <p>{tip.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
