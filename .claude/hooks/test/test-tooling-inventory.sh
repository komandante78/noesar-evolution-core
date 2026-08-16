#!/usr/bin/env bash
# NOESAR EVOLUTION — fixture tests for lib/tooling-inventory.sh (D-0470).
#
# Proves the checker actually catches the bug class it exists for (an undeclared MCP server
# or plugin integration appearing in silence, the same CLASS as F-HOOK-005's silently-stale
# matcher), proves it stays quiet when reality matches the declared baseline, and proves it
# against the real repository state (currently: neither exists).
#
# No real container, no real session: pure function testing against synthetic root
# directories built under a scratch dir.
#
# Usage: ./test-tooling-inventory.sh   (exit 0 = all pass, exit 1 = a failure)
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$HERE/../lib/tooling-inventory.sh"
ROOT="$(cd "$HERE/../../.." && pwd)"

# shellcheck source=../lib/tooling-inventory.sh
. "$LIB"

G="$(mktemp -d /tmp/noesar-tooling-inventory-test.XXXXXX)"
trap 'rm -rf "$G"' EXIT

PASS=0; FAIL=0
ok()  { echo "  ok   - $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL - $1"; [ $# -gt 1 ] && printf '         %s\n' "$2"; FAIL=$((FAIL+1)); }

# fixture_root NAME BASELINE_MCP BASELINE_PLUGINS MEASURED_MCP MEASURED_PLUGINS
# Builds a synthetic project root with .claude/hooks/lib/tooling-inventory-baseline.json
# set to the two BASELINE_* flags, and .mcp.json / settings.json "plugins" key present or
# absent per the two MEASURED_* flags.
fixture_root() {
  r="$G/$1"
  mkdir -p "$r/.claude/hooks/lib"
  cat > "$r/.claude/hooks/lib/tooling-inventory-baseline.json" <<JSON
{"mcp_json_present": $2, "settings_plugins_key_present": $3}
JSON
  [ "$4" = "true" ] && : > "$r/.mcp.json"
  if [ "$5" = "true" ]; then
    printf '{"hooks":{},"permissions":{},"plugins":{}}' > "$r/.claude/settings.json"
  else
    printf '{"hooks":{},"permissions":{}}' > "$r/.claude/settings.json"
  fi
  printf '%s' "$r"
}

# --- 1. both declared absent, both measured absent: clean ---
R1="$(fixture_root clean false false false false)"
OUT="$(tin_check_baseline "$R1")"; RC=$?
[ "$RC" -eq 0 ] && [ -z "$OUT" ] && ok "declared-absent, measured-absent: rc=0, no GAP lines" \
                 || bad "declared-absent, measured-absent: rc=0, no GAP lines" "rc=$RC out=$OUT"

# --- 2. the bug class this exists for: an .mcp.json appears, undeclared ---
R2="$(fixture_root undeclared-mcp false false true false)"
OUT="$(tin_check_baseline "$R2")"; RC=$?
[ "$RC" -ne 0 ] && ok "undeclared .mcp.json is reported (rc=1)" \
                 || bad "undeclared .mcp.json is reported (rc=1)" "rc=$RC"
echo "$OUT" | grep -q '^GAP:mcp_json_present:declared=false,measured=true$' \
  && ok "the gap names exactly what changed: mcp_json_present false->true" \
  || bad "the gap names exactly what changed: mcp_json_present false->true" "$OUT"

# --- 3. same bug class, for a "plugins" key in settings.json ---
R3="$(fixture_root undeclared-plugins false false false true)"
OUT="$(tin_check_baseline "$R3")"; RC=$?
[ "$RC" -ne 0 ] && ok "undeclared settings.json plugins key is reported (rc=1)" \
                 || bad "undeclared settings.json plugins key is reported (rc=1)" "rc=$RC"
echo "$OUT" | grep -q '^GAP:settings_plugins_key_present:declared=false,measured=true$' \
  && ok "the gap names exactly what changed: settings_plugins_key_present false->true" \
  || bad "the gap names exactly what changed: settings_plugins_key_present false->true" "$OUT"

# --- 4. a legitimate, up-to-date baseline (both declared true, both measured true): clean ---
R4="$(fixture_root declared-and-present true true true true)"
OUT="$(tin_check_baseline "$R4")"; RC=$?
[ "$RC" -eq 0 ] && [ -z "$OUT" ] && ok "declared-present, measured-present: rc=0, no GAP lines" \
                 || bad "declared-present, measured-present: rc=0, no GAP lines" "rc=$RC out=$OUT"

# --- 5. reverse drift: baseline says present, reality says removed — also flagged ---
R5="$(fixture_root stale-baseline true false false false)"
OUT="$(tin_check_baseline "$R5")"; RC=$?
[ "$RC" -ne 0 ] && ok "stale baseline (declared-present, now absent) is reported (rc=1)" \
                 || bad "stale baseline (declared-present, now absent) is reported (rc=1)" "rc=$RC"
echo "$OUT" | grep -q '^GAP:mcp_json_present:declared=true,measured=false$' \
  && ok "the reverse-drift gap is also named precisely" \
  || bad "the reverse-drift gap is also named precisely" "$OUT"

# --- 6. the live, current repository is clean against its own real baseline ---
if [ -f "$ROOT/.claude/hooks/lib/tooling-inventory-baseline.json" ]; then
  OUT="$(tin_check_baseline "$ROOT")"; RC=$?
  [ "$RC" -eq 0 ] && [ -z "$OUT" ] && ok "the real repository has no undeclared tooling drift" \
                   || bad "the real repository has no undeclared tooling drift" "rc=$RC out=$OUT"
else
  ok "[SKIPPED, declared] live baseline file not found at $ROOT"
fi

echo
echo "================================================================"
echo "tooling-inventory fixture tests: $PASS passed, $FAIL failed"
echo "================================================================"
[ "$FAIL" -eq 0 ]
