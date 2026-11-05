"use client";

/**
 * Patient/doctor-facing prescription document — « Ordonnance médicale »
 * (issue #101 — professional Medika ordonnance; supersedes the #82 §3 layout).
 *
 * A formal French medical document: real Medika logo asset from the repo
 * (`/icons/icon-512.png`, never invented artwork), deep-emerald branding with
 * restrained mint accents, formal title « PRESCRIPTION MÉDICALE / ORDONNANCE »,
 * a confidential-document marking, aligned identity blocks (prescriber +
 * patient — only verified recorded values), an Rx prescription section with
 * numbered wrap-safe medication rows, general instructions, a clearly
 * DESIGNATED (always empty) signature space above the printed prescriber
 * identity, and a Medika-Haïti factual footer. Strictly NO prices (the server
 * allowlist guarantees it; only allowlisted fields are rendered).
 *
 * Data honesty (inherited from #82, kept intact):
 * - Fields without a recorded value are omitted, never invented. The current
 *   PrescriptionDocument payload carries NO patient birth date, NO doctor
 *   contact details and NO stored signature image — so none is rendered
 *   (schema gap documented in the PR; needs a separate migration review).
 * - The prescriber identity is ONLY `doc.doctor.name` (authoritative record).
 *   `consultation.doctor_id` is an internal identifier, NOT a display name —
 *   it is never rendered anywhere on the document (owner review, PR #104).
 *   When no recorded name exists the prescriber block shows the same
 *   empty-value marker as every other block and the signature caption is
 *   omitted entirely.
 * - No fabricated signature, registration number, credential or verification
 *   claim — the signature area is a designated empty space.
 *
 * States (issue #82 §3, kept): loading, retryable error, empty, and a legacy
 * free-text fallback ONLY when the structured endpoint genuinely answers
 * 404 (pre-#82 record) — network/server errors are never silently swapped
 * for the legacy text.
 *
 * Actions (issue #101): « Télécharger en PNG » (high-quality capture of the
 * document node only, html2canvas lazily imported, fonts awaited before
 * capture, 2× DPR, French feedback on failure) and « Exporter en PDF (A4) »
 * (browser print pipeline; @media print isolates the document on A4 with
 * page-break-safe medication rows).
 * The independent-purchase alternative is explicit in French.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, Download, Printer, RefreshCw } from "lucide-react";
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
const EMERALD = "#145b50"; // institutional deep emerald (manifest theme_color)
const MINT_LINE = "#d9ece0";
const MINT_SOFT = "#e9f6ef";

/** Small uppercase section label — the document's visual rhythm. */
function SectionLabel({ children, withRx = false }: { children: React.ReactNode; withRx?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      {withRx && (
        <span
          aria-hidden
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: EMERALD,
            color: "#ffffff",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontStyle: "italic",
            fontWeight: 700,
            fontSize: "0.9rem",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            letterSpacing: "0.02em",
          }}
        >
          Rx
        </span>
      )}
      <span
        style={{
          fontSize: "0.7rem",
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: EMERALD,
        }}
      >
        {children}
      </span>
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
    <div
      className="ordonnance-entry"
      style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid #e3ece9" }}
    >
      <div
        aria-hidden
        style={{
          flexShrink: 0,
          width: 24,
          height: 24,
          borderRadius: 999,
          background: MINT_SOFT,
          border: "1px solid " + MINT_LINE,
          color: EMERALD,
          fontSize: "0.8rem",
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 1,
        }}
      >
        {index + 1}
      </div>
      <div style={{ minWidth: 0, overflowWrap: "anywhere", flex: 1 }}>
        <div style={{ fontWeight: 700, color: INK, fontSize: "0.98rem", fontFamily: "Georgia, 'Times New Roman', serif" }}>
          {heading}
        </div>
        {details.length > 0 && (
          <div style={{ fontSize: "0.88rem", color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{details.join("  ·  ")}</div>
        )}
        {supply.length > 0 && (
          <div style={{ fontSize: "0.86rem", color: MUTED, marginTop: 3 }}>{supply.join("  ·  ")}</div>
        )}
        {item.instructions ? (
          <div style={{ fontSize: "0.87rem", fontStyle: "italic", color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
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
}: {
  doc: PrescriptionDocument | null;
  legacyText: string;
  fallbackPatientName?: string | null;
}) {
  const hasStructured = Boolean(doc);
  const reference = doc?.reference ?? null;
  const issueDate = formatIssueDate(doc?.issued_at);
  // Authoritative prescriber identity ONLY — never the consultation's
  // internal doctor_id (owner review correction, PR #104).
  const doctorName = doc?.doctor?.name ?? null;
  return (
    <div
      className="ordonnance-doc"
      style={{
        background: "#ffffff",
        color: INK,
        borderRadius: 14,
        border: `1px solid ${MINT_LINE}`,
        padding: "26px 24px 20px",
        boxShadow: "0 1px 2px rgba(18,45,40,0.06), 0 12px 32px -18px rgba(13,58,50,0.18)",
      }}
    >
      {/* ── Header: Medika logo asset + identity, confidential marking ──── */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Real Medika logo asset shipped in this repository (no invented artwork).
              Deliberately a plain same-origin <img>: the PNG capture (html2canvas)
              needs a stable, already-loaded element without srcset/lazy variants. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- html2canvas capture requires a plain <img>; 2.8KB same-origin asset */}
          <img
            src="/icons/icon-512.png"
            alt="Medika"
            width={44}
            height={44}
            style={{ width: 44, height: 44, borderRadius: 12, display: "block" }}
          />
          <div>
            <div
              style={{
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: "1.3rem",
                fontWeight: 700,
                lineHeight: 1.15,
                color: EMERALD,
              }}
            >
              Medika
            </div>
            <div style={{ fontSize: "0.76rem", color: MUTED, marginTop: 2 }}>
              Téléconsultation · Haïti
            </div>
          </div>
        </div>
        <div
          style={{
            fontSize: "0.62rem",
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: EMERALD,
            border: `1px solid ${MINT_LINE}`,
            background: MINT_SOFT,
            borderRadius: 999,
            padding: "5px 12px",
            whiteSpace: "nowrap",
          }}
        >
          Document médical confidentiel
        </div>
      </div>

      {/* ── Formal title: PRESCRIPTION MÉDICALE / ORDONNANCE ────────────── */}
      <div style={{ textAlign: "center", marginTop: 18, marginBottom: 4 }}>
        <div
          style={{
            fontSize: "0.66rem",
            fontWeight: 700,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: MUTED,
          }}
        >
          Prescription médicale
        </div>
        <div
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "1.55rem",
            fontWeight: 700,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: EMERALD,
            marginTop: 2,
            lineHeight: 1.2,
          }}
        >
          Ordonnance
        </div>
      </div>
      <div aria-hidden style={{ height: 3, background: EMERALD, borderRadius: 2, marginTop: 8 }} />

      {/* ── Identity blocks: prescriber / patient / délivrance ──────────── */}
      <div
        className="ordonnance-meta"
        style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 16 }}
      >
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <SectionLabel>Prescripteur</SectionLabel>
          <div
            style={{
              fontWeight: 700,
              fontSize: "0.98rem",
              overflowWrap: "anywhere",
              fontFamily: "Georgia, 'Times New Roman', serif",
            }}
          >
            {doctorName ?? "—"}
          </div>
          {doc?.doctor?.specialty && (
            <div style={{ fontSize: "0.86rem", color: MUTED, marginTop: 2 }}>{doc.doctor.specialty}</div>
          )}
          {doc?.doctor?.license_number && (
            <div style={{ fontSize: "0.82rem", color: MUTED, marginTop: 2 }}>
              N° d’enregistrement : {doc.doctor.license_number}
            </div>
          )}
          {doc?.doctor?.hospital && (
            <div style={{ fontSize: "0.82rem", color: MUTED, marginTop: 2 }}>{doc.doctor.hospital}</div>
          )}
          {doc?.doctor?.location && (
            <div style={{ fontSize: "0.82rem", color: MUTED, marginTop: 2 }}>{doc.doctor.location}</div>
          )}
        </div>
        <div style={{ flex: "1 1 180px", minWidth: 0 }}>
          <SectionLabel>Patient</SectionLabel>
          <div style={{ fontWeight: 700, fontSize: "0.98rem", overflowWrap: "anywhere" }}>
            {doc?.patient?.name ?? fallbackPatientName ?? "—"}
            {doc?.patient?.age != null && doc.patient.age !== "" ? (
              <span style={{ fontWeight: 400, color: MUTED }}> — {doc.patient.age} ans</span>
            ) : null}
          </div>
        </div>
        <div style={{ flex: "1 1 170px", minWidth: 0 }}>
          <SectionLabel>Délivrance</SectionLabel>
          {issueDate && (
            <div style={{ fontSize: "0.86rem", color: INK, lineHeight: 1.5 }}>Délivrée le {issueDate}</div>
          )}
          {reference && (
            <div style={{ fontSize: "0.82rem", color: MUTED, marginTop: 2, fontWeight: 600 }}>Réf. : {reference}</div>
          )}
        </div>
      </div>

      {/* ── Rx — Prescriptions ──────────────────────────────────────────── */}
      <div style={{ marginTop: 20 }}>
        <SectionLabel withRx>Prescriptions</SectionLabel>
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
          <div
            style={{
              padding: "6px 0 2px",
              whiteSpace: "pre-wrap",
              fontSize: "0.92rem",
              lineHeight: 1.55,
              borderTop: "1px solid #e3ece9",
            }}
          >
            {legacyText}
          </div>
        )}
      </div>

      {/* ── General instructions ────────────────────────────────────────── */}
      {hasStructured && doc?.general_instructions ? (
        <div style={{ marginTop: 16 }}>
          <SectionLabel>Instructions générales</SectionLabel>
          <div
            style={{
              whiteSpace: "pre-wrap",
              fontSize: "0.9rem",
              lineHeight: 1.55,
              color: MUTED,
              background: MINT_SOFT,
              border: `1px solid ${MINT_LINE}`,
              borderRadius: 10,
              padding: "10px 14px",
            }}
          >
            {doc.general_instructions}
          </div>
        </div>
      ) : null}

      {/* ── Signature area: designated space, printed prescriber identity ──
          NO stored signature exists in the data model — the space stays
          empty; nothing is ever fabricated. */}
      <div
        className="ordonnance-sign"
        style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginTop: 26 }}
      >
        <div style={{ flex: "1 1 200px", minWidth: 0, fontSize: "0.8rem", color: MUTED, lineHeight: 1.55 }}>
          Ordonnance établie lors d’une téléconsultation Medika.
          <br />
          Les médicaments prescrits peuvent être achetés en pharmacie sur présentation de ce document.
        </div>
        <div style={{ flex: "0 1 230px", minWidth: 200 }}>
          <div
            style={{
              height: 84,
              border: `1.5px dashed ${MINT_LINE}`,
              borderRadius: 10,
              background: "#fcfefd",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              paddingBottom: 8,
              fontSize: "0.68rem",
              fontWeight: 700,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              color: "#7d948f",
            }}
          >
            Signature du prescripteur
          </div>
          {doctorName && (
            <div style={{ fontSize: "0.8rem", color: INK, marginTop: 6, textAlign: "center", fontWeight: 600 }}>
              {doctorName}
              {doc?.doctor?.specialty ? <span style={{ fontWeight: 400, color: MUTED }}> — {doc.doctor.specialty}</span> : null}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer: Medika identity + Haïti context ─────────────────────── */}
      <div
        style={{
          marginTop: 20,
          paddingTop: 10,
          borderTop: `2px solid ${EMERALD}`,
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          fontSize: "0.72rem",
          color: MUTED,
        }}
      >
        <span>Medika — plateforme de téléconsultation médicale · Haïti</span>
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
      <section
        className="card"
        style={{ margin: 12, background: "#f7fbf9", borderColor: MINT_LINE }}
        aria-label="Ordonnance médicale"
      >
        <Spinner label="Chargement de l’ordonnance…" />
      </section>
    );
  }

  // Genuine fetch failure (not a 404): explicit retryable error state.
  if (loadFailed) {
    return (
      <section
        className="card"
        style={{ margin: 12, background: "#f7fbf9", borderColor: MINT_LINE }}
        aria-label="Ordonnance médicale"
      >
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
      <div
        className="ordonnance-actions"
        style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginBottom: 10 }}
      >
        <button type="button" className="btn btn-secondary" onClick={onDownload} disabled={downloading}>
          <Download size={15} aria-hidden /> {downloading ? "Téléchargement…" : "Télécharger en PNG"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onPrint}>
          <Printer size={15} aria-hidden /> Exporter en PDF (A4)
        </button>
      </div>
      <ErrorAlert error={actionError} />

      {/* The document itself — the only node captured for download/print. */}
      <div ref={docRef}>
        <OrdonnanceDocumentBody
          doc={doc}
          legacyText={legacyText}
          fallbackPatientName={consultation.patient_name}
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
