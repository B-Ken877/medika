/**
 * Issue #83 — medication orders and manual pharmacy quotes (patient web).
 *
 * Contracts:
 *  1. CTA « Demander le prix et la livraison avec Medika » with the explicit
 *     independence notice (download/print without ordering) + required
 *     address, Haitian phone, and explicitly allowlisted delivery zone.
 *  2. Quote review: pharmacy, itemized availability (Disponible / Stock
 *     partiel / Indisponible), unit price × quantity = subtotal in HTG,
 *     medication-only total, free-delivery notice, quote validity, no-substitution note.
 *  3. Decision path: Accepter / Refuser / Annuler / nouvelle demande; the
 *     payment step is an honest NEXT STEP note (dependent issue #84) — never
 *     a fake payment button.
 *  4. Server-driven French status copy; the client never invents statuses.
 *  5. The prescription document panel stays price-free (issue #82 contract
 *     preserved — the quote UI lives in its own component file).
 *  6. The consultation page gates the panel to the patient viewer of a
 *     finished consultation.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MedicationOrderCta, MedicationOrderView, MedicationQuoteView } from "@/components/consultation/MedicationOrderPanel";
import type { MedicationOrder } from "@/lib/api/types";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

/** renderToString interleaves <!-- --> between adjacent text nodes; strip
 *  them so assertions match what users actually read. */
const ssr = (html: string) => html.replace(/<!-- -->/g, "");

const noop = () => undefined;

function order(over: Partial<MedicationOrder> = {}): MedicationOrder {
  return {
    id: "MO_1",
    reference: "CMD-2026-1A2B3C4D5E",
    consultation_id: "cons_1",
    prescription_document_id: "RX_1",
    prescription_reference: "ORD-2026-ABCDEF1234",
    patient_id: "p1",
    patient_name: "Jean Baptiste",
    status: "REQUESTED",
    status_label_fr: "Demande en cours de traitement",
    requested_at: 1793853776,
    sla_deadline_at: 1793855576,
    sla_state: "PENDING",
    quote: null,
    next_step: "WAITING_MEDIKA",
    ...over,
  };
}

const quoteItems = [
  {
    prescription_index: 0,
    name: "Paracétamol",
    strength: "500 mg",
    form: "comprimé",
    quantity_prescribed: "15 comprimés",
    availability: "AVAILABLE",
    unit_price_htg: 25,
    quantity: 15,
    subtotal_htg: 375,
  },
  {
    prescription_index: 1,
    name: "Ibuprofène",
    strength: "200 mg",
    availability: "PARTIAL",
    offered_quantity: "4 comprimés sur 6",
    unit_price_htg: 50,
    quantity: 4,
    subtotal_htg: 200,
  },
  {
    prescription_index: 2,
    name: "Amoxicilline",
    strength: "500 mg",
    availability: "UNAVAILABLE",
  },
];

describe("MedicationOrderCta — « Demander le prix et la livraison avec Medika » (issue #83, zones as records)", () => {
  const zone = { id: "ZONE_PAP", city: "Port-au-Prince", zone_name: "Port-au-Prince" };
  const html = ssr(renderToString(
    createElement(MedicationOrderCta, {
      busy: false,
      deliveryAddress: "",
      deliveryPhone: "",
      deliveryZoneId: "ZONE_PAP",
      zones: [zone],
      zonesLoading: false,
      onDeliveryAddressChange: noop,
      onDeliveryPhoneChange: noop,
      onDeliveryZoneChange: noop,
      onCreate: noop,
    }),
  ));

  it("shows the exact French CTA and the independence notice", () => {
    expect(html).toContain("Demander le prix et la livraison avec Medika");
    expect(html).toContain("Acheter vos médicaments avec Medika");
    expect(html).toContain("Vous restez libre d’acheter vos médicaments vous-même");
  });

  it("requires delivery address, Haitian phone, and an exact zone RECORD", () => {
    expect(html).toContain("Adresse de livraison (obligatoire)");
    expect(html).toContain("Téléphone pour la livraison (obligatoire)");
    expect(html).toContain("Zone de livraison Medika (obligatoire)");
    // The zone is a SELECT over active records, never free text.
    expect(html).toContain("Port-au-Prince — Port-au-Prince");
  });

  it("shows the selected zone in the verification note", () => {
    expect(html).toContain("Zone sélectionnée : Port-au-Prince (Port-au-Prince)");
  });

  it("fails closed with the independent-purchase alternative when no zone is active", () => {
    const closed = ssr(renderToString(
      createElement(MedicationOrderCta, {
        busy: false,
        deliveryAddress: "",
        deliveryPhone: "",
        deliveryZoneId: "",
        zones: [],
        zonesLoading: false,
        onDeliveryAddressChange: noop,
        onDeliveryPhoneChange: noop,
        onDeliveryZoneChange: noop,
        onCreate: noop,
      }),
    ));
    expect(closed).toContain("La livraison Medika n’est pas encore disponible dans votre zone");
    expect(closed).toContain("acheter vos médicaments en pharmacie");
    expect(closed).not.toContain("Adresse de livraison (obligatoire)");
  });
});

describe("MedicationQuoteView — the pharmacy quote as the patient reviews it", () => {
  const quoted = order({
    status: "QUOTED",
    status_label_fr: "Devis à consulter",
    next_step: "REVIEW_QUOTE",
    quote: {
      id: "PQ_1",
      order_id: "MO_1",
      pharmacy: { id: "PH_1", name: "Pharmacie du Centre", whatsapp_number: "50937001122" },
      items: quoteItems,
      total_htg: 575,
      agent_name: "Admin Test",
      confirmation_source: "WHATSAPP",
      confirmed_at: 1793854000,
      expires_at: 1793940400,
      notes: "",
      superseded_at: null,
      expired: false,
    },
  });

  const html = ssr(renderToString(
    createElement(MedicationQuoteView, { order: quoted, busy: false, onAccept: noop, onDecline: noop }),
  ));

  it("shows the pharmacy and the itemized lines with explicit availability", () => {
    expect(html).toContain("Pharmacie du Centre");
    expect(html).toContain("Disponible");
    expect(html).toContain("Stock partiel");
    expect(html).toContain("Indisponible");
    expect(html).toContain("Quantité confirmée par la pharmacie : 4 comprimés sur 6");
  });

  it("shows unit price × quantity = subtotal, medication-only total and free delivery copy", () => {
    expect(html).toContain("25 HTG × 15 =");
    expect(html).toContain("375 HTG");
    expect(html).toContain("50 HTG × 4 =");
    expect(html).toContain("200 HTG");
    expect(html).toContain("Total des médicaments");
    expect(html).toContain("575 HTG");
    expect(html).toContain("Livraison offerte par Medika dans les zones desservies.");
    expect(html).not.toContain("Frais de livraison");
    expect(html).not.toContain("150 HTG");
  });

  it("never prices an unavailable item and states the no-substitution rule", () => {
    expect(html).toContain("aucune substitution n’est faite sans");
    expect(html).toContain("Aucun médicament n’est remplacé sans l’accord du médecin");
    // The unavailable line renders no arithmetic (no "×" price row for item 3).
    expect(html).not.toContain("Amoxicilline 500 mg — 0 HTG");
  });

  it("shows the quote validity and both decisions in French", () => {
    expect(html).toContain("Devis valable jusqu’au");
    expect(html).toContain("Accepter le devis");
    expect(html).toContain("Refuser le devis");
  });

  it("an expired quote shows the expired warning and hides the accept action", () => {
    const expiredHtml = ssr(renderToString(
      createElement(MedicationQuoteView, {
        order: {
          ...quoted,
          quote: { ...quoted.quote!, expired: true, expires_at: 1793850000 },
        },
        busy: false,
        onAccept: noop,
        onDecline: noop,
      }),
    ));
    expect(expiredHtml).toContain("Ce devis a expiré");
    expect(expiredHtml).toContain("prix actualisés");
    expect(expiredHtml).not.toContain("Accepter le devis");
  });
});

describe("MedicationOrderView — server-driven lifecycle states", () => {
  const handlers = { busy: false, onAccept: noop, onDecline: noop, onCancel: noop, onNewRequest: noop };

  it("REQUESTED: waiting copy with the SLA deadline and the cancel action", () => {
    const html = ssr(renderToString(createElement(MedicationOrderView, { order: order(), ...handlers })));
    expect(html).toContain("Demande enregistrée. Notre équipe contacte une pharmacie partenaire");
    expect(html).toContain("réponse attendue avant le");
    expect(html).toContain("Annuler la demande");
  });

  it("ESCALATED: explicit delay notice (SLA target, not a guarantee)", () => {
    const html = ssr(renderToString(
      createElement(MedicationOrderView, { order: order({ status: "ESCALATED", sla_state: "ESCALATED" }), ...handlers }),
    ));
    expect(html).toContain("prend plus de temps que prévu");
    expect(html).toContain("Annuler la demande");
  });

  it("ACCEPTED: the payment step is an honest NEXT STEP, never a fake payment button", () => {
    const html = ssr(renderToString(
      createElement(MedicationOrderView, { order: order({ status: "ACCEPTED", next_step: "PAYMENT" }), ...handlers }),
    ));
    expect(html).toContain("Devis accepté");
    expect(html).toContain("le paiement du devis sera disponible dans Medika");
    expect(html).not.toContain("Payer maintenant");
    expect(html).not.toContain("Paiement MonCash");
  });

  it("DECLINED / CANCELLED / EXPIRED: terminal copy with the new-request path", () => {
    for (const status of ["DECLINED", "CANCELLED", "EXPIRED"]) {
      const html = ssr(renderToString(
        createElement(MedicationOrderView, { order: order({ status }), ...handlers }),
      ));
      expect(html).toContain("Faire une nouvelle demande");
    }
  });

  it("uses the server-provided French reference and hides the quote view without a quote", () => {
    const html = ssr(renderToString(createElement(MedicationOrderView, { order: order(), ...handlers })));
    expect(html).toContain("Réf. : CMD-2026-1A2B3C4D5E");
    expect(html).not.toContain("Devis de vos médicaments");
  });
});

describe("Issue #83 — source contracts (patient web)", () => {
  const panel = read("../components/consultation/MedicationOrderPanel.tsx");
  const page = read("../app/app/consultations/[id]/page.tsx");
  const ordonnancePanel = read("../components/consultation/PrescriptionPanel.tsx");

  it("the panel guards every action against double submission", () => {
    expect(panel).toContain("if (busy) return; // anti double-submit");
    expect(panel).toMatch(/disabled=\{busy\}/);
  });

  it("all order actions go through the dedicated endpoints (no invented routes)", () => {
    expect(panel).toContain("createMedicationOrder(token ?? \"\", consultation.id");
    expect(panel).toContain("acceptMedicationQuote(token ?? \"\", order.id)");
    expect(panel).toContain("declineMedicationQuote(token ?? \"\", order.id)");
    expect(panel).toContain("cancelMedicationOrder(token ?? \"\", order.id)");
  });

  it("the panel hides itself for legacy free-text prescriptions (no structured document)", () => {
    expect(panel).toContain("getPrescriptionDocument(token, consultation.id)");
    expect(panel).toContain("setHasStructured(false)");
  });

  it("the consultation page gates the panel to the patient viewer of a finished consultation", () => {
    expect(page).toContain("finished && isPatientViewer && (");
    expect(page).toContain("MedicationOrderPanel consultation={consultation} token={token}");
  });

  it("the prescription document component stays price-free (issue #82 contract preserved)", () => {
    expect(ordonnancePanel.toLowerCase()).not.toMatch(/\b(price|prix|montant|amount|fee)\b/);
  });
});
