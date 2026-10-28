/**
 * Emoji insertion — cursor math, surrogate-pair safety, 4000-limit in code
 * points, and data integrity for the curated set.
 */
import { describe, expect, it } from "vitest";
import { EMOJI_CATEGORIES, FREQUENT_EMOJIS, insertAtCursor } from "@/lib/chat/emoji";

describe("insertAtCursor", () => {
  it("inserts at the caret and preserves the surrounding draft", () => {
    expect(insertAtCursor("bonjou", "😀", 3)).toEqual({ value: "bon😀jou", caret: 5 });
    expect(insertAtCursor("bonjou", "🙏", 0)).toEqual({ value: "🙏bonjou", caret: 2 });
    expect(insertAtCursor("bonjou", "🙏", 6)).toEqual({ value: "bonjou🙏", caret: 8 });
  });

  it("clamps an out-of-range caret", () => {
    expect(insertAtCursor("ab", "😀", 99)).toEqual({ value: "ab😀", caret: 4 });
    expect(insertAtCursor("ab", "😀", -3)).toEqual({ value: "😀ab", caret: 2 });
  });

  it("does not split surrogate pairs in combined sequences", () => {
    const family = "👨‍👩‍👧‍👦"; // 7 code points, 11 UTF-16 units
    const out = insertAtCursor(`bye${family}`, "❤️", 3)!; // ❤️ = 2 code points
    expect(out.value).toBe(`bye❤️${family}`);
    expect(Array.from(out.value).length).toBe(3 + 2 + 7); // code points intact
  });

  it("enforces the limit in CODE POINTS (no mid-sequence truncation)", () => {
    const family = "👨‍👩‍👧‍👦"; // 7 code points
    const draft = "a".repeat(3993); // 3993 + 7 = 4000 → allowed
    expect(insertAtCursor(draft, family, draft.length)?.value.length).toBe(draft.length + 11);
    const tooLong = "a".repeat(3994); // 3994 + 7 = 4001 → refused entirely
    expect(insertAtCursor(tooLong, family, tooLong.length)).toBeNull();
  });

  it("refuses an empty emoji", () => {
    expect(insertAtCursor("ab", "", 1)).toBeNull();
  });
});

describe("curated emoji data", () => {
  it("has non-empty categories with named emojis", () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThanOrEqual(4);
    for (const cat of EMOJI_CATEGORIES) {
      expect(cat.emojis.length).toBeGreaterThan(0);
      for (const e of cat.emojis) {
        expect(e.char.length).toBeGreaterThan(0);
        expect(e.name.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("quick row entries all exist (renderable glyphs)", () => {
    for (const e of FREQUENT_EMOJIS) {
      expect(Array.from(e.char).length).toBeGreaterThan(0);
    }
  });

  it("keeps every emoji a real multi-unit or single-unit glyph (no empty strings)", () => {
    const all = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
    expect(all.length).toBeGreaterThan(80);
    expect(all.every((e) => e.char !== "")).toBe(true);
  });
});
