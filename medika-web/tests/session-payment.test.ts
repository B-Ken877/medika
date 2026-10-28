/**
 * Session storage tests (jsdom-free: stubs sessionStorage) and
 * payment protocol tests (create/verify with mocked fetch).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── session storage ──────────────────────────────────────────────────────────
const store = new Map<string, string>();
const storageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
};
vi.stubGlobal("sessionStorage", storageStub);
// The session module guards on `typeof window` — provide one.
vi.stubGlobal("window", { sessionStorage: storageStub });

const { readSession, writeSession, clearSession } = await import("@/lib/auth/session");

describe("session storage", () => {
  beforeEach(() => store.clear());

  it("round-trips token and user", () => {
    writeSession("patient_1", { id: "patient_1", name: "Sarah" });
    const session = readSession();
    expect(session?.token).toBe("patient_1");
    expect(session?.user).toEqual({ id: "patient_1", name: "Sarah" });
  });

  it("clears everything on logout (no stale medical data)", () => {
    writeSession("patient_1", { id: "patient_1" });
    clearSession();
    expect(readSession()).toBeNull();
    expect(store.size).toBe(0);
  });

  it("returns null without a token even if a user blob exists", () => {
    store.set("medika_session_user", '{"id":"x"}');
    expect(readSession()).toBeNull();
  });

  it("survives a corrupted user blob", () => {
    store.set("medika_session_token", "patient_1");
    store.set("medika_session_user", "not-json{{");
    const session = readSession();
    expect(session?.token).toBe("patient_1");
    expect(session?.user).toBeNull();
  });
});

// ── payment protocol ─────────────────────────────────────────────────────────
process.env.NEXT_PUBLIC_PAYMENT_BASE_URL = "/payment";
import type { PaymentError as PaymentErrorT } from "@/lib/payment";
const { createPayment, verifyPayment, buildOrderId, PaymentError } = await import("@/lib/payment");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("payment protocol", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds Android-compatible order ids", () => {
    const id = buildOrderId("doctor_9");
    expect(id).toMatch(/^MC_\d+_doctor_9$/);
  });

  it("creates a payment and returns the redirect URL", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      json({ success: true, redirectUrl: "https://moncash.example/checkout?token=abc" }),
    );
    const res = await createPayment({ orderId: "MC_1_doctor_9", amount: 1500 });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/payment/api/payment/create");
    expect(JSON.parse(init.body)).toEqual({ orderId: "MC_1_doctor_9", amount: 1500 });
    expect(res.redirectUrl).toContain("moncash");
  });

  it("rejects create responses without success:true", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(json({ success: false }));
    const err = await createPayment({ orderId: "x", amount: 10 }).catch((e: unknown) => e);
    const err2 = await createPayment({ orderId: "x", amount: 10 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect((err2 as PaymentErrorT).stage).toBeDefined();
  });

  it("verifies a payment and extracts the transactionId (Android shape)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      json({ success: true, payment: { transactionId: "TX-777" } }),
    );
    const res = await verifyPayment("MC_1_doctor_9");
    expect(res.success).toBe(true);
    expect(res.transactionId).toBe("TX-777");
  });

  it("normalizes payment network failures to user-safe French errors", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("ECONNREFUSED at 10.0.0.1"));
    const err = await createPayment({ orderId: "x", amount: 10 }).catch((e: unknown) => e);
    expect((err as PaymentErrorT).stage).toBe("network");
    expect((err as PaymentErrorT).message).not.toContain("ECONNREFUSED");
    expect((err as PaymentErrorT).message).not.toContain("10.0.0.1");
  });
});
