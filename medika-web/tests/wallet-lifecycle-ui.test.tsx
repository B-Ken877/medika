/**
 * Issue #24 + #25 + #71 web UI tests:
 *   * EXPIRE status labels + badge classes
 *   * Issue #71: NO ticking countdown anywhere — calm static copy on the chat
 *     page; deadlines stay server-authoritative (types keep expires_at /
 *     offer_deadline); the pre-expiration reminder lives server-side
 *   * Wallet page contracts: read-only (NO withdraw/request button), wired to
 *     GET /api/doctor/wallet, patient-inaccessible by server design
 *   * DoctorDashboard / chat page source contracts (EXPIRE banner, wallet card)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as fs from "node:fs";

import { statusBadgeClass } from "@/lib/format";
import { consultationStatusLabel } from "@/lib/labels";

const webRoot = join(__dirname, "..");
const readSrc = (rel: string) => readFileSync(join(webRoot, rel), "utf8");
/** Source without comments — assertions must target real code/UI strings. */
const readCode = (rel: string) =>
  readSrc(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("EXPIRE status (issue #25)", () => {
  it("has a Kreyòl label and a badge class", () => {
    expect(consultationStatusLabel("EXPIRE")).toBe("Ekspire");
    expect(statusBadgeClass("EXPIRE")).toBe("badge-red");
  });

  it("the chat page renders an EXPIRE banner with history preservation + re-create link", () => {
    const src = readSrc("app/app/consultations/[id]/page.tsx");
    expect(src).toContain('consultation.status === "EXPIRE"');
    expect(src).toContain("ekspire otomatikman apre 5 zè");
    expect(src).toMatch(/[Ii]storik mesaj yo kons[eè]ve/);
  });

  it("the chat page uses CALM STATIC COPY for the five-hour window (issue #71)", () => {
    const src = readCode("app/app/consultations/[id]/page.tsx");
    expect(src).toContain("consultation.expires_at != null");
    expect(src).toContain("Konsiltasyon sa a disponib jiska 5 èdtan apre doktè a aksepte");
    expect(src).not.toContain("OfferCountdown");
  });

  it("the doctor dashboard renders NO acceptance-window or expiry countdown (issue #71)", () => {
    const src = readCode("components/consultation/DoctorDashboard.tsx");
    expect(src).not.toContain("OfferCountdown");
    expect(src).not.toContain("Tan pou aksepte:");
    expect(src).not.toContain("Ekspire nan:");
  });

  it("the doctor dashboard counts EXPIRE consultations in the done bucket", () => {
    const src = readSrc("components/consultation/DoctorDashboard.tsx");
    expect(src).toMatch(/\(c\.status === "TERMINE" \|\| c\.status === "REFUSE" \|\| c\.status === "EXPIRE"\)/);
  });
});

describe("no ticking countdown anywhere (issue #71)", () => {
  it("the OfferCountdown component is removed", () => {
    expect(fs.existsSync(join(webRoot, "components/consultation/OfferCountdown.tsx"))).toBe(false);
  });

  it("formatCountdown is removed from lib/format.ts", () => {
    expect(readSrc("lib/format.ts")).not.toContain("formatCountdown");
  });

  it("the .offer-countdown CSS contract is removed", () => {
    const css = readSrc("app/globals.css");
    expect(css).not.toContain(".offer-countdown");
  });

  it("deadline fields stay server-authoritative API data (types untouched)", () => {
    const types = readSrc("lib/api/types.ts");
    expect(types).toContain("expires_at");
    expect(types).toContain("offer_deadline");
  });
});

describe("doctor wallet (issue #24) — read-only by design", () => {
  it("the wallet page exists and is wired to GET /api/doctor/wallet", () => {
    const page = readSrc("app/app/wallet/page.tsx");
    expect(page).toContain("getDoctorWallet");
    expect(fs.existsSync(join(webRoot, "app/app/wallet/page.tsx"))).toBe(true);
  });

  it("NO withdraw / request-payout affordance anywhere in the wallet UI", () => {
    const page = readCode("app/app/wallet/page.tsx");
    const dashboard = readCode("components/consultation/DoctorDashboard.tsx");
    for (const src of [page, dashboard]) {
      expect(src).not.toMatch(/withdraw|retir|request[^\n]*payout|demande[^\n]*paiement/i);
    }
  });

  it("the wallet page explains that payouts are scheduled and admin-run", () => {
    const page = readSrc("app/app/wallet/page.tsx");
    expect(page).toContain("Pa gen peman anko");
    expect(page).toContain("chak 15 ak 30");
  });

  it("the endpoint wrapper targets the read-only route", () => {
    const endpoints = readSrc("lib/api/endpoints.ts");
    expect(endpoints).toContain('"/api/doctor/wallet"');
    // No mutation endpoint for doctors on wallet/payouts:
    expect(endpoints).not.toMatch(/wallet.*method:\s*"(POST|PUT|DELETE)"/);
  });

  it("the doctor dashboard links to the wallet page and shows the available amount", () => {
    const src = readSrc("components/consultation/DoctorDashboard.tsx");
    expect(src).toContain('href="/app/wallet"');
    expect(src).toContain("formatCurrency(wallet.available.amount)");
  });

  it("doctor navigation includes the wallet entry", () => {
    const src = readSrc("components/layout/AppShell.tsx");
    expect(src).toContain('href: "/app/wallet"');
    // Issue #34: concise one-line nav label ("Revni" — was "Revni mwen").
    expect(src).toContain('label: "Revni"');
  });

  it("the types describe the additive deadline fields and wallet shapes", () => {
    const types = readSrc("lib/api/types.ts");
    expect(types).toContain('"EXPIRE"');
    expect(types).toContain("offer_deadline?: number | null;");
    expect(types).toContain("expires_at?: number | null;");
    expect(types).toContain("interface DoctorWallet");
  });
});

describe("admin payouts page (issue #24)", () => {
  it("exists with the Payé flow guarded by a MonCash-first warning", () => {
    const page = readSrc("../medika-admin/app/(admin)/payouts/page.js");
    expect(page).toContain("/admin/payouts/settle");
    expect(page).toContain("Paye");
    expect(page).toContain("transfert MonCash");
    expect(page).toContain("moncashReference");
  });

  it("handles the idempotent alreadyPaid response without creating duplicates", () => {
    const page = readSrc("../medika-admin/app/(admin)/payouts/page.js");
    expect(page).toContain("alreadyPaid");
    expect(page).toContain("aucun doublon");
  });

  it("the settle action is disabled while processing", () => {
    const page = readSrc("../medika-admin/app/(admin)/payouts/page.js");
    expect(page).toMatch(/disabled=\{settling\}/);
  });

  it("admin navigation includes the Versements entry", () => {
    const layout = readSrc("../medika-admin/app/(admin)/layout.js");
    expect(layout).toContain("'/payouts'");
    expect(layout).toContain("Versements");
  });
});
