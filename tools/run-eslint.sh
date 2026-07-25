#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Run ESLint over the first-party JavaScript surface.
#
# ESLint is not installed on this host and CLAUDE10 rule 45 forbids installing tooling to
# satisfy a rule. It therefore runs inside a temporary container, pinned by digest, with
# its dependencies installed into a scratch directory OUTSIDE the repository — so no
# node_modules tree ever appears in the working tree, and repository hygiene (rule 33)
# holds.
#
#   tools/run-eslint.sh              lint and print a summary
#   tools/run-eslint.sh --json PATH  additionally write the JSON report to PATH
#
# Exit status is ESLint's: non-zero if there is at least one error.

set -euo pipefail

# Pinned. The whole point of this script is a reproducible verdict; "whatever npm serves
# today" is not one.
ESLINT_VERSION="${NOESAR_ESLINT_VERSION:-9.39.5}"
NODE_IMAGE="${NOESAR_LINT_IMAGE:-node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3}"

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CACHE_ROOT="${NOESAR_LINT_CACHE:-${ARTIFACT_ROOT:-/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS}/lint}"
JSON_OUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --json) JSON_OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$CACHE_ROOT"

# The scratch directory holds only package.json and node_modules; the repository is
# mounted read-only so a lint run can never modify the source it is judging.
if [ ! -x "$CACHE_ROOT/node_modules/.bin/eslint" ] \
  || [ "$(cat "$CACHE_ROOT/.eslint-version" 2>/dev/null || echo none)" != "$ESLINT_VERSION" ]; then
  echo "installing eslint@${ESLINT_VERSION} into ${CACHE_ROOT} (pinned container)" >&2
  docker run --rm \
    -v "$CACHE_ROOT":/lint \
    -w /lint \
    "$NODE_IMAGE" \
    sh -c "npm install --no-audit --no-fund --prefix /lint eslint@${ESLINT_VERSION} >/dev/null 2>&1 \
      && node -e \"process.stdout.write(require('/lint/node_modules/eslint/package.json').version)\" > /lint/.eslint-version"
fi

INSTALLED="$(cat "$CACHE_ROOT/.eslint-version")"
echo "ESLINT_VERSION=${INSTALLED}" >&2
echo "ESLINT_IMAGE=${NODE_IMAGE}" >&2

ARGS='["--no-color"]'
set +e
docker run --rm \
  -v "$PROJECT_ROOT":/src:ro \
  -v "$CACHE_ROOT":/lint \
  -w /src \
  -e NODE_PATH=/lint/node_modules \
  "$NODE_IMAGE" \
  /lint/node_modules/.bin/eslint --no-color --format json . > "$CACHE_ROOT/report.json" 2> "$CACHE_ROOT/report.err"
STATUS=$?
set -e

if [ ! -s "$CACHE_ROOT/report.json" ]; then
  echo "eslint produced no report; stderr follows" >&2
  cat "$CACHE_ROOT/report.err" >&2
  exit "${STATUS:-1}"
fi

if [ -n "$JSON_OUT" ]; then
  cp "$CACHE_ROOT/report.json" "$JSON_OUT"
fi

node "$PROJECT_ROOT/tools/summarise-eslint.mjs" "$CACHE_ROOT/report.json"
exit "$STATUS"
