#!/usr/bin/env bash
# cache-cleanup.sh — the ONE mechanism authorised by CLAUDE10.md rule 12's fourth named
# exception (D-0680, Owner 2026-08-24) to remove a superseded project directory under the
# host cache root, and to empty Claude Code's own throwaway temp.
#
# Why a tool instead of an `rm`. Rule 12's other exceptions learned this already: an ad-hoc
# recursive removal carries its safety in the operator's attention, and attention is not a
# mechanism. The decision function below carries it instead — it is pure, it is unit-tested by
# tools/test-cache-cleanup.sh, and the destructive-command guard denies the ad-hoc form outright.
#
# This tool grants nothing. Every name it acts on must already be recorded in
# docs/DECISION_LOG.md by the phase that decided it. Passing a name here is carrying out a
# recorded decision, never taking one.
#
# Portability (CLAUDE10.md §16): the cache root is a parameter, never a presumed path. Nothing
# here presumes this host, this filesystem or this operating system beyond POSIX + bash.

# Shell options are set only when this file is EXECUTED, never when it is sourced. A library
# that turns on `set -e` in its caller makes every non-zero return of its own functions fatal
# for code that merely wanted to ask a question — which is what a decision function does. Found
# by tools/test-cache-cleanup.sh §4: sourcing killed the test at the first REFUSED verdict.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then set -euo pipefail; fi

CACHE_ROOT="${NOESAR_CACHE_ROOT:-/mnt/cachec}"

# Never removed, whatever is asked. Kept as a literal list rather than a pattern: a pattern that
# is wrong is wrong silently, a missing name here is visible. NOESAR is on this list because it
# holds .tools/claude_home — this project's own memory, history and configuration.
CACHE_CLEANUP_PROTECTED="
NOESAR
NOESAR_EVOLUTION
NOESAR_EVOLUTION_ARTIFACTS
NOESAR_EVOLUTION_BACKUPS
NOESAR_EVOLUTION_CANONICAL_V1
NOESAR_EVOLUTION_RUNTIME
NOESAR_EVOLUTION_SHADOWS
NOESAR_EVOLUTION_STAGING
ATOM
ATOM_EVOLUTION
ATOM_INTERNAL
ATOM_MODEL
NOESAR-ATOM-PRIVATE
"

# cache_cleanup_removable <name> -> 0 and prints "REMOVABLE <abs path>"
#                                   1 and prints "REFUSED <name>: <reason>"
# Pure: it decides, it never removes. Every refusal names its reason so a caller cannot report
# "nothing happened" for two different causes.
cache_cleanup_removable() {
  local name="${1-}"
  local root="${NOESAR_CACHE_ROOT:-$CACHE_ROOT}"

  if [ -z "$name" ]; then
    printf 'REFUSED <empty>: no name given\n'; return 1
  fi
  case "$name" in
    */*)   printf 'REFUSED %s: a name, not a path — nothing nested is reachable\n' "$name"; return 1 ;;
    *..*)  printf 'REFUSED %s: contains ".."\n' "$name"; return 1 ;;
    -*)    printf 'REFUSED %s: begins with "-"\n' "$name"; return 1 ;;
    .|..)  printf 'REFUSED %s: refers to a directory itself\n' "$name"; return 1 ;;
  esac

  local prot
  while IFS= read -r prot; do
    [ -z "$prot" ] && continue
    if [ "$name" = "$prot" ]; then
      printf 'REFUSED %s: on the protected list of CLAUDE10.md rule 12 exception E4\n' "$name"
      return 1
    fi
  done <<< "$CACHE_CLEANUP_PROTECTED"

  local path="$root/$name"
  if [ "$(dirname "$path")" != "$root" ]; then
    printf 'REFUSED %s: not directly under %s\n' "$name" "$root"; return 1
  fi
  if [ -L "$path" ]; then
    printf 'REFUSED %s: is a symlink — removing it would act on its target\n' "$name"; return 1
  fi
  if [ ! -d "$path" ]; then
    printf 'REFUSED %s: not an existing directory\n' "$name"; return 1
  fi

  printf 'REMOVABLE %s\n' "$path"
  return 0
}

# cache_cleanup_remove <name>... — applies the decision above to each name, in order.
# Refusals do not abort the run: each name is judged and reported on its own, so one bad name
# cannot silently drop the rest of a recorded decision.
cache_cleanup_remove() {
  local name verdict path rc=0
  for name in "$@"; do
    if verdict="$(cache_cleanup_removable "$name")"; then
      path="${verdict#REMOVABLE }"
      if rm -rf -- "$path"; then
        printf 'REMOVED %s\n' "$path"
      else
        printf 'FAILED %s\n' "$path"; rc=1
      fi
    else
      printf '%s\n' "$verdict"; rc=1
    fi
  done
  return "$rc"
}

# cache_cleanup_empty_tmp — empties Claude Code's throwaway temp (exception E4, allowance b).
# The directory itself survives; only its contents go. A glob is avoided deliberately: this
# directory has held ~296k entries, which overflows ARG_MAX.
cache_cleanup_empty_tmp() {
  local tmp="${NOESAR_CLAUDE_TMP:-$CACHE_ROOT/NOESAR/.tools/claude_tmp}"
  if [ ! -d "$tmp" ]; then
    printf 'SKIP %s: not an existing directory\n' "$tmp"; return 1
  fi
  case "$tmp" in
    */claude_tmp) ;;
    *) printf 'REFUSED %s: only a directory named claude_tmp may be emptied here\n' "$tmp"; return 1 ;;
  esac
  find "$tmp" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  printf 'EMPTIED %s (%s entries remain)\n' "$tmp" "$(find "$tmp" -mindepth 1 -maxdepth 1 | grep -c . || true)"
}

# Sourced by the test; executed by a phase carrying out a recorded decision.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  if [ "$#" -eq 0 ]; then
    printf 'usage: %s <directory-name>...\n' "$0" >&2
    printf 'names must already be recorded in docs/DECISION_LOG.md; this tool decides nothing.\n' >&2
    exit 2
  fi
  cache_cleanup_remove "$@"
fi
