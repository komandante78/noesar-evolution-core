// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regenerates database/postgres/MIGRATIONS.json from the files on disk.
//
// The manifest records a sha256 per migration and the runtime refuses to re-apply a
// migration whose file no longer hashes to what the ledger recorded. Keeping the
// manifest by hand is how those two drift apart, so it is generated instead.
//
//   node tools/generate-migration-manifest.mjs [--check]
//
// --check exits non-zero if the manifest on disk differs from the files, without
// writing anything. That is the form the test suite calls.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'database', 'postgres');
const manifestPath = path.join(migrationsDir, 'MIGRATIONS.json');

export function buildManifest(dir = migrationsDir, previous = null) {
  const files = fs.readdirSync(dir)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b));

  const migrations = files.map((filename) => {
    const bytes = fs.readFileSync(path.join(dir, filename));
    return {
      bytes: bytes.length,
      filename,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      version: filename.slice(0, 4),
    };
  });

  const base = previous ?? {};
  return {
    baselineV040Preserved: base.baselineV040Preserved ?? true,
    baselineV050Preserved: base.baselineV050Preserved ?? true,
    // generatedUtc is carried over rather than stamped with the current time: this file
    // is generated during a build, and a timestamp that changes on every run makes the
    // manifest look modified when nothing about the migrations changed.
    generatedUtc: base.generatedUtc ?? '1970-01-01T00:00:00Z',
    legacyV030Executable: base.legacyV030Executable ?? false,
    migrations,
    release: base.release ?? null,
    schemaVersion: base.schemaVersion ?? null,
    target: base.target ?? null,
  };
}

function serialise(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const previous = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : null;
  const next = buildManifest(migrationsDir, previous);
  const rendered = serialise(next);
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : '';
    if (current !== rendered) {
      process.stderr.write('MIGRATION_MANIFEST=STALE\n');
      process.exit(1);
    }
    process.stdout.write(`MIGRATION_MANIFEST=CURRENT ${next.migrations.length} migrations\n`);
    process.exit(0);
  }
  fs.writeFileSync(manifestPath, rendered);
  process.stdout.write(`MIGRATION_MANIFEST=WRITTEN ${next.migrations.length} migrations\n`);
}
