#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-007 / INST-008's Update Trust Verifier: refuses (non-zero exit) a candidate
// release that asks for more authority than the installed baseline unless an
// authorisation document names EXACTLY the permissions being added. See
// services/reference-control-plane/src/permission-surface.mjs for the enforcement logic
// this wraps — this file only reads argv, reads files, and prints the outcome.
//
//   node tools/verify-permission-diff.mjs --baseline <installed.json> --candidate <update.json> [--authorization <auth.json>]
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyUpdateAuthorized, PermissionDiffError } from '../services/reference-control-plane/src/permission-surface.mjs';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' }, candidate: { type: 'string' }, authorization: { type: 'string' },
  },
});
if (!values.baseline || !values.candidate) {
  process.stderr.write('usage: verify-permission-diff.mjs --baseline <file> --candidate <file> [--authorization <file>]\n');
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(resolve(values.baseline), 'utf8'));
const candidate = JSON.parse(readFileSync(resolve(values.candidate), 'utf8'));
const authorization = values.authorization ? JSON.parse(readFileSync(resolve(values.authorization), 'utf8')) : null;
const nowUnix = Math.floor(Date.now() / 1000);

try {
  const outcome = verifyUpdateAuthorized({ baseline, candidate, authorization, nowUnix });
  process.stdout.write(`PERMISSION_DIFF=AUTHORIZED\n`);
  process.stdout.write(`added=${outcome.added.length} removed=${outcome.removed.length}\n`);
  if (outcome.added.length) process.stdout.write(`  added: ${outcome.added.join(', ')}\n`);
  if (outcome.removed.length) process.stdout.write(`  removed: ${outcome.removed.join(', ')}\n`);
  process.stdout.write(`reason=${outcome.reason}\n`);
  process.exit(0);
} catch (error) {
  if (error instanceof PermissionDiffError) {
    process.stdout.write(`PERMISSION_DIFF=REFUSED\n`);
    process.stdout.write(`kind=${error.kind}\n`);
    process.stdout.write(`reason=${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
