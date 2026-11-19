/**
 * Generates the service worker's cache VERSION from content hashes and
 * stamps it into public/sw.js.
 *
 *   version = sha256( every file in public/ (path + content hash),
 *                     + sw.js with its VERSION line stripped )
 *             → "medika-v" + first 12 hex chars
 *
 * Rationale: the SW's activate handler deletes every cache that does not
 * start with VERSION, so the version string is the kill-switch for stale
 * caches. It used to be a hand-edited constant ("medika-v2") and was
 * forgotten twice — once that left every client pinned to stale artwork
 * for weeks. With this script the version bumps itself whenever a public
 * asset or the SW policy changes, and stays stable (byte-identical
 * builds) when nothing changed — the stamp is idempotent.
 *
 * Usage:
 *   node scripts/build-sw-version.mjs            stamp (writes sw.js)
 *   node scripts/build-sw-version.mjs --check    no write; exit 1 if stale
 *
 * Wired as the "prebuild" npm script so every deploy (Vercel runs
 * `npm run build`) re-stamps before shipping.
 */
"use strict";

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_LINE = /const VERSION = "[^"]+";/;

/** Pure: the version string the given public/ directory should have. */
export function computeSwVersion(publicDir) {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      // sw.js participates ONLY through its stripped policy body below —
      // hashing the raw file here would make every stamp change the next
      // stamp (the VERSION line it writes would feed the next hash).
      else if (relative(publicDir, p) !== "sw.js") files.push(p);
    }
  })(publicDir);

  const hash = createHash("sha256");
  for (const f of files.sort()) {
    hash.update(relative(publicDir, f));
    hash.update("\0");
    hash.update(createHash("sha256").update(readFileSync(f)).digest());
  }
  // sw.js participates through its POLICY only: hash everything except the
  // generated VERSION line, so stamping never changes the next stamp.
  const swPath = join(publicDir, "sw.js");
  const policy = readFileSync(swPath, "utf8").replace(VERSION_LINE, "");
  hash.update("sw.js\0");
  hash.update(createHash("sha256").update(policy).digest());
  return `medika-v${hash.digest("hex").slice(0, 12)}`;
}

/** The VERSION currently written in sw.js, or null if the line is absent. */
export function currentSwVersion(publicDir) {
  const m = readFileSync(join(publicDir, "sw.js"), "utf8").match(VERSION_LINE);
  return m ? m[0].match(/"([^"]+)"/)?.[1] ?? null : null;
}

/** Stamp sw.js in place; returns the version written. Idempotent. */
export function stampSwVersion(publicDir) {
  const version = computeSwVersion(publicDir);
  const swPath = join(publicDir, "sw.js");
  const sw = readFileSync(swPath, "utf8");
  if (!VERSION_LINE.test(sw)) {
    throw new Error(`sw.js has no VERSION line to stamp (${swPath})`);
  }
  writeFileSync(swPath, sw.replace(VERSION_LINE, `const VERSION = "${version}";`));
  return version;
}

export function isSwVersionCurrent(publicDir) {
  return computeSwVersion(publicDir) === currentSwVersion(publicDir);
}

function main() {
  const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
  if (process.argv.includes("--check")) {
    if (isSwVersionCurrent(publicDir)) {
      console.log(`[sw-version] up to date: ${currentSwVersion(publicDir)}`);
      return;
    }
    console.error(
      `[sw-version] sw.js is STALE (computed ${computeSwVersion(publicDir)}, ` +
        `found ${currentSwVersion(publicDir)}). Run: node scripts/build-sw-version.mjs`,
    );
    process.exit(1);
  }
  const version = stampSwVersion(publicDir);
  console.log(`[sw-version] stamped ${version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
