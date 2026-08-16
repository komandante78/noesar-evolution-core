#!/usr/bin/env sh
# NOESAR EVOLUTION — measured tooling-surface drift check (D-0470).
#
# Why this exists. CLAUDE10.md §19 rule 81 declares, as a measured fact, that this project
# has zero third-party MCP servers or marketplace plugins configured (no .mcp.json, no
# "plugins" key in .claude/settings.json). Rules 82-85 hinge on that being true: internal-use
# native tools are blanket-authorized, but a NEW third-party integration is explicitly a
# per-integration decision (rule 84), never a silent side effect of some later session adding
# a file. Nothing enforced that the declared fact stays true — a future .mcp.json could appear
# and no one would notice until it mattered. Same bug CLASS as F-HOOK-005 (D-0454/D-0455): a
# claim recorded once, never mechanically re-checked, going stale in silence.
#
# What this checks, and what it deliberately does not. This compares MEASURED reality
# (does .mcp.json exist; does settings.json have a "plugins" key) against a small,
# git-tracked baseline file (tooling-inventory-baseline.json) that a human edits in the SAME
# commit as any CLAUDE10.md §19 amendment naming a new integration. It does not parse §19's
# prose — English-text parsing is exactly the fragile approach hook-matcher-enums.sh's own
# comment already rejects for a similar reason. The baseline file is the single source of
# truth this checker trusts; §19 is the human-readable record of why it says what it says.
#
# Deliberately POSIX sh, not bash — sourced by state-digest.sh (`#!/usr/bin/env sh`) and by
# the bash test suite in this directory (a superset). No arrays, no `local`, no `$'...'`.
set -u

# tin_check_baseline ROOT
# Prints one "GAP:<flag>:declared=<x>,measured=<y>" line per mismatch between the baseline
# file and measured reality. Prints nothing and returns 0 when they agree, or when jq or the
# baseline file itself is unavailable (a caller that needs that distinction checks for jq
# first — this function's job is drift detection, not environment probing). Returns 1 if
# anything disagrees.
tin_check_baseline() {
  root="$1"
  baseline="$root/.claude/hooks/lib/tooling-inventory-baseline.json"
  command -v jq >/dev/null 2>&1 || return 0
  [ -f "$baseline" ] || return 0

  declared_mcp="$(jq -r '.mcp_json_present' "$baseline" 2>/dev/null)"
  declared_plugins="$(jq -r '.settings_plugins_key_present' "$baseline" 2>/dev/null)"

  if [ -f "$root/.mcp.json" ]; then measured_mcp=true; else measured_mcp=false; fi

  settings="$root/.claude/settings.json"
  if [ -f "$settings" ] && jq -e 'has("plugins")' "$settings" >/dev/null 2>&1; then
    measured_plugins=true
  else
    measured_plugins=false
  fi

  rc=0
  if [ "$declared_mcp" != "$measured_mcp" ]; then
    printf 'GAP:mcp_json_present:declared=%s,measured=%s\n' "$declared_mcp" "$measured_mcp"
    rc=1
  fi
  if [ "$declared_plugins" != "$measured_plugins" ]; then
    printf 'GAP:settings_plugins_key_present:declared=%s,measured=%s\n' \
      "$declared_plugins" "$measured_plugins"
    rc=1
  fi
  return "$rc"
}
