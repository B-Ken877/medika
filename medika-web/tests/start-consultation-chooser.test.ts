/**
 * Contract tests for the "New consultation" entry (owner's spec):
 *
 *  1. The CTA is a real BUTTON, never a link to /app/consult — the first
 *     tap opens the two-option sheet instead of navigating.
 *  2. The sheet offers EXACTLY two options with the owner-approved labels:
 *     "Rele yon ajan" (call-center agent call) and "Kontinye manyèlman"
 *     (manual intake form).
 *  3. The agent option performs a ZERO-INPUT call-center request (empty
 *     body, no form fields anywhere in the sheet) and lands the patient
 *     directly in the voice call screen — the call popup.
 *  4. The manual option goes to the classic /app/consult flow, unchanged.
 *  5. The sheet is styled as an iOS action sheet (blurred backdrop, grabber,
 *     grouped rows, tinted squircle icons, hairline separator, cancel
 *     capsule), with every rule scoped under .app-shell (issue #99
 *     governance) and reduced-motion respected.
 *  6. The call screen's waiting copy acknowledges a CALL_CENTER consultation
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
const themeSource = read("../app/patient-theme.css");
const globalsSource = read("../app/globals.css");

describe("new consultation entry — button + two-option sheet", () => {
  it("the dashboard CTA is the chooser button — the old /app/consult link is gone", () => {
    expect(dashboardSource).toContain("<StartConsultation />");
    expect(dashboardSource).toContain("<StartConsultation compact />");
    // No navigation link to the intake form remains as the CTA.
    expect(dashboardSource).not.toContain('href="/app/consult"');
  });

  it("the CTA is a real <button>, not a link, with iOS press feedback", () => {
    expect(chooserSource).toContain('className="btn btn-primary scs-cta"');
    expect(chooserSource).toContain("Kòmanse yon konsiltasyon");
    expect(themeSource).toContain(".app-shell .scs-cta:active");
  });

  it("the sheet offers exactly two options with the owner-approved labels", () => {
    expect(chooserSource).toContain("Rele yon ajan");
    expect(chooserSource).toContain("Kontinye manyèlman");
    expect(chooserSource).toContain('router.push("/app/consult")');
    // Exactly two choice rows inside the grouped card.
    expect(chooserSource.match(/className="scs-row"/g)?.length).toBe(2);
  });

  it("the agent call requires ZERO patient input — no form fields in the sheet", () => {
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

  it("the sheet is built as an iOS action sheet (backdrop, grabber, rows, cancel)", () => {
    expect(chooserSource).toContain('className="scs-backdrop"');
    expect(chooserSource).toContain('className="scs-grabber"');
    expect(chooserSource).toContain('className="scs-icon scs-icon-agent"');
    expect(chooserSource).toContain('className="scs-icon scs-icon-manual"');
    expect(chooserSource).toContain('className="scs-cancel"');
    // iOS blur + hairline separator + tinted squircle icons + safe-area.
    expect(themeSource).toContain("backdrop-filter: blur(10px)");
    expect(themeSource).toContain(".app-shell .scs-sep");
    expect(themeSource).toContain("env(safe-area-inset-bottom)");
    // Entrance animations ship in globals.css next to the other keyframes.
    expect(globalsSource).toContain("@keyframes scs-rise");
    expect(themeSource).toContain("animation: scs-rise");
    // Reduced motion suppresses the sheet animations.
    expect(themeSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.app-shell \.scs-sheet \{ animation: none/,
    );
  });

  it("every scs-* rule stays scoped under .app-shell (issue #99 governance)", () => {
    const lines = themeSource
      .split("\n")
      .map((line) => line.trim());
    // The scoped styles exist…
    const scoped = lines.filter((line) => /^\.app-shell \.scs-/.test(line));
    expect(scoped.length).toBeGreaterThan(20);
    // …and no selector line ever opens with a bare .scs- class (a line that
    // starts with .scs- is by definition unscoped).
    const unscoped = lines.filter((line) => /^\.scs-/.test(line));
    expect(unscoped).toEqual([]);
  });

  it("the call screen waits for the AGENT on CALL_CENTER consultations", () => {
    expect(callPageSource).toContain('"N ap rele ajant sant apèl la…"');
    expect(callPageSource).toContain('c.channel === "CALL_CENTER"');
    // The doctor-wait copy stays for regular consultations.
    expect(callPageSource).toContain('"N ap tann doktè a konekte…"');
  });
});
