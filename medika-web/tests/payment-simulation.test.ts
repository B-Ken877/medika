/**
 * Simulated-payment tests — web client side.
 *
 * Part 1 (behavioural, mocked fetch): the payment lib discovers the mode
 * from the server (fail-closed to real mode) and parses the server-provided
 * `simulated` flag from the create response.
 *
 * Part 2 (source-contract, same pattern as consult-flow.test.ts — medika-web
 * has no jsdom/RTL): the consult payment step renders the server-driven
 * simulated flow — Kreyòl test-mode copy, no MonCash gateway in the simulated
 * path, never fakes success locally, keeps the real MonCash flow intact, and
 * the old client-side SANDBOX fake is gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NEXT_PUBLIC_PAYMENT_BASE_URL = "/payment";
import type { PaymentMode as PaymentModeT } from "@/lib/payment";
const { createPayment, fetchPaymentMode } = await import("@/lib/payment");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// ── Part 1: payment lib behaviour ────────────────────────────────────────────

describe("fetchPaymentMode (server-authoritative mode discovery)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /payment/api/payment/config and returns the server flag", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(json({ simulated: true }));
    const mode: PaymentModeT = await fetchPaymentMode();
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/payment/api/payment/config");
    expect(mode.simulated).toBe(true);
  });

  it("returns { simulated: false } when the server says so (production)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(json({ simulated: false }));
    const mode = await fetchPaymentMode();
    expect(mode.simulated).toBe(false);
  });

  it("fails CLOSED to real mode on a non-200 response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(json({ simulated: true }, 503));
    const mode = await fetchPaymentMode();
    expect(mode.simulated).toBe(false);
  });

  it("fails CLOSED to real mode on a network error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("network down"));
    const mode = await fetchPaymentMode();
    expect(mode.simulated).toBe(false);
  });

  it("fails CLOSED to real mode on a malformed body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("not-json{{", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const mode = await fetchPaymentMode();
    expect(mode.simulated).toBe(false);
  });
});

describe("createPayment parses the server-provided simulated flag", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reflects simulated:true from the server response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      json({ success: true, simulated: true, redirectUrl: "/payment/simulated?orderId=MC_1" }),
    );
    const res = await createPayment({ orderId: "MC_1", amount: 750 });
    expect(res.simulated).toBe(true);
    expect(res.redirectUrl).toContain("/payment/simulated");
  });

  it("defaults to simulated:false when the flag is absent (real MonCash flow)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      json({ success: true, redirectUrl: "https://moncash.example/checkout?token=abc" }),
    );
    const res = await createPayment({ orderId: "MC_2", amount: 1500 });
    expect(res.simulated).toBe(false);
    expect(res.redirectUrl).toContain("moncash.example");
  });
});

describe("server failures surface honest messages (issue #77)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a 503 payment-service-unavailable answer is NOT reported as a connection problem", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      json({ success: false, error: "Serveur de paiement non configure" }, 503),
    );
    await expect(createPayment({ orderId: "MC_503", amount: 750 })).rejects.toMatchObject({
      name: "PaymentError",
      stage: "network",
      message: "Sèvis peman an pa disponib kounye a. Tanpri eseye ankò pita oswa kontakte sipò a.",
    });
  });

  it("other 5xx failures keep the connection-oriented message", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(json({ success: false }, 502));
    await expect(createPayment({ orderId: "MC_502", amount: 750 })).rejects.toMatchObject({
      name: "PaymentError",
      message: "Nou pa rive konekte ak sèvis peman an. Verifye koneksyon entènèt ou epi eseye ankò.",
    });
  });
});

// ── Part 2: consult page source contracts ───────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const consultPage = readFileSync(
  resolve(__dirname, "../app/app/consult/page.tsx"),
  "utf8",
);

/** Extract a function body conservatively (from its declaration to the next
 * top-level "const <name> =" or the closing of the component). */
function extractFn(name: string): string {
  const start = consultPage.indexOf(`const ${name} = `);
  expect(start).toBeGreaterThan(-1);
  // End at the next top-level function declaration after the start.
  const rest = consultPage.slice(start + 1);
  const nextFn = rest.search(/\n  const (startPayment|startSimulatedPayment|confirmPayment|createTheConsultation|backToDoctors|simulateSandboxPayment) = /);
  return nextFn === -1 ? consultPage.slice(start) : consultPage.slice(start, start + 1 + nextFn);
}

describe("consult payment step — simulated mode (server-driven)", () => {
  it("discovers the mode from the server before rendering the CTA", () => {
    expect(consultPage).toContain("fetchPaymentMode()");
    expect(consultPage).toContain('setPayMode(mode.simulated ? "simulated" : "real")');
    // The mode resets every time the payment step is reached.
    expect(consultPage).toContain('if (step !== "payment") return;');
  });

  it("renders the approved Kreyòl test-mode copy", () => {
    expect(consultPage).toContain("Simile peman an");
    expect(consultPage).toContain("Mòd tès la aktive. Peman sa a se yon simulation; pa gen okenn lajan k ap deplase.");
    expect(consultPage).toContain("N ap konfime peman tès la...");
    // Issue #40: the success copy confirms the payment; the consultation
    // request is then submitted AUTOMATICALLY (no second patient action).
    expect(consultPage).toContain("Peman tès la reyisi.");
    expect(consultPage).toContain("N ap voye demann ou a otomatikman...");
    expect(consultPage).toContain("Nou pa t kapab konfime peman tès la. Tanpri, eseye ankò.");
  });

  it("never opens the MonCash gateway in the simulated path", () => {
    const fn = extractFn("startSimulatedPayment");
    expect(fn).toContain("verifyPayment(orderIdRef.current)");
    expect(fn).not.toContain("openPaymentGateway");
    expect(fn).not.toContain("window.open");
  });

  it("shows success only after the server confirms — a non-simulated server response is an error", () => {
    const fn = extractFn("startSimulatedPayment");
    expect(fn).toContain("res.simulated !== true");
    expect(fn).toContain("result.success");
  });

  it("guards against double submission while create/verify is in flight", () => {
    const fn = extractFn("startSimulatedPayment");
    expect(fn).toContain('payState === "creating" || payState === "verifying"');
  });

  it("reuses the accepted simulated order on retry (no orphan payment rows)", () => {
    const fn = extractFn("startSimulatedPayment");
    expect(fn).toContain("simOrderReadyRef.current");
    // The order flag resets when the doctor selection changes.
    expect(consultPage).toContain("simOrderReadyRef.current = false;");
  });

  it("keeps the simulated payment record distinguishable in the UI (server SIM- id shown)", () => {
    expect(consultPage).toContain("Idantifyan: {transactionId}");
  });
});

describe("consult payment step — real MonCash mode stays intact (regression)", () => {
  it("still opens the MonCash gateway in the real path", () => {
    const fn = extractFn("startPayment");
    expect(fn).toContain("openPaymentGateway(res.redirectUrl)");
  });

  it("still renders the real-mode CTA and verification copy", () => {
    expect(consultPage).toContain("Peye {formatCurrency(amount)} ak MonCash");
    expect(consultPage).toContain("Verifye peman an");
    expect(consultPage).toContain("Peman an trete pa MonCash");
  });

  it("never shows a simulation notice in the real payment flow (server-gated)", () => {
    // The test notice is rendered only under payMode === "simulated".
    const noticeIdx = consultPage.indexOf("Mòd tès la aktive.");
    const guardIdx = consultPage.lastIndexOf('payMode === "simulated"', noticeIdx);
    expect(noticeIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(-1);
    // And the mode comes from the server, not from a client-side flag.
    expect(consultPage).not.toContain("NEXT_PUBLIC_PAYMENT_SIMULATION");
    expect(consultPage).not.toContain("simulated=true");
  });

  it("the client-side SANDBOX fake is removed (server verification only)", () => {
    expect(consultPage).not.toContain("SANDBOX_TEST_");
    expect(consultPage).not.toContain("simulateSandboxPayment");
  });
});
