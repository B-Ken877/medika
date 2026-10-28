/**
 * Deterministic waveform synthesis (issue #18) — the audio bubble's bars must
 * be stable per message (no flicker across re-renders), bounded, and distinct
 * between messages.
 */
import { describe, expect, it } from "vitest";
import { hashSeed, mulberry32, synthesizedBars } from "@/lib/chat/waveform";

describe("hashSeed", () => {
  it("is stable for the same key", () => {
    expect(hashSeed("msg-42")).toBe(hashSeed("msg-42"));
  });

  it("differs between keys", () => {
    const seeds = new Set(["a", "b", "c", "d", "e", "f"].map(hashSeed));
    expect(seeds.size).toBe(6);
  });

  it("returns a uint32", () => {
    const v = hashSeed("kreyòl-mesaj-vwa");
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(v)).toBe(true);
  });
});

describe("mulberry32", () => {
  it("produces the same sequence for the same seed", () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it("stays in [0, 1)", () => {
    const rnd = mulberry32(987);
    for (let i = 0; i < 500; i++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("synthesizedBars", () => {
  it("is deterministic for the same message key", () => {
    expect(synthesizedBars("message-1")).toEqual(synthesizedBars("message-1"));
  });

  it("uses the default bar count and honors custom counts", () => {
    expect(synthesizedBars("k").length).toBe(44);
    expect(synthesizedBars("k", 12).length).toBe(12);
  });

  it("keeps every bar within 0.16..1 (visible, never overflowing)", () => {
    for (const key of ["a", "b", "message-999", "x-y-z"]) {
      for (const b of synthesizedBars(key)) {
        expect(b).toBeGreaterThanOrEqual(0.16);
        expect(b).toBeLessThanOrEqual(1);
      }
    }
  });

  it("produces different shapes for different messages", () => {
    // Whole-array equality across distinct keys would be a hash catastrophe.
    const distinct = new Set(
      ["m1", "m2", "m3", "m4", "m5"].map((k) => JSON.stringify(synthesizedBars(k))),
    );
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("has speech-like energy: middle bars are not all silent", () => {
    const bars = synthesizedBars("speech");
    const middle = bars.slice(Math.floor(bars.length * 0.3), Math.ceil(bars.length * 0.7));
    const avg = middle.reduce((s, b) => s + b, 0) / middle.length;
    expect(avg).toBeGreaterThan(0.3);
  });
});
