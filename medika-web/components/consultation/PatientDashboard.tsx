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
  MessageSquareHeart,
  Moon,
  Pill,
  Plus,
  Salad,
  Stethoscope,
  Sun,
  Truck,
  LifeBuoy,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { getConsultations } from "@/lib/api/endpoints";
import type { Consultation } from "@/lib/api/types";
import { relativeTime } from "@/lib/format";
import { specialtyLabel } from "@/lib/labels";
import { EmptyState, ErrorAlert, SkeletonRows, StatusBadge } from "@/components/ui/primitives";

const HEALTH_TIPS: { icon: typeof Droplets; title: string; text: string }[] = [
  { icon: Droplets, title: "Bwè dlo", text: "Bwè omwen 8 vè dlo chak jou pou w kenbe kò w anfòm." },
  { icon: Moon, title: "Dòmi ki repoze", text: "Eseye dòmi 7 a 8 lè chak swa pou kò w ka repoze byen." },
  { icon: Activity, title: "Aktivite fizik", text: "30 minit mache rapid chak jour ase pou ameliore sante kè w." },
  { icon: Salad, title: "Manje balanse", text: "Prefere fwi, legim ak pwotein ki pa gra chak repa." },
  { icon: Sun, title: "Soley ak vitamin D", text: "Pase 15 minit nan solèy chak jou pou vitamin D." },
  { icon: HeartPulse, title: "Sante mantal", text: "Pran tan pou tèt ou: meditasyon, lekti oswa respire fon." },
  { icon: ClipboardList, title: "Vaksen ajou", text: "Verifye vaksen ou yo epi fè rapel yo doktè ou rekomande a." },
  { icon: Stethoscope, title: "Kè anfòm", text: "Siveye tansyon atè w regilyèman pou evite risk." },
];

// The 3-step Medika journey (Nov 2026 redesign). Explains the full patient
// flow that the medication-order + payment + delivery surfaces now cover —
// so a first-time visitor understands what Medika does beyond the consult.
const JOURNEY_STEPS: { icon: typeof Stethoscope; title: string; text: string }[] = [
  {
    icon: MessageSquareHeart,
    title: "1 · Konsiltasyon",
    text: "Pale ak yon doktè pa videyo, lè w vle. Doktè a ekri òrdònans ou.",
  },
  {
    icon: Pill,
    title: "2 · Pri ak medikaman",
    text: "Mande pri medikaman yo atravè Medika — wè devi a, aksepte oswa refize.",
  },
  {
    icon: Truck,
    title: "3 · Livrezon gratis",
    text: "Peye (simile pou kounye a) epi resevwa medikaman yo lakay ou, nan zòn k kouvri.",
  },
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
      {/* Issue #99 → #103 → #109 → Nov 2026 redesign: Akèy hero — OPEN, unboxed
          hero area with large two-line greeting left + artwork stage anchored
          to the screen's right edge. The hero copy now carries a secondary
          value line so first-time visitors understand what Medika does beyond
          a single consult, plus a full-width CTA row directly below. */}
      <section className="home-hero" aria-label="Resime sante ou">
        <div className="hero-copy">
          <span className="hero-eyebrow" aria-hidden>
            <HeartPulse size={13} /> Telemedsin · Ayiti
          </span>
          <h1 className="page-title">Bonjou, {user?.name?.split(" ")[0] ?? ""}</h1>
          <p className="page-desc">
            Pale ak yon doktè, jwenn pri medikaman ou yo, epi fè yo delivre — tout sa nan yon sèl aplikasyon.
          </p>
        </div>
        <div className="hero-art">
          {/* eslint-disable-next-line @next/next/no-img-element -- static same-origin decorative asset with fixed intrinsic dimensions; plain <img> matches repo convention (see PrescriptionPanel) and keeps the stage layout-shift-free */}
          <img
            src="/patient-hero-doctor.png"
            alt="Ilistrasyon doktè Medika a"
            width={560}
            height={700}
            loading="eager"
            decoding="async"
            className="hero-art-img"
          />
        </div>
      </section>

      {/* Primary actions — full-width row directly below the hero: the main
          consult CTA plus a secondary link to the consultation history so a
          returning patient can resume immediately. */}
      <div className="page-head-actions home-cta-row">
        <Link href="/app/consult" className="btn btn-primary">
          <Plus size={18} aria-hidden /> Kòmanse yon konsiltasyon
        </Link>
        {counts.total > 0 && (
          <Link href="/app/consultations" className="btn btn-ghost">
            <CalendarCheck size={17} aria-hidden /> Konsiltasyon mwen yo
          </Link>
        )}
      </div>

      {/* 3-step Medika journey (Nov 2026 redesign). Explains the full patient
          flow that the medication-order + payment + delivery surfaces now
          cover — so a first-time visitor understands what Medika does beyond
          the consult. Replaces a featureless gap between the CTA and the
          stats with concrete, ordered value. */}
      <section className="home-journey" aria-labelledby="journey-title">
        <h2 id="journey-title" className="section-title">
          Kijan Medika mache
        </h2>
        <div className="journey-grid" role="list">
          {JOURNEY_STEPS.map((step, i) => (
            <div key={step.title} className="journey-card" role="listitem">
              <div className="journey-step-no" aria-hidden>{i + 1}</div>
              <div className="journey-icon" aria-hidden>
                <step.icon size={20} />
              </div>
              <h4 className="journey-title">{step.title.replace(/^\d+\s·\s/, "")}</h4>
              <p className="journey-text">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Summary metrics (real counts). Nov 2026: each card carries a subtle
          gradient accent strip so the row reads as four distinct tiles instead
          of four identical white boxes. */}
      <div className="stat-grid" role="group" aria-label="Rezime konsiltasyon yo">
        <div className="stat-card stat-gray">
          <div className="stat-label">
            <span className="stat-dot gray" aria-hidden /> Tout konsiltasyon yo
          </div>
          <div className="stat-value">{counts.total}</div>
        </div>
        <div className="stat-card stat-yellow">
          <div className="stat-label">
            <span className="stat-dot yellow" aria-hidden /> An atant
          </div>
          <div className="stat-value">{counts.pending}</div>
        </div>
        <div className="stat-card stat-green">
          <div className="stat-label">
            <span className="stat-dot green" aria-hidden /> K ap dewoule
          </div>
          <div className="stat-value">{counts.active}</div>
        </div>
        <div className="stat-card stat-blue">
          <div className="stat-label">
            <span className="stat-dot blue" aria-hidden /> Fini
          </div>
          <div className="stat-value">{counts.done}</div>
        </div>
      </div>

      {/* Desktop two-column section: active consultation + quick links side
          by side so a desktop patient sees both without scrolling. On mobile
          the column collapses to a single stack (CSS .home-split). */}
      <div className="home-split">
        {/* Active consultation panel */}
        {consultations !== null && current && (
          <section className="panel" aria-labelledby="current-title">
            <div className="panel-head">
              <h2 id="current-title" className="panel-title">
                Konsiltasyon k ap dewoule
              </h2>
              <StatusBadge status={current.status} />
            </div>
            <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <span className="brand-mark" aria-hidden>
                <Stethoscope size={17} />
              </span>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="row-title">
                  <span>{specialtyLabel(current.specialty_needed)}</span>
                </div>
                <div className="row-sub">{current.description || "Pa gen deskripsyon"}</div>
                <div className="row-meta">Demann lan fèt {relativeTime(current.created_at)}</div>
              </div>
              {/* Issue #56: an ACTIVE consultation's primary surface is the
                  real video call; waiting/finished ones open the
                  detail chat. The retired placeholder room is no longer a
                  destination. */}
              <Link
                href={
                  current.status === "EN_COURS"
                    ? `/app/consultations/${encodeURIComponent(current.id)}/call?mode=video`
                    : `/app/consultations/${encodeURIComponent(current.id)}`
                }
                className="btn btn-secondary"
              >
                {current.status === "EN_COURS" ? "Antre nan apèl la" : "Gade detay yo"} <ChevronRight size={15} aria-hidden />
              </Link>
            </div>
          </section>
        )}

        {/* Compact quick links (existing routes only) */}
        <section aria-labelledby="quick-title">
          <h2 id="quick-title" className="section-title">
            Aksè rapid
          </h2>
          <div className="quick-links">
            <Link href="/app/doctors" className="quick-link">
              <span className="quick-icon" aria-hidden>
                <Stethoscope size={17} />
              </span>
              <span>
                Jwenn yon doktè
                <div className="quick-sub">Espesyalite ak disponibilite</div>
              </span>
            </Link>
            <Link href="/app/dossier" className="quick-link">
              <span className="quick-icon" aria-hidden>
                <FolderOpen size={17} />
              </span>
              <span>
                Dosisye medikal mwen
                <div className="quick-sub">Alèji, tretman, istwa medikal</div>
              </span>
            </Link>
            <Link href="/app/tickets" className="quick-link">
              <span className="quick-icon" aria-hidden>
                <LifeBuoy size={17} />
              </span>
              <span>
                Èd
                <div className="quick-sub">Kontakte sèvis kliyan Medika a</div>
              </span>
            </Link>
          </div>
        </section>
      </div>

      {/* Consultation history */}
      <section aria-labelledby="recent-title">
        <div className="flex-between mb-2">
          <h2 id="recent-title" className="section-title" style={{ marginBottom: 0 }}>
            Konsiltasyon ki pase yo
          </h2>
          <Link href="/app/consultations" className="btn btn-ghost btn-sm">
            Gade tout <ChevronRight size={15} aria-hidden />
          </Link>
        </div>

        {consultations === null && !error && <SkeletonRows count={3} />}
        <ErrorAlert error={error} onRetry={load} />

        {consultations !== null && recent.length === 0 && !error && (
          <div className="panel">
            <EmptyState
              icon={<CalendarCheck size={24} />}
              title="Ou poko gen okenn konsiltasyon."
              description="Di nou sa w ap santi pou w kòmanse premye konsiltasyon ou ak yon doktè."
              action={
                <Link href="/app/consult" className="btn btn-primary">
                  <Plus size={16} aria-hidden /> Kòmanse yon konsiltasyon
                </Link>
              }
            />
          </div>
        )}

        {recent.length > 0 && (
          <div>
            {recent.map((c) => (
              <Link
                key={c.id}
                href={
                  c.status === "EN_COURS"
                    ? `/app/consultations/${encodeURIComponent(c.id)}/call?mode=video`
                    : `/app/consultations/${encodeURIComponent(c.id)}`
                }
                className="panel-row history-card"
              >
                <span className="brand-mark" aria-hidden>
                  <Stethoscope size={16} />
                </span>
                <div className="row-body">
                  <div className="row-title">
                    <span>{specialtyLabel(c.specialty_needed)}</span>
                  </div>
                  <div className="row-sub">{c.description || "Pa gen deskripsyon"}</div>
                  <div className="row-meta">{relativeTime(c.created_at)}</div>
                </div>
                <ChevronRight size={18} className="muted" aria-hidden />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Health tips carousel (static content, same as Android) */}
      <section aria-labelledby="tips-title">
        <h2 id="tips-title" className="section-title">
          Konsèy sante
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
