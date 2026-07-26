#!/usr/bin/env sh
# Verification entry point.
#
# Every step is named, and the summary at the end says which ran, which failed, and which could
# not run at all. It used to be a bare list under `set -eu`: the second step began failing when
# migrations 0013-0016 landed, and the five steps after it silently stopped running for good.
# Nothing announced that; the script just stopped. So the failure of one step no longer hides
# the existence of the others, and a step that cannot run is DECLARED, never counted as passed.
set -u
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
PYTHON=${NOESAR_PYTHON:-python3}

PASSED=0
FAILED=0
UNAVAILABLE=0
FAILED_STEPS=''
UNAVAILABLE_STEPS=''

step() {
  name=$1
  shift
  if [ "$1" = "$PYTHON" ] && ! command -v "$PYTHON" >/dev/null 2>&1; then
    printf '%s\n' "STEP $name = UNAVAILABLE (no $PYTHON on this host)"
    UNAVAILABLE=$((UNAVAILABLE + 1))
    UNAVAILABLE_STEPS="$UNAVAILABLE_STEPS $name"
    return 0
  fi
  if "$@"; then
    printf '%s\n' "STEP $name = PASS"
    PASSED=$((PASSED + 1))
  else
    printf '%s\n' "STEP $name = FAIL"
    FAILED=$((FAILED + 1))
    FAILED_STEPS="$FAILED_STEPS $name"
  fi
}

step unit            node --test services/reference-control-plane/test/*.test.mjs
step source-verify   node tools/verify-source.mjs
step auth-smoke      node tools/auth-http-smoke.mjs
step pg-migrations   "$PYTHON" tools/verify-postgres-migrations.py
step pg-contract     "$PYTHON" tools/verify-postgres-contract.py
step rust-source     "$PYTHON" tools/verify-rust-authority-source.py
step rust-provenance "$PYTHON" tools/test-rust-build-provenance.py -q

printf '\n%s\n' "TEST_SUMMARY pass=$PASSED fail=$FAILED unavailable=$UNAVAILABLE"
[ "$FAILED" -eq 0 ] || printf '%s\n' "FAILED:$FAILED_STEPS"
[ "$UNAVAILABLE" -eq 0 ] || printf '%s\n' "UNAVAILABLE (declared, NOT passed):$UNAVAILABLE_STEPS"
[ "$FAILED" -eq 0 ]
