/**
 * API client tests: URL building, timeouts, error normalization,
 * auth header injection, request body encoding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// apiFetch reads process.env at module load — pin it before import.
process.env.NEXT_PUBLIC_API_BASE_URL = "";
import type { ApiError as ApiErrorT } from "@/lib/api/client";
const { apiFetch, ApiError, buildUrl } = await import("@/lib/api/client");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildUrl", () => {
  it("prefixes a slash when missing", () => {
    expect(buildUrl("api/health")).toBe("/api/health");
  });

  it("serializes defined query params and skips empty ones", () => {
    expect(buildUrl("/api/doctors", { specialty: "Cardiologie", other: undefined })).toBe(
      "/api/doctors?specialty=Cardiologie",
    );
  });
});

describe("apiFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the Authorization header when a token is provided", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await apiFetch("/api/profile", { token: "user_1" });
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer user_1");
    expect(init.cache).toBe("no-store");
  });

  it("JSON-encodes plain object bodies", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ token: "x" }));
    await apiFetch("/api/auth/login", { method: "POST", body: { username: "a", password: "b" } });
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ username: "a", password: "b" }));
  });

  it("normalizes 401 into an ApiError with code unauthorized", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Invalid token" }, 401),
    );
    const err = await apiFetch("/api/profile", { token: "bad" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiErrorT;
    expect(apiErr.code).toBe("unauthorized");
    expect(apiErr.status).toBe(401);
    // User-safe French message, no backend internals:
    expect(apiErr.message).not.toContain("Invalid token");
  });

  it("maps network failures to a French, code=network ApiError", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("fetch failed"));
    const err = await apiFetch("/api/health").catch((e: unknown) => e);
    expect((err as ApiErrorT).code).toBe("network");
    expect((err as ApiErrorT).message).not.toContain("fetch failed");
  });

  it("times out with code=timeout", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "TimeoutError")),
          );
        }),
    );
    const err = await apiFetch("/api/health", { timeoutMs: 30 }).catch((e: unknown) => e);
    expect((err as ApiErrorT).code).toBe("timeout");
  });

  it("forwards caller aborts as code=aborted", async () => {
    const caller = new AbortController();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const promise = apiFetch("/api/health", { signal: caller.signal }).catch((e: unknown) => e);
    caller.abort();
    const err = await promise;
    expect((err as ApiErrorT).code).toBe("aborted");
  });

  it("returns null bodies as null (backend returns null for missing consultations)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("null", { status: 200 }),
    );
    const result = await apiFetch<unknown>("/api/consultations/missing");
    expect(result).toBeNull();
  });
});
