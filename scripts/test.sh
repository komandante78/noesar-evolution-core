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
# Guarded because this script deliberately does NOT use `set -e` (see above): without
# the guard a failed cd is not fatal, and every step below would then run against
# whatever directory the caller happened to be in — reporting results for a tree that
# is not this one. Dropping `set -e` fixed one silent failure and opened this one.
cd "$ROOT" || { printf '%s\n' "FATAL: cannot enter repository root: $ROOT" >&2; exit 1; }
PYTHON=${NOESAR_PYTHON:-python3}

PASSED=0
FAILED=0
UNAVAILABLE=0
PARTIAL=0
FAILED_STEPS=''
UNAVAILABLE_STEPS=''
PARTIAL_STEPS=''

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

# Some tools report three states, not two: 0 pass, 1 fail, 2 "one half of me could not
# run here". Collapsing that third state onto FAIL is the mistake this script exists to
# avoid — an expected red is a red everybody learns to skip, and it would hide a real
# one appearing beside it. Used ONLY for tools documented to follow this convention;
# assuming it globally would silently downgrade a genuine failure that happened to
# exit 2.
step_tristate() {
  name=$1
  shift
  "$@"
  case $? in
    0) printf '%s\n' "STEP $name = PASS"; PASSED=$((PASSED + 1)) ;;
    2) printf '%s\n' "STEP $name = PARTIAL (declared by the tool, NOT counted as passed)"
       PARTIAL=$((PARTIAL + 1)); PARTIAL_STEPS="$PARTIAL_STEPS $name" ;;
    *) printf '%s\n' "STEP $name = FAIL"
       FAILED=$((FAILED + 1)); FAILED_STEPS="$FAILED_STEPS $name" ;;
  esac
}

step unit            node --test services/reference-control-plane/test/*.test.mjs
step source-verify   node tools/verify-source.mjs
step auth-smoke      node tools/auth-http-smoke.mjs
# Both of these existed, worked, and were run by nothing. http-smoke had been crashing
# for several phases on endpoints correctly moved behind authentication, and
# packaging-filters is the regression test .gitignore cites by name for the anchoring
# rules that once deleted real vendored source. A check no runner invokes is a check
# that rots, and neither failure was visible until it was looked for on purpose.
step http-smoke      node tools/http-smoke.mjs
step_tristate packaging node tools/test-packaging-filters.mjs
step pg-migrations   "$PYTHON" tools/verify-postgres-migrations.py
step pg-contract     "$PYTHON" tools/verify-postgres-contract.py
step rust-source     "$PYTHON" tools/verify-rust-authority-source.py
step rust-provenance "$PYTHON" tools/test-rust-build-provenance.py -q

printf '\n%s\n' "TEST_SUMMARY pass=$PASSED fail=$FAILED partial=$PARTIAL unavailable=$UNAVAILABLE"
[ "$FAILED" -eq 0 ] || printf '%s\n' "FAILED:$FAILED_STEPS"
[ "$PARTIAL" -eq 0 ] || printf '%s\n' "PARTIAL (declared, NOT passed):$PARTIAL_STEPS"
[ "$UNAVAILABLE" -eq 0 ] || printf '%s\n' "UNAVAILABLE (declared, NOT passed):$UNAVAILABLE_STEPS"
[ "$FAILED" -eq 0 ]
