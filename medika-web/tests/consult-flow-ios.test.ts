/**
 * Contract tests for the iOS-styled consultation flow (owner's request:
 * "make the consultation form more iPhone like layout and design but still
 * keeping the same color scheme").
 *
 *  1. All four wizard steps (guard panel, intake, doctors, payment) carry
 *     the "cf" wrapper that scopes the iOS styling layer.
 *  2. The styling lives ONLY in the scoped layer in patient-theme.css —
 *     the shared globals (.card, .field, .tabs, .row) are untouched so the
 *     rest of the app (doctor pages included) keeps its current look.
 *  3. The color scheme is unchanged: the overrides reference the existing
 *     mint/green tokens (--green-*, --pt-mint-*, --pt-glass) and never
 *     introduce a new palette.
 *  4. The urgency picker is a true iOS segmented control (pill segments in a
 *     filled track), with reduced-motion suppression.
 *  5. Nothing in the flow's logic or copy changes: validation strings, raw
 *     urgency values and the SpecialtySelect contract stay exactly as the
 *     consult-flow contract tests already assert them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

const consultPage = read("../app/app/consult/page.tsx");
const themeSource = read("../app/patient-theme.css");
const globalsSource = read("../app/globals.css");

describe("consultation flow — iOS form layer", () => {
  it("every wizard step wears the cf wrapper (guard, intake, doctors, payment)", () => {
    // Guard panel
    expect(consultPage).toContain('className="stack cf"');
    // Intake keeps its existing hook and gains the iOS layer
    expect(consultPage).toContain('className="stack consult-intake cf"');
    // Exactly four cf containers in the file
    expect(consultPage.match(/className="[^"]*\bcf\b[^"]*"/g)?.length).toBe(4);
  });

  it("the iOS layer only overrides under .app-shell .cf (shared styles untouched)", () => {
    // The scoped overrides exist…
    const scoped = themeSource
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\.app-shell \.cf/.test(line));
    expect(scoped.length).toBeGreaterThan(25);
    // …and no selector line ever opens with a bare .cf class (a line that
    // starts with .cf is by definition unscoped).
    const unscoped = themeSource
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\.cf/.test(line) && !line.startsWith(".app-shell .cf"));
    expect(unscoped).toEqual([]);
    // globals.css keeps the generic .tabs underline style for other pages.
    expect(globalsSource).toMatch(/\.tabs \{[^}]*border-bottom/);
  });

  it("keeps the Medika color scheme — overrides use the existing tokens only", () => {
    // Same brand greens + mint glass system, never a new palette.
    expect(themeSource).toMatch(/\.app-shell \.cf[\s\S]{0,200}var\(--green-600\)/);
    expect(themeSource).toContain(".app-shell .cf .card");
    expect(themeSource).toMatch(/\.app-shell \.cf \.card \{[^}]*var\(--pt-glass\)/);
    expect(themeSource).toMatch(/\.app-shell \.cf \.card \{[^}]*var\(--pt-card-border-soft\)/);
    // No iOS-blue or any foreign hex introduced by the cf layer.
    const cfBlock = themeSource.slice(themeSource.indexOf("Consultation flow — iOS-styled form"));
    expect(cfBlock).not.toMatch(/#0a84ff|#007aff|#007AFF/i);
  });

  it("the urgency picker is a true iOS segmented control", () => {
    expect(themeSource).toMatch(/\.app-shell \.cf \.tabs \{[\s\S]*?border-radius: 12px/);
    expect(themeSource).toMatch(/\.app-shell \.cf \.tabs button\.active \{[\s\S]*?box-shadow/);
    // Selected pill reads on the mint glass surface.
    expect(themeSource).toMatch(/\.app-shell \.cf \.tabs button\.active \{[\s\S]*?background: var\(--pt-glass\)/);
    // Reduced motion suppresses the segment transitions.
    expect(themeSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.app-shell \.cf \.tabs button \{ transition: none/,
    );
  });

  it("text fields are iOS filled rounded fields with a green focus ring", () => {
    expect(themeSource).toMatch(/\.app-shell \.cf \.textarea \{[\s\S]*?border-radius: 14px/);
    expect(themeSource).toMatch(/\.app-shell \.cf \.textarea:focus \{[\s\S]*?border-color: var\(--green-500\)/);
    expect(themeSource).toMatch(/\.app-shell \.cf \.sp-trigger \{[\s\S]*?border-radius: 14px/);
  });

  it("the doctor list becomes iOS grouped rows with hairline separators", () => {
    expect(themeSource).toMatch(/\.app-shell \.cf \.list \{[\s\S]*?border-radius: 18px/);
    expect(themeSource).toMatch(/\.app-shell \.cf \.list \.row \{[\s\S]*?border-bottom: 1px solid rgba\(13, 58, 50/);
    expect(themeSource).toContain(".app-shell .cf .list .row:last-child { border-bottom: none; }");
  });

  it("primary buttons use the shared iOS press language", () => {
    expect(themeSource).toMatch(/\.app-shell \.cf \.btn-primary:active:not\(:disabled\) \{[\s\S]*?transform: scale\(0\.97\)/);
  });

  it("the flow's logic and copy are untouched (labels + raw backend values)", () => {
    expect(consultPage).toContain("Jwenn yon doktè");
    expect(consultPage).toContain('urgencyLevel: urgency,');
    expect(consultPage).toContain("<SpecialtySelect");
    // The wrapper class is the ONLY markup change — no native select appears.
    expect(consultPage).not.toMatch(/<select[\s>]/);
  });
});
