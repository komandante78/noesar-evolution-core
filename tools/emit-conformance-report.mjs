// SPDX-License-Identifier: AGPL-3.0-or-later
// Produces the authority conformance report that the Rust release path consumes.
//
// Before this tool existed nothing produced that file. `rust/build-authority-release.sh`
// required it, `tools/create-rust-build-provenance.py` refused to mint provenance without
// it, and `tools/test-rust-build-provenance.py` fabricated one as a fixture -- so the whole
// chain was verifiable and unreachable at the same time. Same class as D-0171.
//
// The verdict comes from executing `conformance/authority-vectors.json` through the
// reference control plane's own suites. It is never asserted; if the suites do not run,
// the report says FAIL.

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The suites that consume conformance/authority-vectors.json. Kept explicit rather than
// globbed: a suite silently dropped from a glob is a coverage loss nobody sees.
const SUITES = [
  'services/reference-control-plane/test/conformance.test.mjs',
  'services/reference-control-plane/test/canonical-json.test.mjs',
  'services/reference-control-plane/test/privacy-states.test.mjs',
];

const VECTORS = 'conformance/authority-vectors.json';

const out = process.argv[2];
if (!out) {
  console.error('usage: node tools/emit-conformance-report.mjs <report-path>');
  process.exit(2);
}

const lines = [];
let failed = 0;
let total = 0;

if (!existsSync(resolve(root, VECTORS))) {
  console.error(`missing ${VECTORS}`);
  lines.push(`VECTORS=MISSING ${VECTORS}`);
  failed += 1;
} else {
  for (const suite of SUITES) {
    if (!existsSync(resolve(root, suite))) {
      lines.push(`SUITE=MISSING ${suite}`);
      failed += 1;
      continue;
    }
    const run = spawnSync(process.execPath, ['--test', suite], {
      cwd: root,
      encoding: 'utf8',
    });
    const stdout = run.stdout ?? '';
    const pass = Number((stdout.match(/^# pass (\d+)$/m) ?? ['', '0'])[1]);
    const fail = Number((stdout.match(/^# fail (\d+)$/m) ?? ['', '0'])[1]);
    total += pass + fail;
    // status !== 0 covers the case the suite crashed before reporting any count at all,
    // which a pass/fail count alone would read as a clean zero.
    if (run.status !== 0 || fail > 0) {
      failed += fail > 0 ? fail : 1;
      lines.push(`SUITE=FAIL ${suite} pass=${pass} fail=${fail} exit=${run.status}`);
    } else {
      lines.push(`SUITE=PASS ${suite} pass=${pass}`);
    }
  }
}

const verdict = failed === 0 && total > 0 ? 'PASS' : 'FAIL';
const body = [
  `AUTHORITY_CONFORMANCE=${verdict}`,
  `VECTORS=${VECTORS}`,
  `CHECKS=${total}`,
  `FAILURES=${failed}`,
  ...lines,
  '',
].join('\n');

mkdirSync(dirname(resolve(root, out)), { recursive: true });
writeFileSync(resolve(root, out), body, 'utf8');
process.stdout.write(body);
process.exit(verdict === 'PASS' ? 0 : 1);
