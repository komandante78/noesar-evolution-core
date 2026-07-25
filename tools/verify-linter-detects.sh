#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Prove the linter fires before trusting a clean run.
#
# A clean scan proves the scanner found nothing, never that the code is correct. This
# project has already been bitten by a check that was silently passing, so the detector is
# tested against canaries that reproduce the exact defect class B-006 names:
#
#   1. an object-literal shorthand naming an identifier not in scope  (F4-005, F4-006)
#   2. a call to a function that was renamed at the call site but never defined
#   3. a browser-side handler referencing an undeclared symbol
#
# The canaries live OUTSIDE the repository, in a scratch directory, so a canary can never
# be committed by accident.

set -euo pipefail

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SCRATCH="${NOESAR_LINT_CANARY_DIR:-${ARTIFACT_ROOT:-/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS}/lint-canary}"
CACHE_ROOT="${NOESAR_LINT_CACHE:-${ARTIFACT_ROOT:-/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS}/lint}"
NODE_IMAGE="${NOESAR_LINT_IMAGE:-node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3}"

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"
cp "$PROJECT_ROOT/eslint.config.mjs" "$SCRATCH/eslint.config.mjs"

cat > "$SCRATCH/canary-shorthand.mjs" <<'CANARY'
// Canary 1: the F4-005 / F4-006 shape. `profileId` is the parameter; `providerId` is not
// declared anywhere in this scope. Valid syntax, so `node --check` accepts it.
export function probe(profileId) {
  return { providerId, ok: true };
}
CANARY

cat > "$SCRATCH/canary-renamed-call.mjs" <<'CANARY'
// Canary 2: a call site renamed without the definition following it.
export async function get(url) {
  return fetchOnceRetryingStaleSocket(url, {});
}
CANARY

mkdir -p "$SCRATCH/apps/webui-static"
cat > "$SCRATCH/apps/webui-static/canary-browser.js" <<'CANARY'
// Canary 3: browser-side, where an undeclared identifier makes a handler do nothing at
// all rather than fail loudly.
export function attach() {
  document.querySelector('#x').addEventListener('click', () => { render(undeclaredState); });
}
CANARY

if [ ! -x "$CACHE_ROOT/node_modules/.bin/eslint" ]; then
  echo "eslint is not installed; run tools/run-eslint.sh first" >&2
  exit 2
fi

set +e
docker run --rm \
  -v "$SCRATCH":/canary:ro \
  -v "$CACHE_ROOT":/lint \
  -w /canary \
  -e NODE_PATH=/lint/node_modules \
  "$NODE_IMAGE" \
  /lint/node_modules/.bin/eslint --no-color --format json . > "$SCRATCH/report.json" 2>"$SCRATCH/report.err"
set -e

node - "$SCRATCH/report.json" <<'VERIFY'
import fs from 'node:fs';
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const undef = new Set();
for (const file of report) {
  for (const message of file.messages ?? []) {
    if (message.ruleId === 'no-undef') {
      undef.add(`${file.filePath.split('/').pop()}:${message.message}`);
    }
  }
}
const expected = [
  ['canary-shorthand.mjs', 'providerId'],
  ['canary-renamed-call.mjs', 'fetchOnceRetryingStaleSocket'],
  ['canary-browser.js', 'undeclaredState'],
];
let missed = 0;
for (const [file, identifier] of expected) {
  const hit = [...undef].some((entry) => entry.startsWith(file) && entry.includes(identifier));
  process.stdout.write(`${hit ? 'DETECTED' : 'MISSED  '} ${file} -> ${identifier}\n`);
  if (!hit) missed += 1;
}
process.stdout.write(`LINTER_SELF_TEST=${missed === 0 ? 'PASS' : 'FAIL'} ${expected.length - missed}/${expected.length}\n`);
process.exit(missed === 0 ? 0 : 1);
VERIFY
