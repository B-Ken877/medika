/**
 * Brand palette contracts (issue #20) — the login/registration institutional
 * green family must be the SINGLE rendered source of truth. These tests pin
 * the structural guarantees:
 *   - visual-polish.css never redefines color tokens (the bug that made the
 *     whole app render the legacy lime/forest palette);
 *   - no legacy palette hex or rgba value survives anywhere in the web app;
 *   - globals.css keeps the institutional trio and points links at the
 *     approved auth link green;
 *   - the admin interface stays on the same institutional family.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const webPolish = readFileSync("app/visual-polish.css", "utf8");
const webGlobals = readFileSync("app/globals.css", "utf8");
const adminGlobals = readFileSync("../medika-admin/app/globals.css", "utf8");

/** Every hex/rgba the legacy "warm lime + forest-green" palette ever used. */
const LEGACY_VALUES = [
  "#a3d900", "#49670a", "#23452e", "#193824", "#173621", "#102719", "#315b34",
  "#f7fbe9", "#eef7d4", "#dceda7", "#c6e66e",
  "rgba(163, 217, 0", "rgba(163,217,0",
  "rgba(120, 168, 0", "rgba(120,168,0",
  "rgba(35, 69, 46", "rgba(35,69,46",
  "#f7faef", "#fafbf6", "#f5f8ef",
];

describe("visual-polish.css can never override the palette again", () => {
  it("its :root block declares layout tokens only", () => {
    const rootBlock = webPolish.match(/:root \{[\s\S]*?\}/)?.[0] ?? "";
    expect(rootBlock).toContain("--maxw: 1280px");
    expect(rootBlock).toContain("--content-pad: 18px");
    for (const forbidden of [
      "--green-", "--gray-", "--bg", "--surface", "--text-", "--divider", "--success", "--shadow",
    ]) {
      expect(rootBlock).not.toContain(forbidden);
    }
  });

  it("contains no legacy palette value anywhere", () => {
    for (const legacy of LEGACY_VALUES) {
      expect(webPolish).not.toContain(legacy);
    }
  });

  it("keeps the functional auth toast rules it owns", () => {
    expect(webPolish).toContain(".auth-shell ~ .toast-stack");
    expect(webPolish).toContain("body.has-offline-toast .auth-form-pane");
  });
});

describe("globals.css keeps the institutional family as the source of truth", () => {
  it("institutional green trio is intact (register CTA = shared primary)", () => {
    expect(webGlobals).toContain("--green-500: #197568");
    expect(webGlobals).toContain("--green-600: #145b50");
    expect(webGlobals).toContain("--green-700: #10483f");
  });

  it("approved auth tokens are intact (login CTA, links, focus)", () => {
    expect(webGlobals).toContain("--auth-submit: #075a48");
    expect(webGlobals).toContain("--auth-submit-hover: #064a3c");
    expect(webGlobals).toContain("--brand-link: #146b58");
    expect(webGlobals).toContain("--auth-focus: #25856d");
  });

  it("site-wide links use the approved auth link green", () => {
    expect(webGlobals).toContain("a { color: var(--brand-link);");
    expect(webGlobals).toContain("a:hover { color: var(--brand-link-hover);");
  });

  it("no legacy palette value leaks into the stylesheet", () => {
    for (const legacy of LEGACY_VALUES) {
      expect(webGlobals).not.toContain(legacy);
    }
  });
});

describe("the login/registration pages render the institutional palette", () => {
  it("login keeps its own CTA shade (not overridden by shared tokens)", () => {
    expect(webGlobals).toContain(".auth-login-shell .auth-submit {");
    expect(webGlobals).toMatch(/\.auth-login-shell \.auth-submit \{[\s\S]*?background: var\(--auth-submit\)/);
  });

  it("register keeps the shared primary green for its CTA", () => {
    expect(webGlobals).toMatch(/\.auth-register-shell \.auth-submit \{[\s\S]*?background: var\(--green-600\)/);
  });

  it("neither auth page inherits a legacy background from visual-polish", () => {
    // The old .auth-shell rule (lime radial + warm bg) is gone entirely.
    expect(webPolish).not.toMatch(/\.auth-shell \{/);
  });
});

describe("medika-admin stays on the same institutional family", () => {
  it("admin brand tokens equal the shared institutional trio", () => {
    expect(adminGlobals).toContain("--mk-brand: #145b50");
    expect(adminGlobals).toContain("--mk-brand-hover: #10483f");
    expect(adminGlobals).toContain("--mk-brand-active: #197568");
  });

  it("admin contains no legacy palette value", () => {
    for (const legacy of LEGACY_VALUES) {
      expect(adminGlobals).not.toContain(legacy);
    }
  });
});
