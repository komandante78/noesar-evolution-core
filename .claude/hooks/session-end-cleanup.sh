#!/usr/bin/env bash
# NOESAR EVOLUTION — SessionEnd hook. The ONLY component authorised to delete a baseline.
#
# The lifecycle this closes (F-HOOK-003, D-0383):
#
#   SessionStart  writes the trust anchor, privately and atomically
#   Stop          reads and compares it on EVERY turn — never deletes
#   SessionEnd    deletes it once, here, at real session termination
#   SessionStart  (next one) collects residues left by sessions that never got here
#
# Why this file exists at all: Stop fires at the end of every assistant TURN. Deleting the
# baseline there destroyed the anchor after the first green turn, blinding check 6 for the
# rest of the session and blocking every later close on a gap that never existed.
#
# CONTRACT, verified against Claude Code 2.1.227 in the installed binary rather than assumed:
#   · the payload carries session_id (the shared hook-payload builder emits it) and reason;
#   · reason is one of clear | resume | logout | prompt_input_exit | bypass_permissions_disabled
#     | other — this hook treats them ALIKE, because every one of them ends the session and
#     the baseline is worthless afterwards. No branching means no reason can be forgotten;
#   · a SessionEnd hook CANNOT block termination, so this file never tries to. It reports;
#   · the default timeout is 1500 ms, so it does no docker call, no git call and no scan.
#
# SAFETY: the path is DERIVED HERE from a session_id validated as an identifier — never
# taken from the payload. A payload cannot steer this hook at a path of its choosing, and
# every removal additionally requires: exact filename prefix, a regular file, not a symlink,
# and ownership by the current uid. Anything failing a check is kept and declared.
set -u

ROOT="${NOESAR_GUARD_ROOT:-/mnt/cachec/NOESAR_EVOLUTION}"
GUARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "$ROOT/.claude/hooks")"
BASELINE_LIB="$GUARD_DIR/lib/container-baseline.sh"
BOOTSTRAP_MARKER="${NOESAR_GUARD_BOOTSTRAP_MARKER:-/tmp/noesar-evolution-governance-bootstrap-session-id.txt}"

emit() { # $1 = message
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg m "$1" '{systemMessage:("session-end-cleanup: " + $m)}'
  else
    printf '{}\n'
  fi
  exit 0
}

INPUT="$(cat 2>/dev/null || true)"

if ! command -v jq >/dev/null 2>&1 || [ ! -f "$BASELINE_LIB" ]; then
  # No silent success: a cleanup that could not run says so rather than implying it worked.
  printf '{"systemMessage":"session-end-cleanup: jq or the baseline library is unavailable — cleanup did NOT run; a residue may remain for the next SessionStart to collect."}\n'
  exit 0
fi

SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"
REASON="$(printf '%s' "$INPUT" | jq -r '.reason // "unspecified"' 2>/dev/null || echo unspecified)"

# shellcheck source=lib/container-baseline.sh
. "$BASELINE_LIB"

if [ -z "$SESSION_ID" ]; then
  emit "the payload carried no session_id — nothing was removed (reason=$REASON)."
fi
if ! cbl_valid_session_id "$SESSION_ID"; then
  # Deliberately does not echo the offending value back into a transcript.
  emit "the session id is not a valid identifier — nothing was removed (reason=$REASON)."
fi

BASELINE_DIR="$(cbl_runtime_dir)"
RESULT="$(cbl_remove_session_files "$BASELINE_DIR" "$SESSION_ID" "$BOOTSTRAP_MARKER" 2>/dev/null | tr '\n' ' ')"
[ -z "$RESULT" ] && RESULT="no action taken"

emit "reason=$REASON · $RESULT"
