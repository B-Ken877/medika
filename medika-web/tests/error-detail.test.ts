/**
 * Issue #79 — error legibility for payment-adjacent failures.
 *
 * Reported symptom: a simulated payment succeeded but the consultation was
 * not created, and the UI showed no actionable reason. Two halves to the
 * contract, both covered here:
 *
 * 1. BEHAVIOURAL (apiFetch): the backend's user-safe `error` string and the
 *    issue #60 `existing_id` link are normalized onto ApiError.detail /
 *    ApiError.existingId — they must survive normalization.
 *
 * 2. SOURCE-CONTRACT (ErrorAlert + consult payment step): the error alert
 *    renders the specific detail (not just the generic per-status message),
 *    and the post-payment failure state keeps the honest "you do not need
 *    to pay again" copy with a retry that reuses the SAME payment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.NEXT_PUBLIC_API_BASE_URL = "";
const { apiFetch, ApiError } = await import("@/lib/api/client");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("apiFetch carries the backend's user-safe reason on ApiError.detail", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("409 doctor-busy: detail is the specific message, generic message stays intact", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(
        { error: "Doktè sa a okipe deja yon konsiltasyon. Chwazi yon lòt doktè oswa eseye pi ta." },
        409,
      ),
    );
    const err = (await apiFetch("/api/consultations", { method: "POST", body: {}, token: "t" }).catch((e) => e)) as InstanceType<typeof ApiError>;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("Gen yon konfli — enfòmasyon sa a egziste deja.");
    expect(err.detail).toContain("okipe deja");
  });

  it("402 underpayment: detail carries the exact required amount", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Montant paye insuffisant (requis: 750 HTG)" }, 402),
    );
    const err = (await apiFetch("/api/consultations", { method: "POST", body: {}, token: "t" }).catch((e) => e)) as InstanceType<typeof ApiError>;
    expect(err.status).toBe(402);
    expect(err.detail).toContain("750");
  });

  it("409 one-active conflict: existing_id surfaces as ApiError.existingId", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(
        { error: "Ou gen deja yon konsiltasyon aktif.", existing_id: "cons_abc", existing_status: "RECHERCHE_MEDECIN" },
        409,
      ),
    );
    const err = (await apiFetch("/api/consultations", { method: "POST", body: {}, token: "t" }).catch((e) => e)) as InstanceType<typeof ApiError>;
    expect(err.status).toBe(409);
    expect(err.existingId).toBe("cons_abc");
  });

  it("successes without an error body carry no detail", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ id: "cons_ok" }));
    const data = await apiFetch<{ id: string }>("/api/consultations", { method: "POST", body: {}, token: "t" });
    expect(data.id).toBe("cons_ok");
  });
});

// ── Source contracts ─────────────────────────────────────────────────────────

const primitives = readFileSync(resolve(__dirname, "../components/ui/primitives.tsx"), "utf8");
const consultPage = readFileSync(resolve(__dirname, "../app/app/consult/page.tsx"), "utf8");

describe("ErrorAlert renders the specific backend reason (issue #79)", () => {
  it("reads ApiError.detail and renders it when it differs from the generic text", () => {
    expect(primitives).toContain("error instanceof ApiError ? error.detail : undefined");
    expect(primitives).toContain("detail && detail !== text");
  });

  it("keeps the role=alert error surface accessible", () => {
    expect(primitives).toContain('role="alert"');
  });
});

describe("post-payment failure state stays honest and recoverable", () => {
  it("payment-success panel never claims booking success; retry reuses the SAME payment", () => {
    // The warning explicitly says the request was NOT sent and no second
    // payment is needed — with the ErrorAlert detail above it, the reason
    // is now legible (doctor busy / amount / active consultation…).
    expect(consultPage).toContain("Peman ou a konfime, men nou pa t kapab voye demann lan. Pa pè — ou pa bezwen peye ankò.");
    expect(consultPage).toContain("Reseye voye demann lan (menm peman an)");
  });

  it("auto-submits only after a SERVER-verified payment and keeps payment context on failure", () => {
    expect(consultPage).toContain('if (payState === "done")');
    expect(consultPage).toContain("void createTheConsultation()");
    // Failure path keeps orderIdRef so the retry re-uses the same payment.
    expect(consultPage).toContain("orderId: orderIdRef.current || null");
  });
});
