#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Every governance suite in this directory, in one run. (D-0511)
#
# The suites existed before this runner and each one was green — when somebody remembered to type
# its name. None was reachable from `scripts/test.sh`, so nothing in any pipeline would have caught
# a governance regression. That is the same shape as the two defects this project has already
# repaired: the retired `noesar-debuglab` hunt step that pointed at a container which no longer
# existed, and the retention branch whose condition never fired. A check nobody runs is not a check
# — it is a comment. `scripts/test.sh` now has one `governance` step that calls this file.
#
# Discovery is by pattern, not by a list: a suite added tomorrow is picked up without editing this
# file, which is the same reason the exceptions themselves now live in one source.
#
# Usage: ./run-all.sh   (exit 0 = every suite passed, 1 = at least one failed or was unavailable)
# Needs: bash, jq. Mutates nothing outside each suite's own TMPDIR; starts no container.
set -u

HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

FAILED=""
RAN=0

for suite in "$HERE"/test-*.sh; do
  [ -r "$suite" ] || continue
  name="$(basename "$suite" .sh)"
  RAN=$((RAN + 1))
  # Only the tail matters: each suite prints one line per assertion, and loading all of them costs
  # more than running them (noesar-evolution-verify, "output discipline").
  if out="$(bash "$suite" 2>&1)"; then
    printf 'GOVERNANCE %-28s = PASS  %s\n' "$name" "$(printf '%s' "$out" | grep -Ei '[0-9]+ passed' | tail -1)"
  else
    printf 'GOVERNANCE %-28s = FAIL\n' "$name"
    printf '%s\n' "$out" | grep -E '^\s*FAIL|UNAVAILABLE|[0-9]+ passed' | head -20
    FAILED="$FAILED $name"
  fi
done

printf -- '----\n'
if [ "$RAN" -eq 0 ]; then
  printf 'GOVERNANCE: no suite found in %s — that is a failure, not a pass\n' "$HERE"
  exit 1
fi
if [ -n "$FAILED" ]; then
  printf 'GOVERNANCE: %s suite(s) run, FAILED:%s\n' "$RAN" "$FAILED"
  exit 1
fi
printf 'GOVERNANCE: %s suite(s) run, all passed\n' "$RAN"
