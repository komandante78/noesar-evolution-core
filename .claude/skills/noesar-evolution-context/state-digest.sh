#!/usr/bin/env sh
# NOESAR EVOLUTION — state digest.
#
# Why this exists: reading the mandated state files in full costs roughly 400 KB
# (~100k tokens) before a single line of work is done — PROJECT_STATE.json alone is
# 80 KB across ~120 top-level keys, DECISION_LOG.md is 160 KB, INSTALLATION_LEDGER.md
# is 116 KB. Almost all of it is history that a phase does not need. This prints the
# ~60 lines that a cold session actually needs, and tells you where to look for the
# rest instead of loading it.
#
# It reports only. It mutates nothing, starts nothing, and touches no container.
set -u
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
# Guarded on purpose: this script does not use `set -e`, so an unguarded failed cd
# would let every section below report on whatever directory the caller was in.
cd "$ROOT" || { printf '%s\n' "FATAL: cannot enter project root: $ROOT" >&2; exit 1; }

STATE=PROJECT_STATE.json
[ -f "$STATE" ] || { printf '%s\n' "FATAL: $STATE not found — wrong root: $ROOT" >&2; exit 1; }

printf '===== NOESAR EVOLUTION — STATE DIGEST =====\n'
printf 'root      : %s\n' "$ROOT"
printf 'generated : %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

printf '\n----- GIT -----\n'
printf 'branch    : %s\n' "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '[no git]')"
printf 'head      : %s\n' "$(git log -1 --format='%h %s' 2>/dev/null | cut -c1-100 || echo '-')"
printf 'dirty     : %s file(s) modified/untracked\n' "$(git status --porcelain 2>/dev/null | wc -l)"
printf 'remote    : %s\n' "$(git remote -v 2>/dev/null | head -1 || echo 'NONE (B-001)')"

printf '\n----- PHASE (PROJECT_STATE.json) -----\n'
jq -r '
  "current_phase   : \(.current_phase)",
  "phase_status    : \(.phase_status // "-" | .[0:160])",
  "next_phase      : \(.next_phase // "-" | .[0:160])",
  "last_commit     : \(.last_commit // "-" | .[0:100])",
  "last_updated    : \(.last_updated_utc // "-")",
  "plan_of_record  : \(.plan_of_record // "-" | .[0:120])"
' "$STATE"

printf '\nnext_action (verbatim, truncated to 600 chars):\n'
jq -r '.next_action // "-" | .[0:600]' "$STATE"

printf '\n----- BLOCKERS -----\n'
jq -r 'if (.blockers|length) == 0 then "none" else
  .blockers[] | "  [\(.severity // "?")] \(.id // "?") — \(.summary // .code // "?" | .[0:150])"
end' "$STATE"

printf '\n----- OPEN FINDINGS -----\n'
jq -r 'if (.open_findings // [] | length) == 0 then "  none" else
  (.open_findings[] | "  [\(.severity // "?")] \(.id // "?") \(.status // "") — \(.summary // "" | .[0:120])")
end' "$STATE"

printf '\n----- DEFERRED (count only; read the key if the phase touches them) -----\n'
printf '  deferred_items: %s\n' "$(jq -r '.deferred_items // [] | length' "$STATE")"

printf '\n----- TEST SUITE AS DECLARED IN STATE -----\n'
printf '  ⚠ these are DECLARATIONS recorded by a past phase, NOT a measurement taken now.\n'
printf '     Verify before quoting them. They have been stale before.\n'
jq -r '.product_test_suite // {} | to_entries[] | "  \(.key): \(.value)"' "$STATE"

printf '\n----- LAST DECISIONS (docs/DECISION_LOG.md, newest last) -----\n'
grep -n '^## D-0' docs/DECISION_LOG.md 2>/dev/null | tail -4 | sed 's/^/  /'
printf '  (file is %s lines — read only the tail range you need)\n' "$(wc -l < docs/DECISION_LOG.md 2>/dev/null || echo '?')"

printf '\n----- LAST INSTALLATION (docs/INSTALLATION_LEDGER.md, newest last) -----\n'
grep -n '^## ' docs/INSTALLATION_LEDGER.md 2>/dev/null | tail -2 | sed 's/^/  /'
printf '  (file is %s lines — read only the last entry)\n' "$(wc -l < docs/INSTALLATION_LEDGER.md 2>/dev/null || echo '?')"

printf '\n----- HANDOFF MAP (docs/SESSION_HANDOFF.md — read this one, by offset) -----\n'
grep -n '^#\{1,3\} ' docs/SESSION_HANDOFF.md 2>/dev/null | sed 's/^/  /'

printf '\n----- PROJECT CONTAINERS (read-only; §5a allows exactly two at phase close) -----\n'
if command -v docker >/dev/null 2>&1; then
  docker ps -a --filter 'name=noesar-evolution' \
    --format '  {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null || printf '  [docker query failed]\n'
  printf '  project containers: %s\n' "$(docker ps -a --filter 'name=noesar-evolution' -q 2>/dev/null | wc -l)"
else
  printf '  [docker not available on this host]\n'
fi

printf '\n===== END DIGEST — do NOT bulk-read the capped files; see the context skill =====\n'
