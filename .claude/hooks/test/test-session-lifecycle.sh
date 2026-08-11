#!/usr/bin/env bash
# NOESAR EVOLUTION — end-to-end fixture tests for the BASELINE LIFECYCLE (F-HOOK-003, D-0383).
#
#   SessionStart  create the private runtime dir, write the anchor atomically, prune only
#                 residues proven cold
#   Stop          read and compare on EVERY turn — never delete
#   SessionEnd    delete this session's files, and only this session's
#
# What makes this suite different from test-container-baseline.sh: that one proves a single
# Stop behaves; this one proves the anchor SURVIVES A SEQUENCE of turns and dies exactly
# once, at the right moment, in the right hands. The defect it exists to prevent — Stop
# consuming the anchor on the first green turn — was invisible to every single-turn test.
#
# No real container, no real session and no real project root is touched: NOESAR_GUARD_ROOT
# is a synthetic tree, NOESAR_GUARD_BASELINE_DIR a per-run scratch dir, and
# NOESAR_GUARD_FAKE_DOCKER_JSON replaces the docker daemon entirely.
#
# Usage: ./test-session-lifecycle.sh   (exit 0 = all pass, exit 1 = a failure)
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START="$HERE/../session-context.sh"
GUARD="$HERE/../session-close-guard.sh"
ENDHOOK="$HERE/../session-end-cleanup.sh"
LIB="$HERE/../lib/container-baseline.sh"
PREFIX="noesar-evolution-container-baseline-"

G="$(mktemp -d /tmp/noesar-lifecycle-test.XXXXXX)"
trap 'rm -rf "$G"' EXIT

PASS=0; FAIL=0
ok()  { echo "  ok   - $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL - $1"; [ $# -gt 1 ] && printf '         %s\n' "$2"; FAIL=$((FAIL+1)); }
assert_file()    { if [ -f "$1" ]; then ok "$2"; else bad "$2" "file absent: $1"; fi; }
assert_no_file() { if [ ! -e "$1" ]; then ok "$2"; else bad "$2" "file still present: $1"; fi; }
assert_jq()      { if printf '%s' "$1" | jq -e "$2" >/dev/null 2>&1; then ok "$3"; else bad "$3" "expr $2 · got $1"; fi; }
assert_mode()    { local m; m="$(stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1" 2>/dev/null)"
                   if [ "$m" = "$2" ]; then ok "$3"; else bad "$3" "mode $m, wanted $2 ($1)"; fi; }

entry() { printf '{"id":"%s","name":"%s","created":"2026-01-01T00:00:00Z","image_id":"sha256:x","labels":{}}' "$1" "$2"; }
CLEAN="$G/docker-clean.json";  printf '[%s]' "$(entry idbase noesar-evolution)" > "$CLEAN"
NEWCT="$G/docker-newct.json";  printf '[%s,%s]' "$(entry idbase noesar-evolution)" "$(entry idNEW noesar-evolution-probe)" > "$NEWCT"

mkroot() { mkdir -p "$1/docs"
  printf '{"last_commit":"deadbeef","next_action":"do the next thing"}' > "$1/PROJECT_STATE.json"
  printf '# HANDOFF\n\nPROSSIMA: something\n' > "$1/docs/SESSION_HANDOFF.md"; }
ROOT="$G/root"; mkroot "$ROOT"

start_session() { # start_session BDIR SESSION_ID FAKE
  printf '{"session_id":"%s","source":"startup"}' "$2" \
    | NOESAR_GUARD_BASELINE_DIR="$1" NOESAR_GUARD_FAKE_DOCKER_JSON="$3" bash "$START" >/dev/null 2>&1
}
stop_turn() { # stop_turn BDIR SESSION_ID FAKE [DRY]
  printf '{"session_id":"%s","hook_event_name":"Stop","stop_hook_active":false}' "$2" \
    | NOESAR_GUARD_ROOT="$ROOT" NOESAR_GUARD_BASELINE_DIR="$1" \
      NOESAR_GUARD_FAKE_DOCKER_JSON="$3" NOESAR_GUARD_DRY_RUN="${4:-}" \
      NOESAR_GUARD_BOOTSTRAP_MARKER="$1/bootstrap-marker.txt" bash "$GUARD" 2>/dev/null
}
end_session() { # end_session BDIR SESSION_ID REASON
  printf '{"session_id":"%s","hook_event_name":"SessionEnd","reason":"%s"}' "$2" "$3" \
    | NOESAR_GUARD_BASELINE_DIR="$1" NOESAR_GUARD_BOOTSTRAP_MARKER="$1/bootstrap-marker.txt" \
      bash "$ENDHOOK" 2>/dev/null
}

echo "=== 1-3. SessionStart: private directory, private file, atomic publish ==="
D="$G/d1"
start_session "$D" sess0001 "$CLEAN"
assert_file "$D/${PREFIX}sess0001.json" "SessionStart writes the baseline"
assert_mode "$D" 700 "the runtime directory is 0700 — not readable by other local users"
assert_mode "$D/${PREFIX}sess0001.json" 600 "the baseline is 0600 — the trust anchor is not world-writable"
if [ -z "$(find "$D" -maxdepth 1 -name ".${PREFIX}*" 2>/dev/null)" ]; then
  ok "the atomic write leaves no temporary file behind"
else bad "the atomic write leaves no temporary file behind"; fi
if jq -e 'type=="array"' "$D/${PREFIX}sess0001.json" >/dev/null 2>&1; then
  ok "what is published is a valid JSON array — validated BEFORE the rename"
else bad "what is published is a valid JSON array"; fi

echo
echo "=== 4-6. SessionStart refuses what it cannot trust ==="
D2="$G/d2"; mkdir -p "$G/elsewhere"
ln -s "$G/elsewhere" "$D2"
start_session "$D2" sess0002 "$CLEAN"
if [ -z "$(find "$G/elsewhere" -maxdepth 1 -name "${PREFIX}*" 2>/dev/null)" ]; then
  ok "a symlinked runtime directory is refused — nothing is written through it"
else bad "a symlinked runtime directory is refused"; fi
D3="$G/d3"; mkdir -p "$D3"; chmod 700 "$D3"
printf '[]' > "$D3/${PREFIX}sess0003.json"
if chown 12345 "$D3/${PREFIX}sess0003.json" 2>/dev/null; then
  start_session "$D3" sess0003 "$CLEAN"
  FOUID="$(stat -c %u "$D3/${PREFIX}sess0003.json" 2>/dev/null)"
  if [ "$FOUID" = "12345" ]; then ok "an existing baseline owned by another uid is NOT overwritten"
  else bad "an existing baseline owned by another uid is NOT overwritten" "uid is now $FOUID"; fi
else
  ok "[SKIPPED, declared] cannot chown in this environment — foreign-owner refusal not exercised"
fi
D4="$G/d4"; mkdir -p "$D4"; chmod 700 "$D4"
printf '[]' > "$D4/${PREFIX}othersess.json"
start_session "$D4" sess0004 "$CLEAN"
assert_file "$D4/${PREFIX}othersess.json" "another session's baseline is left untouched by SessionStart"

echo
echo "=== 7-12. Stop across MANY turns: the anchor survives every one of them ==="
D5="$G/d5"
start_session "$D5" sess0005 "$CLEAN"
B5="$D5/${PREFIX}sess0005.json"
SUM1="$(sha256sum "$B5" | cut -d' ' -f1)"
OUT="$(stop_turn "$D5" sess0005 "$CLEAN")"
assert_jq "$OUT" '.verdict=="PASS"' "turn 1 · Stop passes"
assert_file "$B5" "turn 1 · the baseline survives a PASS"
OUT="$(stop_turn "$D5" sess0005 "$CLEAN")"
assert_jq "$OUT" '.verdict=="PASS"' "turn 2 · Stop passes again — this is the case F-HOOK-003 broke"
assert_file "$B5" "turn 2 · the baseline is STILL there"
SUM2="$(sha256sum "$B5" | cut -d' ' -f1)"
if [ "$SUM1" = "$SUM2" ]; then ok "turn 2 · the content is unchanged — the anchor is not re-captured mid-session"
else bad "turn 2 · the content is unchanged" "a mid-session container would be absorbed into it"; fi
OUT="$(stop_turn "$D5" sess0005 "$NEWCT")"
assert_jq "$OUT" '.decision=="block"' "turn 3 · a container created during the session BLOCKS — check 6 still sees, turns later"
assert_file "$B5" "turn 3 · a BLOCK also keeps the baseline"
OUT="$(stop_turn "$D5" sess0005 "$CLEAN")"
assert_jq "$OUT" '.verdict=="PASS"' "turn 4 · once the litter is gone the same session passes again"
OUT="$(stop_turn "$D5" sess0005 "$CLEAN" 1)"
assert_jq "$OUT" '.dryRun==true' "turn 5 · the dry run still works after several real turns"
assert_file "$B5" "turn 5 · the dry run keeps the baseline"

echo
echo "=== 13-16. SessionEnd deletes its own files, and refuses everything else ==="
D6="$G/d6"
start_session "$D6" sessAAAA "$CLEAN"
start_session "$D6" sessBBBB "$CLEAN"
printf 'sessAAAA' > "$D6/bootstrap-marker.txt"
OUT="$(end_session "$D6" sessAAAA clear)"
assert_no_file "$D6/${PREFIX}sessAAAA.json" "SessionEnd removes the ending session's baseline"
assert_file    "$D6/${PREFIX}sessBBBB.json" "SessionEnd leaves the OTHER live session's baseline alone"
assert_no_file "$D6/bootstrap-marker.txt" "SessionEnd retires the bootstrap marker naming that session"
printf 'sessBBBB' > "$D6/bootstrap-marker.txt"
OUT="$(end_session "$D6" sessCCCC other)"
assert_file "$D6/bootstrap-marker.txt" "a marker naming a DIFFERENT session is never retired"
assert_file "$D6/${PREFIX}sessBBBB.json" "ending an unrelated session deletes nothing"
OUT="$(end_session "$D6" '../../etc/passwd' other)"
assert_jq "$OUT" '.systemMessage|test("not a valid identifier")' "a traversal-shaped session id is refused, and not echoed back"
assert_file "$D6/${PREFIX}sessBBBB.json" "the refusal left every real file in place"
OUT="$(end_session "$D6" '' other)"
assert_jq "$OUT" '.systemMessage|test("no session_id")' "an absent session id removes nothing and says so"
D7="$G/d7"; mkdir -p "$D7"; chmod 700 "$D7"
printf 'REAL' > "$G/real-target.txt"
ln -s "$G/real-target.txt" "$D7/${PREFIX}sessLINK.json"
OUT="$(end_session "$D7" sessLINK other)"
assert_file "$G/real-target.txt" "a symlinked baseline is refused — the link target is never deleted"
assert_jq "$OUT" '.systemMessage|test("symlink")' "and the refusal is declared, not silent"

echo
echo "=== 17-22. every documented SessionEnd reason is handled the same way ==="
for R in clear resume logout prompt_input_exit bypass_permissions_disabled other; do
  DR="$G/reason-$R"
  start_session "$DR" sessreason "$CLEAN"
  OUT="$(end_session "$DR" sessreason "$R")"
  if [ ! -e "$DR/${PREFIX}sessreason.json" ] && printf '%s' "$OUT" | jq -e --arg r "$R" '.systemMessage|test("reason=" + $r)' >/dev/null 2>&1; then
    ok "reason '$R' · cleaned up and reported"
  else
    bad "reason '$R' · cleaned up and reported" "$OUT"
  fi
done

echo
echo "=== 23-24. crash recovery: PROVEN DEAD only — age is never evidence (F-HOOK-004) ==="
# The rule under test: PROVEN_DEAD may go; POTENTIALLY_ACTIVE, UNKNOWN and AGE_ONLY stay.
BOOT="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo '')"
mystart() { # starttime of a pid, comm-safe (field 22)
  local line rest; line="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  rest="${line##*) }"; set -- $rest; printf '%s' "${20}"
}
sidecar() { # sidecar DIR SID PID STARTTIME [BOOT]
  printf '{"schema":1,"boot_id":"%s","uid":%s,"captured_at":0,"ancestors":[{"pid":%s,"starttime":"%s"}]}' \
    "${5:-$BOOT}" "$(id -u)" "$3" "$4" > "$1/${PREFIX}$2.owner.json"
}
old() { touch -t 202001010000 "$1"; }          # far older than any grace period
DEADPID=4194300                                 # above the pid ceiling: nothing can own it

D8="$G/d8"; mkdir -p "$D8"; chmod 700 "$D8"
MYPID=$$; MYST="$(mystart $$)"

# 1 · alive and recent
printf '[]' > "$D8/${PREFIX}sessLIVE.json";      sidecar "$D8" sessLIVE "$MYPID" "$MYST"
# 2 · alive but IDLE FOR YEARS — the whole point of F-HOOK-004
printf '[]' > "$D8/${PREFIX}sessIDLE.json";      sidecar "$D8" sessIDLE "$MYPID" "$MYST";      old "$D8/${PREFIX}sessIDLE.json"
# 3 · pid still exists but is a DIFFERENT process (recycled pid)
printf '[]' > "$D8/${PREFIX}sessREUSE.json";     sidecar "$D8" sessREUSE "$MYPID" 999999999;   old "$D8/${PREFIX}sessREUSE.json"
# 4 · owning process provably gone, and past the grace period
printf '[]' > "$D8/${PREFIX}sessDEAD.json";      sidecar "$D8" sessDEAD "$DEADPID" 12345;      old "$D8/${PREFIX}sessDEAD.json"
# 4b · provably gone but still INSIDE the grace period
printf '[]' > "$D8/${PREFIX}sessFRESHDEAD.json"; sidecar "$D8" sessFRESHDEAD "$DEADPID" 12345
# 4c · a different boot: no process of that boot can be alive
printf '[]' > "$D8/${PREFIX}sessOLDBOOT.json";   sidecar "$D8" sessOLDBOOT "$MYPID" "$MYST" "00000000-0000-0000-0000-000000000000"; old "$D8/${PREFIX}sessOLDBOOT.json"
# 5 · legacy: no sidecar at all
printf '[]' > "$D8/${PREFIX}sessLEGACY.json";    old "$D8/${PREFIX}sessLEGACY.json"
# 6 · incomplete metadata
printf '[]' > "$D8/${PREFIX}sessPARTIAL.json";   printf '{"schema":1}' > "$D8/${PREFIX}sessPARTIAL.owner.json"; old "$D8/${PREFIX}sessPARTIAL.json"
# 7 · corrupt metadata
printf '[]' > "$D8/${PREFIX}sessCORRUPT.json";   printf 'not json at all' > "$D8/${PREFIX}sessCORRUPT.owner.json"; old "$D8/${PREFIX}sessCORRUPT.json"
# 8 · the current session, made to look ancient
printf '[]' > "$D8/${PREFIX}sessCURRENT.json";   sidecar "$D8" sessCURRENT "$DEADPID" 12345;   old "$D8/${PREFIX}sessCURRENT.json"

start_session "$D8" sessCURRENT "$CLEAN"

assert_file    "$D8/${PREFIX}sessLIVE.json"      "alive + recent → preserved"
assert_file    "$D8/${PREFIX}sessIDLE.json"      "ALIVE BUT IDLE FOR YEARS → preserved — age is not death (F-HOOK-004)"
assert_no_file "$D8/${PREFIX}sessREUSE.json"     "a recycled pid reads as DEAD, not as the original process — no PID-reuse confusion"
assert_no_file "$D8/${PREFIX}sessDEAD.json"      "owning process proven gone + past grace → removed"
assert_file    "$D8/${PREFIX}sessFRESHDEAD.json" "proven dead but INSIDE the grace period → still kept"
assert_no_file "$D8/${PREFIX}sessOLDBOOT.json"   "a different boot id is proof of death on its own → removed"
assert_file    "$D8/${PREFIX}sessLEGACY.json"    "legacy residue with no identity → preserved and declared"
assert_file    "$D8/${PREFIX}sessPARTIAL.json"   "incomplete metadata → preserved"
assert_file    "$D8/${PREFIX}sessCORRUPT.json"   "corrupt metadata → preserved"
assert_file    "$D8/${PREFIX}sessCURRENT.json"   "the CURRENT session is never pruned, whatever its metadata says"
assert_no_file "$D8/${PREFIX}sessDEAD.owner.json" "a removed baseline takes its own sidecar with it"
OUTP="$(printf '{"session_id":"sessCURRENT","source":"startup"}' | NOESAR_GUARD_BASELINE_DIR="$D8" \
        NOESAR_GUARD_FAKE_DOCKER_JSON="$CLEAN" bash -c '. '"$LIB"'; cbl_prune_stale_baselines "$0" sessCURRENT' "$D8" 2>/dev/null)"
if printf '%s' "$OUTP" | grep -q 'KEPT:'; then ok "residues that cannot be removed are DECLARED, not silently ignored"
else bad "residues that cannot be removed are DECLARED" "$OUTP"; fi

D9="$G/d9"; mkdir -p "$D9"; chmod 700 "$D9"
printf '[]' > "$D9/${PREFIX}sessFOREIGN.json"; sidecar "$D9" sessFOREIGN "$DEADPID" 12345; old "$D9/${PREFIX}sessFOREIGN.json"
if chown 12345 "$D9/${PREFIX}sessFOREIGN.json" 2>/dev/null; then
  start_session "$D9" sessMine "$CLEAN"
  assert_file "$D9/${PREFIX}sessFOREIGN.json" "a residue owned by ANOTHER uid is kept even when proven dead"
else
  ok "[SKIPPED, declared] cannot chown here — foreign-owner prune refusal not exercised"
fi
printf '[]' > "$D9/not-our-prefix.json"; old "$D9/not-our-prefix.json"
ln -s "$G/real-target.txt" "$D9/${PREFIX}sessSYM.json" 2>/dev/null
start_session "$D9" sessMine2 "$CLEAN"
assert_file "$D9/not-our-prefix.json" "a file outside the exact prefix is never a prune candidate"
assert_file "$G/real-target.txt" "a symlinked residue is refused — the link target survives"

echo
echo "=== 12-13 (policy, read from the code) · no destructive glob, no mtime-only delete ==="
if grep -nE 'rm -rf|rm[[:space:]]+-[a-zA-Z]*r' "$LIB" >/dev/null 2>&1; then
  bad "the library issues no recursive remove"
else ok "the library issues no recursive remove — every deletion names one file"; fi
if grep -A4 'live="$(cbl_liveness_of' "$LIB" | grep -q 'ALIVE)\|UNKNOWN)'; then
  ok "deletion is gated on the liveness verdict, not on a timestamp"
else bad "deletion is gated on the liveness verdict, not on a timestamp"; fi

echo
echo "=== 25. no hook in this lifecycle issues a mutating docker command ==="
if grep -nE '\bdocker[[:space:]]+(rm|rmi|stop|start|kill|restart|prune|create|run|exec|network|volume|system)\b' \
     "$ENDHOOK" "$START" "$LIB" >/dev/null 2>&1; then
  bad "no mutating docker command in SessionStart / SessionEnd / the library"
else
  ok "no mutating docker command in SessionStart / SessionEnd / the library"
fi
# Comment lines are stripped first: this file's own header explains why SessionEnd calls no
# docker, and matching prose would be the same whole-string mistake F-HOOK-001 was.
if sed 's/#.*//' "$ENDHOOK" | grep -qE '(^|[^A-Za-z_])docker([^A-Za-z_]|$)'; then
  bad "SessionEnd calls no docker at all (it must finish inside 1500 ms)"
else
  ok "SessionEnd calls no docker at all (it must finish inside 1500 ms)"
fi

echo
echo "=== 28. the run leaves no fixture resource outside its own scratch dir ==="
if [ -z "$(find /tmp -maxdepth 1 -name 'noesar-lifecycle-test.*' -not -path "$G" 2>/dev/null)" ]; then
  ok "no stray lifecycle-test directory survives outside this run's own"
else
  bad "no stray lifecycle-test directory survives outside this run's own"
fi

echo
echo "================================================================"
echo "session-lifecycle fixture tests: $PASS passed, $FAIL failed"
echo "================================================================"
[ "$FAIL" -eq 0 ]
