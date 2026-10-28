/**
 * Issue #34 regression — doctor bottom navigation fits narrow phones.
 *
 * The five doctor destinations previously used long labels ("Konsiltasyon
 * yo", "Revni mwen", "Notifikasyon", "Pwofil mwen") inside a fixed bottom
 * bar; on narrow viewports the text wrapped onto multiple lines, icons/labels
 * misaligned across items, and the bar wasted vertical space.
 *
 * Verified here (source-contract pattern — no jsdom in this package):
 *   - concise one-line Kreyòl labels for all five doctor destinations;
 *   - every destination keeps its route and icon (navigation preserved);
 *   - CSS enforces equal widths, single-line labels and a compact height.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shell = readFileSync(resolve(__dirname, "../components/layout/AppShell.tsx"), "utf8");
const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");

// The doctor destinations are the FIRST return [ … ] in navItems(); the
// patient destinations are the second. Slice on the array literals.
const firstReturn = shell.indexOf("return [");
const secondReturn = shell.indexOf("return [", firstReturn + 1);
const doctorBlock = shell.slice(firstReturn, secondReturn);
const patientBlock = shell.slice(secondReturn);

describe("doctor bottom navigation labels (issue #34)", () => {
  it("uses the five concise one-line Kreyòl labels", () => {
    for (const label of ["Akèy", "Demann", "Revni", "Alèt", "Pwofil"]) {
      expect(doctorBlock).toContain(`label: "${label}"`);
    }
    // The long labels that used to wrap are gone from the nav.
    for (const longLabel of ["Konsiltasyon yo", "Revni mwen", "Notifikasyon", "Pwofil mwen"]) {
      expect(shell).not.toContain(`label: "${longLabel}"`);
    }
  });

  it("preserves every destination route and icon", () => {
    for (const href of ["/app", "/app/consultations", "/app/wallet", "/app/notifications", "/app/profile"]) {
      expect(doctorBlock).toContain(`href: "${href}"`);
    }
    expect(doctorBlock).toContain("icon: Home");
    expect(doctorBlock).toContain("icon: CalendarDays");
    expect(doctorBlock).toContain("icon: Wallet");
    expect(doctorBlock).toContain("icon: Bell");
    expect(doctorBlock).toContain("icon: User");
  });

  it("patient navigation stays four concise one-line labels", () => {
    for (const label of ["Akèy", "Doktè yo", "Konsiltasyon", "Pwofil"]) {
      expect(patientBlock).toContain(`label: "${label}"`);
    }
  });
});

describe("bottom navigation CSS contract (issue #34)", () => {
  const navCss = css.slice(css.indexOf(".bottom-nav {"), css.indexOf("/* ── Page heading region"));

  it("keeps every destination on one line (no wrapping labels)", () => {
    expect(navCss).toContain("white-space: nowrap");
    expect(navCss).toContain("text-overflow: ellipsis");
  });

  it("gives each destination equal width with centered content", () => {
    expect(navCss).toContain("flex: 1 1 0");
    expect(navCss).toContain("min-width: 0");
    expect(navCss).toContain("align-items: center");
    expect(navCss).toContain("justify-content: center");
  });

  it("keeps an accessible touch target while compacting the bar", () => {
    expect(navCss).toContain("min-height: 44px");
    expect(css).toContain("--bottomnav-h: 56px;");
  });

  it("respects the device safe area (Android gesture bar)", () => {
    expect(navCss).toContain("env(safe-area-inset-bottom, 0px)");
  });
});
