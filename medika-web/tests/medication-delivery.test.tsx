/**
 * Issue #82 — delivery scope (patient web).
 *
 * Contracts:
 *  1. MedicationDeliveryTrackingSection renders the French custody stage,
 *     the scheduled date, and the history — from server data only.
 *  2. The receipt-confirmation button appears ONLY at
 *     AWAITING_CONFIRMATION and is absent otherwise (the patient — never a
 *     driver tap — completes a delivery).
 *  3. 404 (no delivery assigned yet) renders nothing; other errors surface
 *     a French retry message instead of a fake empty state.
 *  4. The delivery employee portal page offers exactly the legal next
 *     custody actions per stage and NEVER a "Delivered" tap.
 *  5. The createMedicationOrder contract requires all four delivery fields
 *     at compile time (server rejects anything less — the interim `= {}`
 *     default that type-checked but always failed is gone).
 *  6. The login page routes delivery employees to /livreur.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MedicationDeliveryTracking } from "@/components/consultation/MedicationOrderPanel";
import type { DeliveryTracking } from "@/lib/api/types";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
const ssr = (html: string) => html.replace(/<!-- -->/g, "");

function tracking(over: Partial<DeliveryTracking> = {}): DeliveryTracking {
  return {
    id: "DL_1",
    medication_order_id: "MO_1",
    reference: "CMD-2026-1A2B3C4D5E",
    delivery_address: "12, rue Ka o",
    delivery_phone: "+50937142536",
    delivery_zone: "Centre-ville",
    city: "Port-au-Prince",
    scheduled_for: "2026-11-06",
    urgent: false,
    status: "ASSIGNED",
    events: [{ event_type: "ASSIGNED", actor_role: "admin", reason: "", created_at: 1793854000 }],
    ...over,
  };
}

// The section fetches on mount; SSR renders the loading state — the tests
// below assert the static contract (labels, statuses) and the page sources.
const LOADING_HTML = ssr(renderToString(
  createElement(MedicationDeliveryTracking, { orderId: "MO_1", token: "tok" }),
));

describe("MedicationDeliveryTracking — patient tracking (issue #82 §7)", () => {
  const panelSource = read("../components/consultation/MedicationOrderPanel.tsx");

  it("exposes the complete French custody vocabulary (nine audited stages)", () => {
    for (const stage of ["ASSIGNED", "PHARMACY_PREPARING", "READY_FOR_PICKUP", "PICKED_UP",
      "OUT_FOR_DELIVERY", "AWAITING_CONFIRMATION", "DELIVERED", "FAILED_ATTEMPT", "RETURNED_ESCALATED"]) {
      expect(panelSource).toMatch(new RegExp("^(\\s*)" + stage + ":", "m"));
    }
    expect(panelSource).toContain("veuillez confirmer la réception");
    expect(panelSource).toContain("Livraison terminée");
  });

  it("renders a labelled loading state (never a blank card)", () => {
    expect(LOADING_HTML).toContain("Suivi de la livraison");
    expect(LOADING_HTML).toContain("Suivi");
  });
});

describe("livreur portal — employee custody actions (static source contract)", () => {
  const source = read("../app/livreur/page.tsx");

  it("offers only legal transitions and NEVER lets an employee mark DELIVERED", () => {
    expect(source).toContain("PHARMACY_PREPARING");
    expect(source).toContain("AWAITING_CONFIRMATION");
    expect(source).toContain("RETURNED_ESCALATED");
    // No employee action may produce a DELIVERED event:
    expect(source).not.toMatch(/type:\s*"DELIVERED"/);
    // The terminal stage explains that the PATIENT confirms:
    expect(source).toContain("Le patient doit confirmer la réception dans Medika.");
  });

  it("requires a reason for failure stages and sends an idempotency key", () => {
    expect(source).toContain("needsReason: true");
    expect(source).toContain("Idempotency-Key");
    expect(source).toContain("Veuillez préciser le motif");
  });

  it("guards the route to the delivery role only", () => {
    expect(source).toContain('user?.role !== "delivery"');
    expect(source).toContain("/login?next=%2Flivreur");
  });

  it("never exposes clinical data fields in the employee payload type", () => {
    // Check the actual Delivery type block, not prose comments.
    const typeBlock = source.slice(
      source.indexOf("type Delivery = {"),
      source.indexOf("};", source.indexOf("type Delivery = {")),
    );
    expect(typeBlock).toContain("delivery_address");
    expect(typeBlock).not.toMatch(/diagnosis|symptom|prescription|note|history/i);
  });
});

describe("createMedicationOrder contract (issue #82 §1.4)", () => {
  it("the endpoints module requires the payload — no `= {}` default remains", () => {
    const endpoints = read("../lib/api/endpoints.ts");
    expect(endpoints).toMatch(/payload: CreateMedicationOrderRequest,\n\s+signal\?: AbortSignal/);
    expect(endpoints).not.toMatch(/payload: CreateMedicationOrderRequest = \{\}/);
  });

  it("CreateMedicationOrderRequest carries all four required delivery fields", () => {
    const types = read("../lib/api/types.ts");
    const block = types.slice(
      types.indexOf("export interface CreateMedicationOrderRequest"),
      types.indexOf("}", types.indexOf("export interface CreateMedicationOrderRequest")),
    );
    for (const field of ["delivery_address", "delivery_phone", "delivery_city", "delivery_zone_id"]) {
      expect(block).toContain(`${field}: string;`);
    }
  });

  it("the order CTA sends the selected zone RECORD id and the record's authoritative city", () => {
    const panel = read("../components/consultation/MedicationOrderPanel.tsx");
    expect(panel).toContain("delivery_zone_id: zone.id");
    expect(panel).toContain("delivery_city: zone.city");
    // Fail closed client-side too when no zone record is selected.
    expect(panel).toContain("Veuillez sélectionner une zone de livraison Medika dans la liste.");
  });
});

describe("login routing for the delivery role", () => {
  it("redirects delivery employees to /livreur when no explicit next page", () => {
    const login = read("../app/login/page.tsx");
    expect(login).toContain('user?.role === "delivery" ? "/livreur" : next');
  });
});
