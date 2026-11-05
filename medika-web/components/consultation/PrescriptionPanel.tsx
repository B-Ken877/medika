"use client";

/**
 * Patient/doctor-facing prescription document — « Ordonnance médicale »
 * (consolidated issue #82 §3 — critical visual deliverable).
 *
 * The document IS the visual focus: a white medical-document surface with a
 * clear header (title, stable reference, issue date), aligned identity
 * blocks (prescriber + patient, only verified recorded values), readable
 * numbered medication rows that wrap long drug names, general instructions
 * and a factual footer. Restrained Medika green branding; no fabricated
 * signature, credential or verification claim. Strictly NO prices (the
 * server allowlist guarantees it; only allowlisted fields are rendered).
 *
 * States (issue #82 §3): loading, retryable error, empty, and a legacy
 * free-text fallback ONLY when the structured endpoint genuinely answers
 * 404 (pre-#82 record) — network/server errors are never silently swapped
 * for the legacy text.
 *
 * Actions: « Télécharger l'ordonnance » (high-quality PNG of the document
 * node only, html2canvas lazily imported, fonts awaited before capture,
 * 2× DPR, French feedback on failure) and « Imprimer / Enregistrer en PDF »
 * (browser print pipeline; @media print isolates the document on A4).
 * The independent-purchase alternative is explicit in French.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, Download, Printer, RefreshCw, Stethoscope } from "lucide-react";
import type { Consultation, PrescriptionDocument } from "@/lib/api/types";
import { getPrescriptionDocument } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import { ErrorAlert, Spinner } from "@/components/ui/primitives";

function formatIssueDate(epochSeconds?: number | null): string | null {
  if (!epochSeconds) return null;
  try {
    return new Date(epochSeconds * 1000).toLocaleString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

const INK = "#122d28";
const MUTED = "#3f4f4b";

/** Small uppercase section label — the document's visual rhythm. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "0.7rem",
        fontWeight: 700,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: "#5b7470",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

/** One structured medication instruction: numbered, wrap-safe row. */
function MedicationEntry({ item, index }: { item: PrescriptionDocument["items"][number]; index: number }) {
  const heading = [item.name, item.strength, item.form ? `(${item.form})` : null].filter(Boolean).join(" ");
  const details = [
    item.dose ? `Prise : ${item.dose}` : null,
    item.route ? `Voie : ${item.route}` : null,
    item.frequency ? `Fréquence : ${item.frequency}` : null,
    item.duration ? `Durée : ${item.duration}` : null,
  ].filter(Boolean);
  const supply = [
    item.quantity ? `Quantité : ${item.quantity}` : null,
    item.refills ? `Renouvellements : ${item.refills}` : null,
  ].filter(Boolean);
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid #e3ece9" }}>
      <div
        aria-hidden
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: 999,
          background: "#e7f2ee",
          color: "#1f6f5c",
          fontSize: "0.78rem",
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 1,
        }}
      >
        {index + 1}
      </div>
      <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        <div style={{ fontWeight: 700, color: INK, fontSize: "0.95rem" }}>{heading}</div>
        {details.length > 0 && (
          <div style={{ fontSize: "0.88rem", color: MUTED, marginTop: 2 }}>{details.join(" · ")}</div>
        )}
        {supply.length > 0 && (
          <div style={{ fontSize: "0.88rem", color: MUTED, marginTop: 2 }}>{supply.join(" · ")}</div>
        )}
        {item.instructions ? (
          <div style={{ fontSize: "0.86rem", fontStyle: "italic", color: MUTED, marginTop: 3 }}>
            {item.instructions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The document body — the ONLY node captured by the download/print actions.
 * Pure component so tests can SSR the document exactly as a patient sees it.
 * Shows only authoritative data: fields without a recorded value are omitted,
 * never invented.
 */
export function OrdonnanceDocumentBody({
  doc,
  legacyText,
  fallbackPatientName,
  fallbackDoctorId,
}: {
  doc: PrescriptionDocument | null;
  legacyText: string;
  fallbackPatientName?: string | null;
  fallbackDoctorId?: string | null;
}) {
  const hasStructured = Boolean(doc);
  const reference = doc?.reference ?? null;
  const issueDate = formatIssueDate(doc?.issued_at);
  return (
    <div
      className="ordonnance-doc"
      style={{
        background: "#ffffff",
        color: INK,
        borderRadius: 12,
        border: "1px solid #dbe7e3",
        padding: "20px 18px",
        boxShadow: "0 1px 2px rgba(18,45,40,0.06)",
      }}
    >
      {/* ── Header: brand + title, reference + date ─────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            aria-hidden
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "#1f6f5c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
            }}
          >
            <Stethoscope size={20} aria-hidden />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.22rem", lineHeight: 1.2, fontWeight: 700, color: "#1f6f5c" }}>
              Ordonnance médicale
            </h3>
            <div style={{ fontSize: "0.78rem", color: MUTED, marginTop: 2 }}>Medika · Téléconsultation</div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: "0.8rem", color: MUTED, lineHeight: 1.5 }}>
          {reference && (
            <div style={{ fontWeight: 600, color: INK }}>Réf. : {reference}</div>
          )}
          {issueDate && <div>Délivrée le {issueDate}</div>}
        </div>
      </div>
      <div aria-hidden style={{ height: 3, background: "#1f6f5c", borderRadius: 2, marginTop: 14 }} />

      {/* ── Identity blocks: prescriber / patient ───────────────────────── */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14 }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <SectionLabel>Prescripteur</SectionLabel>
          <div style={{ fontWeight: 700, fontSize: "0.95rem", overflowWrap: "anywhere" }}>
            {doc?.doctor?.name ?? fallbackDoctorId ?? "—"}
          </div>
          {doc?.doctor?.specialty && (
            <div style={{ fontSize: "0.86rem", color: MUTED }}>{doc.doctor.specialty}</div>
          )}
          {doc?.doctor?.license_number && (
            <div style={{ fontSize: "0.82rem", color: MUTED }}>
              N° d’enregistrement : {doc.doctor.license_number}
            </div>
          )}
          {doc?.doctor?.hospital && (
            <div style={{ fontSize: "0.82rem", color: MUTED }}>{doc.doctor.hospital}</div>
          )}
        </div>
        <div style={{ flex: "1 1 180px", minWidth: 0 }}>
          <SectionLabel>Patient</SectionLabel>
          <div style={{ fontWeight: 700, fontSize: "0.95rem", overflowWrap: "anywhere" }}>
            {doc?.patient?.name ?? fallbackPatientName ?? "—"}
            {doc?.patient?.age != null && doc.patient.age !== "" ? (
              <span style={{ fontWeight: 400, color: MUTED }}> — {doc.patient.age} ans</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Prescriptions ───────────────────────────────────────────────── */}
      <div style={{ marginTop: 16 }}>
        <SectionLabel>Prescriptions</SectionLabel>
        {hasStructured && doc && doc.items.length > 0 && (
          <div style={{ borderTop: "1px solid #e3ece9" }}>
            {doc.items.map((item, i) => (
              <MedicationEntry key={`${item.name}-${i}`} item={item} index={i} />
            ))}
          </div>
        )}
        {hasStructured && doc && doc.items.length === 0 && !doc.general_instructions && (
          <p className="small" style={{ color: MUTED }}>
            Aucun médicament renseigné sur cette ordonnance.
          </p>
        )}
        {/* Legacy record (pre-#82): the verbatim free text, readable as-is.
           No date/reference is invented for legacy rows. */}
        {!hasStructured && (
          <div style={{ padding: "6px 0 2px", whiteSpace: "pre-wrap", fontSize: "0.92rem", lineHeight: 1.55, borderTop: "1px solid #e3ece9" }}>
            {legacyText}
          </div>
        )}
      </div>

      {/* ── General instructions ────────────────────────────────────────── */}
      {hasStructured && doc?.general_instructions ? (
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Instructions générales</SectionLabel>
          <div style={{ whiteSpace: "pre-wrap", fontSize: "0.9rem", lineHeight: 1.55, color: MUTED }}>
            {doc.general_instructions}
          </div>
        </div>
      ) : null}

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 18,
          paddingTop: 10,
          borderTop: "1px solid #dbe7e3",
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          fontSize: "0.72rem",
          color: MUTED,
        }}
      >
        <span>Document électronique délivré via la plateforme Medika.</span>
        {reference && <span>Réf. {reference}</span>}
      </div>
    </div>
  );
}

export function PrescriptionPanel({
  consultation,
  token,
}: {
  consultation: Consultation;
  token?: string | null;
}) {
  const [doc, setDoc] = useState<PrescriptionDocument | null>(null);
  const [legacyText] = useState<string>(() => (consultation.prescription ?? "").trim());
  const [loading, setLoading] = useState<boolean>(Boolean(token));
  const [loadFailed, setLoadFailed] = useState<boolean>(false); // genuine server/network failure
  const [reloadNonce, setReloadNonce] = useState(0);
  const [actionError, setActionError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    (async () => {
      try {
        const d = await getPrescriptionDocument(token, consultation.id);
        if (alive) setDoc(d);
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 404) {
          // Genuinely a legacy record (no structured document): the verbatim
          // free text stays readable through the same document layout.
          setDoc(null);
        } else {
          // Network/server failure: NEVER silently swap in the legacy text —
          // surface a retryable error state instead (issue #82 §3).
          setLoadFailed(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token, consultation.id, reloadNonce]);

  const retry = useCallback(() => setReloadNonce((n) => n + 1), []);

  if (loading) {
    return (
      <section className="card" style={{ margin: 12 }} aria-label="Ordonnance médicale">
        <Spinner label="Chargement de l’ordonnance…" />
      </section>
    );
  }

  // Genuine fetch failure (not a 404): explicit retryable error state.
  if (loadFailed) {
    return (
      <section className="card" style={{ margin: 12 }} aria-label="Ordonnance médicale">
        <ErrorAlert error={new ApiError("network", 0, "Impossible de charger l’ordonnance. Vérifiez votre connexion puis réessayez.")} />
        <button type="button" className="btn btn-secondary" onClick={retry} style={{ marginTop: 8 }}>
          <RefreshCw size={15} aria-hidden /> Réessayer
        </button>
      </section>
    );
  }

  // Nothing issued for this consultation (and no historical text): no panel.
  if (!doc && !legacyText) return null;

  const onDownload = async () => {
    if (downloading || !docRef.current) return;
    setDownloading(true);
    setActionError(null);
    try {
      // Lazy import: the renderer is only fetched when the patient actually
      // downloads the document (kept out of the main bundle).
      const html2canvas = (await import("html2canvas")).default;
      // Fonts (and any embedded images) must be ready before capture, or the
      // PNG can render with fallback glyphs / blank areas.
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }
      const canvas = await html2canvas(docRef.current, {
        backgroundColor: "#ffffff",
        scale: 2, // high-DPI capture; the full document node, nothing else
        logging: false,
        useCORS: true,
      });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("export failed");
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = `ordonnance-${doc?.reference ?? consultation.id}.png`;
      window.document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setActionError(new ApiError("network", 0, "Le téléchargement de l’ordonnance a échoué. Réessayez."));
    } finally {
      setDownloading(false);
    }
  };

  const onPrint = () => {
    setActionError(null);
    window.print();
  };

  return (
    <section
      className="card ordonnance-wrap"
      style={{ margin: 12, background: "#f4f8f6", borderColor: "var(--green-200)" }}
      aria-label="Ordonnance médicale"
    >
      {/* Actions — outside the captured/printed node, hidden on paper. */}
      <div className="ordonnance-actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
        <button type="button" className="btn btn-secondary" onClick={onDownload} disabled={downloading}>
          <Download size={15} aria-hidden /> {downloading ? "Téléchargement…" : "Télécharger l’ordonnance"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onPrint}>
          <Printer size={15} aria-hidden /> Imprimer / Enregistrer en PDF
        </button>
      </div>
      <ErrorAlert error={actionError} />

      {/* The document itself — the only node captured for download/print. */}
      <div ref={docRef}>
        <OrdonnanceDocumentBody
          doc={doc}
          legacyText={legacyText}
          fallbackPatientName={consultation.patient_name}
          fallbackDoctorId={consultation.doctor_id}
        />
      </div>

      {/* Independent purchase stays one visible, always-available choice. */}
      <p className="small" style={{ margin: "10px 2px 0", color: MUTED }}>
        <ClipboardList size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
        Télécharger l’ordonnance et acheter les médicaments en pharmacie reste possible à tout moment,
        sans demander de service Medika.
      </p>
    </section>
  );
}
