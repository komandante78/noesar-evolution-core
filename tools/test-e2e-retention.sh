#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# `tools/e2e-retention-policy.sh` and the runner's use of it, driven with SYNTHETIC driver
# output. No Docker, no browser, no probe: every case is a decision, and a decision is a pure
# function of an exit code and a log.
#
#   npm run test:e2e-retention     (or: bash tools/test-e2e-retention.sh)
#
# # Why this exists at all (F-E2EDISK-001)
#
# The retention rule the runner shipped with was correct and never ran: it keyed on the exit
# code, and a permanently-declared open gap kept the exit code at 1 forever. Nothing could
# have caught that, because nothing measured the DECISION — only the outcome of whole runs,
# each of which looked plausible. So the decision is now a function, and this drives it.
#
# # The case that is not a scenario
#
# `SOURCE-DECISION-NOT-ON-RC-ALONE` reads the shipped runner's own text. The defect being
# repaired is precisely a branch that keys on `rc` alone, and no runtime scenario can defend
# against someone reinstating it — a scenario only proves what the code does today. The same
# reasoning as `redeploy-fixture.sh`'s SOURCE-READS-BEFORE-MUTATION case.

set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
POLICY="${1:-$HERE/e2e-retention-policy.sh}"
# Overridable so the static assertions can be pointed at a DELIBERATELY BROKEN copy and seen to
# fail. A detector nobody has watched fail is not known to discriminate — this project has found
# defects in its own measurement more than once, so the oracle is part of the tool, not a
# one-off someone did by hand and wrote down.
RUNNER="${NOESAR_E2E_RETENTION_RUNNER:-$HERE/run-browser-e2e.sh}"
DRIVER="${NOESAR_E2E_RETENTION_DRIVER:-$HERE/browser-e2e.mjs}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); printf '  ok   - %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  FAIL - %s   :: %s\n' "$1" "$2"; }

if [ ! -r "$POLICY" ]; then printf 'POLICY_MISSING=%s\n' "$POLICY"; exit 1; fi
# shellcheck source=/dev/null
. "$POLICY"

if ! declare -F e2e_retention_verdict >/dev/null; then
  printf 'POLICY_DEFINES_NO_FUNCTION=%s\n' "$POLICY"; exit 1
fi

# A driver log with the given counters, wrapped in enough surrounding noise that a naive
# match on the marker would be tested rather than flattered.
log_with() { # <name> <declared> <undeclared> [extra-line]
  local path="$WORK/$1.log"
  {
    echo 'PASS  a check that passed'
    echo 'FAIL  I18N-RUNTIME the catalogue-closable gap does not grow (declared gap, not a pass)  [declared gap F-I18N-002]'
    echo 'BROWSER_E2E_TOTAL=501'
    echo 'BROWSER_E2E_PASS=500'
    echo 'BROWSER_E2E_FAIL=1'
    echo "BROWSER_E2E_FAIL_DECLARED=$2"
    echo "BROWSER_E2E_FAIL_UNDECLARED=$3"
    [ -n "${4:-}" ] && echo "$4"
  } > "$path"
  printf '%s' "$path"
}

expect() { # <case> <expected-verb> <rc> <log>
  local got; got="$(e2e_retention_verdict "$3" "${4:-}")"
  case "$got" in
    "$2"*) pass "$1  ($got)" ;;
    *)     fail "$1" "expected '$2…', got '$got'" ;;
  esac
}

echo "RETENTION_POLICY=$POLICY"

# --- the repair itself -------------------------------------------------------------------
# The one case that was impossible before: red, but every red is a tracked declared gap.
expect 'ONLY-DECLARED-GAPS-FAILED deletes'            delete   1 "$(log_with only-declared 1 0)"
# And the case that must NOT change: a real failure keeps its only forensic copy.
expect 'A-GENUINE-FAILURE preserves'                  preserve 1 "$(log_with genuine 1 3)"
expect 'ONE-GENUINE-FAILURE-AMONG-DECLARED preserves' preserve 1 "$(log_with mixed 1 1)"

# --- unchanged behaviour ------------------------------------------------------------------
expect 'A-PASSING-RUN deletes'                        delete   0 "$(log_with green 0 0)"
# The accessibility audit shares this runner and prints no such counters. An unknown driver
# must behave exactly as it did before this change: preserve on failure.
expect 'UNKNOWN-DRIVER-FAILED preserves'              preserve 1 "$WORK/nonexistent.log"
expect 'UNKNOWN-DRIVER-PASSED deletes'                delete   0 "$WORK/nonexistent.log"

# --- fail-safe: every ambiguity preserves --------------------------------------------------
expect 'ABORT-BEFORE-SUMMARY preserves'               preserve 2 "$(log_with aborted 0 0)"
expect 'EXIT-CODE-NOT-NUMERIC preserves'              preserve x "$(log_with weird 0 0)"
expect 'EMPTY-LOG preserves'                          preserve 1 "$(: > "$WORK/empty.log"; printf '%s' "$WORK/empty.log")"
expect 'NO-LOG-PATH preserves'                        preserve 1 ''
expect 'NON-NUMERIC-COUNTER preserves'                preserve 1 "$(log_with garbled 1 'zero')"
# Two runs' output concatenated into one file: the reading is not trustworthy, so it preserves
# even though a `head -1` would have found a 0 and deleted.
expect 'DUPLICATED-COUNTER preserves'                 preserve 1 \
  "$(log_with doubled 1 0 'BROWSER_E2E_FAIL_UNDECLARED=4')"
# A check whose NAME contains the marker must not be mistaken for the counter — the counter is
# anchored at start of line, and this proves the anchor is load-bearing.
expect 'MARKER-INSIDE-A-CHECK-NAME still deletes'     delete   1 \
  "$(log_with anchored 1 0 'FAIL  a check mentioning BROWSER_E2E_FAIL_UNDECLARED=9 in its name')"

# --- the static invariant -------------------------------------------------------------------
# The runner must ASK the policy, and the branch that keeps or deletes the workspace must key
# on the verdict — not on the exit code. That is the defect being repaired, and no runtime
# scenario can stop it being reintroduced.
#
# Scoped to the RETENTION REGION, not to the whole file, and the reason is worth writing down:
# the first version of this assertion grepped the file for `if [ "${rc}" -ne 0 ]` and went red
# on correct code. `rc` is still legitimately read at the top of cleanup() to dump the probe's
# logs on a failure, which has nothing to do with retention. A detector that cannot tell those
# two apart would have forced a worse script to satisfy a test — a false positive "fixed" is a
# real regression introduced for nothing (CLAUDE10.md §40b).
# The region is the BRANCH, from the `if` that opens it to the `fi` that closes it — not the
# verdict call above it. Found by running this assertion rather than by reading it: the first
# version started the region at the call, which legitimately contains `${rc}` because that is
# how the exit code is handed to the policy, and it went red on the correct runner.
RETENTION_REGION="$WORK/retention-region.txt"
awk '/^  if \[ "\$\{verdict/,/^  fi$/' "$RUNNER" > "$RETENTION_REGION"
if [ ! -r "$RUNNER" ]; then
  fail 'SOURCE-DECISION-NOT-ON-RC-ALONE' "runner unreadable: $RUNNER"
elif ! grep -q 'e2e_retention_verdict "${rc}"' "$RUNNER"; then
  fail 'SOURCE-DECISION-NOT-ON-RC-ALONE' 'the runner never hands the exit code to the policy'
elif [ ! -s "$RETENTION_REGION" ]; then
  fail 'SOURCE-DECISION-NOT-ON-RC-ALONE' 'no retention branch keyed on the verdict was found'
elif grep -q '\${rc}' "$RETENTION_REGION"; then
  fail 'SOURCE-DECISION-NOT-ON-RC-ALONE' 'the retention branch still reads the exit code'
elif ! grep -q 'PRESERVED for diagnosis' "$RETENTION_REGION"; then
  fail 'SOURCE-DECISION-NOT-ON-RC-ALONE' 'the located branch is not the one that preserves'
else
  pass 'SOURCE-DECISION-NOT-ON-RC-ALONE  (the retention branch keys on the verdict)'
fi

# The runner must still refuse to recurse into a path that is not this run's own. That guard
# predates this change and is exactly the kind of insurance a refactor quietly drops.
if grep -q 'path failed the safety check' "$RUNNER"; then
  pass 'SOURCE-PATH-SAFETY-GUARD-KEPT'
else
  fail 'SOURCE-PATH-SAFETY-GUARD-KEPT' 'the ARTIFACT_ROOT safety check is gone'
fi

# The driver must actually emit the counter the policy reads, or the whole chain is decorative.
if grep -q 'BROWSER_E2E_FAIL_UNDECLARED=' "$DRIVER"; then
  pass 'SOURCE-DRIVER-EMITS-THE-COUNTER'
else
  fail 'SOURCE-DRIVER-EMITS-THE-COUNTER' 'browser-e2e.mjs prints no BROWSER_E2E_FAIL_UNDECLARED'
fi

# The declared gap must be DECLARED at its call site, not matched by name from a list. A list
# of names in a second file is the thing that goes stale silently.
if grep -q "declaredGap: 'F-I18N-002'" "$DRIVER"; then
  pass 'SOURCE-DECLARED-GAP-IS-MARKED-AT-ITS-CALL-SITE'
else
  fail 'SOURCE-DECLARED-GAP-IS-MARKED-AT-ITS-CALL-SITE' 'no check declares F-I18N-002'
fi

printf 'E2E_RETENTION_PASS=%s\nE2E_RETENTION_FAIL=%s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
