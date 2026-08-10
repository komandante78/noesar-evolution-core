#!/usr/bin/env bash
# NOESAR EVOLUTION — SessionStart hook.
#
# Two jobs:
#  1. Inject a COMPACT digest (current_phase/next_action/open blockers/git status) into
#     context, hard-capped at 6 KB — built directly from PROJECT_STATE.json via jq, not by
#     passing through the full state-digest.sh report (which runs ~10 KB on its own and is
#     meant for a human/agent reading it interactively, not for a size-capped hook payload).
#  2. Write a session-scoped, identity-based (container ID, not just name) baseline of
#     EVERY container docker knows about, so the Stop hook (session-close-guard.sh) can
#     later tell a pre-existing container apart from one created during this session, even
#     if it shares a name with something that predates the session (a removed-and-recreated
#     container gets a new id). Host-wide, not filtered to noesar-evolution* at capture
#     time — the Stop hook does the NOESAR-vs-external classification from labels/name.
#
# Reads hook JSON from stdin for `.session_id` (baseline filename) and `.source` (message
# only, no branching on it).
set -u

ROOT="/mnt/cachec/NOESAR_EVOLUTION"
STATE="$ROOT/PROJECT_STATE.json"
BASELINE_LIB="$ROOT/.claude/hooks/lib/container-baseline.sh"
MAX_BYTES=6144

INPUT="$(cat 2>/dev/null || true)"
SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"

# --- job 2: container baseline (best-effort, never fails the hook) ---
if [ -n "$SESSION_ID" ] && [ -f "$BASELINE_LIB" ]; then
  # shellcheck source=lib/container-baseline.sh
  . "$BASELINE_LIB"
  cbl_fetch_all_containers > "/tmp/noesar-evolution-container-baseline-${SESSION_ID}.json" 2>/dev/null || true
fi

# --- job 1: compact digest ---
SECRET_PATTERN='(TOKEN|SECRET|PASSWORD|PASSPHRASE|PRIVATE_KEY|BEGIN [A-Z ]*PRIVATE KEY|Bearer [A-Za-z0-9._-]{10,}|api[_-]?key)'

truncate_field() {
  # $1 = text, $2 = max chars
  local t="$1" n="$2"
  if [ "${#t}" -gt "$n" ]; then
    printf '%s…[truncated]' "${t:0:$n}"
  else
    printf '%s' "$t"
  fi
}

GIT_BRANCH="(unknown)"
GIT_HEAD="(unknown)"
GIT_DIRTY="(unknown)"
if command -v git >/dev/null 2>&1 && [ -d "$ROOT/.git" ]; then
  GIT_BRANCH="$(cd "$ROOT" && git branch --show-current 2>/dev/null || echo '?')"
  GIT_HEAD="$(cd "$ROOT" && git rev-parse --short=7 HEAD 2>/dev/null || echo '?')"
  DIRTY_N="$(cd "$ROOT" && git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  GIT_DIRTY="$DIRTY_N file(s) changed"
fi

CURRENT_PHASE="(PROJECT_STATE.json unavailable)"
NEXT_ACTION="(PROJECT_STATE.json unavailable)"
BLOCKERS_LINE="(PROJECT_STATE.json unavailable)"
LAST_COMMIT="?"

if [ -f "$STATE" ] && command -v jq >/dev/null 2>&1 && jq empty "$STATE" >/dev/null 2>&1; then
  CURRENT_PHASE="$(jq -r '.current_phase // empty' "$STATE" 2>/dev/null)"
  NEXT_ACTION="$(jq -r '.next_action // empty' "$STATE" 2>/dev/null)"
  LAST_COMMIT="$(jq -r '.last_commit // empty' "$STATE" 2>/dev/null)"
  BLOCKERS_LINE="$(jq -r '
    [.blockers[]? | select(.severity != "resolved")]
    | if length == 0 then "none open"
      else (map("[" + .severity + "] " + .id + ": " + (.summary // "" | .[0:100])) | join(" | "))
      end
  ' "$STATE" 2>/dev/null)"
fi

CURRENT_PHASE="$(truncate_field "$CURRENT_PHASE" 700)"
NEXT_ACTION="$(truncate_field "$NEXT_ACTION" 700)"
BLOCKERS_LINE="$(truncate_field "$BLOCKERS_LINE" 700)"

DIGEST="NOESAR EVOLUTION — compact session digest
git: branch=$GIT_BRANCH head=$GIT_HEAD dirty=$GIT_DIRTY
state.last_commit: $LAST_COMMIT

current_phase: $CURRENT_PHASE

next_action: $NEXT_ACTION

open blockers (non-resolved): $BLOCKERS_LINE

Full detail on demand, never loaded whole: .claude/skills/noesar-evolution-context/state-digest.sh"

# Defensive secret-shaped-line filter, then hard byte cap — the mechanical guarantee this
# hook stays under budget regardless of how long any single field above turns out to be.
DIGEST="$(printf '%s\n' "$DIGEST" | grep -vEi "$SECRET_PATTERN")"
DIGEST="$(printf '%s' "$DIGEST" | head -c "$MAX_BYTES")"

printf '%s' "$DIGEST" | jq -Rs '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:.}}'
