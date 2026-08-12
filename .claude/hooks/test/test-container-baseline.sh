#!/usr/bin/env bash
# NOESAR EVOLUTION — synthetic fixture tests for the identity-based container baseline
# (.claude/hooks/lib/container-baseline.sh), the mechanism behind SessionStart's capture
# and the Stop hook's check 6.
#
# No real docker container is created, started, stopped, or removed anywhere in this
# file. Every "current" and "baseline" state is a literal JSON fixture fed straight into
# cbl_check_containers — the same pure function the real Stop hook calls, just with the
# real cbl_fetch_all_containers() bypassed by construction (we pass CURRENT_JSON directly,
# we never call it here).
#
# Usage: ./test-container-baseline.sh   (exit 0 = all pass, exit 1 = at least one failure)
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$HERE/../lib/container-baseline.sh"
# shellcheck source=../lib/container-baseline.sh
. "$LIB"

TMPDIR="$(mktemp -d /tmp/noesar-cbl-test.XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

PASS=0
FAIL=0

# assert_contains OUTPUT PREFIX SUBSTRING DESCRIPTION
# Passes if at least one line of OUTPUT starts with PREFIX ("FAIL:" or "DEBT:") and
# contains SUBSTRING.
assert_contains() {
  local output="$1" prefix="$2" substr="$3" desc="$4"
  if printf '%s\n' "$output" | grep -F "$prefix" | grep -qF "$substr"; then
    echo "  ok   - $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL - $desc"
    echo "         expected a line starting with '$prefix' containing '$substr'"
    echo "         got:"
    printf '%s\n' "$output" | sed 's/^/           /'
    FAIL=$((FAIL+1))
  fi
}

# assert_absent OUTPUT SUBSTRING DESCRIPTION
assert_absent() {
  local output="$1" substr="$2" desc="$3"
  if printf '%s\n' "$output" | grep -qF "$substr"; then
    echo "  FAIL - $desc"
    echo "         did not expect any line containing '$substr'"
    echo "         got:"
    printf '%s\n' "$output" | sed 's/^/           /'
    FAIL=$((FAIL+1))
  else
    echo "  ok   - $desc"
    PASS=$((PASS+1))
  fi
}

assert_no_fail() {
  local output="$1" desc="$2"
  if printf '%s\n' "$output" | grep -q '^FAIL:'; then
    echo "  FAIL - $desc"
    echo "         expected zero FAIL: lines, got:"
    printf '%s\n' "$output" | sed 's/^/           /'
    FAIL=$((FAIL+1))
  else
    echo "  ok   - $desc"
    PASS=$((PASS+1))
  fi
}

entry() { # entry ID NAME [LABELS_JSON]
  local id="$1" name="$2" labels="${3:-}"
  [ -z "$labels" ] && labels='{}'
  printf '{"id":"%s","name":"%s","created":"2026-08-10T00:00:00Z","image_id":"sha256:x","labels":%s}' "$id" "$name" "$labels"
}

echo "=== 1. same name, same id: not new, not blocked ==="
BASE="[$(entry idA noesar-evolution-old-d0300)]"
CUR="[$(entry idA noesar-evolution-old-d0300)]"
printf '%s' "$BASE" > "$TMPDIR/base1.json"
OUT="$(cbl_check_containers "$TMPDIR/base1.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_no_fail "$OUT" "identical id+name across baseline and current produces no FAIL"

echo "=== 2. same name, different id: new and blocked ==="
BASE="[$(entry idA noesar-evolution-old-d0300)]"
CUR="[$(entry idB noesar-evolution-old-d0300)]"
printf '%s' "$BASE" > "$TMPDIR/base2.json"
OUT="$(cbl_check_containers "$TMPDIR/base2.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_contains "$OUT" "FAIL:" "noesar-evolution-old-d0300 (idB" "same name, different id (rename+recreate) is caught as new and blocks"

echo "=== 3. different name, new id, but NOESAR-scoped by label: new and blocked ==="
BASE="[$(entry idA noesar-evolution-old-d0300)]"
NOESAR_LABELS='{"org.noesar.phase":"4"}'
CUR="[$(entry idA noesar-evolution-old-d0300), $(entry idC some-renamed-noesar-thing "$NOESAR_LABELS")]"
printf '%s' "$BASE" > "$TMPDIR/base3.json"
OUT="$(cbl_check_containers "$TMPDIR/base3.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_contains "$OUT" "FAIL:" "some-renamed-noesar-thing (idC" "a new id under a non-prefixed name but with an org.noesar.* label still blocks"

echo "=== 3b. different name, new id, NOT NOESAR-scoped: new but only a debt, not blocked ==="
BASE="[$(entry idA noesar-evolution-old-d0300)]"
CUR="[$(entry idA noesar-evolution-old-d0300), $(entry idD some-other-project-container)]"
printf '%s' "$BASE" > "$TMPDIR/base3b.json"
OUT="$(cbl_check_containers "$TMPDIR/base3b.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_absent "$OUT" "FAIL:some-other-project-container" "an external (non-NOESAR) new container never produces a FAIL"
assert_contains "$OUT" "DEBT:" "some-other-project-container (idD" "an external new container is still reported, as a non-blocking debt"

echo "=== 4. container present in baseline: not blocked ==="
BASE="[$(entry idA noesar-evolution)]"
CUR="[$(entry idA noesar-evolution)]"
printf '%s' "$BASE" > "$TMPDIR/base4.json"
OUT="$(cbl_check_containers "$TMPDIR/base4.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_no_fail "$OUT" "a container that was already in the baseline is never blocked"

echo "=== 5. new container but already removed before closure: not blocked ==="
BASE="[$(entry idA noesar-evolution)]"
CUR="[$(entry idA noesar-evolution)]"   # the transient container idX never appears in CURRENT at all
printf '%s' "$BASE" > "$TMPDIR/base5.json"
OUT="$(cbl_check_containers "$TMPDIR/base5.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_no_fail "$OUT" "a container created and removed again before Stop never appears in current, so it cannot block"

echo "=== 6. baseline file present but corrupted (not valid JSON): error/block ==="
printf 'not { valid json' > "$TMPDIR/base6.json"
CUR="[$(entry idA noesar-evolution)]"
OUT="$(cbl_check_containers "$TMPDIR/base6.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_contains "$OUT" "FAIL:" "not a valid JSON array — corrupted" "a corrupted baseline file blocks, not silently passes"

echo "=== 7. baseline missing, exempt bootstrap session: explicit non-blocking warning ==="
printf 'sess-bootstrap-1' > "$TMPDIR/marker7.txt"
CUR="[$(entry idA noesar-evolution)]"
OUT="$(cbl_check_containers "$TMPDIR/does-not-exist7.json" "$CUR" sess-bootstrap-1 "$TMPDIR/marker7.txt")"
assert_no_fail "$OUT" "the one session_id named by the bootstrap marker gets no FAIL for a missing baseline"
assert_contains "$OUT" "DEBT:" "BASELINE_UNAVAILABLE_PREINSTALL" "...and gets an explicit BASELINE_UNAVAILABLE_PREINSTALL debt instead"

echo "=== 7b. baseline missing, NOT the exempt session: blocks (fails closed, not open) ==="
printf 'sess-bootstrap-1' > "$TMPDIR/marker7b.txt"
CUR="[$(entry idA noesar-evolution)]"
OUT="$(cbl_check_containers "$TMPDIR/does-not-exist7b.json" "$CUR" sess-some-other-session "$TMPDIR/marker7b.txt")"
assert_contains "$OUT" "FAIL:" "container baseline missing for this session" "any session other than the named bootstrap exemption blocks on a missing baseline"

echo "=== 8. B-012: >1 rollback containers pre-existing: non-blocking debt, not a FAIL ==="
BASE="[$(entry idA noesar-evolution-old-d0300), $(entry idB noesar-evolution-old-d0299), $(entry idC noesar-evolution-old-d0298)]"
CUR="$BASE"
printf '%s' "$BASE" > "$TMPDIR/base8.json"
OUT="$(cbl_check_containers "$TMPDIR/base8.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_no_fail "$OUT" "3 pre-existing rollback containers (all in baseline) never produce a FAIL"
assert_contains "$OUT" "DEBT:" "B-012" "...but are reported as the B-012 non-blocking debt"

echo
echo "=== cbl_is_noesar_scoped unit checks ==="
if entry idX noesar-evolution-old-d0300 | cbl_is_noesar_scoped; then
  echo "  ok   - name-prefix match recognised as NOESAR-scoped"; PASS=$((PASS+1))
else
  echo "  FAIL - name-prefix match should be NOESAR-scoped"; FAIL=$((FAIL+1))
fi
if entry idX totally-unrelated-container | cbl_is_noesar_scoped; then
  echo "  FAIL - unrelated name+no labels should NOT be NOESAR-scoped"; FAIL=$((FAIL+1))
else
  echo "  ok   - unrelated name+no labels correctly NOT NOESAR-scoped"; PASS=$((PASS+1))
fi

echo
echo "=== SessionStart write / Stop read round-trip via NOESAR_GUARD_FAKE_DOCKER_JSON ==="
FAKE="[$(entry idA noesar-evolution), $(entry idB noesar-evolution-voice-hear)]"
printf '%s' "$FAKE" > "$TMPDIR/fake-docker.json"
RESULT="$(NOESAR_GUARD_FAKE_DOCKER_JSON="$TMPDIR/fake-docker.json" cbl_fetch_all_containers)"
if [ "$(jq -c 'sort_by(.id)' <<<"$RESULT" 2>/dev/null)" = "$(jq -c 'sort_by(.id)' <<<"$FAKE" 2>/dev/null)" ]; then
  echo "  ok   - cbl_fetch_all_containers returns the fixture verbatim under the test override"; PASS=$((PASS+1))
else
  echo "  FAIL - fixture round-trip through cbl_fetch_all_containers did not match"; FAIL=$((FAIL+1))
fi

echo
echo "=== label secret-scrubbing: a secret-shaped label VALUE is dropped, key is not, no docker call made ==="
cat > "$TMPDIR/inspect-shape.json" <<'EOF'
[
  {"Id":"deadbeef","Name":"/noesar-evolution","Created":"2026-08-10T00:00:00Z","Image":"sha256:x",
   "Config":{"Labels":{"org.noesar.phase":"4","ATOM_TOKEN":"shh-secret-value-should-not-survive"}}}
]
EOF
# cbl_fetch_all_containers only reads real docker inspect output shaped like this via a live
# daemon; here we exercise the same jq transform in isolation to prove the scrub works,
# without needing a real container.
SCRUBBED="$(jq -c --arg pat "$CBL_SECRET_PATTERN" '
  [.[] | {id:.Id,name:(.Name|ltrimstr("/")),created:.Created,image_id:.Image,
          labels:((.Config.Labels // {}) | with_entries(select(.value | test($pat;"i") | not)))}]
' "$TMPDIR/inspect-shape.json")"
if printf '%s' "$SCRUBBED" | jq -e '.[0].labels | has("ATOM_TOKEN") | not' >/dev/null 2>&1 \
   && printf '%s' "$SCRUBBED" | jq -e '.[0].labels["org.noesar.phase"] == "4"' >/dev/null 2>&1; then
  echo "  ok   - secret-shaped label value scrubbed, unrelated label preserved"; PASS=$((PASS+1))
else
  echo "  FAIL - label scrubbing transform did not behave as expected"; echo "$SCRUBBED"; FAIL=$((FAIL+1))
fi

echo
echo "############################################################"
echo "# session-close-guard.sh LIFECYCLE — end to end, real script"
echo "############################################################"
# Why this section exists (D-0381): everything above tests cbl_check_containers, the pure
# function. Nothing tested session-close-guard.sh ITSELF, so nothing tested the one thing
# that mutates — cleanup_container_baseline(). The suite was 17/17 green on the very day
# the guard deleted a live session's baseline and blocked its own Stop. A pure-function
# test cannot catch a side effect nobody exercises.
#
# No real container, no real session baseline and no real project root is touched here:
# NOESAR_GUARD_ROOT points at a synthetic tree, NOESAR_GUARD_BASELINE_DIR at this run's
# own scratch dir, and NOESAR_GUARD_FAKE_DOCKER_JSON replaces the docker daemon.

GUARD="$HERE/../session-close-guard.sh"

mkroot() { # mkroot DIR — a synthetic project root that passes checks 1-5.
  mkdir -p "$1/docs"
  printf '{"last_commit":"deadbeef","next_action":"do the next thing"}' > "$1/PROJECT_STATE.json"
  printf '# HANDOFF\n\nPROSSIMA: something\n' > "$1/docs/SESSION_HANDOFF.md"
}

run_guard() { # run_guard ROOT BDIR SESSION_ID FAKE_DOCKER DRY STOP_ACTIVE
  printf '{"session_id":"%s","hook_event_name":"Stop","stop_hook_active":%s}' "$3" "${6:-false}" \
    | NOESAR_GUARD_ROOT="$1" NOESAR_GUARD_BASELINE_DIR="$2" \
      NOESAR_GUARD_FAKE_DOCKER_JSON="$4" NOESAR_GUARD_DRY_RUN="$5" \
      NOESAR_GUARD_BOOTSTRAP_MARKER="$2/bootstrap-marker.txt" \
      bash "$GUARD" 2>/dev/null
}

assert_jq() { # assert_jq JSON EXPR DESC
  if printf '%s' "$1" | jq -e "$2" >/dev/null 2>&1; then
    echo "  ok   - $3"; PASS=$((PASS+1))
  else
    echo "  FAIL - $3"; echo "         expr: $2"; echo "         got: $1"; FAIL=$((FAIL+1))
  fi
}
assert_file() { # assert_file PATH DESC
  if [ -f "$1" ]; then echo "  ok   - $2"; PASS=$((PASS+1))
  else echo "  FAIL - $2 (file absent: $1)"; FAIL=$((FAIL+1)); fi
}
assert_no_file() { # assert_no_file PATH DESC
  if [ -f "$1" ]; then echo "  FAIL - $2 (file still present: $1)"; FAIL=$((FAIL+1))
  else echo "  ok   - $2"; PASS=$((PASS+1)); fi
}

G="$TMPDIR/guard"; mkdir -p "$G/bl"; mkroot "$G/root"
CLEAN_FIXTURE="$G/docker-clean.json"
printf '[%s]' "$(entry idA noesar-evolution)" > "$CLEAN_FIXTURE"
NEWCT_FIXTURE="$G/docker-newct.json"
printf '[%s, %s]' "$(entry idA noesar-evolution)" "$(entry idZ noesar-evolution-e2e-probe)" > "$NEWCT_FIXTURE"
mkbaseline() { printf '[%s]' "$(entry idA noesar-evolution)" > "$G/bl/noesar-evolution-container-baseline-$1.json"; }

echo "=== L1. DRY_RUN, valid baseline: PASS verdict and the baseline SURVIVES ==="
mkbaseline s1
OUT="$(run_guard "$G/root" "$G/bl" s1 "$CLEAN_FIXTURE" 1)"
assert_jq "$OUT" '.verdict=="PASS" and .dryRun==true' "dry run on a clean session reports verdict PASS"
assert_jq "$OUT" '.systemMessage|test("DRY_RUN")' "the dry run declares itself in the message"
assert_file "$G/bl/noesar-evolution-container-baseline-s1.json" "DRY_RUN did NOT delete the baseline (the regression this suite exists for)"
assert_jq "$OUT" '.systemMessage|test("nothing was deleted")' "the dry run names what a real Stop would have removed"

echo "=== L2. DRY_RUN, baseline missing: BLOCK, and nothing is recreated ==="
OUT="$(run_guard "$G/root" "$G/bl" s2-missing "$CLEAN_FIXTURE" 1)"
assert_jq "$OUT" '.verdict=="BLOCK" and .decision=="block" and .dryRun==true' "dry run keeps the blocking verdict — it never downgrades a block to a report"
assert_no_file "$G/bl/noesar-evolution-container-baseline-s2-missing.json" "dry run does not fabricate the missing baseline"

echo "=== L3. DRY_RUN, corrupted baseline: BLOCK, file left byte-identical ==="
printf 'not { valid json' > "$G/bl/noesar-evolution-container-baseline-s3.json"
BEFORE_SUM="$(cksum < "$G/bl/noesar-evolution-container-baseline-s3.json")"
OUT="$(run_guard "$G/root" "$G/bl" s3 "$CLEAN_FIXTURE" 1)"
assert_jq "$OUT" '.verdict=="BLOCK"' "a corrupted baseline blocks in dry run too"
if [ "$BEFORE_SUM" = "$(cksum < "$G/bl/noesar-evolution-container-baseline-s3.json")" ]; then
  echo "  ok   - the corrupted baseline was neither deleted nor rewritten"; PASS=$((PASS+1))
else
  echo "  FAIL - dry run altered the corrupted baseline"; FAIL=$((FAIL+1))
fi

echo "=== L4. DRY_RUN, container created this session: BLOCK, baseline SURVIVES ==="
mkbaseline s4
OUT="$(run_guard "$G/root" "$G/bl" s4 "$NEWCT_FIXTURE" 1)"
assert_jq "$OUT" '.verdict=="BLOCK" and (.systemMessage|test("noesar-evolution-e2e-probe"))' "an uncleaned session container blocks in dry run"
assert_file "$G/bl/noesar-evolution-container-baseline-s4.json" "a blocking dry run still preserves the baseline"

# --- D-0383 lifecycle helpers -------------------------------------------------------------
# Stop no longer deletes anything, so "did the real Stop act on this file" can no longer be
# answered by the file's absence. It is answered by the HEARTBEAT instead: a real Stop
# refreshes the mtime, a dry run must not. Backdating first makes the comparison exact
# rather than racing the one-second granularity of touch.
age_file()  { touch -t 202001010000 "$1" 2>/dev/null || true; }
mtime_of()  { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }
assert_touched() { # assert_touched PATH DESC
  if [ "$(mtime_of "$1")" -gt 1600000000 ] 2>/dev/null; then echo "  ok   - $2"; PASS=$((PASS+1))
  else echo "  FAIL - $2 (mtime was NOT refreshed: $1)"; FAIL=$((FAIL+1)); fi
}
assert_untouched() { # assert_untouched PATH DESC
  if [ "$(mtime_of "$1")" -lt 1600000000 ] 2>/dev/null; then echo "  ok   - $2"; PASS=$((PASS+1))
  else echo "  FAIL - $2 (mtime WAS refreshed: $1)"; FAIL=$((FAIL+1)); fi
}

echo "=== L5. NORMAL stop, all green: the baseline SURVIVES the turn (F-HOOK-003, D-0383) ==="
mkbaseline s5
OUT="$(run_guard "$G/root" "$G/bl" s5 "$CLEAN_FIXTURE" "")"
assert_jq "$OUT" '.verdict=="PASS" and .dryRun==false' "a normal green stop reports PASS and is not a dry run"
# This assertion is the INVERSE of what it was before D-0383, deliberately. Stop fires at the
# end of every TURN: consuming the anchor here blinded check 6 for the rest of the session and
# blocked every later close on a gap that never existed. SessionEnd consumes it now.
assert_file "$G/bl/noesar-evolution-container-baseline-s5.json" "a green stop KEEPS the baseline — Stop is per-turn, not per-session"

echo "=== L6. NORMAL stop, failing: fail-closed AND the baseline is preserved for the retry ==="
mkbaseline s6
OUT="$(run_guard "$G/root" "$G/bl" s6 "$NEWCT_FIXTURE" "")"
assert_jq "$OUT" '.decision=="block" and .continue==false' "a failing normal stop still blocks — fail-closed preserved"
assert_file "$G/bl/noesar-evolution-container-baseline-s6.json" "a blocking normal stop keeps the baseline, so the session can be re-checked"

echo "=== L7. stop_hook_active=true: anti-loop allows, does not emit a block ==="
mkbaseline s7
OUT="$(run_guard "$G/root" "$G/bl" s7 "$NEWCT_FIXTURE" "" true)"
assert_jq "$OUT" '.verdict=="ALLOW_ANTILOOP" and (has("decision")|not)' "the second stop allows through instead of blocking twice"
assert_file "$G/bl/noesar-evolution-container-baseline-s7.json" "the anti-loop path lets the stop happen and still keeps the baseline"

echo "=== L7b. stop_hook_active=true under DRY_RUN: allows, but deletes nothing ==="
mkbaseline s7b
OUT="$(run_guard "$G/root" "$G/bl" s7b "$NEWCT_FIXTURE" 1 true)"
assert_jq "$OUT" '.verdict=="ALLOW_ANTILOOP" and .dryRun==true' "anti-loop path is reachable in dry run"
assert_file "$G/bl/noesar-evolution-container-baseline-s7b.json" "the anti-loop path in dry run deletes nothing either"

echo "=== L8. bootstrap marker matching the session: debt, not FAIL; marker OUTLIVES the turn ==="
printf 's8' > "$G/bl/bootstrap-marker.txt"
OUT="$(run_guard "$G/root" "$G/bl" s8 "$CLEAN_FIXTURE" "")"
assert_jq "$OUT" '.verdict=="PASS" and (.systemMessage|test("BASELINE_UNAVAILABLE_PREINSTALL"))' "the named bootstrap session passes with an explicit declared debt"
# Also inverted by D-0383: consuming the exemption on the first turn meant every later turn
# of that same session lost it and blocked. SessionEnd retires it, once.
assert_file "$G/bl/bootstrap-marker.txt" "the bootstrap exemption survives the turn — SessionEnd retires it, not Stop"

echo "=== L9. bootstrap marker naming a DIFFERENT session: fail closed ==="
printf 'some-other-session' > "$G/bl/bootstrap-marker.txt"
OUT="$(run_guard "$G/root" "$G/bl" s9 "$CLEAN_FIXTURE" 1)"
assert_jq "$OUT" '.verdict=="BLOCK"' "a bootstrap marker for another session does not exempt this one"
assert_file "$G/bl/bootstrap-marker.txt" "a blocking dry run leaves the other session's marker alone"
rm -f "$G/bl/bootstrap-marker.txt"

echo "=== L10. a green stop touches ONLY its own session's baseline ==="
mkbaseline s10-self
mkbaseline s10-other
age_file "$G/bl/noesar-evolution-container-baseline-s10-self.json"
age_file "$G/bl/noesar-evolution-container-baseline-s10-other.json"
OUT="$(run_guard "$G/root" "$G/bl" s10-self "$CLEAN_FIXTURE" "")"
assert_file "$G/bl/noesar-evolution-container-baseline-s10-self.json" "the stopping session keeps its own baseline"
assert_touched "$G/bl/noesar-evolution-container-baseline-s10-self.json" "the stopping session's own baseline gets the heartbeat"
assert_file "$G/bl/noesar-evolution-container-baseline-s10-other.json" "another live session's baseline is never touched"
assert_untouched "$G/bl/noesar-evolution-container-baseline-s10-other.json" "another live session's baseline is not even re-stamped — cross-session isolation"

echo "=== L11. the baseline directory override is honoured on BOTH sides ==="
mkdir -p "$G/bl2"
printf '[%s]' "$(entry idA noesar-evolution)" > "$G/bl2/noesar-evolution-container-baseline-s11.json"
mkbaseline s11   # a decoy of the same name in the OTHER directory
age_file "$G/bl2/noesar-evolution-container-baseline-s11.json"
age_file "$G/bl/noesar-evolution-container-baseline-s11.json"
OUT="$(run_guard "$G/root" "$G/bl2" s11 "$CLEAN_FIXTURE" "")"
# With nothing deleted, "which directory did it resolve?" is answered by the heartbeat.
assert_touched   "$G/bl2/noesar-evolution-container-baseline-s11.json" "the guard resolves inside the CONFIGURED directory"
assert_untouched "$G/bl/noesar-evolution-container-baseline-s11.json" "a same-named baseline outside the configured directory is never reached"

echo "=== L12. malformed payload under DRY_RUN fails closed, and claims no verdict ==="
OUT="$(printf 'not json at all' | NOESAR_GUARD_ROOT="$G/root" NOESAR_GUARD_BASELINE_DIR="$G/bl" \
        NOESAR_GUARD_DRY_RUN=1 bash "$GUARD" 2>/dev/null)"
assert_jq "$OUT" '.decision=="block" and .verdict=="BLOCK" and .dryRun==true' "an unparseable payload blocks the dry run instead of printing a verdict"
OUT="$(printf '' | NOESAR_GUARD_ROOT="$G/root" NOESAR_GUARD_BASELINE_DIR="$G/bl" \
        NOESAR_GUARD_DRY_RUN=1 bash "$GUARD" 2>/dev/null)"
assert_jq "$OUT" '.decision=="block"' "empty stdin blocks the dry run too"

echo "=== L13. DRY_RUN is opt-in: an unset variable is a REAL stop, and it still mutates ==="
mkbaseline s13
age_file "$G/bl/noesar-evolution-container-baseline-s13.json"
OUT="$(printf '{"session_id":"s13","stop_hook_active":false}' \
        | NOESAR_GUARD_ROOT="$G/root" NOESAR_GUARD_BASELINE_DIR="$G/bl" \
          NOESAR_GUARD_FAKE_DOCKER_JSON="$CLEAN_FIXTURE" bash "$GUARD" 2>/dev/null)"
assert_jq "$OUT" '.dryRun==false' "with no NOESAR_GUARD_DRY_RUN set, the guard is in real mode"
# After D-0383 the only mutation a real Stop performs is the heartbeat, so that is what
# separates the two modes now. The distinction must stay OBSERVABLE, or "dry run" would
# become a word rather than a property.
assert_touched "$G/bl/noesar-evolution-container-baseline-s13.json" "real mode still mutates (heartbeat) — the default did not silently become read-only"
mkbaseline s13b
age_file "$G/bl/noesar-evolution-container-baseline-s13b.json"
OUT="$(run_guard "$G/root" "$G/bl" s13b "$CLEAN_FIXTURE" 1)"
assert_untouched "$G/bl/noesar-evolution-container-baseline-s13b.json" "a dry run does not even refresh the mtime — it mutates nothing at all"

echo "=== L14. neither the guard nor the library issues a mutating docker command ==="
if grep -nE '\bdocker[[:space:]]+(rm|rmi|stop|start|kill|restart|prune|create|run|exec|network|volume|system)\b' \
     "$GUARD" "$LIB" >/dev/null 2>&1; then
  echo "  FAIL - a mutating docker command appears in the guard or the library"
  grep -nE '\bdocker[[:space:]]+(rm|rmi|stop|start|kill|restart|prune|create|run|exec|network|volume|system)\b' "$GUARD" "$LIB"
  FAIL=$((FAIL+1))
else
  echo "  ok   - only read-only docker calls (ps/inspect) appear in either file"; PASS=$((PASS+1))
fi

echo "=== L15. SessionStart write -> Stop read round-trip through the overridden directory ==="
mkdir -p "$G/bl3"
printf '{"session_id":"s15","source":"startup"}' \
  | NOESAR_GUARD_BASELINE_DIR="$G/bl3" NOESAR_GUARD_FAKE_DOCKER_JSON="$CLEAN_FIXTURE" \
    bash "$HERE/../session-context.sh" >/dev/null 2>&1
assert_file "$G/bl3/noesar-evolution-container-baseline-s15.json" "SessionStart writes into the configured baseline directory"
OUT="$(run_guard "$G/root" "$G/bl3" s15 "$CLEAN_FIXTURE" 1)"
assert_jq "$OUT" '.verdict=="PASS"' "the Stop hook reads back exactly what SessionStart wrote — the two sides cannot drift"

echo "=== R1. the §3a installation replacement is NOT litter, when its predecessor is preserved ==="
# CLAUDE10 §3a authorises replacing the installation container: stop, preserve the predecessor
# under a timestamped name, start the replacement. That gives \`noesar-evolution\` a NEW id, which
# check 6 could not tell apart from litter — it blocked the close of the very session that
# performed an authorised deployment (measured 2026-08-12, after the ATOM_TOKEN rotation).
# The exemption is deliberately narrow: the name must be EXACTLY the installation, an
# installation must have existed in the baseline, and the container it replaced must still be
# present AND come from the baseline. That last clause is what makes it a replacement rather
# than a container conjured from nothing.
BASE="[$(entry idOLD noesar-evolution)]"
CUR="[$(entry idNEW noesar-evolution), $(entry idOLD noesar-evolution-pre-token-rotation-20260812T130147Z)]"
printf '%s' "$BASE" > "$TMPDIR/baseR1.json"
OUT="$(cbl_check_containers "$TMPDIR/baseR1.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_no_fail "$OUT" "an authorised replacement whose predecessor is preserved does not block"
assert_contains "$OUT" "DEBT:" "noesar-evolution" "the replacement is still REPORTED, never silent"

echo "=== R2. a replacement with NO preserved predecessor still blocks ==="
BASE="[$(entry idOLD noesar-evolution)]"
CUR="[$(entry idNEW noesar-evolution)]"
printf '%s' "$BASE" > "$TMPDIR/baseR2.json"
OUT="$(cbl_check_containers "$TMPDIR/baseR2.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_contains "$OUT" "FAIL:" "noesar-evolution (idNEW" "without a preserved predecessor it is not a sanctioned replacement, and blocks"

echo "=== R3. a 'predecessor' that was never in the baseline does not buy the exemption ==="
BASE="[$(entry idOLD noesar-evolution)]"
CUR="[$(entry idNEW noesar-evolution), $(entry idFAKE noesar-evolution-pre-token-rotation-forged)]"
printf '%s' "$BASE" > "$TMPDIR/baseR3.json"
OUT="$(cbl_check_containers "$TMPDIR/baseR3.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_contains "$OUT" "FAIL:" "noesar-evolution (idNEW" "a predecessor absent from the baseline cannot sanction a replacement"

echo "=== R4. any OTHER new noesar-evolution-* container is still litter ==="
BASE="[$(entry idOLD noesar-evolution)]"
CUR="[$(entry idOLD noesar-evolution), $(entry idPROBE noesar-evolution-e2e-probe-1)]"
printf '%s' "$BASE" > "$TMPDIR/baseR4.json"
OUT="$(cbl_check_containers "$TMPDIR/baseR4.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_contains "$OUT" "FAIL:" "noesar-evolution-e2e-probe-1 (idPROBE" "the exemption covers the installation only, never a probe or a runner"

echo
echo "================================================================"
echo "container-baseline fixture tests: $PASS passed, $FAIL failed"
echo "================================================================"
[ "$FAIL" -eq 0 ]
