/**
 * Guard rails for scripts/build-sw-version.mjs — the service worker cache
 * version must never go stale again (that bug pinned old artwork on every
 * client for weeks; owner report "I don't see the changes", Nov 2026).
 *
 * The freshness tests run against the REAL public/ directory and the REAL
 * sw.js: forgetting to stamp after changing an asset or the policy fails
 * the suite instead of shipping a stale cache version. Mutation cases run
 * on a throwaway temp copy so the worktree is never touched.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeSwVersion,
  currentSwVersion,
  isSwVersionCurrent,
} from "../scripts/build-sw-version.mjs";

const ROOT = process.cwd(); // vitest runs with medika-web as cwd
const PUBLIC_DIR = resolve(ROOT, "public");
const SCRIPT = resolve(ROOT, "scripts", "build-sw-version.mjs");

/** Copy public/ into a fresh temp dir for mutation tests. */
function copyPublic() {
  const dir = mkdtempSync(join(tmpdir(), "sw-ver-"));
  cpSync(PUBLIC_DIR, dir, { recursive: true });
  return dir;
}

describe("service worker cache version", () => {
  it("generates a version from content: medika-v + 12 hex chars", () => {
    expect(computeSwVersion(PUBLIC_DIR)).toMatch(/^medika-v[0-9a-f]{12}$/);
  });

  it("is stable when nothing changed (idempotent stamping)", () => {
    expect(computeSwVersion(PUBLIC_DIR)).toBe(computeSwVersion(PUBLIC_DIR));
  });

  it("changes when a public asset changes", () => {
    const dir = copyPublic();
    const before = computeSwVersion(dir);
    const manifest = join(dir, "manifest.webmanifest");
    writeFileSync(manifest, readFileSync(manifest, "utf8") + "\n");
    expect(computeSwVersion(dir)).not.toBe(before);
  });

  it("changes when the sw.js policy changes (not just assets)", () => {
    const dir = copyPublic();
    const before = computeSwVersion(dir);
    const sw = join(dir, "sw.js");
    writeFileSync(
      sw,
      readFileSync(sw, "utf8").replace(
        "Security rule #1",
        "Security rule #1 (policy touch)",
      ),
    );
    expect(computeSwVersion(dir)).not.toBe(before);
  });

  it("stamping does not change the next stamp (VERSION line excluded)", () => {
    const dir = copyPublic();
    const swPath = join(dir, "sw.js");
    const before = readFileSync(swPath, "utf8");
    const first = computeSwVersion(dir);
    writeFileSync(
      swPath,
      before.replace(/const VERSION = "[^"]+";/, `const VERSION = "${first}";`),
    );
    expect(computeSwVersion(dir)).toBe(first);
  });

  it("committed sw.js carries the current computed version (freshness gate)", () => {
    expect(isSwVersionCurrent(PUBLIC_DIR)).toBe(true);
  });

  it("--check exits 0 on a fresh worktree (no writes)", () => {
    const out = execFileSync("node", [SCRIPT, "--check"], { encoding: "utf8" });
    expect(out).toContain("up to date");
  });

  it("currentSwVersion parses the stamped value", () => {
    expect(currentSwVersion(PUBLIC_DIR)).toMatch(/^medika-v[0-9a-f]{12}$/);
  });
});
