#!/usr/bin/env bash
# test-cache-cleanup.sh — proves cache_cleanup_removable() REFUSES before trusting that it
# permits. A guard that has only ever said yes has not been shown to work (CLAUDE10.md §40c).
#
# Everything runs against a disposable cache root under this repository's own temp: the real
# /mnt/cachec is never touched by this test, not even to read it.

set -uo pipefail
CDPATH= cd -- "$(dirname -- "$0")/.." || exit 1
ROOT="$(pwd)"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL  %s\n     -> %s\n' "$1" "${2:-}"; }

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/cache-cleanup-test.XXXXXX")"
trap 'rm -rf -- "$SANDBOX"' EXIT

export NOESAR_CACHE_ROOT="$SANDBOX"
# shellcheck source=tools/cache-cleanup.sh
. "$ROOT/tools/cache-cleanup.sh"

mkdir -p "$SANDBOX/DISPOSABLE" "$SANDBOX/NOESAR_EVOLUTION" "$SANDBOX/ATOM_MODEL" \
         "$SANDBOX/NOESAR/.tools/claude_tmp" "$SANDBOX/nested/inner"
printf 'keep me\n' > "$SANDBOX/NOESAR_EVOLUTION/canary.txt"
printf 'a file\n'  > "$SANDBOX/loose-file"
ln -s "$SANDBOX/NOESAR_EVOLUTION" "$SANDBOX/sneaky-link" 2>/dev/null

printf '\n=== 1 · it refuses ===\n'

refuses() { # <label> <name> <expected reason fragment>
  local out
  if out="$(cache_cleanup_removable "$2" 2>&1)"; then
    bad "$1" "PERMITTED, expected refusal: $out"
  elif printf '%s' "$out" | grep -qF "$3"; then
    ok "$1"
  else
    bad "$1" "refused for the wrong reason: $out"
  fi
}

refuses "a protected name (NOESAR_EVOLUTION)" NOESAR_EVOLUTION "protected list"
refuses "a protected name (ATOM_MODEL)"       ATOM_MODEL       "protected list"
refuses "NOESAR itself — it holds claude_home" NOESAR          "protected list"
refuses "a nested path"        "nested/inner"     "a name, not a path"
refuses "parent traversal"     ".."               'contains ".."'
refuses "traversal in a name"  "x/../NOESAR"      "a name, not a path"
refuses "a leading dash"       "-rf"              'begins with "-"'
refuses "an empty name"        ""                 "no name given"
refuses "a name that does not exist" "NOT_THERE"  "not an existing directory"
refuses "a plain file"         "loose-file"       "not an existing directory"
[ -L "$SANDBOX/sneaky-link" ] && refuses "a symlink" "sneaky-link" "is a symlink"

printf '\n=== 2 · it permits exactly what the exception covers ===\n'
if out="$(cache_cleanup_removable DISPOSABLE)"; then
  [ "$out" = "REMOVABLE $SANDBOX/DISPOSABLE" ] \
    && ok "a disposable directory is REMOVABLE, with its absolute path" \
    || bad "verdict text" "$out"
else
  bad "a disposable directory is permitted" "$out"
fi

printf '\n=== 3 · removal happens, and only there ===\n'
cache_cleanup_remove DISPOSABLE > "$SANDBOX/.out" 2>&1
grep -q "^REMOVED $SANDBOX/DISPOSABLE$" "$SANDBOX/.out" \
  && ok "the target is reported REMOVED" || bad "REMOVED line" "$(cat "$SANDBOX/.out")"
[ -d "$SANDBOX/DISPOSABLE" ] && bad "the target is gone" "it is still there" \
  || ok "the target is gone"
[ -f "$SANDBOX/NOESAR_EVOLUTION/canary.txt" ] \
  && ok "the protected neighbour is untouched" || bad "protected neighbour" "canary lost"

printf '\n=== 4 · one bad name does not drop the rest of a recorded decision ===\n'
mkdir -p "$SANDBOX/D1" "$SANDBOX/D2"
cache_cleanup_remove D1 NOESAR_EVOLUTION D2 > "$SANDBOX/.out2" 2>&1
if [ ! -d "$SANDBOX/D1" ] && [ ! -d "$SANDBOX/D2" ] \
   && grep -q "^REFUSED NOESAR_EVOLUTION" "$SANDBOX/.out2" \
   && [ -d "$SANDBOX/NOESAR_EVOLUTION" ]; then
  ok "D1 and D2 removed, the protected name refused, the run did not abort"
else
  bad "mixed batch" "$(cat "$SANDBOX/.out2")"
fi

printf '\n=== 5 · claude_tmp is emptied, not removed ===\n'
mkdir -p "$SANDBOX/NOESAR/.tools/claude_tmp/junk-a" "$SANDBOX/NOESAR/.tools/claude_tmp/junk-b"
NOESAR_CLAUDE_TMP="$SANDBOX/NOESAR/.tools/claude_tmp" cache_cleanup_empty_tmp > "$SANDBOX/.out3" 2>&1
if [ -d "$SANDBOX/NOESAR/.tools/claude_tmp" ] \
   && [ -z "$(ls -A "$SANDBOX/NOESAR/.tools/claude_tmp")" ]; then
  ok "contents gone, the directory itself survives"
else
  bad "claude_tmp emptying" "$(cat "$SANDBOX/.out3")"
fi
out="$(NOESAR_CLAUDE_TMP="$SANDBOX/NOESAR/.tools" cache_cleanup_empty_tmp 2>&1)" || true
printf '%s' "$out" | grep -qF "only a directory named claude_tmp" \
  && ok "a directory that is not claude_tmp is refused" || bad "tmp name guard" "$out"

printf '\n=== summary ===\n  pass=%s fail=%s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
