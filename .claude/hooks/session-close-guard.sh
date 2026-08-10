#!/usr/bin/env bash
# NOESAR EVOLUTION — Stop hook.
#
# Blocks a stop when the project's own closure duty (skill noesar-evolution, step 14
# WRITE HANDOFF) was not actually carried out. Every check is the mechanical form of
# something CLAUDE10.md/the skills already say in prose.
#
# Anti-loop: reads `.stop_hook_active` from stdin. If true, this Stop event is itself a
# continuation caused by a previous block from THIS hook — it allows the stop through
# rather than blocking a second time.
#
# Fails OPEN on any internal error (missing jq/git, unreadable file): a broken guard must
# not silently trap the session, and must not silently pass either — it says so.
set -u

ROOT="${NOESAR_GUARD_ROOT:-/mnt/cachec/NOESAR_EVOLUTION}"
STATE="$ROOT/PROJECT_STATE.json"
HANDOFF="$ROOT/docs/SESSION_HANDOFF.md"

INPUT="$(cat 2>/dev/null || true)"
STOP_ACTIVE="$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"
SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"

FAILS=()
DEBTS=()

if ! command -v jq >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1 || [ ! -d "$ROOT" ]; then
  printf '{"systemMessage":"session-close-guard: jq/git/project root unavailable in this hook context — skipped, not blocking."}\n'
  exit 0
fi

# The "closure set" — paths a state-closure step legitimately changes on its own, without
# that change counting as project work the state file must describe. A commit whose full
# diff against PROJECT_STATE.json's last_commit stays inside this set does not re-trip
# check 2 below: this is what breaks the self-reference paradox (the file cannot name the
# hash of the commit that will contain it, because that hash depends on the file).
is_closure_path() {
  case "$1" in
    PROJECT_STATE.json|docs/SESSION_HANDOFF.md|docs/DECISION_LOG.md|docs/INSTALLATION_LEDGER.md) return 0 ;;
    .claude/settings.json) return 0 ;;
    .claude/hooks/*) return 0 ;;
    .claude/skills/*/SKILL.md) return 0 ;;
    *) return 1 ;;
  esac
}
# BACKUPS/* is deliberately NOT in this set (Owner instruction, 2026-08-10). A backup can
# contain real sources/config/substantial content, so it must never be treated as a
# closure-only change by construction — a commit that touches BACKUPS/* is judged on its
# own merits by check 2 like any other non-governance path.

# --- Check 1: PROJECT_STATE.json is valid JSON ---
if [ ! -f "$STATE" ]; then
  FAILS+=("PROJECT_STATE.json is missing at $STATE")
elif ! jq empty "$STATE" >/dev/null 2>&1; then
  FAILS+=("PROJECT_STATE.json is not valid JSON")
fi

# --- Check 2: last_commit is HEAD, or HEAD is ahead of it by closure-set changes only ---
if [ -f "$STATE" ] && jq empty "$STATE" >/dev/null 2>&1; then
  STATE_COMMIT="$(jq -r '.last_commit // empty' "$STATE" 2>/dev/null)"
  HEAD_FULL="$(cd "$ROOT" && git rev-parse HEAD 2>/dev/null)"
  if [ -n "$STATE_COMMIT" ] && [ -n "$HEAD_FULL" ]; then
    STATE_COMMIT_FULL="$(cd "$ROOT" && git rev-parse "$STATE_COMMIT" 2>/dev/null)"
    if [ -z "$STATE_COMMIT_FULL" ]; then
      FAILS+=("PROJECT_STATE.json.last_commit ('$STATE_COMMIT') does not resolve to a real commit")
    elif [ "$STATE_COMMIT_FULL" = "$HEAD_FULL" ]; then
      : # exact match
    elif (cd "$ROOT" && git merge-base --is-ancestor "$STATE_COMMIT_FULL" "$HEAD_FULL" 2>/dev/null); then
      NONCLOSURE=""
      while IFS= read -r p; do
        [ -z "$p" ] && continue
        is_closure_path "$p" || NONCLOSURE="$NONCLOSURE $p"
      done <<< "$(cd "$ROOT" && git diff --name-only "$STATE_COMMIT_FULL" "$HEAD_FULL" 2>/dev/null)"
      if [ -n "$NONCLOSURE" ]; then
        FAILS+=("PROJECT_STATE.json.last_commit is behind HEAD by non-closure-set changes:$NONCLOSURE")
      fi
      # else: HEAD is ahead only by closure-set commit(s) (e.g. this state update itself
      # being committed on top of last_commit) — not a staleness failure.
    else
      FAILS+=("PROJECT_STATE.json.last_commit ('$STATE_COMMIT') is not an ancestor of HEAD — history diverged")
    fi
  fi
fi

# --- Check 3: docs/SESSION_HANDOFF.md <= 150 lines ---
if [ ! -f "$HANDOFF" ]; then
  FAILS+=("docs/SESSION_HANDOFF.md is missing")
else
  HLINES="$(wc -l < "$HANDOFF" 2>/dev/null || echo 0)"
  [ "$HLINES" -gt 150 ] 2>/dev/null && FAILS+=("docs/SESSION_HANDOFF.md is $HLINES lines, over the 150-line cap")
fi

# --- Check 4: handoff and cursor report a next action ---
if [ -f "$STATE" ] && jq empty "$STATE" >/dev/null 2>&1; then
  NEXT_ACTION="$(jq -r '.next_action // empty' "$STATE" 2>/dev/null)"
  [ -z "$NEXT_ACTION" ] && FAILS+=("PROJECT_STATE.json.next_action is empty")
fi
if [ -f "$HANDOFF" ] && ! grep -qiE 'PROSSIM' "$HANDOFF" 2>/dev/null; then
  FAILS+=("docs/SESSION_HANDOFF.md has no PROSSIMA/next-action section")
fi

# --- Check 5: uncommitted operational changes newer than the handoff (heuristic) ---
if [ -d "$ROOT/.git" ] && [ -f "$HANDOFF" ]; then
  HANDOFF_MTIME="$(stat -c %Y "$HANDOFF" 2>/dev/null || echo 0)"
  NEWER=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    path="${line:3}"
    path="${path#* -> }"
    is_closure_path "$path" && continue
    fullpath="$ROOT/$path"
    [ -e "$fullpath" ] || continue
    mt="$(stat -c %Y "$fullpath" 2>/dev/null || echo 0)"
    [ "$mt" -gt "$HANDOFF_MTIME" ] 2>/dev/null && NEWER="$NEWER $path"
  done <<< "$(cd "$ROOT" && git status --porcelain 2>/dev/null)"
  [ -n "$NEWER" ] && FAILS+=("uncommitted changes newer than docs/SESSION_HANDOFF.md, not registered there:$NEWER")
fi

# --- Check 6: containers — identity-based (container ID, not just name) ---
# SessionStart (session-context.sh) writes a session-scoped, host-wide baseline of
# {id,name,created,image_id,labels} for every container docker knows about. A container
# ID absent from that baseline appeared during this session; if it is in NOESAR-evolution
# scope (cbl_is_noesar_scoped: label or name prefix) and still present now, leaving it is
# the litter CLAUDE10.md §5a actually forbids, and that blocks — including the case where
# it shares a NAME with something pre-existing but has a DIFFERENT id (removed and
# recreated under the old name), because matching is by id, never by name alone. A new
# container outside NOESAR-evolution scope is reported but never blocks — this project's
# duty is its own litter, not every container on a shared host.
#
# A missing or corrupt baseline fails CLOSED here (blocks), not open — Owner instruction,
# 2026-08-10: a governance gap must say so, not pass silently. The one exception is this
# session's own bootstrap, named in BOOTSTRAP_MARKER: the single session_id that
# legitimately ran SessionStart before this identity-based baseline mechanism existed at
# all. Only an exact match downgrades a missing baseline to a declared, non-blocking debt;
# every other session with no baseline blocks.
BASELINE_FILE=""
BOOTSTRAP_MARKER="${NOESAR_GUARD_BOOTSTRAP_MARKER:-/tmp/noesar-evolution-governance-bootstrap-session-id.txt}"
BASELINE_LIB="$ROOT/.claude/hooks/lib/container-baseline.sh"
if command -v docker >/dev/null 2>&1 && [ -f "$BASELINE_LIB" ]; then
  # shellcheck source=lib/container-baseline.sh
  . "$BASELINE_LIB"
  [ -n "$SESSION_ID" ] && BASELINE_FILE="/tmp/noesar-evolution-container-baseline-${SESSION_ID}.json"
  CURRENT_JSON="$(cbl_fetch_all_containers)"
  while IFS= read -r finding; do
    [ -z "$finding" ] && continue
    case "$finding" in
      FAIL:*) FAILS+=("${finding#FAIL:}") ;;
      DEBT:*) DEBTS+=("${finding#DEBT:}") ;;
    esac
  done <<< "$(cbl_check_containers "$BASELINE_FILE" "$CURRENT_JSON" "$SESSION_ID" "$BOOTSTRAP_MARKER")"
fi

# The baseline (and the one-time bootstrap exemption, once its named session closes) are
# deleted only when this hook is actually about to let the stop happen — not while it is
# still blocking, since the session continues and a later check in the same session still
# needs them.
cleanup_container_baseline() {
  [ -n "$BASELINE_FILE" ] && rm -f "$BASELINE_FILE" 2>/dev/null
  if [ -n "$SESSION_ID" ] && [ -f "$BOOTSTRAP_MARKER" ] && [ "$(cat "$BOOTSTRAP_MARKER" 2>/dev/null)" = "$SESSION_ID" ]; then
    rm -f "$BOOTSTRAP_MARKER" 2>/dev/null
  fi
}

DEBT_TEXT=""
for d in "${DEBTS[@]:-}"; do
  [ -n "$d" ] && DEBT_TEXT="$DEBT_TEXT
[debt] $d"
done

if [ ${#FAILS[@]} -eq 0 ]; then
  cleanup_container_baseline
  jq -n --arg d "$DEBT_TEXT" '{systemMessage:("session-close-guard: all blocking checks passed (state JSON valid, last_commit consistent with HEAD, handoff<=150 lines, next action present, no unregistered diff, no session-created container litter)." + $d)}'
  exit 0
fi

REASON=""
for f in "${FAILS[@]}"; do
  REASON="$REASON- $f
"
done

if [ "$STOP_ACTIVE" = "true" ]; then
  cleanup_container_baseline
  jq -n --arg r "$REASON" --arg d "$DEBT_TEXT" '{systemMessage:("session-close-guard: checks still failing but allowing the stop (stop_hook_active, avoiding a loop). Unresolved:\n" + $r + $d)}'
  exit 0
fi

jq -n --arg r "$REASON" --arg d "$DEBT_TEXT" '{decision:"block",reason:$r,continue:false,stopReason:$r,systemMessage:("session-close-guard BLOCKED this stop:\n" + $r + $d)}'
