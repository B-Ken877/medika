/**
 * Issue #40 — simplified doctor selection + automatic submission.
 *
 * Web contracts (source-contract pattern):
 *  1. Selecting a doctor in the consult flow opens the FULL profile
 *     immediately (no extra "See Profile" click), with the intake preserved
 *     as a draft and restored on return (resume=1 → review step).
 *  2. The doctor profile CTA continues the draft when one exists.
 *  3. A server-verified payment auto-submits the consultation — the patient
 *     never clicks "send" twice; failures are recoverable WITHOUT re-paying.
 *  4. Synchronous ref guards close the double-tap race that caused the
 *     reported payment conflict (paired with the server-side replay).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("consult draft (issue #40)", () => {
  const lib = read("../lib/consult-draft.ts");

  it("stores the intake in sessionStorage (per tab, never server-side)", () => {
    expect(lib).toContain('window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))');
    expect(lib).not.toContain("localStorage");
  });

  it("expires stale drafts (30-minute window)", () => {
    expect(lib).toContain("DRAFT_MAX_AGE_MS = 30 * 60 * 1000");
    expect(lib).toContain("Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS");
  });

  it("tolerates malformed / private-mode storage without breaking the flow", () => {
    expect(lib).toMatch(/catch \{\s*\n\s*\/\* private mode/);
  });
});

describe("doctor selection opens the full profile (issue #40.1)", () => {
  const page = read("../app/app/consult/page.tsx");

  it("tapping a doctor row navigates to the profile — no intermediate step", () => {
    expect(page).toContain("const openDoctorProfile = (doc: User) => {");
    expect(page).toContain("router.push(`/app/doctors/${encodeURIComponent(doc.id)}`)");
    expect(page).toContain('onClick={() => openDoctorProfile(d)}');
    expect(page).not.toContain("onClick={() => selectDoctor(d)}");
  });

  it("the intake is saved as a draft when leaving to the profile", () => {
    expect(page).toContain("saveConsultDraft({");
    expect(page).toMatch(/openDoctorProfile[\s\S]{0,200}saveConsultDraft/);
  });

  it("the draft is restored on return; resume=1 jumps to the review step", () => {
    expect(page).toContain('const resumeFromProfile = params.get("resume") === "1";');
    expect(page).toMatch(/const draft = readConsultDraft\(\);[\s\S]{0,300}setSymptoms\(draft\.symptoms\)/);
    expect(page).toMatch(/if \(draft && resumeFromProfile\) \{[\s\S]{0,120}setStep\("payment"\)/);
  });

  it("a fresh visit still lands on the FULL intake (payment never skipped)", () => {
    expect(page).toContain("// Fresh entry (no draft): stay on the FULL intake");
  });

  it("the doctor list rows show the verified badge (server status only)", () => {
    expect(page).toContain('d.verification_status === "verified" && <VerifiedBadge compact />');
  });
});

describe("profile continue CTA (issue #40.1)", () => {
  const profile = read("../app/app/doctors/[id]/page.tsx");

  it("adapts to the consult-flow draft (continue) vs a fresh visit (start)", () => {
    expect(profile).toContain("hasConsultDraft()");
    expect(profile).toContain("&resume=1");
    expect(profile).toContain('"Kontinye konsiltasyon an"');
    expect(profile).toContain('"Kòmanse konsiltasyon ak doktè sa a"');
  });
});

describe("automatic submission after verified payment (issue #40.2)", () => {
  const page = read("../app/app/consult/page.tsx");

  it("payState 'done' auto-submits — no second patient action", () => {
    expect(page).toMatch(/useEffect\(\(\) => \{\s*\n\s*if \(payState === "done"\) \{/);
    expect(page).toContain("N ap voye demann ou a otomatikman...");
  });

  it("'done' is only reachable through SERVER-verified payment (both modes)", () => {
    // Simulated: success only after the backend confirms.
    expect(page).toMatch(/const result = await verifyPayment\(orderIdRef\.current\);[\s\S]{0,120}setPayState\("done"\)/);
    // Real: the verify endpoint decides.
    expect(page).toMatch(/confirmPayment[\s\S]{0,400}verifyPayment\(orderIdRef\.current\)/);
  });

  it("a failed auto-submit is recoverable WITHOUT paying again", () => {
    expect(page).toContain("ou pa bezwen peye ankò");
    expect(page).toContain("(menm peman an)");
    // The retry reuses the SAME order/transaction context.
    expect(page).toContain("orderId: orderIdRef.current || null");
    expect(page).toContain("transactionId,");
  });

  it("repeated taps are prevented — synchronous ref guards (issue #40.3)", () => {
    expect(page).toContain("const submitInFlightRef = useRef(false);");
    expect(page).toContain("const payInFlightRef = useRef(false);");
    expect(page).toMatch(/submitInFlightRef\.current = true; \/\/ synchronous anti-double-submit/);
    expect(page).toMatch(/payInFlightRef\.current = true; \/\/ synchronous guard/);
    // Both guards are released when the flow ends.
    expect(page.match(/finally \{\s*\n\s*payInFlightRef\.current = false;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(page).toMatch(/finally \{\s*\n\s*submitInFlightRef\.current = false;/);
  });

  it("no manual 'send the request' button remains in the success path", () => {
    // The old manual CTA is gone from the done state.
    const doneStart = page.indexOf('payState === "done" && (');
    const doneBlock = page.slice(doneStart, page.indexOf('payState === "error" && (', doneStart));
    expect(doneBlock).not.toContain("Voye demann lan");
    expect(doneBlock).toContain("disabled");
  });
});

describe("server-side idempotent replay (issue #40.3, backend contract)", () => {
  const routes = read("../../src/routes/consultations.js");

  it("a consumed payment owned by the requester replays their consultation", () => {
    expect(routes).toContain("payment_replayed: true");
    expect(routes).toMatch(/payment\.errorStatus === 409[\s\S]{0,400}existing\.patient_id === req\.user\.id/);
  });

  it("the attach-race loser also replays the winner's consultation", () => {
    expect(routes).toContain("// Lost the race");
    expect(routes).toMatch(/adminDelete\(id\);[\s\S]{0,500}payment_replayed: true/);
  });
});
