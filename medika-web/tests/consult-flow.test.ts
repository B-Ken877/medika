/**
 * Regression tests for the doctor-directory consultation flow.
 *
 * Original bug (main @ 1388cf2, app/app/consult/page.tsx):
 *   When the patient clicked "Consulter" on a doctor card in the directory,
 *   the preselected-doctor effect resolved the doctor and immediately called
 *   setStep("payment") — skipping the medical intake form entirely (no
 *   symptoms, no urgency, no validation).
 *
 * Coverage here (source-contract guards, same pattern as
 * tests/patient-dashboard-auth.test.ts — medika-web has no jsdom/RTL):
 *   1. The preselected-doctor effect must NOT jump to the payment step; the
 *      patient lands on the intake form, and payment happens only through
 *      onIntakeSubmit's validation path.
 *   2. Symptoms and specialty remain validated before advancing.
 *   3. The consultation payload keeps the exact backend contract fields
 *      (description, specialtyNeeded, urgencyLevel, doctorId, transactionId,
 *      paymentAmount, orderId).
 *   4. The urgency internal values sent to the backend stay exactly
 *      "Faible" | "Moyenne" | "Haute" | "Critique" (display labels are
 *      separate, via urgencyLabel()).
 *   5. The specialty picker uses the custom SpecialtySelect (no native
 *      <select>) and keeps raw values as option values.
 *   6. The directory page still links to /app/consult?doctor=<id>.
 *   7. Anti-double-submit guard and payment verification remain in place.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const consultPage = readFileSync(
  resolve(__dirname, "../app/app/consult/page.tsx"),
  "utf8",
);
const doctorsPage = readFileSync(
  resolve(__dirname, "../app/app/doctors/page.tsx"),
  "utf8",
);
const specialtySelect = readFileSync(
  resolve(__dirname, "../components/ui/SpecialtySelect.tsx"),
  "utf8",
);

describe("consult flow — directory entry (?doctor=) goes through intake", () => {
  it("a FRESH directory entry never jumps to payment; a resumed draft does (issue #40)", () => {
    // The effect body between "preselectedDoctorId" and its closing.
    const effectStart = consultPage.indexOf("if (!preselectedDoctorId || !token) return;");
    const effectEnd = consultPage.indexOf("}, [preselectedDoctorId, token, resumeFromProfile]);");
    expect(effectStart).toBeGreaterThan(-1);
    expect(effectEnd).toBeGreaterThan(effectStart);
    const effectBody = consultPage.slice(effectStart, effectEnd);
    // The step jump is gated on a RESTORED DRAFT + resume=1 (returning from
    // the doctor profile); a fresh entry stays on the full intake.
    expect(effectBody).toMatch(/if \(draft && resumeFromProfile\) \{[\s\S]{0,120}setStep\("payment"\)/);
    expect(effectBody).toContain("// Fresh entry (no draft): stay on the FULL intake");
    // The draft restores the patient's typed intake — never retyped.
    expect(effectBody).toContain("setSymptoms(draft.symptoms)");
    // The doctor is resolved and kept selected, with his specialty prefilled.
    expect(effectBody).toContain("setSelectedDoctor(doc)");
    expect(effectBody).toContain("setSpecialty(doc.specialty)");
    // A doctor that cannot be resolved is surfaced, not silently ignored.
    expect(effectBody).toContain("setDoctorNotFound(true)");
  });

  it("keeps symptoms and specialty validation before leaving the intake step", () => {
    expect(consultPage).toContain("Tanpri, di nou sa w ap senti anvan w kontinye.");
    expect(consultPage).toContain("Tanpri, chwazi yon espesyalite medikal.");
    expect(consultPage).toContain("if (!symptoms.trim())");
    expect(consultPage).toContain("if (!specialty)");
  });

  it("advances to payment only when a doctor matching the specialty is selected", () => {
    expect(consultPage).toContain(
      'if (selectedDoctor && selectedDoctor.specialty === specialty) {',
    );
    expect(consultPage).toContain("findDoctors(specialty)");
  });

  it("keeps the exact backend payload fields on consultation creation", () => {
    for (const field of [
      "description:",
      "specialtyNeeded:",
      "urgencyLevel:",
      "aiSummary:",
      "aiExplanation:",
      "doctorId:",
      "patientAge:",
      "transactionId,",
      "paymentAmount:",
      "orderId:",
    ]) {
      expect(consultPage).toContain(field);
    }
  });

  it("sends the raw internal urgency values to the backend (display labels separate)", () => {
    expect(consultPage).toContain(
      'const URGENCY_LEVELS = ["Faible", "Moyenne", "Haute", "Critique"];',
    );
    // Display mapping is used for labels only.
    expect(consultPage).toContain("urgencyLabel(u)");
    expect(consultPage).not.toContain('urgencyLevel: urgencyLabel');
    expect(consultPage).toContain("urgencyLevel: urgency,");
  });

  it("uses the custom SpecialtySelect instead of a native <select>", () => {
    expect(consultPage).toContain("SpecialtySelect");
    // No native select/option pair left on the consult page.
    expect(consultPage).not.toMatch(/<select[\s>]/);
    expect(consultPage).not.toMatch(/<option[\s>]/);
  });

  it("SpecialtySelect ships the approved Kreyòl defaults and ARIA wiring", () => {
    expect(specialtySelect).toContain('placeholder = "Chwazi yon espesyalite"');
    expect(specialtySelect).toContain('searchPlaceholder = "Chèche yon espesyalite..."');
    expect(specialtySelect).toContain('emptyMessage = "Nou pa jwenn espesyalite sa a."');
    expect(specialtySelect).toContain('loadingLabel = "N ap chaje espesyalite yo..."');
    // Accessible combobox + listbox semantics.
    expect(specialtySelect).toContain('aria-haspopup="listbox"');
    expect(specialtySelect).toContain('aria-expanded={open}');
    expect(specialtySelect).toContain('role="listbox"');
    expect(specialtySelect).toContain('role="option"');
    expect(specialtySelect).toContain("aria-autocomplete=\"list\"");
    // Keyboard support: arrows, Enter, Escape, click-outside.
    expect(specialtySelect).toContain('"ArrowDown"');
    expect(specialtySelect).toContain('"ArrowUp"');
    expect(specialtySelect).toContain('"Enter"');
    expect(specialtySelect).toContain('"Escape"');
    // Values are raw backend values; labels are display-only.
    expect(specialtySelect).toContain("Raw backend value — never mutated");
  });

  it("builds picker options with raw backend values as values", () => {
    expect(consultPage).toContain("value: p.name");
    expect(consultPage).toContain("label: specialtyLabel(p.name)");
  });

  it("keeps anti-double-submit and payment verification intact (issue #40 hardened)", () => {
    // State guard + SYNCHRONOUS ref guard (React state is async — two rapid
    // taps could both pass the state check; the ref cannot).
    expect(consultPage).toContain("if (!token || !selectedDoctor || submitting || submitInFlightRef.current) return;");
    expect(consultPage).toContain("submitInFlightRef.current = true; // synchronous anti-double-submit");
    expect(consultPage).toContain("if (payState === \"verifying\") return;");
    expect(consultPage).toContain("await verifyPayment(orderIdRef.current)");
    // Payment success is only shown after verification confirms it.
    expect(consultPage).toContain("if (result.success)");
    expect(consultPage).toContain('setPayState("done")');
  });

  it("keeps the MonCash order-id protocol unchanged", () => {
    expect(consultPage).toContain("buildOrderId(selectedDoctor.id)");
    expect(consultPage).toContain("await createPayment({ orderId, amount })");
  });

  it("handles the no-doctor (normal) flow identically", () => {
    expect(consultPage).toContain("findDoctors(specialty);");
    // Back from payment re-filters the doctor list (covers the directory path).
    expect(consultPage).toContain("backToDoctors");
  });
});

describe("doctors directory — entry point to the consultation flow", () => {
  // Issue #30 changed the contract: every directory card (including the old
  // "Konsilte" entry point) now opens the dedicated doctor PROFILE page; the
  // profile's CTA continues to /app/consult?doctor=<id> with intake required.
  it("links each card to the doctor profile page (issue #30)", () => {
    expect(doctorsPage).toContain("`/app/doctors/${encodeURIComponent(d.id)}`");
    expect(doctorsPage).not.toContain("`/app/consult?doctor=${encodeURIComponent(d.id)}`");
  });

  it("labels the profile action with Kreyòl copy (no French)", () => {
    expect(doctorsPage).toContain("Gade pwofil");
    expect(doctorsPage).not.toContain("Consulter");
  });

  it("pluralizes the result count naturally in Kreyòl", () => {
    expect(doctorsPage).toContain("Nou pa jwenn doktè");
    expect(doctorsPage).toContain("doktè jwenn");
    expect(doctorsPage).not.toMatch(/médecins?\s/);
  });

  it("does not translate raw specialty data (display-label mapping only)", () => {
    // The filter still compares the RAW specialty value.
    expect(doctorsPage).toContain("if (specialty && d.specialty !== specialty) return false;");
    // Display goes through the mapping helper.
    expect(doctorsPage).toContain("specialtyLabel(s)");
    expect(doctorsPage).not.toContain("SPECIALTY_LABELS"); // no local duplicate map
  });
});
