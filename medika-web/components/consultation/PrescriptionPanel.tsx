"use client";

/**
 * Patient/doctor-facing prescription document — « Ordonnance médicale »
 * (issue #82).
 *
 * Renders the structured, immutable prescription issued by the doctor:
 * doctor identity and credentials WHEN PRESENT (never fabricated, no
 * verification claim), patient, issue date, stable reference, structured
 * medication instructions and general instructions — in French.
 *
 * Strictly NO medication/pharmacy/delivery prices (the server allowlist
 * guarantees it; this component only renders the allowlisted fields).
 *
 * Actions: « Télécharger l'ordonnance » (PNG via html2canvas, lazily imported
 * so it never loads for users who don't download) and « Imprimer / Enregistrer
 * en PDF » (browser print pipeline; print CSS isolates the document on A4).
 * Legacy free-text prescriptions (pre-#82 records) stay readable through the
 * same document layout — no date/reference is invented for them.
 */
import { useEffect, useRef, useState } from "react";
import { ClipboardList, Download, Printer } from "lucide-react";
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

/** One structured medication instruction rendered as a document entry. */
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
    <div className="ordonnance-item" style={{ padding: "8px 0", borderBottom: "1px solid var(--gray-200)" }}>
      <div style={{ fontWeight: 600, color: "var(--ink, #122d28)" }}>
        {index + 1}. {heading}
      </div>
      {details.length > 0 && (
        <div style={{ fontSize: "0.9rem", color: "var(--gray-700, #3f4f4b)", marginTop: 2 }}>{details.join(" · ")}</div>
      )}
      {supply.length > 0 && (
        <div style={{ fontSize: "0.9rem", color: "var(--gray-700, #3f4f4b)", marginTop: 2 }}>{supply.join(" · ")}</div>
      )}
      {item.instructions ? (
        <div style={{ fontSize: "0.88rem", fontStyle: "italic", color: "var(--gray-700, #3f4f4b)", marginTop: 2 }}>
          {item.instructions}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The document body — the ONLY node captured by the download/print actions.
 * Extracted as a pure component so tests can SSR the structured document
 * exactly as a patient will see it. Shows only authoritative data: fields
 * without a recorded value are omitted, never invented.
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
    <div className="ordonnance-doc" style={{ background: "#ffffff", color: "#122d28", padding: 16, borderRadius: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "1.15rem", color: "var(--green-800)", display: "flex", alignItems: "center", gap: 8 }}>
          <ClipboardList size={18} aria-hidden style={{ color: "var(--green-700)" }} />
          Ordonnance médicale
        </h3>
        {reference && (
          <span className="tiny" style={{ color: "var(--gray-700, #3f4f4b)" }}>Réf. : {reference}</span>
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: "0.92rem", lineHeight: 1.5 }}>
        <div>
          <span style={{ color: "var(--gray-700, #3f4f4b)" }}>Prescripteur : </span>
          <strong>{doc?.doctor?.name ?? fallbackDoctorId ?? "—"}</strong>
        </div>
        {doc?.doctor?.specialty && (
          <div>
            <span style={{ color: "var(--gray-700, #3f4f4b)" }}>Spécialité : </span>
            {doc.doctor.specialty}
          </div>
        )}
        {doc?.doctor?.license_number && (
          <div>
            <span style={{ color: "var(--gray-700, #3f4f4b)" }}>N° d’enregistrement : </span>
            {doc.doctor.license_number}
          </div>
        )}
        {doc?.doctor?.hospital && (
          <div>
            <span style={{ color: "var(--gray-700, #3f4f4b)" }}>Établissement : </span>
            {doc.doctor.hospital}
          </div>
        )}
        <div style={{ marginTop: 6 }}>
          <span style={{ color: "var(--gray-700, #3f4f4b)" }}>Patient : </span>
          <strong>{doc?.patient?.name ?? fallbackPatientName ?? "—"}</strong>
          {doc?.patient?.age != null && doc.patient.age !== "" ? ` — ${doc.patient.age} ans` : ""}
        </div>
        {issueDate && (
          <div>
            <span style={{ color: "var(--gray-700, #3f4f4b)" }}>Délivrée le : </span>
            {issueDate}
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, borderTop: "1px solid var(--gray-200)" }}>
        {hasStructured && doc && doc.items.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {doc.items.map((item, i) => (
              <MedicationEntry key={`${item.name}-${i}`} item={item} index={i} />
            ))}
          </div>
        )}
        {hasStructured && doc && doc.items.length === 0 && !doc.general_instructions && (
          <p className="small" style={{ color: "var(--gray-700, #3f4f4b)" }}>
            Aucun médicament renseigné sur cette ordonnance.
          </p>
        )}
        {/* Legacy record (pre-#82): the verbatim free text, readable as-is. */}
        {!hasStructured && <div style={{ padding: "10px 0", whiteSpace: "pre-wrap", fontSize: "0.92rem" }}>{legacyText}</div>}
      </div>

      {hasStructured && doc?.general_instructions ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: "0.92rem" }}>Instructions générales</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: "0.92rem", color: "var(--gray-700, #3f4f4b)", marginTop: 2 }}>
            {doc.general_instructions}
          </div>
        </div>
      ) : null}
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
  const [actionError, setActionError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    if (!token) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const d = await getPrescriptionDocument(token, consultation.id);
        if (alive) setDoc(d);
      } catch {
        // 404 (no structured document — legacy record) or network hiccup:
        // the legacy plain-text fallback below keeps the prescription readable.
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token, consultation.id]);

  if (loading) {
    return (
      <section className="card" style={{ margin: 12 }} aria-label="Ordonnance médicale">
        <Spinner label="Chargement de l’ordonnance…" />
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
      const canvas = await html2canvas(docRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false,
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
      style={{ margin: 12, background: "var(--success-bg, #f0f7f4)", borderColor: "var(--green-200)" }}
      aria-label="Ordonnance médicale"
    >
      {/* Actions — outside the captured/printed node, hidden on paper. */}
      <div className="ordonnance-actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 8 }}>
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
    </section>
  );
}
