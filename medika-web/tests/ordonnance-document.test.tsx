/**
 * Issues #82 + #101 — « Ordonnance médicale » : professional Medika
 * prescription document.
 *
 * Contracts:
 *  1. SSR of the structured document (formal French title
 *     « PRESCRIPTION MÉDICALE / ORDONNANCE », stable reference, prescriber
 *     identity + credentials only when present, patient, items with optional
 *     fields, general instructions).
 *  2. NO price/financial vocabulary anywhere in the document sources.
 *  3. NO fabricated signature/credential/verification claim — only a clearly
 *     designated EMPTY signature space with the printed prescriber identity.
 *  4. Legacy free-text prescriptions stay readable (verbatim, no invented
 *     reference/date).
 *  5. PNG download (« Télécharger en PNG », lazy html2canvas) + PDF export
 *     (« Exporter en PDF (A4) » via the print pipeline) with A4 print
 *     isolation and page-break-safe rows.
 *  6. Real Medika logo asset from the repository (/icons/icon-512.png) —
 *     never invented artwork; exactly ONE <img> in the document (no
 *     signature image exists in the data model).
 *  7. Confidential-medical-document marking and Medika-Haïti footer.
 *  8. Structured composer (French labels, add/remove, single-issuance
 *     semantics, anti double-submit).
 *  9. Consultation page renders the panel for patient AND doctor when
 *     the consultation is finished.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OrdonnanceDocumentBody, PrescriptionPanel } from "@/components/consultation/PrescriptionPanel";
import { PrescriptionModal } from "@/components/consultation/PrescriptionModal";
import type { Consultation, PrescriptionDocument } from "@/lib/api/types";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

/** renderToString interleaves <!-- --> between adjacent text nodes; strip
 *  them so assertions match what users actually read. */
const ssr = (html: string) => html.replace(/<!-- -->/g, "");

function consultation(over: Partial<Consultation> = {}): Consultation {
  return {
    id: "cons_rx1",
    patient_id: "p1",
    patient_name: "Jean Baptiste",
    patient_age: 41,
    doctor_id: "d1",
    description: "Douleurs",
    specialty_needed: "Medecine Generale",
    urgency_level: "Moyenne",
    ai_summary: "",
    ai_explanation: "",
    status: "TERMINE",
    prescription: null,
    created_at: 1,
    updated_at: 1,
    ...over,
  };
}

function structuredDoc(over: Partial<PrescriptionDocument> = {}): PrescriptionDocument {
  return {
    id: "RX_1",
    consultation_id: "cons_rx1",
    reference: "ORD-2026-1A2B3C4D5E",
    status: "ISSUED",
    version: 1,
    items: [
      {
        name: "Paracétamol",
        strength: "500 mg",
        form: "comprimé",
        dose: "1 comprimé",
        route: "orale",
        frequency: "3 fois par jour",
        duration: "5 jours",
        quantity: "15 comprimés",
        refills: "0",
        instructions: "À prendre après les repas",
      },
      { name: "Ibuprofène", strength: "200 mg", frequency: "2 fois par jour" },
    ],
    general_instructions: "Repos et hydratation abondante.",
    issued_at: 1793853776,
    doctor: {
      name: "Dr Test",
      specialty: "Medecine Generale",
      license_number: "MSPP-1",
      hospital: "Hopital Test",
      location: "Port-au-Prince",
    },
    patient: { name: "Jean Baptiste", age: 41 },
    ...over,
  };
}

describe("OrdonnanceDocumentBody — structured document (issue #82)", () => {
  const html = ssr(renderToString(
    createElement(OrdonnanceDocumentBody, { doc: structuredDoc(), legacyText: "" }),
  ));

  it("titles the document « PRESCRIPTION MÉDICALE / ORDONNANCE » and shows the stable reference (issue #101)", () => {
    expect(html).toContain("Prescription médicale");
    expect(html).toContain("Ordonnance");
    expect(html).toContain("Réf. : ORD-2026-1A2B3C4D5E");
  });

  it("brands the document with the real Medika logo asset, the confidential marking and the Haïti footer (issue #101)", () => {
    expect(html).toContain("/icons/icon-512.png");
    expect(html).toContain('alt="Medika"');
    expect(html).toContain("Document médical confidentiel");
    expect(html).toContain("Haïti");
  });

  it("shows the prescriber identity, specialty and credentials WHEN present", () => {
    expect(html).toContain("Prescripteur");
    expect(html).toContain("Dr Test");
    expect(html).toContain("Medecine Generale");
    expect(html).toContain("N° d’enregistrement :");
    expect(html).toContain("MSPP-1");
    expect(html).toContain("Hopital Test");
    expect(html).toContain("Port-au-Prince");
  });

  it("shows the patient identity and age", () => {
    expect(html).toContain("Patient");
    expect(html).toContain("Jean Baptiste");
    expect(html).toContain("41 ans");
  });

  it("renders every structured medication with its optional fields", () => {
    expect(html).toContain("Paracétamol 500 mg (comprimé)");
    expect(html).toContain("Prise : 1 comprimé");
    expect(html).toContain("Voie : orale");
    expect(html).toContain("Fréquence : 3 fois par jour");
    expect(html).toContain("Durée : 5 jours");
    expect(html).toContain("Quantité : 15 comprimés");
    expect(html).toContain("Renouvellements : 0");
    expect(html).toContain("À prendre après les repas");
    // Second medication with sparse optional fields — no invented values.
    expect(html).toContain("Ibuprofène 200 mg");
    expect(html).not.toContain("Voie : null");
    expect(html).not.toContain("Quantité : undefined");
  });

  it("renders the Rx prescription section and the general instructions section (issue #101)", () => {
    expect(html).toContain("Prescriptions");
    expect(html).toContain("Rx");
    expect(html).toContain("Instructions générales");
    expect(html).toContain("Repos et hydratation abondante.");
  });

  it("omits (never invents) missing credentials and dates", () => {
    const minimal = ssr(renderToString(
      createElement(OrdonnanceDocumentBody, {
        doc: structuredDoc({
          doctor: { name: "Dr Sans Credentials", specialty: null, license_number: null, hospital: null, location: null },
          issued_at: null,
        }),
        legacyText: "",
      }),
    ));
    expect(minimal).not.toContain("N° d’enregistrement :");
    expect(minimal).not.toContain("MSPP");
    // A missing issue date is omitted — never invented.
    expect(minimal).not.toContain("Délivrée le");
  });

  it("contains no price, pharmacy-fee or delivery-fee vocabulary", () => {
    const lower = html.toLowerCase();
    expect(lower).not.toContain("price");
    expect(lower).not.toContain("prix");
    expect(lower).not.toContain("montant");
    expect(lower).not.toContain("fee");
    expect(lower).not.toContain("htg");
    expect(lower).not.toContain("gourde");
  });

  it("shows a designated EMPTY signature space, never a fabricated signature or verification claim (issue #101)", () => {
    // The clearly designated signature space, with the printed prescriber
    // identity beneath it:
    expect(html).toContain("Signature du prescripteur");
    expect(html).toContain("Dr Test");
    // No verification claim is ever fabricated:
    expect(html).not.toContain("vérifié");
    expect(html).not.toContain("Vérifié");
    expect(html).not.toContain("certifié");
    expect(html).not.toContain("cachet");
    // No signature image exists in the data model — the document must ship
    // exactly ONE <img>: the real Medika logo asset.
    expect((html.match(/<img/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/<img[^>]+sign/i);
  });
});

describe("OrdonnanceDocumentBody — legacy fallback (pre-#82 records)", () => {
  const html = ssr(renderToString(
    createElement(OrdonnanceDocumentBody, {
      doc: null,
      legacyText: "Paracétamol 500 mg: 1 tablete 3 fwa pa jou pandan 5 jou",
      fallbackPatientName: "Jean Baptiste",
    }),
  ));

  it("renders the historical free text verbatim under the French title", () => {
    expect(html).toContain("Ordonnance");
    expect(html).toContain("Paracétamol 500 mg: 1 tablete 3 fwa pa jou pandan 5 jou");
  });

  it("invents NO reference or issue date for legacy records", () => {
    expect(html).not.toContain("Réf. :");
    expect(html).not.toContain("Délivrée le :");
  });

  it("invents NO prescriber identity for legacy records — no doctor id, no signature caption", () => {
    // Legacy records carry no structured doctor data. The old code rendered
    // the consultation doctor_id (here "d1") as the prescriber's name — it
    // must never appear as rendered text content:
    expect(html).toContain("Prescripteur");
    expect(html).not.toContain(">d1<");
  });
});

describe("OrdonnanceDocumentBody — prescriber identity is authoritative ONLY (owner review, PR #104)", () => {
  // The owner-reported scenario: the consultation's internal doctor_id is an
  // identifier, not a verified display name. It must NEVER appear on the
  // document — not as the prescriber's name, not as the signature caption.
  const RAW_DOCTOR_ID = "d1c0e9a8-77b2-4f9e-a1c3-9f2b5d6e8a10";

  it("renders NO doctor id when the record has doctor.name = null — prescriber shows the empty marker only", () => {
    const html = ssr(renderToString(
      createElement(OrdonnanceDocumentBody, {
        doc: structuredDoc({
          doctor: { name: null, specialty: null, license_number: null, hospital: null, location: null },
        }),
        legacyText: "",
      }),
    ));
    // No recorded name → no name is invented (and the fixture default never
    // leaks in):
    expect(html).not.toContain("Dr Test");
    // The prescriber block shows the same empty-value marker as every other
    // block — never an identifier:
    expect(html).toContain("Prescripteur");
    expect(html).toMatch(/>—</);
  });

  it("still renders the recorded doctor name verbatim (positive path unchanged)", () => {
    const html = ssr(renderToString(
      createElement(OrdonnanceDocumentBody, { doc: structuredDoc(), legacyText: "" }),
    ));
    expect(html).toContain("Dr Test");
    expect(html).toContain("Medecine Generale");
  });

  it("a UUID-like doctor_id passed via the consultation never reaches the document (panel path)", () => {
    const html = ssr(renderToString(
      createElement(PrescriptionPanel, {
        consultation: consultation({
          prescription: "Texte historique",
          doctor_id: RAW_DOCTOR_ID,
        }),
      }),
    ));
    expect(html).toContain("Texte historique");
    expect(html).not.toContain(RAW_DOCTOR_ID);
  });

  it("source contract — the consultation doctor_id is never passed for display", () => {
    const panel = read("../components/consultation/PrescriptionPanel.tsx");
    expect(panel).not.toContain("fallbackDoctorId");
    expect(panel).toContain("const doctorName = doc?.doctor?.name ?? null;");
  });
});

describe("PrescriptionPanel — actions", () => {
  it("offers the download and print actions with French labels", () => {
    const html = ssr(renderToString(
      createElement(PrescriptionPanel, {
        consultation: consultation({ prescription: "Texte historique" }),
        token: "tok",
      }),
    ));
    // SSR renders the panel in its loading state; the actions appear once
    // loaded — contract-checked on the source below. Here we assert the
    // SSR shell renders the aria-label without throwing.
    expect(html).toContain("Ordonnance médicale");
  });

  it("renders nothing when there is no document and no historical text (SSR, no token)", () => {
    const html = ssr(renderToString(
      createElement(PrescriptionPanel, { consultation: consultation({ prescription: null }) }),
    ));
    expect(html).toBe("");
  });

  it("falls back to the legacy text synchronously when no token exists", () => {
    const html = ssr(renderToString(
      createElement(PrescriptionPanel, {
        consultation: consultation({ prescription: "Texte historique lisible" }),
      }),
    ));
    expect(html).toContain("Texte historique lisible");
    expect(html).toContain("Télécharger en PNG");
    expect(html).toContain("Exporter en PDF (A4)");
  });
});

describe("Prescription document — source contracts (issue #82)", () => {
  const panel = read("../components/consultation/PrescriptionPanel.tsx");
  const modal = read("../components/consultation/PrescriptionModal.tsx");
  const css = read("../app/globals.css");
  const page = read("../app/app/consultations/[id]/page.tsx");
  const types = read("../lib/api/types.ts");

  it("downloads via lazily-imported html2canvas (never in the main bundle)", () => {
    expect(panel).toContain('await import("html2canvas")');
    expect(modal).not.toContain("html2canvas");
  });

  it("the download names the file after the stable reference", () => {
    expect(panel).toContain("ordonnance-${doc?.reference ?? consultation.id}.png");
  });

  it("print isolates only the document (A4, actions hidden, page-break-safe rows — issue #101)", () => {
    expect(css).toContain("@page { size: A4; margin: 14mm; }");
    expect(css).toContain(".ordonnance-doc, .ordonnance-doc * { visibility: visible; }");
    expect(css).toMatch(/@media print[\s\S]*\.ordonnance-actions \{ display: none !important; \}/);
    expect(css).toMatch(
      /\.ordonnance-entry,\s*\.ordonnance-meta,\s*\.ordonnance-sign \{ break-inside: avoid; page-break-inside: avoid; \}/,
    );
  });

  it("no price/financial identifier exists in the document or composer sources", () => {
    for (const [name, src] of [["panel", panel], ["modal", modal]] as const) {
      expect(src.toLowerCase(), name).not.toMatch(/\b(price|prix|montant|amount|fee)\b/);
    }
    // The server DTO forbids financial fields BY DESIGN.
    expect(types).toContain("No price/financial field exists BY DESIGN");
  });

  it("the composer prevents double-submit and reports duplicate issuance", () => {
    expect(modal).toContain("if (!token || submitting) return; // anti double-submit");
    // Server answers 409 PRESCRIPTION_ALREADY_ISSUED on a second submit;
    // the modal surfaces it through ErrorAlert (server-provided French text).
    expect(modal).toContain("<ErrorAlert error={error} />");
  });

  it("the composer sends the structured payload, not free text", () => {
    expect(modal).toContain("issuePrescription(token, consultation.id, {");
    expect(modal).toContain("items: items.map((it) => ({ ...it, name: it.name.trim() }))");
    expect(modal).toContain("general_instructions: generalInstructions.trim()");
  });

  it("the composer offers add/remove of multiple medications", () => {
    expect(modal).toContain("Ajouter un médicament");
    expect(modal).toContain("Retirer le médicament");
  });

  it("all feature copy is French", () => {
    expect(modal).toContain("Ordonnance médicale");
    expect(modal).toContain("Établir l’ordonnance et clôturer");
    expect(modal).toContain("Instructions générales");
    expect(panel).toContain("Télécharger en PNG");
    expect(panel).toContain("Exporter en PDF (A4)");
    expect(panel).toContain("Chargement de l’ordonnance…");
    expect(panel).toContain("Le téléchargement de l’ordonnance a échoué. Réessayez.");
  });

  it("falls back to legacy text ONLY on a genuine 404; network/server errors get a retryable state", () => {
    // The legacy swap-in is gated on the structured endpoint's 404.
    expect(panel).toContain("err.status === 404");
    expect(panel).toContain("loadFailed");
    // Failures surface an explicit French retry action instead of silently
    // hiding behind the historical free text (issue #82 §3).
    expect(panel).toContain("Impossible de charger l’ordonnance. Vérifiez votre connexion puis réessayez.");
    expect(panel).toContain("Réessayer");
  });

  it("awaits font readiness before PNG capture (no blank/fallback glyphs)", () => {
    expect(panel).toContain("document.fonts?.ready");
    expect(panel).toContain("scale: 2");
    expect(panel).toContain("useCORS: true");
  });

  it("keeps the independent-purchase alternative explicit (issue #82 §3)", () => {
    expect(panel).toContain("Télécharger l’ordonnance et acheter les médicaments en pharmacie");
  });

  it("the consultation page shows the panel for patient AND doctor when finished", () => {
    expect(page).toContain("{finished && <PrescriptionPanel consultation={consultation} token={token} />}");
  });

  it("a finished consultation lands on the prescription page, chat history is a separate toggle (owner request, Nov 2026)", () => {
    // The finished view defaults to the prescription page…
    expect(page).toContain('useState<"docs" | "chat">("docs")');
    // …rendered as its own scroll region (NOT inside the chat log)…
    expect(page).toContain('className="chat-log rx-docs-view"');
    // …reachable through an always-visible segmented toggle under the header,
    // with the chat history as the second surface.
    expect(page).toContain('className="rx-view-toggle"');
    expect(page).toContain("Òrdònans lan");
    expect(page).toContain("Istwa konvèsasyon an");
    // The chat log stays mounted but hidden while the prescription page is
    // shown, so the scroll controller re-pins to the latest message when the
    // history opens.
    expect(page).toContain('style={finished && finishedView === "docs" ? { display: "none" } : undefined}');
  });
});
