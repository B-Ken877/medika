/**
 * Issue #24 + #25 web UI tests:
 *   * formatCountdown (offer window / 5-hour expiry display)
 *   * EXPIRE status labels + badge classes
 *   * OfferCountdown component (renderToString smoke + server-deadline source)
 *   * Wallet page contracts: read-only (NO withdraw/request button), wired to
 *     GET /api/doctor/wallet, patient-inaccessible by server design
 *   * DoctorDashboard / chat page source contracts (countdown chips, EXPIRE
 *     banner, wallet card)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as fs from "node:fs";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";

import { formatCountdown, statusBadgeClass } from "@/lib/format";
import { consultationStatusLabel } from "@/lib/labels";
import OfferCountdown from "@/components/consultation/OfferCountdown";

const webRoot = join(__dirname, "..");
const readSrc = (rel: string) => readFileSync(join(webRoot, rel), "utf8");
/** Source without comments — assertions must target real code/UI strings. */
const readCode = (rel: string) =>
  readSrc(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("formatCountdown", () => {
  const now = 1_800_000_000_000; // fixed clock

  it("formats minutes", () => {
    expect(formatCountdown(Math.floor(now / 1000) + 54 * 60, now)).toBe("54 min");
  });

  it("formats hours and minutes", () => {
    expect(formatCountdown(Math.floor(now / 1000) + (4 * 3600 + 59 * 60), now)).toBe("4 zè 59 min");
    expect(formatCountdown(Math.floor(now / 1000) + 5 * 3600, now)).toBe("5 zè");
  });

  it("formats seconds under a minute", () => {
    expect(formatCountdown(Math.floor(now / 1000) + 9, now)).toBe("9 s");
  });

  it("expired deadlines read 'Ekspire'", () => {
    expect(formatCountdown(Math.floor(now / 1000) - 1, now)).toBe("Ekspire");
    expect(formatCountdown(Math.floor(now / 1000), now)).toBe("Ekspire");
  });

  it("empty for missing deadlines", () => {
    expect(formatCountdown(null, now)).toBe("");
    expect(formatCountdown(undefined, now)).toBe("");
  });
});

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

  it("the chat page shows the five-hour countdown banner while EN_COURS", () => {
    const src = readSrc("app/app/consultations/[id]/page.tsx");
    expect(src).toContain("consultation.expires_at != null");
    expect(src).toContain("Konsiltasyon an ekspire nan:");
  });

  it("the doctor dashboard shows the acceptance-window countdown on queue rows", () => {
    const src = readSrc("components/consultation/DoctorDashboard.tsx");
    expect(src).toContain("Tan pou aksepte:");
    expect(src).toContain("c.offer_deadline != null");
  });

  it("the doctor dashboard counts EXPIRE consultations in the done bucket", () => {
    const src = readSrc("components/consultation/DoctorDashboard.tsx");
    expect(src).toMatch(/\(c\.status === "TERMINE" \|\| c\.status === "REFUSE" \|\| c\.status === "EXPIRE"\)/);
  });
});

describe("OfferCountdown component", () => {
  it("renders the remaining time from a server-persisted deadline", () => {
    const deadline = Math.floor(Date.now() / 1000) + 30 * 60;
    const html = renderToString(
      createElement(OfferCountdown, { deadline, label: "Tan pou aksepte:" }),
    );
    expect(html).toContain("Tan pou aksepte:");
    expect(html).toMatch(/\d+ min/);
  });

  it("renders nothing without a deadline", () => {
    expect(renderToString(createElement(OfferCountdown, { deadline: null }))).toBe("");
    expect(renderToString(createElement(OfferCountdown, { deadline: undefined }))).toBe("");
  });

  it("renders 'Ekspire' once the deadline passed", () => {
    const deadline = Math.floor(Date.now() / 1000) - 5;
    const html = renderToString(createElement(OfferCountdown, { deadline }));
    expect(html).toContain("Ekspire");
  });

  it("only ever renders the SERVER-provided deadline value (no client-side math)", () => {
    const src = readSrc("components/consultation/OfferCountdown.tsx");
    expect(src).toContain("formatCountdown(deadline, nowMs)");
    expect(src).not.toMatch(/Date\.now\(\)\s*\+/); // never extends/recomputes the deadline
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
    expect(src).toContain("Revni mwen");
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
