/**
 * Contract tests for the "New consultation" entry (owner's spec):
 *
 *  1. The CTA is a real BUTTON, never a link to /app/consult — the first
 *     click opens the two-option chooser instead of navigating.
 *  2. The chooser offers EXACTLY two options: the call-center agent call and
 *     the manual intake form.
 *  3. The agent option performs a ZERO-INPUT call-center request (empty
 *     body, no form fields anywhere in the chooser) and lands the patient
 *     directly in the voice call screen — the call popup.
 *  4. The manual option goes to the classic /app/consult flow, unchanged.
 *  5. The call screen's waiting copy acknowledges a CALL_CENTER consultation
 *     ("calling the call-center agent"), never "waiting for a doctor".
 *
 * medika-web has no jsdom/React Testing Library dependency, so behavior is
 * verified via source-contract guards (same pattern as
 * tests/patient-dashboard-hero-artwork.test.ts).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

const dashboardSource = read("../components/consultation/PatientDashboard.tsx");
const chooserSource = read("../components/consultation/StartConsultation.tsx");
const endpointsSource = read("../lib/api/endpoints.ts");
const callPageSource = read("../app/app/consultations/[id]/call/page.tsx");

describe("new consultation entry — button + two-option chooser", () => {
  it("the dashboard CTA is the chooser button — the old /app/consult link is gone", () => {
    expect(dashboardSource).toContain("<StartConsultation />");
    expect(dashboardSource).toContain("<StartConsultation compact />");
    // No navigation link to the intake form remains as the CTA.
    expect(dashboardSource).not.toContain('href="/app/consult"');
  });

  it("the CTA is a real <button>, not a link", () => {
    expect(chooserSource).toContain('<button type="button" className="btn btn-primary"');
    expect(chooserSource).toContain("Kòmanse yon konsiltasyon");
  });

  it("the chooser offers exactly two options: agent call and manual form", () => {
    expect(chooserSource).toContain("Rele yon ajant sant apèl");
    expect(chooserSource).toContain("Manyèl — ranpi fòm sentòm yo");
    expect(chooserSource).toContain('router.push("/app/consult")');
  });

  it("the agent call requires ZERO patient input — no form fields in the chooser", () => {
    expect(chooserSource).not.toMatch(/<input\b/);
    expect(chooserSource).not.toMatch(/<textarea\b/);
    expect(chooserSource).not.toMatch(/<select\b/);
  });

  it("the agent option posts the empty-body call-center request and opens the voice call screen", () => {
    expect(endpointsSource).toContain('"/api/consultations/call-center"');
    // Empty body — the patient supplies nothing.
    expect(endpointsSource).toMatch(/createCallCenterConsultation[\s\S]*?body: \{\}/);
    expect(chooserSource).toContain("createCallCenterConsultation(token)");
    expect(chooserSource).toContain("/call?mode=voice");
  });

  it("a 409 points the patient back to their existing consultation (issue #60 convention)", () => {
    expect(chooserSource).toContain("err.existingId");
  });

  it("the call screen waits for the AGENT on CALL_CENTER consultations", () => {
    expect(callPageSource).toContain('"N ap rele ajant sant apèl la…"');
    expect(callPageSource).toContain('c.channel === "CALL_CENTER"');
    // The doctor-wait copy stays for regular consultations.
    expect(callPageSource).toContain('"N ap tann doktè a konekte…"');
  });
});
