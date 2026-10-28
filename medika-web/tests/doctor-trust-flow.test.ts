/**
 * Doctor trust flow (issues #30, #31, #32) — web contracts.
 *
 * #30: dedicated profile route linked from every directory card; available
 *      professional fields without fabrication; verified badge grounded in
 *      server state; continuing preserves the selected doctor ID and still
 *      requires intake; loading/error/not-found states.
 * #31: a deliberate review step before MonCash with doctor identity +
 *      intake summary + exact price; profile link; back/change actions;
 *      review state resets when the selection changes; payment gates and
 *      simulation notices unchanged.
 * #32: the badge appears ONLY for verification_status === 'verified'.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("doctor profile page (issue #30)", () => {
  const page = read("../app/app/doctors/[id]/page.tsx");

  it("exists as a dedicated route that fetches the doctor by id", () => {
    expect(page).toContain('getDoctor(token, doctorId, controller.signal)');
    expect(page).toContain('if (err instanceof ApiError && err.code === "not_found") setNotFound(true)');
  });

  it("presents available professional fields — biography, hospital, license, rating — without fabricating", () => {
    // Every field render is conditional on the server actually having it.
    expect(page).toMatch(/\{doctor\.biography && /);
    expect(page).toMatch(/\{doctor\.hospital && /);
    expect(page).toMatch(/\{doctor\.license_number && /);
    expect(page).toMatch(/\{doctor\.rating != null && /);
  });

  it("shows the verified badge only for the explicit server status", () => {
    expect(page).toContain('doctor.verification_status === "verified" && <VerifiedBadge />');
  });

  it("continuing preserves the selected doctor id as the source of truth", () => {
    expect(page).toContain("`/app/consult?doctor=${encodeURIComponent(doctor.id)}`");
  });

  it("warns that intake is still required before payment", () => {
    expect(page).toContain("Avan peman an, w ap dekri sentòm ou epi chwazi nivo ijans yo.");
  });

  it("has distinct loading, error and not-found states with a working retry", () => {
    expect(page).toContain("N ap chaje pwofil doktè a...");
    expect(page).toContain("Nou pa t kapab chaje pwofil doktè a. Tanpri, eseye ankò.");
    expect(page).toContain("Nou pa jwenn doktè sa a.");
    expect(page).toContain("setRetryNonce((n) => n + 1)");
  });

  it("uses server pricing, never client-supplied prices", () => {
    expect(page).toContain("getSpecialtyPrices(token ?? undefined, controller.signal)");
    expect(page).toContain("prices.find((p) => p.name === doctor.specialty)?.price ?? null");
  });
});

describe("doctor directory links to the profile (issue #30)", () => {
  const dir = read("../app/app/doctors/page.tsx");

  it("every card (including the former Konsilte entry point) opens the profile", () => {
    expect(dir).toContain("`/app/doctors/${encodeURIComponent(d.id)}`");
    expect(dir).not.toContain("`/app/consult?doctor=${encodeURIComponent(d.id)}`");
    expect(dir).toContain("Gade pwofil");
  });

  it("verified doctors carry the badge in the directory", () => {
    expect(dir).toContain('d.verification_status === "verified" && <VerifiedBadge compact />');
  });
});

describe("pre-payment review step (issue #31)", () => {
  const page = read("../app/app/consult/page.tsx");

  it("has a deliberate review phase before the MonCash gateway", () => {
    expect(page).toContain('const [reviewed, setReviewed] = useState(false);');
    expect(page).toContain("{!reviewed && (");
    expect(page).toContain("Kontinye ak peman an");
    expect(page).toContain('onClick={() => setReviewed(true)}');
    // The pay CTAs are gated behind the review confirmation.
    expect(page).toMatch(/payMode === "real" && reviewed &&/);
    expect(page).toMatch(/payMode === "simulated" && reviewed &&/);
  });

  it("shows doctor identity + available professional details with a full-profile link", () => {
    expect(page).toContain("Gade pwofil konplè a");
    expect(page).toContain("`/app/doctors/${encodeURIComponent(selectedDoctor?.id ?? \"\")}`");
    expect(page).toContain("{selectedDoctor?.hospital && <div className=\"doctor-meta\">{selectedDoctor.hospital}</div>}");
    expect(page).toContain("{selectedDoctor?.license_number && (");
  });

  it("summarizes the patient's intake (symptoms + urgency) and the exact price", () => {
    expect(page).toContain("Sentòm ou");
    expect(page).toContain("Nivo ijans");
    expect(page).toContain("formatCurrency(amount)");
  });

  it("stops with a clear next step when the price is missing/invalid", () => {
    expect(page).toContain("const amountValid = amount != null && amount > 0;");
    expect(page).toContain("disabled={!amountValid}");
    expect(page).toContain("Pri konsiltasyon an pa disponib kounye a.");
  });

  it("changing the doctor resets the review state (no stale reuse)", () => {
    // Issue #40 replaced inline selection with profile navigation; the review
    // reset still happens on every path that (re)enters the payment step.
    expect(page).toMatch(/const backToDoctors = \(\) => \{[\s\S]*?setReviewed\(false\);/);
    expect(page).toMatch(/if \(selectedDoctor && selectedDoctor\.specialty === specialty\) \{[\s\S]*?setReviewed\(false\);/);
    expect(page).toMatch(/if \(draft && resumeFromProfile\) \{[\s\S]{0,160}setReviewed\(false\);/);
  });

  it("keeps the server-verified payment gates and honest simulation notices", () => {
    // Consultation creation still only happens after backend-confirmed payment.
    expect(page).toContain("verifyPayment(orderIdRef.current)");
    expect(page).toContain('router.replace(`/app/consultations/${encodeURIComponent(consultation.id)}`)');
    // Simulation stays server-decided and explicitly labelled.
    expect(page).toContain("fetchPaymentMode()");
    expect(page).toContain("Mòd tès la aktive. Peman sa a se yon simulation; pa gen okenn lajan k ap deplase.");
  });
});

describe("verified badge component + types (issue #32)", () => {
  const badge = read("../components/ui/VerifiedBadge.tsx");
  const types = read("../lib/api/types.ts");

  it("renders ONLY for the explicit verified status — no inference", () => {
    expect(badge).toContain("Verifye");
    expect(badge).not.toContain("license_number");
    // Callers gate it: verified status only (checked above per screen).
  });

  it("the User type models the server-owned status additively", () => {
    expect(types).toContain(
      'verification_status?: "pending" | "verified" | "rejected" | null;',
    );
    expect(types).toContain("verified_at?: number | null;");
  });

  it("the badge CSS ships (clinical green, compact variant)", () => {
    const css = read("../app/globals.css");
    expect(css).toContain(".badge-verified {");
    expect(css).toContain(".badge-verified-sm");
  });
});
