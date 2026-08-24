#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Does the guard still enforce the rule it claims to enforce? (D-0511)
#
# `CLAUDE10.md` §4 rule 12 forbids deletion and names its exceptions in prose;
# `.claude/hooks/destructive-command-guard.sh` is the program that enforces it. On 2026-08-17 the
# two had drifted: rule 12 carried a **third** named exception — the e2e probe's own run
# directories, outside `PROJECT_ROOT`, irreversible — that the guard had never heard of. The guard
# denied what the authority permitted, with a reason stating a rule the authority no longer states
# flatly. Nobody had done anything wrong; there was simply no mechanism by which an amendment to
# the authority could reach its executor.
#
# This suite is that mechanism. The exceptions live ONCE, in `lib/rule12-exceptions.json`; the
# guard reads that file; and the checks below fail when the file and `CLAUDE10.md` stop agreeing —
# whether because the Owner amends rule 12, or because someone edits the JSON, or because a path
# is hardcoded back into the guard.
#
# Three groups, and the third is the one that makes the first two trustworthy:
#   1. STRUCTURE   the source is well-formed, and the guard consumes it instead of copying it
#   2. ALIGNMENT   every entry traces back to rule 12's own text, and the counts agree
#   3. ORACLE      the alignment checks are shown to FAIL on a deliberately divergent fixture,
#                  because a check that has never gone red has not been shown to work
#   4. BEHAVIOUR   the guard's decisions on the real matrix, in both directions
#
# Usage: ./test-rule12-exceptions.sh   (exit 0 = all pass, exit 1 = a failure)
# Needs: bash, jq, awk. No network, no Docker, no container, mutates nothing outside its TMPDIR.
set -u

HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$(CDPATH= cd -- "$HERE/../../.." && pwd)"
GUARD="$HERE/../destructive-command-guard.sh"
SOURCE_JSON="$HERE/../lib/rule12-exceptions.json"
AUTHORITY="$ROOT/CLAUDE10.md"

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n       %s\n' "$1" "${2:-}"; }

TMPDIR="$(mktemp -d)"
cleanup() { [ -n "${TMPDIR:-}" ] && [ -d "$TMPDIR" ] && rm -r -- "$TMPDIR" 2>/dev/null || true; }
trap cleanup EXIT

for dep in jq awk; do
  command -v "$dep" >/dev/null 2>&1 || { printf 'UNAVAILABLE: %s is required by this suite\n' "$dep"; exit 1; }
done

# --- the alignment checks, as functions over (authority text, source json) --------------------
# Written this way for exactly one reason: group 3 can then run them against a FIXTURE that is
# known to diverge, and assert that they say so. A check only reachable through the real files
# can never be shown to fail.

# r12_block <authority file> <json> -> the text of rule 12 alone, on stdout
r12_block() {
  local open close
  open="$(jq -r '.authority.rule_opens_with' "$2")"
  close="$(jq -r '.authority.rule_ends_before' "$2")"
  awk -v o="$open" -v c="$close" 'index($0, o) { f = 1 } f && index($0, c) { exit } f' "$1"
}

# r12_check_count <block file> <json> -> "OK" | "DIVERGE …"
# The authority marks each exception with the phrase "named exception". More phrases than entries
# means the Owner amended rule 12 and the source was not updated — the exact drift of 2026-08-17.
r12_check_count() {
  local in_text in_json
  in_text="$(grep -o -i 'named exception' "$1" | grep -c .)"
  in_json="$(jq '.exceptions | length' "$2")"
  if [ "$in_text" = "$in_json" ]; then printf 'OK\n'; else
    printf 'DIVERGE rule 12 names %s exception(s), the source records %s\n' "$in_text" "$in_json"
  fi
}

# r12_check_anchors <block file> <json> -> "OK" | "DIVERGE …" (one line per divergence)
# Every entry must be traceable to the authority's own words: its ordinal marker, its quote, and —
# where the exception is mechanical — the file and function the authority names as the only way in.
r12_check_anchors() {
  local out="" marker quote impl fn
  while IFS=$'\t' read -r id marker quote impl fn; do
    [ -n "$id" ] || continue
    grep -qF "$marker" "$1" || out="${out}DIVERGE $id: marker '$marker' is not in rule 12
"
    grep -qF "$quote" "$1" || out="${out}DIVERGE $id: quote '$quote' is not in rule 12
"
    if [ -n "$impl" ] && [ "$impl" != "null" ]; then
      grep -qF "$impl" "$1" || out="${out}DIVERGE $id: mechanism file '$impl' is not named in rule 12
"
    fi
    if [ -n "$fn" ] && [ "$fn" != "null" ]; then
      grep -qF "$fn" "$1" || out="${out}DIVERGE $id: mechanism function '$fn' is not named in rule 12
"
    fi
  done <<< "$(jq -r '.exceptions[] | [ .id, .authority_marker, .authority_quote,
                                       (.mechanism.implementation // ""), (.mechanism.function // "") ] | @tsv' "$2")"
  if [ -z "$out" ]; then printf 'OK\n'; else printf '%s' "$out"; fi
}

# guard_decision <command> -> allow | deny | ask
guard_decision() {
  jq -n --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | "$GUARD" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecision // "allow"'
}
guard_reason() {
  jq -n --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}' \
    | "$GUARD" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecisionReason // ""'
}
assert_decision() { # $1=cmd $2=want $3=desc
  local got; got="$(guard_decision "$1")"
  if [ "$got" = "$2" ]; then ok "$3"; else bad "$3" "wanted $2, got $got — for: $1"; fi
}

printf '=== 1 · structure — one source, consumed and not copied ===\n'

if jq -e '.exceptions | type == "array" and length > 0' "$SOURCE_JSON" >/dev/null 2>&1; then
  ok "the source file parses and carries a non-empty exceptions array"
else
  bad "the source file parses and carries a non-empty exceptions array" "$SOURCE_JSON"
fi

MISSING="$(jq -r '[ .exceptions[] | select((.id | not) or (.authority_marker | not) or (.authority_quote | not)
                    or (.recoverable | type != "boolean") or (.mechanism.summary | not)) | .id // "<no id>" ] | join(",")' "$SOURCE_JSON")"
if [ -z "$MISSING" ]; then ok "every entry declares id, marker, quote, recoverability and mechanism"
else bad "every entry declares id, marker, quote, recoverability and mechanism" "incomplete: $MISSING"; fi

if grep -qF 'rule12-exceptions.json' "$GUARD"; then
  ok "the guard reads the single source"
else
  bad "the guard reads the single source" "no reference to rule12-exceptions.json in $GUARD"
fi

# The point of a single source is that the second copy does not exist. These two assertions are
# what stops the next repair from quietly hardcoding the path or the pattern back into the guard.
# Comment lines are excluded on purpose: the guard's own comments narrate the defect that led here
# (a sibling path named /mnt/…_ARTIFACTS), and prose that explains a decision is not a second copy
# of it. What must not exist is a path or a pattern the guard would ACT on.
GUARD_CODE="$TMPDIR/guard-code.sh"
grep -v '^[[:space:]]*#' "$GUARD" > "$GUARD_CODE"
if [ "$(grep -cF 'NOESAR_EVOLUTION_ARTIFACTS' "$GUARD_CODE")" = "0" ]; then
  ok "the guard's code hardcodes no artifact root — it resolves it from the source"
else
  bad "the guard's code hardcodes no artifact root" "$(grep -nF 'NOESAR_EVOLUTION_ARTIFACTS' "$GUARD_CODE" | head -3)"
fi
if [ "$(grep -cE '\[0-9\]\{8\}T\[0-9\]\{6\}Z' "$GUARD_CODE")" = "0" ]; then
  ok "the guard's code hardcodes no run-stamp pattern — it resolves it from the source"
else
  bad "the guard's code hardcodes no run-stamp pattern" "$(grep -nE '\[0-9\]\{8\}T' "$GUARD_CODE" | head -3)"
fi

# A mechanism the authority names must exist, and must actually define what it claims to define.
while IFS=$'\t' read -r id impl fn; do
  [ -n "$id" ] || continue
  [ "$impl" = "" ] || [ "$impl" = "null" ] && continue
  if [ -r "$ROOT/$impl" ]; then ok "$id: mechanism file exists ($impl)"
  else bad "$id: mechanism file exists ($impl)" "not readable at $ROOT/$impl"; fi
  if grep -qE "^[[:space:]]*${fn}\(\)" "$ROOT/$impl" 2>/dev/null; then
    ok "$id: $impl defines ${fn}()"
  else
    bad "$id: $impl defines ${fn}()" "function not found"
  fi
done <<< "$(jq -r '.exceptions[] | [ .id, (.mechanism.implementation // ""), (.mechanism.function // "") ] | @tsv' "$SOURCE_JSON")"

while IFS=$'\t' read -r id caller; do
  [ -n "$caller" ] || continue
  if [ -r "$ROOT/$caller" ]; then ok "$id: authorised caller exists ($caller)"
  else bad "$id: authorised caller exists ($caller)" "not readable at $ROOT/$caller"; fi
done <<< "$(jq -r '.exceptions[] as $e | $e.mechanism.callers[]? | [ $e.id, . ] | @tsv' "$SOURCE_JSON")"

printf '\n=== 2 · alignment — every entry traces back to CLAUDE10.md rule 12 ===\n'

BLOCK="$TMPDIR/rule12.txt"
r12_block "$AUTHORITY" "$SOURCE_JSON" > "$BLOCK"
if [ -s "$BLOCK" ]; then ok "rule 12 is locatable in $AUTHORITY ($(grep -c . "$BLOCK") lines)"
else bad "rule 12 is locatable in $AUTHORITY" "empty block — the opening/closing anchors no longer match"; fi

RES="$(r12_check_count "$BLOCK" "$SOURCE_JSON")"
if [ "$RES" = "OK" ]; then ok "the number of named exceptions in rule 12 equals the number in the source"
else bad "the number of named exceptions in rule 12 equals the number in the source" "$RES"; fi

RES="$(r12_check_anchors "$BLOCK" "$SOURCE_JSON")"
if [ "$RES" = "OK" ]; then ok "every entry's marker, quote and named mechanism appear in rule 12"
else bad "every entry's marker, quote and named mechanism appear in rule 12" "$RES"; fi

# Recoverability is not decoration: it is what the guard prints when it refuses, and the reason a
# reader can tell "removed from the working tree" from "gone". Rule 12 says so in its own words.
N_IRREV="$(jq -r '[ .exceptions[] | select(.recoverable == false) ] | length' "$SOURCE_JSON")"
if [ "$N_IRREV" -ge 1 ]; then
  ok "at least one exception is recorded as irreversible ($N_IRREV)"
else
  bad "at least one exception is recorded as irreversible" "$(jq -c '[ .exceptions[] | {id, recoverable} ]' "$SOURCE_JSON")"
fi
# Flattened, because the authority is prose wrapped at 90 columns: the phrase this looks for is
# split across two lines in the real file ("this content is **not**\n    recoverable"). A check
# that only works when a sentence happens not to wrap is a check that reports on formatting.
BLOCK_FLAT="$TMPDIR/rule12-flat.txt"
tr -s '[:space:]' ' ' < "$BLOCK" > "$BLOCK_FLAT"
# The counts must AGREE, not merely both be positive. This check used to hardcode "exactly one",
# which was true only while E3 was the only irreversible exception; when E4 arrived on 2026-08-24
# it went red for a correct amendment — reporting drift where there was none, the same class of
# false signal D-0511 repaired. What the rule actually needs is that the source and the prose name
# the SAME number of irreversible exceptions, so neither can gain one silently.
N_DECLARED="$(grep -o 'not\*\* recoverable' "$BLOCK_FLAT" | grep -c . || true)"
if [ "$N_DECLARED" = "$N_IRREV" ]; then
  ok "rule 12 itself declares every irreversible exception as such ($N_DECLARED of $N_IRREV)"
else
  bad "rule 12 itself declares every irreversible exception as such" \
      "prose declares $N_DECLARED, the source records $N_IRREV"
fi

printf '\n=== 3 · oracle — the alignment checks are shown to go RED ===\n'
# A check that has never failed has not been shown to work. Each fixture below diverges in ONE
# way, and the corresponding check must say so. If any of these reports OK, groups 1-2 above prove
# nothing at all.

FIX_TEXT="$TMPDIR/authority-plus-one.txt"
{ cat "$BLOCK"; printf '    **Fourth named exception**, invented by this test: nothing at all.\n'; } > "$FIX_TEXT"
RES="$(r12_check_count "$FIX_TEXT" "$SOURCE_JSON")"
case "$RES" in
  DIVERGE*) ok "a fourth named exception added to the authority is detected (count check goes red)" ;;
  *) bad "a fourth named exception added to the authority is detected" "got: $RES" ;;
esac

FIX_JSON="$TMPDIR/source-minus-one.json"
jq '.exceptions |= .[0:2]' "$SOURCE_JSON" > "$FIX_JSON"
RES="$(r12_check_count "$BLOCK" "$FIX_JSON")"
case "$RES" in
  DIVERGE*) ok "an exception dropped from the source is detected (count check goes red)" ;;
  *) bad "an exception dropped from the source is detected" "got: $RES" ;;
esac

FIX_JSON2="$TMPDIR/source-bad-quote.json"
jq '.exceptions[2].authority_quote = "a phrase CLAUDE10.md does not contain"' "$SOURCE_JSON" > "$FIX_JSON2"
RES="$(r12_check_anchors "$BLOCK" "$FIX_JSON2")"
case "$RES" in
  *DIVERGE*) ok "a quote that is no longer in rule 12 is detected (anchor check goes red)" ;;
  *) bad "a quote that is no longer in rule 12 is detected" "got: $RES" ;;
esac

FIX_JSON3="$TMPDIR/source-bad-mechanism.json"
jq '.exceptions[2].mechanism.function = "e2e_retention_invented"' "$SOURCE_JSON" > "$FIX_JSON3"
RES="$(r12_check_anchors "$BLOCK" "$FIX_JSON3")"
case "$RES" in
  *DIVERGE*) ok "a mechanism the authority does not name is detected (anchor check goes red)" ;;
  *) bad "a mechanism the authority does not name is detected" "got: $RES" ;;
esac

FIX_TEXT2="$TMPDIR/authority-without-third.txt"
grep -v 'Third named exception' "$BLOCK" > "$FIX_TEXT2"
RES="$(r12_check_anchors "$FIX_TEXT2" "$SOURCE_JSON")"
case "$RES" in
  *DIVERGE*) ok "an exception removed from the authority is detected (anchor check goes red)" ;;
  *) bad "an exception removed from the authority is detected" "got: $RES" ;;
esac

printf '\n=== 4 · behaviour — what the guard decides, in both directions ===\n'
E2E_ROOT="$(jq -r '.exceptions[] | select(.id == "E3-e2e-run-directories") | .filesystem_roots[0]
                   | (.default + .suffix)' "$SOURCE_JSON")"
STAMP=20260817T113556Z

# --- the exception is recognised, and never as a silent allow ---
assert_decision "rm $E2E_ROOT/$STAMP" ask \
  "a run directory rule 12 covers reaches the Owner as a question, not a flat refusal"
assert_decision "rm -rf $E2E_ROOT/$STAMP" deny \
  "recursive+force on the same path is still DENIED — the exception is not a licence for rm -rf"

REASON="$(guard_reason "rm $E2E_ROOT/$STAMP")"
for needle in 'E3-e2e-run-directories' 'IRREVERSIBLE' 'e2e_retention_prunable()'; do
  case "$REASON" in
    *"$needle"*) ok "the question names '$needle'" ;;
    *) bad "the question names '$needle'" "reason was: $REASON" ;;
  esac
done
REASON="$(guard_reason "rm -rf $E2E_ROOT/$STAMP")"
case "$REASON" in
  *E3-e2e-run-directories*e2e_retention_prunable*) ok "the refusal names the exception AND the only authorised mechanism" ;;
  *) bad "the refusal names the exception AND the only authorised mechanism" "reason was: $REASON" ;;
esac

# --- the exception is NARROW: everything one step outside it still denies ---
assert_decision "rm $E2E_ROOT" deny \
  "the artifact root ITSELF is not covered — only a run directory under it is"
assert_decision "rm $E2E_ROOT/not-a-run" deny \
  "a directory whose name is not a run stamp is not covered"
assert_decision "rm $E2E_ROOT/$STAMP/workspace" deny \
  "a path nested INSIDE a run directory is not covered — one level only"
assert_decision "rm $E2E_ROOT/../../etc/passwd" deny \
  "a traversal that lands elsewhere is never covered"
assert_decision "rm /etc/hosts" deny \
  "an unrelated path outside PROJECT_ROOT still denies"

# --- F-HOOK-007: a prefix is not a path ---
# Found 2026-08-17 driving this very matrix. `case $OP in "$PROJECT_ROOT"*)` treated the SIBLING
# path /mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS as being inside the repository, because its name
# starts with the root's. Every rm under it — 7.3 GB of e2e workspaces, outside git, outside any
# archive — was silently allowed. Both directions are asserted.
PR="$(grep -m1 '^PROJECT_ROOT=' "$GUARD" | cut -d'"' -f2)"
assert_decision "rm ${PR}_ARTIFACTS/e2e/nothing-here" deny \
  "F-HOOK-007: a sibling whose NAME starts with PROJECT_ROOT is not inside PROJECT_ROOT"
assert_decision "rm $PR/BUILD_TMP/x" allow \
  "F-HOOK-007: a genuine path inside PROJECT_ROOT is still allowed"
assert_decision "rm $PR" allow \
  "F-HOOK-007: the project root itself is still treated as inside the project root"

# --- F-HOOK-006: a separator inside quotes is not a separator ---
# The exact command denied live on 2026-08-17 while reading the runner: the `\|` inside the quoted
# regex became a segment boundary and the text after it became a command word with flags.
assert_decision 'grep -nE "RETAIN\|rm -rf" tools/run-browser-e2e.sh' allow \
  "F-HOOK-006: a quoted alternation containing 'rm -rf' is a search, not a removal"
assert_decision "grep -n 'a;rm -rf /x' file.txt" allow \
  "F-HOOK-006: a quoted semicolon does not start a new command"
assert_decision 'rm -rf /tmp/x' deny \
  "F-HOOK-006: an UNQUOTED recursive+force removal is still denied"
assert_decision 'grep -n "a\|b" f && rm -rf /tmp/x' deny \
  "F-HOOK-006: masking quoted separators does not hide a real one outside them"
assert_decision 'cat f | rm -rf /tmp/x' deny \
  "F-HOOK-006: an unquoted pipe still separates, and the second segment is still judged"

# --- the source is the authority: no source, no exception ---
# Fail-safe direction, stated as a test rather than as a comment. An unreadable source must make
# the guard STRICTER, never more permissive, and it must say so.
for src in "$TMPDIR/does-not-exist.json" /dev/null; do
  OUT="$(jq -n --arg c "rm $E2E_ROOT/$STAMP" '{tool_name:"Bash",tool_input:{command:$c}}' \
        | NOESAR_RULE12_SOURCE="$src" "$GUARD" 2>/dev/null)"
  DEC="$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // "allow"')"
  RSN="$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // ""')"
  if [ "$DEC" = "deny" ]; then ok "an unreadable source ($src) denies rather than assuming an exception"
  else bad "an unreadable source ($src) denies rather than assuming an exception" "got $DEC"; fi
  case "$RSN" in
    *"strictest reading applied"*) ok "the fallback is DECLARED in the reason, not silent ($src)" ;;
    *) bad "the fallback is DECLARED in the reason, not silent ($src)" "reason was: $RSN" ;;
  esac
done

# --- the root is configuration, not this host ---
# CLAUDE10.md §16 rule 62: nothing may presume this host's paths. The exception root comes from
# NOESAR_ARTIFACT_ROOT when set, exactly as tools/run-browser-e2e.sh resolves it, and the default
# in the source file is only that — a default.
OUT="$(jq -n '{tool_name:"Bash",tool_input:{command:"rm /srv/probe-artifacts/e2e/20260817T113556Z"}}' \
      | NOESAR_ARTIFACT_ROOT=/srv/probe-artifacts "$GUARD" 2>/dev/null \
      | jq -r '.hookSpecificOutput.permissionDecision // "allow"')"
if [ "$OUT" = "ask" ]; then ok "a relocated artifact root (NOESAR_ARTIFACT_ROOT) is recognised"
else bad "a relocated artifact root (NOESAR_ARTIFACT_ROOT) is recognised" "got $OUT"; fi
assert_decision "rm /srv/probe-artifacts/e2e/$STAMP" deny \
  "the same path is NOT an exception when the environment does not point there"

# --- nothing else about the guard moved ---
# --- F-HOOK-009: find that removes is a removal, whatever the command word says ---------------
# Found 2026-08-24 during D-0680, by the removal it failed to stop: 89 GB outside PROJECT_ROOT.
assert_decision 'find /mnt/cachec/somewhere -mindepth 1 -maxdepth 1 -exec rm -rf {} +' deny \
  "F-HOOK-009: find -exec rm -rf is a recursive+force removal"
assert_decision 'find /mnt/cachec/somewhere -delete' deny \
  "F-HOOK-009: find -delete is a removal too"
assert_decision 'find /etc -name rm' allow \
  "F-HOOK-009: find -name rm is a SEARCH — normalising it to a removal would deny a read"
assert_decision "find $ROOT/tools -name '*.tmp' -exec rm -rf {} +" deny \
  "F-HOOK-009: recursive+force is denied inside PROJECT_ROOT as well, exactly like a bare rm -rf"

assert_decision 'cat .env'                deny "unchanged: a dotenv file as cat's operand denies"
assert_decision 'docker system prune -af' deny "unchanged: docker system prune denies"
assert_decision 'git push -f origin main' deny "unchanged: git push -f denies"
assert_decision 'ls -la'                  allow "unchanged: a plain read command is allowed"
assert_decision 'ls -l secrets/'          ask  "unchanged: the residual fuzzy signal still asks"

printf '\n================================================================\n'
printf 'rule 12 single-source alignment: %s passed, %s failed\n' "$PASS" "$FAIL"
printf '================================================================\n'
[ "$FAIL" -eq 0 ]
