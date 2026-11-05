/**
 * Issue #82 — « Ordonnance médicale » : structured prescription document.
 *
 * Contracts:
 *  1. SSR of the structured document (French title, stable reference,
 *     prescriber identity + credentials only when present, patient, items
 *     with optional fields, general instructions).
 *  2. NO price/financial vocabulary anywhere in the document sources.
 *  3. NO fabricated signature/credential/verification claim.
 *  4. Legacy free-text prescriptions stay readable (verbatim, no invented
 *     reference/date).
 *  5. Download (« Télécharger l'ordonnance », lazy html2canvas) + print
 *     (« Imprimer / Enregistrer en PDF ») with A4 print isolation CSS.
 *  6. Structured composer (French labels, add/remove, single-issuance
 *     semantics, anti double-submit).
 *  7. Consultation page renders the panel for patient AND doctor when
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

  it("titles the document « Ordonnance médicale » and shows the stable reference", () => {
    expect(html).toContain("Ordonnance médicale");
    expect(html).toContain("Réf. : ORD-2026-1A2B3C4D5E");
  });

  it("shows the prescriber identity, specialty and credentials WHEN present", () => {
    expect(html).toContain("Prescripteur :");
    expect(html).toContain("Dr Test");
    expect(html).toContain("Spécialité :");
    expect(html).toContain("Medecine Generale");
    expect(html).toContain("N° d’enregistrement :");
    expect(html).toContain("MSPP-1");
    expect(html).toContain("Établissement :");
    expect(html).toContain("Hopital Test");
  });

  it("shows the patient identity and age", () => {
    expect(html).toContain("Patient :");
    expect(html).toContain("Jean Baptiste");
    expect(html).toContain("41 ans");
  });

  it("renders every structured medication with its optional fields", () => {
    expect(html).toContain("1. Paracétamol 500 mg (comprimé)");
    expect(html).toContain("Prise : 1 comprimé");
    expect(html).toContain("Voie : orale");
    expect(html).toContain("Fréquence : 3 fois par jour");
    expect(html).toContain("Durée : 5 jours");
    expect(html).toContain("Quantité : 15 comprimés");
    expect(html).toContain("Renouvellements : 0");
    expect(html).toContain("À prendre après les repas");
    // Second medication with sparse optional fields — no invented values.
    expect(html).toContain("2. Ibuprofène 200 mg");
    expect(html).not.toContain("Voie : null");
    expect(html).not.toContain("Quantité : undefined");
  });

  it("renders the general instructions section", () => {
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
    expect(minimal).not.toContain("Établissement :");
    expect(minimal).not.toContain("Délivrée le :");
    // A missing license must never be replaced by a placeholder claim.
    expect(minimal).not.toContain("MSPP");
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

  it("contains no fabricated signature or verification claim", () => {
    expect(html).not.toContain("Signature");
    expect(html).not.toContain("signature");
    expect(html).not.toContain("cachet");
    expect(html).not.toContain("vérifié");
    expect(html).not.toContain("Vérifié");
    expect(html).not.toContain("certifié");
  });
});

describe("OrdonnanceDocumentBody — legacy fallback (pre-#82 records)", () => {
  const html = ssr(renderToString(
    createElement(OrdonnanceDocumentBody, {
      doc: null,
      legacyText: "Paracétamol 500 mg: 1 tablete 3 fwa pa jou pandan 5 jou",
      fallbackPatientName: "Jean Baptiste",
      fallbackDoctorId: "d1",
    }),
  ));

  it("renders the historical free text verbatim under the French title", () => {
    expect(html).toContain("Ordonnance médicale");
    expect(html).toContain("Paracétamol 500 mg: 1 tablete 3 fwa pa jou pandan 5 jou");
  });

  it("invents NO reference or issue date for legacy records", () => {
    expect(html).not.toContain("Réf. :");
    expect(html).not.toContain("Délivrée le :");
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
    expect(html).toContain("Télécharger l’ordonnance");
    expect(html).toContain("Imprimer / Enregistrer en PDF");
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

  it("print isolates only the document (A4, actions hidden)", () => {
    expect(css).toContain("@page { size: A4; margin: 14mm; }");
    expect(css).toContain(".ordonnance-doc, .ordonnance-doc * { visibility: visible; }");
    expect(css).toMatch(/@media print[\s\S]*\.ordonnance-actions \{ display: none !important; \}/);
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
    expect(panel).toContain("Télécharger l’ordonnance");
    expect(panel).toContain("Imprimer / Enregistrer en PDF");
    expect(panel).toContain("Le téléchargement de l’ordonnance a échoué. Réessayez.");
  });

  it("the consultation page shows the panel for patient AND doctor when finished", () => {
    expect(page).toContain("{finished && <PrescriptionPanel consultation={consultation} token={token} />}");
  });
});
