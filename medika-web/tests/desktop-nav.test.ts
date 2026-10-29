/**
 * Issue #71 regression — desktop navigation visibility.
 *
 * At >=900px the mobile bottom bar was display:none and the header carried
 * only brand/notifications/account — desktop widths (e.g. ~1000px) had NO
 * primary navigation at all. The header now renders the SAME role-aware
 * destinations through a shared renderer, so the two navigation surfaces can
 * never drift; below 900px the header nav stays hidden and the bottom bar
 * remains the single navigation.
 *
 * Verified here (source-contract pattern — no jsdom in this package):
 *   - the shell renders a header nav with the shared link renderer;
 *   - CSS hides the header nav below 900px and shows it from 900px up;
 *   - the bottom bar contract (issue #34) is untouched;
 *   - compact-but-visible styling exists for intermediate (~900–1100px)
 *     widths and the active state uses the Medika green tokens.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shell = readFileSync(resolve(__dirname, "../components/layout/AppShell.tsx"), "utf8");
const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");

describe("desktop header navigation (issue #71)", () => {
  it("renders a header nav with the shared role-aware link renderer", () => {
    expect(shell).toContain('<nav className="header-nav" aria-label="Navigasyon prensipal">');
    // Desktop (17px icons) and mobile bar (21px icons) share ONE renderer:
    // identical destinations, identical active-state rule, aria-current kept.
    expect(shell).toContain("items.map((item) => navLink(item, 17))");
    expect(shell).toContain("items.map((item) => navLink(item, 21))");
    expect(shell).toContain('aria-current={active ? "page" : undefined}');
  });

  it("the header nav is hidden below 900px and visible from 900px up", () => {
    const start = css.indexOf(".header-nav { display: none; }");
    expect(start).toBeGreaterThan(-1);
    const desktopBlock = css.slice(css.indexOf("@media (min-width: 900px) {\n  .header-nav {"));
    expect(desktopBlock).toContain(".header-nav {");
    expect(desktopBlock).toContain("display: flex");
  });

  it("the bottom bar stays the navigation below 900px (issue #34 contract untouched)", () => {
    expect(css).toContain("@media (min-width: 900px) { .bottom-nav { display: none; } }");
    const navCss = css.slice(css.indexOf(".bottom-nav {"), css.indexOf("/* ── Page heading region"));
    expect(navCss).toContain("flex: 1 1 0");
    expect(navCss).toContain("min-height: 44px");
  });

  it("intermediate widths (~900–1100px) stay compact but fully navigable", () => {
    expect(css).toMatch(
      /@media \(min-width: 900px\) and \(max-width: 1100px\) \{\s*\.header-nav a \{[^}]*\}/,
    );
    // Nothing is ever hidden at intermediate widths — only spacing shrinks.
    const compact = css.slice(css.indexOf("(min-width: 900px) and (max-width: 1100px)"));
    expect(compact).not.toMatch(/\.header-nav a span\s*\{[^}]*display:\s*none/);
  });

  it("active state and hover use the existing Medika design tokens", () => {
    expect(css).toContain(".header-nav a.active { color: var(--green-600); background: var(--green-50); }");
    expect(css).toContain(".header-nav a:hover { background: var(--gray-50);");
    // Accessible pointer/keyboard target and single-line labels.
    expect(css).toContain("min-height: 40px");
    expect(css).toContain("white-space: nowrap");
  });
});
