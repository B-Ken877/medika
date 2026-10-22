"use client";

/**
 * Patient dashboard — web port of PatientDashboardScreen.kt.
 * Shows: greeting header, consultation status chips, recent consultations
 * (real data), quick actions, medical-record card, and rotating health tips.
 * All data comes from GET /api/consultations; empty states when none.
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
  Salad,
  Sparkles,
  Stethoscope,
  Sun,
  User,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { getConsultations } from "@/lib/api/endpoints";
import type { Consultation } from "@/lib/api/types";
import { relativeTime } from "@/lib/format";
import { Avatar, EmptyState, ErrorAlert, SkeletonRows, StatusBadge } from "@/components/ui/primitives";

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
  const { user } = useAuth();
  const [consultations, setConsultations] = useState<Consultation[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    if (!user) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    getConsultations(user.id, controller.signal)
      .then((list) => {
        setConsultations(Array.isArray(list) ? list : []);
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err);
        setConsultations([]);
      });
  }, [user]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const counts = useMemo(() => {
    const list = consultations ?? [];
    return {
      active: list.filter((c) => c.status === "EN_COURS").length,
      pending: list.filter((c) => c.status === "RECHERCHE_MEDECIN").length,
      done: list.filter((c) => c.status === "TERMINE").length,
      refused: list.filter((c) => c.status === "REFUSE").length,
    };
  }, [consultations]);

  const recent = useMemo(() => (consultations ?? []).slice(0, 5), [consultations]);

  const firstName = user?.name?.split(/\s+/)[0] ?? "";

  return (
    <div className="stack">
      {/* Greeting */}
      <div className="flex-between">
        <div>
          <h1 className="page-title">Bonjour, {firstName}</h1>
          <p className="muted small">Votre espace de santé Medika</p>
        </div>
        <Avatar name={user?.name} src={user?.avatar_url} size="lg" alt={`Avatar de ${user?.name}`} />
      </div>

      {/* Status chips */}
      <div className="stat-grid" role="group" aria-label="Résumé des consultations">
        <div className="stat-card green">
          <div className="stat-value">{counts.active}</div>
          <div className="stat-label">En cours</div>
        </div>
        <div className="stat-card yellow">
          <div className="stat-value">{counts.pending}</div>
          <div className="stat-label">En attente</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-value">{counts.done}</div>
          <div className="stat-label">Terminées</div>
        </div>
        <div className="stat-card red">
          <div className="stat-value">{counts.refused}</div>
          <div className="stat-label">Refusées</div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid-2">
        <Link href="/app/consult" className="card card-hover" style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span className="brand-mark" aria-hidden>
            <Stethoscope size={17} />
          </span>
          <div>
            <strong>Nouvelle consultation</strong>
            <div className="small muted">Décrivez vos symptômes et trouvez un médecin</div>
          </div>
        </Link>
        <Link href="/app/doctors" className="card card-hover" style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span className="brand-mark" aria-hidden>
            <User size={17} />
          </span>
          <div>
            <strong>Trouver un médecin</strong>
            <div className="small muted">Parcourir les spécialités et les médecins disponibles</div>
          </div>
        </Link>
        <Link href="/app/dossier" className="card card-hover" style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span className="brand-mark" aria-hidden>
            <FolderOpen size={17} />
          </span>
          <div>
            <strong>Mon dossier médical</strong>
            <div className="small muted">Allergies, conditions, traitements et historique</div>
          </div>
        </Link>
        <Link href="/app/tickets" className="card card-hover" style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span className="brand-mark" aria-hidden>
            <Sparkles size={17} />
          </span>
          <div>
            <strong>Assistance</strong>
            <div className="small muted">Contacter le service client Medika</div>
          </div>
        </Link>
      </div>

      {/* Recent consultations */}
      <section aria-labelledby="recent-title">
        <div className="flex-between mb-1">
          <h2 id="recent-title" className="section-title" style={{ marginBottom: 0 }}>
            Consultations récentes
          </h2>
          <Link href="/app/consultations" className="btn btn-ghost btn-sm">
            Voir tout <ChevronRight size={15} aria-hidden />
          </Link>
        </div>

        {consultations === null && !error && <SkeletonRows count={3} />}
        <ErrorAlert error={error} onRetry={load} />

        {consultations !== null && recent.length === 0 && !error && (
          <div className="card">
            <EmptyState
              icon={<CalendarCheck size={26} />}
              title="Aucune consultation"
              description="Commencez votre première consultation avec un médecin maintenant."
              action={
                <Link href="/app/consult" className="btn btn-primary">
                  Commencer une consultation
                </Link>
              }
            />
          </div>
        )}

        <div className="list">
          {recent.map((c) => (
            <Link key={c.id} href={`/app/consultations/${encodeURIComponent(c.id)}`} className="row">
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
