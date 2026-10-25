/**
 * Regression tests for the patient dashboard authentication bug.
 *
 * Original bug (feat/clinical-calm-redesign @ b17e463):
 *   PatientDashboard destructured only `user` from useAuth() and called
 *   getConsultations(user.id, …) — passing the USER ID as the bearer token.
 *   The backend's authenticate middleware ran verifyToken() on that value and
 *   rejected every request with 401 "Invalid token", so the patient dashboard
 *   could never load its consultations.
 *
 * Coverage here:
 *   1. Runtime (mocked fetch): getConsultations sends the session token in
 *      the Authorization header, loads a valid session, and surfaces a 401
 *      honestly as ApiError("unauthorized").
 *   2. Source contract: the component wires `token` (and the restoration
 *      `status`) from useAuth, guards the request until the session is
 *      restored, and never passes user.id as the credential. The load
 *      callback depends on the live session values so the retry button
 *      always retries with the CURRENT credential, not a stale closure.
 *   3. Cross-patient isolation is enforced server-side by
 *      GET /api/consultations (listForUser) and covered by the backend
 *      authorization suite (tests/authorization.test.js: "listing only
 *      shows own consultations"). This suite asserts the client keeps
 *      sending the authenticated bearer token that the backend scopes.
 *
 * Environment note: medika-web has no jsdom/React Testing Library dependency,
 * so the component itself is verified via a source-contract guard (the same
 * pattern used for lint-style regression checks) while the request behavior
 * is verified at runtime through the real endpoints module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.NEXT_PUBLIC_API_BASE_URL = "";

// ── 1. Runtime behavior through the real endpoints module ───────────────────

const { getConsultations } = await import("@/lib/api/endpoints");
const { ApiError } = await import("@/lib/api/client");
import type { ApiError as ApiErrorT } from "@/lib/api/client";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("getConsultations credential contract", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the session token (not the user id) as the Bearer credential", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(json([]));
    await getConsultations("session.jwt.token", undefined);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(url).toBe("/api/consultations");
    expect(headers.Authorization).toBe("Bearer session.jwt.token");
  });

  it("a valid session token loads the consultation list", async () => {
    const list = [{ id: "c1", status: "EN_COURS" }, { id: "c2", status: "TERMINE" }];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(json(list));
    const result = await getConsultations("session.jwt.token", undefined);
    expect(result).toEqual(list);
  });

  it("an invalid or expired token surfaces an honest 401 ApiError (not swallowed)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      json({ error: "Invalid token" }, 401),
    );
    const err = await getConsultations("expired-or-fake-token", undefined).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiErrorT;
    expect(apiErr.code).toBe("unauthorized");
    expect(apiErr.status).toBe(401);
  });
});

// ── 2. Source contract: PatientDashboard wiring (regression guard) ──────────

const source = readFileSync(
  resolve(__dirname, "../components/consultation/PatientDashboard.tsx"),
  "utf8",
);

describe("PatientDashboard auth wiring (source contract)", () => {
  it("destructures the session token and restoration status from useAuth()", () => {
    expect(source).toMatch(/const\s*\{\s*user,\s*token,\s*status\s*\}\s*=\s*useAuth\(\)/);
  });

  it("passes the token to getConsultations — never user.id", () => {
    expect(source).toContain("getConsultations(token, controller.signal)");
    expect(source).not.toContain("getConsultations(user.id");
  });

  it("guards the request until the session is restored and the credential exists", () => {
    // The guard must reject the "restoring" state and missing user/token
    // BEFORE any request is issued.
    expect(source).toMatch(
      /if\s*\(\s*status\s*!==\s*"authenticated"\s*\|\|\s*!user\s*\|\|\s*!token\s*\)\s*return;/,
    );
    // Guard must appear before the fetch call in the callback body.
    const guardIdx = source.indexOf('status !== "authenticated"');
    const callIdx = source.indexOf("getConsultations(token");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(guardIdx);
  });

  it("the load callback (used by the retry button) depends on the live session values", () => {
    // `load` is recreated whenever user/token/status change, so onRetry
    // always retries with the CURRENT credential — no stale closure.
    expect(source).toMatch(/\},\s*\[\s*user,\s*token,\s*status\s*\]\);/);
  });

  it("keeps the AbortController pattern for cancelling obsolete requests", () => {
    expect(source).toContain("abortRef.current?.abort();");
    expect(source).toContain("if (controller.signal.aborted) return;");
  });
});

// ── 3. Auth context contract (what the dashboard relies on) ─────────────────

describe("auth context exposes the fields PatientDashboard needs", () => {
  it("AuthState includes user, token and a restoring/authenticated/anonymous status", async () => {
    const ctxSource = readFileSync(resolve(__dirname, "../lib/auth/context.tsx"), "utf8");
    expect(ctxSource).toContain("user: User | null;");
    expect(ctxSource).toContain("token: string | null;");
    expect(ctxSource).toContain(
      'status: "restoring" | "authenticated" | "anonymous";',
    );
  });
});
