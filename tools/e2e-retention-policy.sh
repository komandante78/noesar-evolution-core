#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Should a finished e2e run keep its workspace for diagnosis, or delete it?
#
# Sourceable and side-effect free: it defines one function, touches no file, starts nothing,
# and is safe to `source` from a test. That is the whole reason it is a separate file —
# `tools/run-browser-e2e.sh` cannot be sourced (it builds an image and starts containers on
# the way down), so a decision living inside it could only ever be tested by running a real
# probe, which is ~7 minutes and a Docker daemon per case.
#
# # The defect this exists to remove (F-E2EDISK-001)
#
# The runner has always had a correct-looking retention policy: delete the run directory when
# the run passed, preserve it when it failed. The defect was in the TRIGGER, not the cleanup.
# The suite exits non-zero when ANY check fails, and `F-I18N-002` is a permanently-open
# DECLARED gap — a check that is *known* red and tracked by a finding. So every run exited 1,
# the preserve branch fired every time, the delete branch never fired at all, and 151 run
# directories and 7.3 GB accumulated. Same class as the retired debuglab step: a rule whose
# condition never fires is not a rule.
#
# The fix is to stop asking one boolean two different questions. "Should the suite go red?"
# and "is there anything here worth diagnosing?" are not the same question. A declared gap
# answers yes to the first and no to the second: its state is already written down in a
# finding, and its workspace teaches nobody anything.
#
# # Fail-safe direction, stated once
#
# Every ambiguous case PRESERVES. A preserved workspace costs disk; a deleted one costs the
# only forensic copy of a real failure. An unknown driver (the accessibility audit shares this
# runner and prints no such counters), a missing log, a garbled or duplicated counter, a
# non-integer, an abort before the summary — all preserve. Deleting requires positive proof.

# e2e_retention_verdict <driver_exit_code> <driver_log_path>
#
# Prints "delete <reason>" or "preserve <reason>" on stdout. Never exits, never removes
# anything: the caller owns the filesystem, this owns the decision.
e2e_retention_verdict() {
  local rc="${1:-}" log="${2:-}"

  case "${rc}" in
    ''|*[!0-9]*) printf 'preserve exit-code-not-numeric(%s)\n' "${rc}"; return 0 ;;
  esac

  # A clean run has nothing to diagnose. This is the branch that already worked.
  if [ "${rc}" -eq 0 ]; then printf 'delete run-passed\n'; return 0; fi

  # Only a check-verdict exit is eligible for the declared-gap path. The driver exits 1 for
  # failed checks and 2 for a missing environment; anything else is an abort, and an abort
  # keeps its evidence.
  if [ "${rc}" -ne 1 ]; then printf 'preserve exit-%s-is-an-abort-not-a-verdict\n' "${rc}"; return 0; fi

  if [ -z "${log}" ] || [ ! -r "${log}" ]; then printf 'preserve driver-log-unreadable\n'; return 0; fi

  # Exactly one counter line, or the reading is not trustworthy. Two lines means two runs'
  # output in one file, or a check name that happens to contain the marker.
  local lines value
  lines="$(grep -c '^BROWSER_E2E_FAIL_UNDECLARED=' "${log}" || true)"
  if [ "${lines}" != "1" ]; then
    printf 'preserve undeclared-counter-absent-or-ambiguous(%s)\n' "${lines}"; return 0
  fi
  value="$(grep '^BROWSER_E2E_FAIL_UNDECLARED=' "${log}" | head -1 | cut -d= -f2 | tr -d '[:space:]')"
  case "${value}" in
    ''|*[!0-9]*) printf 'preserve undeclared-counter-not-numeric(%s)\n' "${value}"; return 0 ;;
  esac

  if [ "${value}" -eq 0 ]; then
    printf 'delete only-declared-gaps-failed\n'; return 0
  fi
  printf 'preserve %s-undeclared-failure(s)\n' "${value}"
}
