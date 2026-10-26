/**
 * Secure media resolution — URL classification, signed-grant caching and
 * expiry handling (fetch stubbed; no real network).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMediaGrantCache,
  invalidateMediaGrant,
  isDirectMediaUrl,
  parseAttachmentPath,
  resolveMediaUrl,
} from "@/lib/chat/media";

const GRANT = {
  url: "https://signed.example.com/grant?token=abc",
  expiresIn: 300,
  filename: "foto.png",
  mimetype: "image/png",
  size: 10,
};

let fetchCalls = 0;

beforeEach(() => {
  fetchCalls = 0;
  clearMediaGrantCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(GRANT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("URL classification", () => {
  it("treats legacy/public URLs as directly renderable", () => {
    expect(isDirectMediaUrl("https://medikahaiti.site/uploads/x/1.jpg")).toBe(true);
    expect(isDirectMediaUrl("http://cdn.example.com/f.mp4")).toBe(true);
    expect(isDirectMediaUrl("/uploads/cons_1/123_abc.png")).toBe(true);
    expect(isDirectMediaUrl("data:image/png;base64,xxx")).toBe(true);
    expect(isDirectMediaUrl("blob:https://localhost/uuid")).toBe(true);
  });

  it("treats the private API path as NOT directly renderable", () => {
    expect(isDirectMediaUrl("/api/consultations/cons_1/attachments/att_1")).toBe(false);
  });

  it("parses consultation and attachment ids from the API path", () => {
    expect(parseAttachmentPath("/api/consultations/cons_9/attachments/att_abc")).toEqual({
      consultationId: "cons_9",
      attachmentId: "att_abc",
    });
    expect(parseAttachmentPath("https://example.com/other")).toBeNull();
    expect(parseAttachmentPath("/uploads/x.png")).toBeNull();
  });
});

describe("resolveMediaUrl", () => {
  it("passes legacy URLs straight through (no fetch)", async () => {
    const out = await resolveMediaUrl("https://medikahaiti.site/uploads/x/1.jpg", "tok");
    expect(out).toBe("https://medikahaiti.site/uploads/x/1.jpg");
    expect(fetchCalls).toBe(0);
  });

  it("fetches a signed grant for private paths and caches it", async () => {
    const url = "/api/consultations/cons_1/attachments/att_1";
    const first = await resolveMediaUrl(url, "tok");
    expect(first).toBe(GRANT.url);
    expect(fetchCalls).toBe(1);
    // Same attachment again within the TTL → served from cache.
    const second = await resolveMediaUrl(url, "tok");
    expect(second).toBe(GRANT.url);
    expect(fetchCalls).toBe(1);
  });

  it("re-fetches after the grant expires", async () => {
    const url = "/api/consultations/cons_2/attachments/att_2";
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
    try {
      await resolveMediaUrl(url, "tok");
      expect(fetchCalls).toBe(1);
      vi.setSystemTime(Date.now() + 301_000); // past expiresIn (with the margin)
      await resolveMediaUrl(url, "tok");
      expect(fetchCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-fetches after an explicit invalidation (load error path)", async () => {
    const url = "/api/consultations/cons_3/attachments/att_3";
    await resolveMediaUrl(url, "tok");
    expect(fetchCalls).toBe(1);
    invalidateMediaGrant("cons_3", "att_3");
    await resolveMediaUrl(url, "tok");
    expect(fetchCalls).toBe(2);
  });

  it("hands unknown shapes through untouched", async () => {
    const out = await resolveMediaUrl("/some/unknown/path.png", "tok");
    expect(out).toBe("/some/unknown/path.png");
    expect(fetchCalls).toBe(0);
  });
});
