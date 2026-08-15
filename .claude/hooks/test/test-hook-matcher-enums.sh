#!/usr/bin/env bash
# NOESAR EVOLUTION — fixture tests for lib/hook-matcher-enums.sh (D-0455).
#
# Proves the checker actually catches the bug class it exists for (F-HOOK-005: a matcher
# regex silently missing a value from its own event's documented enum), proves it stays
# quiet on a correct, deliberate SUBSET matcher (PreToolUse's tool-name allowlist), and
# proves it against the two real settings.json states this project has actually had:
# pre-D-0454 (missing "clear"), D-0454-only (missing "fork"), and the current file (clean).
#
# No real container, no real session: this is pure function testing against synthetic
# settings.json fixtures written to a scratch dir.
#
# Usage: ./test-hook-matcher-enums.sh   (exit 0 = all pass, exit 1 = a failure)
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$HERE/../lib/hook-matcher-enums.sh"
ROOT="$(cd "$HERE/../../.." && pwd)"

# shellcheck source=../lib/hook-matcher-enums.sh
. "$LIB"

G="$(mktemp -d /tmp/noesar-matcher-enum-test.XXXXXX)"
trap 'rm -rf "$G"' EXIT

PASS=0; FAIL=0
ok()  { echo "  ok   - $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL - $1"; [ $# -gt 1 ] && printf '         %s\n' "$2"; FAIL=$((FAIL+1)); }

write_settings() {
  # $1 = target path, $2 = SessionStart matcher, $3 = PreToolUse matcher
  cat > "$1" <<JSON
{"hooks":{"SessionStart":[{"matcher":"$2","hooks":[]}],"PreToolUse":[{"matcher":"$3","hooks":[]}]}}
JSON
}

# --- 1. the exact historical bug: pre-D-0454 matcher, missing clear AND fork ---
F1="$G/pre-d0454.json"
write_settings "$F1" "startup|resume|compact" "Bash|Read"
OUT="$(hme_check_settings "$F1")"; RC=$?
[ "$RC" -ne 0 ] && ok "pre-D-0454 matcher is reported as incomplete (rc=1)" \
                 || bad "pre-D-0454 matcher is reported as incomplete (rc=1)" "rc=$RC"
echo "$OUT" | grep -qx 'MISSING:SessionStart:clear' \
  && ok "the missing value is named: clear" \
  || bad "the missing value is named: clear" "$OUT"
echo "$OUT" | grep -qx 'MISSING:SessionStart:fork' \
  && ok "the missing value is named: fork" \
  || bad "the missing value is named: fork" "$OUT"

# --- 2. the residual gap this session found: clear present, fork still missing ---
F2="$G/d0454-only.json"
write_settings "$F2" "startup|resume|clear|compact" "Bash|Read"
OUT="$(hme_check_settings "$F2")"; RC=$?
[ "$RC" -ne 0 ] && ok "D-0454-only matcher (fork still missing) is reported as incomplete" \
                 || bad "D-0454-only matcher (fork still missing) is reported as incomplete" "rc=$RC"
echo "$OUT" | grep -qx 'MISSING:SessionStart:fork' \
  && ok "and only fork is named — clear is not a false positive" \
  || bad "and only fork is named — clear is not a false positive" "$OUT"
echo "$OUT" | grep -q 'MISSING:SessionStart:clear' \
  && bad "clear must NOT be reported missing (it is present)" "$OUT" \
  || ok "clear correctly not reported missing"

# --- 3. full coverage passes clean ---
F3="$G/full.json"
write_settings "$F3" "startup|resume|clear|compact|fork" "Bash|Read"
OUT="$(hme_check_settings "$F3")"; RC=$?
[ "$RC" -eq 0 ] && [ -z "$OUT" ] && ok "full SessionStart coverage: rc=0, no MISSING lines" \
                 || bad "full SessionStart coverage: rc=0, no MISSING lines" "rc=$RC out=$OUT"

# --- 4. PreToolUse's tool-name matcher is a deliberate SUBSET, never flagged ---
# Bash|Read is nowhere near "every tool" (Write, Edit, Agent, WebFetch... are absent on
# purpose) — this checker has no canonical enum for PreToolUse and must stay silent on it,
# or it becomes the exact false-positive class CLAUDE10.md warns against.
echo "$OUT" | grep -q 'PreToolUse' \
  && bad "PreToolUse (a tool-name allowlist, not an enum) must never be flagged" "$OUT" \
  || ok "PreToolUse correctly ignored — its matcher is an intentional subset, not an enum"

# --- 5. the live, current repository settings.json has full coverage ---
LIVE="$ROOT/.claude/settings.json"
if [ -f "$LIVE" ]; then
  OUT="$(hme_check_settings "$LIVE")"; RC=$?
  [ "$RC" -eq 0 ] && [ -z "$OUT" ] && ok "the repository's real settings.json has full matcher coverage" \
                   || bad "the repository's real settings.json has full matcher coverage" "rc=$RC out=$OUT"
else
  ok "[SKIPPED, declared] live settings.json not found at $LIVE"
fi

echo
echo "================================================================"
echo "hook-matcher-enums fixture tests: $PASS passed, $FAIL failed"
echo "================================================================"
[ "$FAIL" -eq 0 ]
