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
#
# DRY RUN (added 2026-08-11, D-0381 — after this hook destroyed a live session's baseline).
# Running this file by hand to "just look at the verdict" is NOT read-only: on a green
# verdict it reaches cleanup_container_baseline() and deletes the real SessionStart
# baseline, after which the genuine Stop of that same session blocks on a governance gap
# that never existed. That is exactly what happened to session 9898143a — the probe was
# described as read-only and was not.
#
#   NOESAR_GUARD_DRY_RUN=1   run every check, emit the SAME verdict, delete NOTHING.
#
# The dry run differs from a normal Stop in exactly one respect: it never mutates. It still
# emits decision:"block" when the checks fail — deliberately, so that the env var being set
# by accident during a real Stop can only ever cost a stale /tmp file, never a fail-open.
# Reducing the block to a report would have turned a stray variable into a bypass.
#
#   NOESAR_GUARD_BASELINE_DIR=<dir>   where baselines live (default /tmp). Point probes and
#                                     fixtures at a scratch dir so a manual run can never
#                                     resolve to a real session's baseline path.
set -u

ROOT="${NOESAR_GUARD_ROOT:-/mnt/cachec/NOESAR_EVOLUTION}"
STATE="$ROOT/PROJECT_STATE.json"
HANDOFF="$ROOT/docs/SESSION_HANDOFF.md"
# Resolved from the shared library once it is sourced (check 6), so the write side
# (SessionStart) and this read side can never resolve two different directories.
BASELINE_DIR=""

DRY_RUN=false
case "${NOESAR_GUARD_DRY_RUN:-}" in
  1|true|TRUE|True|yes|YES) DRY_RUN=true ;;
esac

INPUT="$(cat 2>/dev/null || true)"

# A dry run is a deliberate act by an operator, so it holds itself to a stricter input
# contract than the real hook: unparseable input is a broken probe, and a broken probe must
# not print a verdict anyone could quote. It fails CLOSED. The real Stop path below keeps
# its own long-standing fail-open-on-broken-environment behaviour, unchanged.
# `jq empty` succeeds on EMPTY input, so emptiness must be tested separately — otherwise a
# probe piping nothing at all gets a confident verdict computed from no session at all.
if [ "$DRY_RUN" = true ] && { [ -z "$INPUT" ] || ! printf '%s' "$INPUT" | jq empty >/dev/null 2>&1; }; then
  printf '{"decision":"block","continue":false,"dryRun":true,"verdict":"BLOCK","systemMessage":"session-close-guard DRY_RUN: hook payload is absent or not valid JSON - failing closed, no verdict is claimed and nothing was deleted."}\n'
  exit 0
fi

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
    CLAUDE10.md|CLAUDE.md) return 0 ;;
    .claude/settings.json) return 0 ;;
    .claude/hooks/*) return 0 ;;
    .claude/skills/*/SKILL.md) return 0 ;;
    *) return 1 ;;
  esac
}
# CLAUDE10.md and CLAUDE.md were MISSING from this set until 2026-08-11 (F-CLOSURE-001,
# D-0387), and the omission was invisible until a commit tripped it. Every other governance
# artifact was already here — the state files, settings.json, the hooks, the skills — while
# the authority text those four are subordinate to was classified as product work. The
# consequence was not theoretical: commit d4ad08a changed CLAUDE10.md, and check 2 would
# then have blocked EVERY later session close until last_commit was manually advanced past
# it. A guard that blocks because the project edited its own governance is a guard people
# learn to route around, which costs more than it buys.
#
# The two are exempt for the same reason the skills are: they are authority prose, they
# carry no product behaviour, and changing them does not make PROJECT_STATE.json's
# last_commit a stale description of what the product IS. The exemption is anchored at the
# repository root and matches the exact names only — `vendor/CLAUDE10.md` and
# `CLAUDE10.md.bak` are deliberately outside it (asserted in test-session-lifecycle.sh §29).
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
# Resolved from THIS script's own directory, not from NOESAR_GUARD_ROOT. The library is a
# sibling of this file and always travels with it; deriving it from the root meant that
# overriding the root silently disabled check 6 altogether — a fail-open reached by setting
# a variable that has nothing to do with containers. Found by the L1-L15 lifecycle tests.
GUARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "$ROOT/.claude/hooks")"
BASELINE_LIB="$GUARD_DIR/lib/container-baseline.sh"
# The fixture override counts as a docker source. Without this, check 6 is unreachable on
# any host with no docker binary — which is most of the hosts this product ships to, and
# every CI runner — so the whole baseline mechanism would be untestable off this machine
# (platform law, CLAUDE10.md §60-64). Behaviour on a real docker-less host is unchanged:
# NOESAR_GUARD_FAKE_DOCKER_JSON is never set there.
if { command -v docker >/dev/null 2>&1 || [ -n "${NOESAR_GUARD_FAKE_DOCKER_JSON:-}" ]; } && [ -f "$BASELINE_LIB" ]; then
  # shellcheck source=lib/container-baseline.sh
  . "$BASELINE_LIB"
  BASELINE_DIR="$(cbl_runtime_dir)"
  [ -n "$SESSION_ID" ] && BASELINE_FILE="$(cbl_baseline_path "$BASELINE_DIR" "$SESSION_ID" 2>/dev/null || true)"
  # Heartbeat, before any verdict is computed, so a BLOCKED turn marks this session alive
  # exactly as a passing one does. A dry run is exempt: changing an mtime is a mutation,
  # and the dry run's one promise is that it makes none.
  if [ "$DRY_RUN" != true ] && [ -n "$BASELINE_FILE" ]; then
    cbl_touch_baseline "$BASELINE_FILE" || true
  fi
  CURRENT_JSON="$(cbl_fetch_all_containers)"
  while IFS= read -r finding; do
    [ -z "$finding" ] && continue
    case "$finding" in
      FAIL:*) FAILS+=("${finding#FAIL:}") ;;
      DEBT:*) DEBTS+=("${finding#DEBT:}") ;;
    esac
  done <<< "$(cbl_check_containers "$BASELINE_FILE" "$CURRENT_JSON" "$SESSION_ID" "$BOOTSTRAP_MARKER")"
fi

# THIS HOOK DELETES NOTHING (F-HOOK-003, D-0383).
#
# It used to remove the baseline whenever it was about to let the stop through. That was
# wrong for a reason no test covered: Stop fires at the end of every assistant TURN, not
# once per session. The first green turn destroyed the trust anchor, so every later turn
# blocked on "baseline missing" — a governance gap that had never existed — and, worse,
# check 6 went blind to any container created during the rest of the session.
#
# Deletion now belongs to SessionEnd (session-end-cleanup.sh), which fires once, at real
# session termination, and receives the same session_id. What remains here is the
# heartbeat: refreshing the mtime is what marks this session as alive, so the crash-recovery
# prune in SessionStart can tell a cold residue from a session still working.
CLEANUP_NOTE=""
cleanup_container_baseline() {
  if [ "$DRY_RUN" = true ]; then
    CLEANUP_NOTE="
[dry-run] nothing was deleted — and a real Stop would not have deleted anything either.
The baseline is removed by the SessionEnd hook, not by Stop (D-0383)."
    return 0
  fi
  # The heartbeat already ran in check 6, for every verdict. Nothing to do here but say so.
  if [ -n "$BASELINE_FILE" ]; then
    CLEANUP_NOTE="
[baseline] kept for the rest of the session; SessionEnd removes it (D-0383)."
  fi
}

# Prefix every message so a dry run can never be mistaken for a real close in a transcript.
MODE_TAG=""
[ "$DRY_RUN" = true ] && MODE_TAG="DRY_RUN "

DEBT_TEXT=""
for d in "${DEBTS[@]:-}"; do
  [ -n "$d" ] && DEBT_TEXT="$DEBT_TEXT
[debt] $d"
done

if [ ${#FAILS[@]} -eq 0 ]; then
  cleanup_container_baseline
  jq -n --arg d "$DEBT_TEXT" --arg m "$MODE_TAG" --arg c "$CLEANUP_NOTE" --argjson dry "$DRY_RUN" \
    '{dryRun:$dry,verdict:"PASS",systemMessage:("session-close-guard " + $m + "PASS: all blocking checks passed (state JSON valid, last_commit consistent with HEAD, handoff<=150 lines, next action present, no unregistered diff, no session-created container litter)." + $d + $c)}'
  exit 0
fi

REASON=""
for f in "${FAILS[@]}"; do
  REASON="$REASON- $f
"
done

if [ "$STOP_ACTIVE" = "true" ]; then
  cleanup_container_baseline
  jq -n --arg r "$REASON" --arg d "$DEBT_TEXT" --arg m "$MODE_TAG" --arg c "$CLEANUP_NOTE" --argjson dry "$DRY_RUN" \
    '{dryRun:$dry,verdict:"ALLOW_ANTILOOP",systemMessage:("session-close-guard " + $m + "checks still failing but allowing the stop (stop_hook_active, avoiding a loop). Unresolved:\n" + $r + $d + $c)}'
  exit 0
fi

# The blocking verdict is emitted in BOTH modes, identically. A dry run that downgraded a
# block to a report would mean a stray NOESAR_GUARD_DRY_RUN in the environment silently
# disabled the guard — the fail-open this whole file exists to prevent.
jq -n --arg r "$REASON" --arg d "$DEBT_TEXT" --arg m "$MODE_TAG" --arg c "$CLEANUP_NOTE" --argjson dry "$DRY_RUN" \
  '{decision:"block",reason:$r,continue:false,stopReason:$r,dryRun:$dry,verdict:"BLOCK",systemMessage:("session-close-guard " + $m + "BLOCKED this stop:\n" + $r + $d + $c)}'
