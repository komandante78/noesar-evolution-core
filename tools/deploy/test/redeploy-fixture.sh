#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# `tools/deploy/redeploy.sh`, driven end to end against a FAKE Docker with SYNTHETIC secrets.
#
#   npm run test:redeploy        (or: bash tools/deploy/test/redeploy-fixture.sh)
#
# # Why a fake and not the real daemon
#
# The sequence being tested STOPS AND REPLACES THE INSTALLATION. There is no version of "test it
# for real" that is not a deployment. So the daemon is replaced by `fake-docker`, which keeps
# symbolic state under a temporary directory and journals every invocation — and every case
# asserts that `docker` resolves to it before running anything.
#
# # What this proves, and what it does not
#
# It proves ORDERING, CANCELLATION and RECOVERY: that every read happens before the first
# mutation, that a failure at each point rolls back, that the recipe survives the recreate, that
# no secret reaches stdout, stderr or argv, that temporary files are removed on every path.
#
# It proves NOTHING about Docker itself. The fake answers known templates by substring; it is not
# a Go template engine and not a container runtime.
#
# # The case that is not a scenario
#
# `SOURCE-READS-BEFORE-MUTATION` reads the shipped script's own text and asserts that nothing
# between the rename and the run names the source container. That invariant is what 43.8 s of
# production downtime bought on 2026-08-12 (`D-0390`), and a runtime scenario cannot defend it:
# the defect only appears when the read is reached, and a passing deployment never reaches a
# read that is not there. So it is checked statically, on the file that actually ships.

set -uo pipefail

HERE="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TOOL="${1:-$HERE/../redeploy.sh}"
STATE_ROOT="$(mktemp -d)"
trap 'rm -rf "$STATE_ROOT"' EXIT

OLD_SYNTH="synthetic-old-secret-0000000000000000000000000000000000"
PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); printf '  ok   - %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  FAIL - %s   :: %s\n' "$1" "$2"; }

# The fake must be the ONLY docker on PATH. `/usr/bin` and `/bin` carry awk, tar and friends;
# neither carries a docker this test could reach by accident, and the assertion below proves it.
FAKEBIN="$STATE_ROOT/bin"; mkdir -p "$FAKEBIN"
ln -s "$HERE/fake-docker" "$FAKEBIN/docker"
FAKE_PATH="$FAKEBIN:/usr/bin:/bin"

new_world() {
  export FAKE_ROOT="$STATE_ROOT/$1"
  rm -rf "$FAKE_ROOT"; mkdir -p "$FAKE_ROOT/c/inst" "$FAKE_ROOT/img" "$FAKE_ROOT/net"
  export FAKE_WORKSPACE="$FAKE_ROOT/workspace" FAKE_SHADOWS="$FAKE_ROOT/shadows"
  mkdir -p "$FAKE_WORKSPACE/config" "$FAKE_SHADOWS"
  printf 'synthetic, not a key\n' > "$FAKE_WORKSPACE/config/fake.key"
  : > "$FAKE_ROOT/img/fakeimage_v1"; : > "$FAKE_ROOT/img/fakeimage_v2"; : > "$FAKE_ROOT/net/fake-net"
  local c="$FAKE_ROOT/c/inst"
  printf 'fakeimage:v1' > "$c/image"; printf 'running' > "$c/status"
  printf '0' > "$c/exit";            printf 'healthy' > "$c/health"
  { echo "PATH=/usr/bin"; echo "NODE_ENV=production"
    echo "SECRET_A=$OLD_SYNTH"; echo "SECRET_B=$OLD_SYNTH"
    for i in $(seq 1 20); do echo "FILLER_$i=value$i"; done; } > "$c/env"
  export NOESAR_BACKUPS_DIR="$FAKE_ROOT/backups"
  export TMPDIR="$FAKE_ROOT/tmp"; mkdir -p "$TMPDIR"
  export NOESAR_DEPLOY_HEALTH_TIMEOUT=6 NOESAR_DEPLOY_HEALTH_INTERVAL=1
  export NOESAR_EXPECT_CHILDREN="postgres api codev atom"
  unset FAKE_FAIL_STOP FAKE_FAIL_RUN FAKE_FAIL_RENAME FAKE_UNHEALTHY FAKE_HEALTH_NEVER \
        FAKE_MISSING_CHILD FAKE_STOP_EXIT FAKE_EMPTY_PORT_FLAGS
}
run_tool() { # run_tool [ENV=V…] -- <args…>
  local envs=(); while [ "$1" != "--" ]; do envs+=("$1"); shift; done; shift
  env "${envs[@]}" PATH="$FAKE_PATH" bash "$TOOL" --source inst "$@" \
    > "$FAKE_ROOT/stdout" 2> "$FAKE_ROOT/stderr"
  echo $? > "$FAKE_ROOT/exitcode"
}
code()   { cat "$FAKE_ROOT/exitcode"; }
alive()  { [ -d "$FAKE_ROOT/c/$1" ]; }
stat_()  { cat "$FAKE_ROOT/c/$1/status" 2>/dev/null; }
envof()  { awk -F= -v k="$2" '$1==k{print substr($0,index($0,"=")+1)}' "$FAKE_ROOT/c/$1/env" 2>/dev/null; }
pred()   { for d in "$FAKE_ROOT"/c/inst-pre-*; do [ -d "$d" ] && basename "$d" && return 0; done; return 1; }

echo "=== the docker this test can reach ==="
resolved="$(PATH="$FAKE_PATH" command -v docker)"
[ "$resolved" = "$FAKEBIN/docker" ] && pass "docker resolves to the fixture's fake, not a real client" \
  || fail "docker resolves to the fake" "$resolved"
PATH="$FAKE_PATH" docker version >/dev/null 2>&1 \
  && fail "the fake refuses to act without its state root" "it answered" \
  || pass "the fake refuses to act without its state root (a real client would answer)"

echo "=== 1. check is read-only ==="
new_world check
run_tool -- --check
[ "$(code)" = "0" ] && pass "check: exit 0" || fail "check: exit 0" "got $(code)"
[ "$(stat_ inst)" = "running" ] && pass "check: nothing stopped" || fail "check: nothing stopped" "$(stat_ inst)"
pred >/dev/null 2>&1 && fail "check: nothing renamed" "a predecessor exists" || pass "check: nothing renamed"
[ -z "$(ls -A "$NOESAR_BACKUPS_DIR" 2>/dev/null)" ] && pass "check: no backup written" || fail "check: no backup" "one exists"
[ -z "$(ls -A "$TMPDIR" 2>/dev/null)" ] && pass "check: no temporary file left" || fail "check: temp clean" "$(ls -A "$TMPDIR")"

echo "=== 2. apply refuses without authorisation, and refuses to change nothing ==="
new_world refuse
run_tool -- --apply --rotate-secret SECRET_A
[ "$(code)" = "2" ] && pass "apply without --authorized-by-owner: exit 2" || fail "apply unauthorised" "got $(code)"
new_world nochange
run_tool -- --apply --authorized-by-owner
[ "$(code)" = "2" ] && pass "apply naming no change: exit 2" || fail "apply with no change" "got $(code)"
[ "$(stat_ inst)" = "running" ] && pass "apply refusals stop before any mutation" || fail "refusal is pre-mutation" "$(stat_ inst)"

echo "=== 3. rotate two variables to ONE new value ==="
new_world rotate
run_tool -- --apply --authorized-by-owner --rotate-secret SECRET_A,SECRET_B
[ "$(code)" = "0" ] && pass "rotate: exit 0" || fail "rotate: exit 0" "got $(code)"
A="$(envof inst SECRET_A)"; B="$(envof inst SECRET_B)"
[ -n "$A" ] && [ "$A" = "$B" ] && pass "rotate: both variables carry the SAME new value" || fail "rotate: pair matches" "differ"
[ "$A" != "$OLD_SYNTH" ] && pass "rotate: the value actually changed" || fail "rotate: value changed" "unchanged"
[ "$(wc -l < "$FAKE_ROOT/c/inst/env")" = "24" ] && pass "rotate: every variable carried over" || fail "rotate: env preserved" "$(wc -l < "$FAKE_ROOT/c/inst/env")"
[ "$(envof inst FILLER_7)" = "value7" ] && pass "rotate: untouched variables are untouched" || fail "rotate: others intact" "changed"
pred >/dev/null && pass "rotate: predecessor preserved ($(pred))" || fail "rotate: predecessor" "absent"
recipe="$(cat "$FAKE_ROOT/c/inst/recipe" 2>/dev/null)"
for want in "--stop-timeout 60" "--log-driver json-file" "max-size=50m" "max-file=1" "--read-only" "18089" "/workspace" "/run:mode=1777"; do
  case "$recipe" in *"$want"*) pass "rotate: recipe carries $want" ;; *) fail "rotate: recipe carries $want" "absent" ;; esac
done
bk="$(find "$NOESAR_BACKUPS_DIR" -name workspace.tar 2>/dev/null | head -1)"
[ -n "$bk" ] && [ "$(stat -c '%a' "$bk")" = "600" ] && [ "$(stat -c '%a' "$(dirname "$bk")")" = "700" ] \
  && pass "rotate: backup 0600 in a 0700 directory" || fail "rotate: backup permissions" "wrong or absent"
[ -f "${bk}.sha256" ] && pass "rotate: backup checksum written" || fail "rotate: checksum" "absent"
[ -z "$(ls -A "$TMPDIR" 2>/dev/null)" ] && pass "rotate: no temporary file left" || fail "rotate: temp clean" "$(ls -A "$TMPDIR")"
ROTATE_ROOT="$FAKE_ROOT"; NEWVAL="$A"

echo "=== 4. change the image, keeping everything else ==="
new_world image
run_tool -- --apply --authorized-by-owner --image fakeimage:v2
[ "$(code)" = "0" ] && pass "image: exit 0" || fail "image: exit 0" "got $(code)"
[ "$(cat "$FAKE_ROOT/c/inst/image")" = "fakeimage:v2" ] && pass "image: the replacement runs the new image" || fail "image: new image" "$(cat "$FAKE_ROOT/c/inst/image")"
[ "$(envof inst SECRET_A)" = "$OLD_SYNTH" ] && pass "image: secrets untouched when only the image changes" || fail "image: secrets untouched" "changed"

echo "=== 5. an image that is not local is refused, never pulled ==="
new_world nopull
run_tool -- --apply --authorized-by-owner --image fakeimage:v9
[ "$(code)" = "1" ] && pass "absent image: preflight refuses (exit 1)" || fail "absent image refused" "got $(code)"
[ "$(stat_ inst)" = "running" ] && pass "absent image: nothing was stopped" || fail "absent image: pre-mutation" "$(stat_ inst)"

echo "=== 6. failures BEFORE the rename leave nothing renamed ==="
new_world stopfail
run_tool FAKE_FAIL_STOP=1 -- --apply --authorized-by-owner --rotate-secret SECRET_A
[ "$(code)" = "7" ] && pass "stop fails: exit 7" || fail "stop fails: exit 7" "got $(code)"
pred >/dev/null 2>&1 && fail "stop fails: nothing renamed" "renamed" || pass "stop fails: nothing renamed"
new_world uncleanexit
run_tool FAKE_STOP_EXIT=137 -- --apply --authorized-by-owner --rotate-secret SECRET_A
[ "$(code)" = "7" ] && pass "unclean exit: exit 7" || fail "unclean exit: exit 7" "got $(code)"
pred >/dev/null 2>&1 && fail "unclean exit: nothing renamed" "renamed" || pass "unclean exit: nothing renamed"
new_world incomplete
run_tool FAKE_EMPTY_PORT_FLAGS=1 -- --apply --authorized-by-owner --rotate-secret SECRET_A
[ "$(stat_ inst)" = "running" ] && pass "incomplete recipe: refused before the first mutation" || fail "incomplete recipe" "$(stat_ inst)"

echo "=== 7. every failure AFTER the rename rolls back automatically ==="
rollback_case() {
  local label="$1"; shift
  new_world "rb_$label"
  run_tool "$@" -- --apply --authorized-by-owner --rotate-secret SECRET_A,SECRET_B
  [ "$(code)" = "4" ] && pass "$label: exit 4 (rollback performed)" || fail "$label: exit 4" "got $(code)"
  alive inst && [ "$(stat_ inst)" = "running" ] && pass "$label: the installation is back and running" || fail "$label: restored" "$(stat_ inst)"
  [ "$(envof inst SECRET_A)" = "$OLD_SYNTH" ] && pass "$label: the restored container carries the OLD value" || fail "$label: old value" "changed"
  pred >/dev/null 2>&1 && fail "$label: no orphan predecessor" "one remains" || pass "$label: no orphan predecessor"
  grep -q "ROLLBACK (automatic)" "$FAKE_ROOT/stdout" && pass "$label: the rollback announced itself" || fail "$label: announced" "silent"
  [ -z "$(ls -A "$TMPDIR" 2>/dev/null)" ] && pass "$label: no temporary file left" || fail "$label: temp clean" "leftover"
}
rollback_case run_fails      FAKE_FAIL_RUN=1
rollback_case unhealthy      FAKE_UNHEALTHY=1
rollback_case health_timeout FAKE_HEALTH_NEVER=1
rollback_case missing_child  FAKE_MISSING_CHILD=atom

echo "=== 8. no secret in stdout, stderr or argv ==="
leak=0
for f in "$ROTATE_ROOT/stdout" "$ROTATE_ROOT/stderr" "$ROTATE_ROOT/journal"; do
  grep -qF "$OLD_SYNTH" "$f" 2>/dev/null && { fail "no leak in $(basename "$f")" "old secret found"; leak=1; }
  [ -n "${NEWVAL:-}" ] && grep -qF "$NEWVAL" "$f" 2>/dev/null && { fail "no leak in $(basename "$f")" "new secret found"; leak=1; }
done
[ "$leak" = "0" ] && pass "neither synthetic secret appears in stdout, stderr or the argv journal"
grep -qE '\b(64|32) characters\b|[0-9a-f]{64}' "$ROTATE_ROOT/stdout" \
  && fail "no length and no hash printed" "found" || pass "no length and no hash printed"
grep -qE '^run .*(SECRET_A|SECRET_B)=' "$ROTATE_ROOT/journal" 2>/dev/null \
  && fail "no secret in argv" "passed on the command line" || pass "no secret ever travelled in argv"

echo "=== 9. SOURCE-READS-BEFORE-MUTATION (static, on the shipped file) ==="
# The invariant 43.8 s of downtime bought. A runtime scenario cannot defend it: a read that is
# not there is never reached, so only the text can be asked.
rename_at="$(grep -n '^docker rename "\$SOURCE" "\$PREDECESSOR"' "$TOOL" | head -1 | cut -d: -f1)"
run_at="$(grep -n '^docker run -d --name "\$SOURCE"' "$TOOL" | head -1 | cut -d: -f1)"
if [ -n "$rename_at" ] && [ -n "$run_at" ] && [ "$run_at" -gt "$rename_at" ]; then
  pass "the rename precedes the creation, as the sequence requires"
  between="$(awk -v a="$rename_at" -v b="$run_at" 'NR>a && NR<b && /docker inspect "\$SOURCE"/' "$TOOL" | grep -c . || true)"
  [ "$between" = "0" ] && pass "ZERO reads of the source between the rename and the creation" \
                       || fail "no read between rename and creation" "$between found"
  stop_at="$(grep -n '^docker stop --timeout "\$STOP_GRACE" "\$SOURCE"' "$TOOL" | head -1 | cut -d: -f1)"
  guard_at="$(grep -n 'REFUSED: the creation recipe is incomplete' "$TOOL" | head -1 | cut -d: -f1)"
  [ -n "$stop_at" ] && [ -n "$guard_at" ] && [ "$guard_at" -lt "$stop_at" ] \
    && pass "the completeness guard runs BEFORE anything is stopped" \
    || fail "guard precedes stop" "guard=$guard_at stop=$stop_at"
else
  fail "the rename and the creation were both found" "rename=$rename_at run=$run_at"
fi
grep -q 'set -eEuo pipefail' "$TOOL" && pass "the ERR trap can be inherited (-E)" || fail "-E is set" "absent"
grep -q "grep -icE '401|unauthor|x-atom-token' || true" "$TOOL" \
  && pass "the zero-count grep cannot trip the ERR trap (|| true kept)" || fail "grep -c guarded" "unguarded"
grep -qE '/mnt/(cachec|user)' "$TOOL" && fail "no host path is hardcoded (§60-64)" "found" \
  || pass "no path of any particular host is hardcoded (§60-64)"

echo "=== 10. PROVENANCE GATE (static, on the shipped file) — D-0559 ==="
# §3a 11c requires the image's contents to be proven equal to the repository tree before a
# deployment. It was done by hand, and the hand followed the overlay: the `d0544` ledger entry
# records "3/3" because that overlay copied three files. The gate below is what replaced the
# hand, and these three lines are what stop it from being quietly dropped again.
grep -q 'verify-image-provenance.sh' "$TOOL" \
  && pass "the deploy path calls the provenance verifier" \
  || fail "provenance verifier is called" "absent — §3a 11c would be unmeasured"
prov_at="$(grep -n 'verify-image-provenance.sh' "$TOOL" | head -1 | cut -d: -f1)"
gate_at="$(grep -n '^\[ "\$FAIL" -eq 0 \] || { say "REFUSED: preflight failed' "$TOOL" | head -1 | cut -d: -f1)"
[ -n "$prov_at" ] && [ -n "$gate_at" ] && [ "$prov_at" -lt "$gate_at" ] \
  && pass "it runs in preflight, before the gate that refuses a failed preflight" \
  || fail "provenance runs before the mutation gate" "prov=$prov_at gate=$gate_at"
# A measured drift must be a FAIL; an unmeasurable one must not be. Both directions matter:
# failing when docker is absent would make the tool host-coupled (§60-64), and passing when the
# bytes differ would make the whole check decorative.
awk '/verify-image-provenance.sh/,/esac/' "$TOOL" | grep -q '2|3) warn' \
  && awk '/verify-image-provenance.sh/,/esac/' "$TOOL" | grep -q '\*) bad' \
  && pass "measured drift FAILs, unmeasurable provenance only warns" \
  || fail "drift FAILs and unmeasurable warns" "the case arms do not say both"

echo
echo "================================================================"
echo "redeploy fixture: $PASS passed, $FAIL failed"
echo "================================================================"
[ "$FAIL" -eq 0 ]
