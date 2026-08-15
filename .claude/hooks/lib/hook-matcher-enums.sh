#!/usr/bin/env sh
# NOESAR EVOLUTION — canonical enum values for hook events whose `matcher` field
# partitions by a FIXED, DOCUMENTED enum of source/reason values (not by tool name).
#
# Why this exists (F-HOOK-005, D-0454). .claude/settings.json's SessionStart matcher was
# "startup|resume|compact" for three days: /clear fires SessionStart with source=="clear",
# a value the regex never covered, so a mid-session /clear silently skipped
# session-context.sh and no container baseline was ever written. The gap was invisible
# until it blocked a Stop. Building this fixed it once; this library exists so the SAME
# bug class — a matcher regex silently missing a value from its own event's enum — cannot
# recur unnoticed, in this hook or any other one this project adds later (D-0455).
#
# Source of the enums: https://code.claude.com/docs/en/hooks, verified 2026-08-15 against
# the live docs page (SessionStart's fifth value, "fork", was missing from the first
# fix — found only once this table was built from the documented enum rather than from
# memory of the incident).
#
# Deliberately narrow. Only hook events whose matcher is an EXHAUSTIVE, DOCUMENTED enum
# belong here. PreToolUse/PostToolUse/PermissionRequest/PermissionDenied match TOOL NAMES —
# an intentional, deliberate SUBSET (this project's destructive-command-guard only needs
# Bash|Read|Grep|Write|Edit, not every tool that exists) — including them here would make
# this checker fail loud on a correct scope decision, exactly the false-positive class
# CLAUDE10.md §40a names (SC1007, the 0o700 "too permissive" hit, the `must-not-leak`
# canary). A hook event is added below only when Claude Code documents it as a closed,
# small set of values a matcher is meant to fully partition.
#
# Deliberately POSIX sh, not bash: sourced both by state-digest.sh (`#!/usr/bin/env sh`,
# platform law CLAUDE10.md §60-64 — never presumes this host's `sh` is bash) and by the
# bash test suites in this directory, which are a superset of what this file uses. No
# process substitution, no `local`-array tricks, no `$'...'` quoting — a plain pipeline and
# `IFS` word-splitting only, portable to dash/ash as well as bash. Not exercised against a
# real dash on this host (none installed here) — declared UNVERIFIED on dash specifically,
# verified only under this host's bash-as-sh.
set -u

hme_canonical_enum() {
  case "$1" in
    SessionStart) printf 'startup resume clear compact fork' ;;
    SessionEnd)   printf 'clear resume logout prompt_input_exit bypass_permissions_disabled other' ;;
    *) return 1 ;;
  esac
}

# hme_check_matcher HOOK_NAME MATCHER_STRING
# Prints one "MISSING:<hook>:<value>" line per canonical value absent from MATCHER_STRING
# (a `|`-separated alternation, the shape every matcher in this project's settings.json
# uses). Prints nothing and returns 0 when the hook has no canonical enum here (nothing to
# check — e.g. a tool-name matcher) or coverage is complete. Returns 1 if anything is
# missing, so a caller can treat this as a plain pass/fail gate.
hme_check_matcher() {
  hook="$1"; matcher="${2:-}"
  enum="$(hme_canonical_enum "$hook" 2>/dev/null)" || return 0
  rc=0
  for val in $enum; do
    found=0
    oldifs="$IFS"; IFS='|'
    for alt in $matcher; do [ "$alt" = "$val" ] && found=1; done
    IFS="$oldifs"
    if [ "$found" -eq 0 ]; then
      printf 'MISSING:%s:%s\n' "$hook" "$val"
      rc=1
    fi
  done
  return "$rc"
}

# hme_check_settings SETTINGS_JSON_PATH
# Walks every hook block in a settings.json that DECLARES a matcher, and checks coverage
# for the ones this file has a canonical enum for. One "MISSING:<hook>:<value>" line per
# gap on stdout; nothing on full coverage. Silent success (not a failure) when jq or the
# file is unavailable — a caller that needs that distinction checks for jq itself first;
# this function's job is coverage, not environment probing.
#
# Implementation note: the tsv reader is the CONSUMING side of a pipeline, not a process
# substitution, so its exit status IS the pipeline's exit status (POSIX-portable) and the
# accumulated "did anything go missing" verdict can propagate through `exit` inside the
# subshell that the pipe already creates.
hme_check_settings() {
  settings="$1"
  [ -f "$settings" ] && command -v jq >/dev/null 2>&1 || return 0
  jq -r '
    .hooks // {} | to_entries[]
    | .key as $hook
    | .value[]? | select(has("matcher"))
    | [$hook, .matcher] | @tsv
  ' "$settings" 2>/dev/null | {
    any_missing=0
    while IFS="$(printf '\t')" read -r hook matcher; do
      [ -z "$hook" ] && continue
      hme_check_matcher "$hook" "$matcher" || any_missing=1
    done
    exit "$any_missing"
  }
}
