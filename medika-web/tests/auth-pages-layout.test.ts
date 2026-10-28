/**
 * Auth pages layout contracts (issue #43) — login and registration must use
 * the SAME centered, responsive layout system.
 *
 * Root cause pinned here: the register shell declared `display: grid` inside
 * its ≥900px block, which silently won the cascade over the generic
 * `.auth-shell { display: flex }` rules (equal specificity, later order) and
 * then collided with the shared `.auth-brand-pane { width: 42% }` — a
 * percentage that resolves against the grid AREA, squeezing the brand pane
 * to ~305px inside a ~728px column and leaving a dead gap. The login page
 * only looked correct because its own grid declaration LOST that cascade and
 * rendered through the flex path by accident.
 *
 * These contracts guarantee the unified flex system and the structural fix
 * (the register mobile brand bar is a direct shell child, never a sibling of
 * the form inside the pane) can never regress silently.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const globals = readFileSync("app/globals.css", "utf8");
const registerPage = readFileSync("app/register/page.tsx", "utf8");
const loginPage = readFileSync("app/login/page.tsx", "utf8");

/** Extract the register ≥900px block from globals.css. */
function registerDesktopBlock(): string {
  const marker = ".auth-register-shell {";
  const mediaStart = globals.indexOf("@media (min-width: 900px) {", globals.indexOf("/* Registration page"));
  expect(mediaStart).toBeGreaterThan(-1);
  const blockStart = globals.indexOf(marker, mediaStart);
  expect(blockStart).toBeGreaterThan(-1);
  // Walk to the matching closing brace of the media block.
  let depth = 0;
  for (let i = mediaStart; i < globals.length; i++) {
    if (globals[i] === "{") depth++;
    if (globals[i] === "}") {
      depth--;
      if (depth === 0) return globals.slice(mediaStart, i + 1);
    }
  }
  return "";
}

describe("register page structure mirrors login (issue #43)", () => {
  it("keeps the mobile brand bar a DIRECT child of the shell, outside the form pane", () => {
    // Structural fix: if the brand bar stays inside the row-flex pane it sits
    // BESIDE the form on tablet/mobile and shoves the form off-center.
    const brandIdx = registerPage.indexOf('className="auth-mobile-brand"');
    const paneIdx = registerPage.indexOf('className="auth-form-pane"');
    expect(brandIdx).toBeGreaterThan(-1);
    expect(paneIdx).toBeGreaterThan(-1);
    expect(brandIdx).toBeLessThan(paneIdx); // brand bar is declared before, and outside, the pane
    const paneInner = registerPage.slice(paneIdx);
    expect(paneInner.split("auth-form-pane")[1]).not.toContain("auth-mobile-brand");
    // Login uses the same shell > brand-bar > pane ordering.
    const loginBrand = loginPage.indexOf('className="auth-mobile-brand"');
    const loginPane = loginPage.indexOf('className="auth-form-pane"');
    expect(loginBrand).toBeGreaterThan(-1);
    expect(loginPane).toBeGreaterThan(-1);
    expect(loginBrand).toBeLessThan(loginPane);
  });

  it("does not inline layout styles on the form (CSS owns the layout system)", () => {
    expect(registerPage).not.toContain("maxWidth: 440");
    expect(registerPage).not.toContain('style={{ maxWidth');
  });

  it("preserves every registration field and the submit contract", () => {
    for (const id of ["reg-name", "reg-age", "reg-gender", "reg-email", "reg-phone", "reg-username", "reg-password"]) {
      expect(registerPage).toContain(`id="${id}"`);
    }
    expect(registerPage).toContain('autoComplete="new-password"');
    expect(registerPage).toContain("Kreye kont");
    // Behavior untouched: same auth hook and redirect target.
    expect(registerPage).toContain("useAuth()");
    expect(registerPage).toContain('router.replace("/app")');
  });

  it("preserves the login page behavior contract", () => {
    for (const id of ["username", "password"]) {
      expect(loginPage).toContain(`id="${id}"`);
    }
    expect(loginPage).toContain('router.replace(next)');
  });
});

describe("shared centered layout system (globals.css)", () => {
  it("register desktop uses the SAME flex model as login — never a grid", () => {
    const block = registerDesktopBlock();
    expect(block).toContain(".auth-register-shell");
    expect(block).toContain("display: flex");
    expect(block).toContain("flex-direction: row");
    // The regression: a grid template here wins the cascade and breaks the
    // shared 42% brand-pane width (resolves against the grid area).
    expect(block).not.toContain("display: grid");
    expect(block).not.toContain("grid-template-columns");
  });

  it("centers the register form pane on every breakpoint", () => {
    // Base (mobile) pane: column + horizontally centered form.
    const basePane = globals.match(/\.auth-register-shell \.auth-form-pane \{[^}]*\}/)?.[0] ?? "";
    expect(basePane).toContain("flex-direction: column");
    expect(basePane).toContain("align-items: center");
    // Desktop pane: vertically balanced (centered) too.
    const desktopPane = registerDesktopBlock().match(/\.auth-register-shell \.auth-form-pane \{[^}]*\}/)?.[0] ?? "";
    expect(desktopPane).toContain("justify-content: center");
    expect(desktopPane).toContain("align-items: center");
  });

  it("gives registration the same tablet card treatment as login (640–899px)", () => {
    const tablet = globals.match(/@media \(min-width: 640px\) and \(max-width: 899px\) \{[\s\S]*?\n\}/g) ?? [];
    const registerTablet = tablet.find((b) => b.includes(".auth-register-shell"));
    expect(registerTablet).toBeTruthy();
    expect(registerTablet).toContain("#f0f6f3"); // same tinted shell as login tablet
    const formRule = registerTablet?.match(/\.auth-register-shell \.auth-form \{[^}]*\}/)?.[0] ?? "";
    expect(formRule).toContain("border: 1px solid #e0eae5");
    expect(formRule).toContain("border-radius: 18px");
    expect(formRule).toContain("box-shadow:");
  });

  it("keeps sensible max-widths so neither form stretches on desktop", () => {
    // Login: 420px on desktop (scoped block), register: 520px (longer form).
    expect(globals).toMatch(/\.auth-login-shell \.auth-form \{\s*max-width: 420px;/);
    expect(globals).toMatch(/\.auth-register-shell \.auth-form \{\s*width: 100%;\s*max-width: 520px !important;/);
  });

  it("keeps the shared 42% brand pane that both pages rely on", () => {
    const shared = globals.match(/@media \(min-width: 900px\) \{\s*\.auth-shell \{[^}]*\}[\s\S]*?\.auth-brand-pane \{[^}]*\}/)?.[0] ?? "";
    expect(shared).toContain("width: 42%");
    expect(shared).toContain("flex-shrink: 0");
  });

  it("protects narrow screens from cramped controls and overflow on both pages", () => {
    expect(globals).toMatch(/@media \(max-width: 380px\) \{[\s\S]*?\.auth-login-shell \.auth-form-pane/);
    expect(globals).toMatch(/@media \(max-width: 380px\) \{[\s\S]*?\.auth-register-shell \.auth-form-pane/);
  });
});

describe("institutional palette untouched (issue #43 scope guard)", () => {
  it("register keeps the green identity — no new palette values introduced", () => {
    const registerSection = globals.slice(globals.indexOf("/* Registration page"));
    expect(registerSection).toContain("var(--green-600)");
    expect(registerSection).toContain("var(--green-700)");
    expect(registerSection).toContain("var(--brand-link)");
    // The only literal colors added are the ones login's tablet block already used.
    for (const allowed of ["#f0f6f3", "#e0eae5", "#fff", "#e8efec", "#63736f", "#263b36"]) {
      expect(registerSection).toContain(allowed);
    }
  });
});
