/**
 * Migration bundle drift guard.
 *
 * src/auto-migrate.js consumes db/migrations-bundle.js (the embedded copy of
 * db/migrations/*.sql) because Vercel's function bundle always includes
 * statically-required modules, while `services.*.functions.includeFiles` is
 * rejected by the platform. This test fails whenever the bundle drifts from
 * the SQL sources — the remedy is `node scripts/bundle-migrations.js`.
 */
'use strict';

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bundle = (await import('../db/migrations-bundle.js')).default ?? (await import('../db/migrations-bundle.js'));

describe('db/migrations-bundle.js', () => {
  const sqlDir = path.join(repoRoot, 'db', 'migrations');
  const sqlFiles = fs.readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();

  it('covers every migration file, byte-for-byte, in filename order', () => {
    expect(Object.keys(bundle).sort()).toEqual(sqlFiles);
    expect(sqlFiles.length).toBeGreaterThan(0);
    for (const file of sqlFiles) {
      expect(bundle[file], `${file} must match db/migrations/${file} exactly`).toBe(
        fs.readFileSync(path.join(sqlDir, file), 'utf8')
      );
    }
  });

  it('keys sort so that migrations apply in filename order (001 → 014)', () => {
    const names = Object.keys(bundle);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
    expect(names[0]).toMatch(/^001_/);
    expect(names[names.length - 1]).toMatch(/^014_/);
  });
});
