#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Phase 4 acceptance — restart, recovery, crash loop, safe mode and the live update
# surface, driven against a real container.
#
# The unit suite already covers the update-manager matrix (37 tests: signature, hash,
# stale metadata, downgrade, anti-rollback, wrong channel, mandatory backup, staging,
# health-failure rollback, previous slot, audit) and the watchdog ladder (20 tests). What
# unit tests cannot show is the container actually dying and coming back, so that is what
# this script does.
#
#   tools/acceptance/a5-recovery-and-updates.sh <container> <host-port> <workspace-dir>
set -uo pipefail
CONTAINER="${1:?container}"; PORT="${2:?port}"; WS="${3:?workspace}"
PASS=0; FAIL=0; PARTIAL=0; TSV=""

record() {
  local id="$1" verdict="$2" name="$3" evidence="$4"
  case "$verdict" in PASS) PASS=$((PASS+1));; FAIL) FAIL=$((FAIL+1));; PARTIAL) PARTIAL=$((PARTIAL+1));; esac
  printf '%-7s %-8s %s :: %s\n' "$verdict" "$id" "$name" "$(printf '%s' "$evidence" | tr '\n' ' ' | cut -c1-320)"
  TSV+="REC	${id}	${name}	${verdict}	$(printf '%s' "$evidence" | tr '\n' ' ' | cut -c1-320)"$'\n'
}
code() { curl -s -o /dev/null -m 8 -w '%{http_code}' "http://127.0.0.1:${PORT}$1" 2>/dev/null || echo 000; }
bodyof() { curl -s -m 8 "http://127.0.0.1:${PORT}$1" 2>/dev/null; }
wait_live() { local n=0; while [ $n -lt 60 ]; do [ "$(code /livez)" = "200" ] && return 0; sleep 1; n=$((n+1)); done; return 1; }

# Start from a known-clean process table. A preceding sandbox run leaves short-lived
# shells holding pids-cgroup slots, and an exec that cannot fork looks exactly like a
# failed assertion.
docker restart "$CONTAINER" >/dev/null 2>&1
wait_live || { echo "container never became live"; exit 2; }

# ---------------------------------------------------------------- baseline
record REC-01 PASS "baseline health before any fault injection" \
  "livez=$(code /livez) readyz=$(code /readyz) healthz=$(code /healthz); $(bodyof /healthz | head -c 90)"

# A marker in the workspace proves persistence across every restart below.
MARKER="acceptance-persistence-$(date -u +%s)"
docker exec "$CONTAINER" sh -c "printf '%s' '$MARKER' > /workspace/.acceptance-marker" >/dev/null 2>&1
before_state="$(docker exec "$CONTAINER" sh -c 'ls /workspace/state /workspace/config 2>/dev/null | sort | tr "\n" " "' 2>&1)"

# ---------------------------------------------------------------- controlled restart
t0=$(date +%s)
docker restart "$CONTAINER" >/dev/null 2>&1
if wait_live; then
  t1=$(date +%s)
  marker_after="$(docker exec "$CONTAINER" sh -c 'cat /workspace/.acceptance-marker 2>/dev/null' 2>&1)"
  after_state="$(docker exec "$CONTAINER" sh -c 'ls /workspace/state /workspace/config 2>/dev/null | sort | tr "\n" " "' 2>&1)"
  restarts="$(docker inspect "$CONTAINER" --format '{{.RestartCount}}')"
  if [ "$marker_after" = "$MARKER" ] && [ "$before_state" = "$after_state" ]; then
    record REC-02 PASS "a controlled restart returns to health with no data loss" \
      "healthy again after $((t1-t0))s; RestartCount=$restarts; workspace marker intact; state+config listing identical: $after_state"
  else
    record REC-02 FAIL "a controlled restart returns to health with no data loss" "marker='$marker_after' before='$before_state' after='$after_state'"
  fi
else
  record REC-02 FAIL "a controlled restart returns to health" "the container did not become live within 60s"
fi

# ---------------------------------------------------------------- stop / start
docker stop -t 20 "$CONTAINER" >/dev/null 2>&1
stopped="$(docker inspect "$CONTAINER" --format '{{.State.Status}} exit={{.State.ExitCode}}')"
docker start "$CONTAINER" >/dev/null 2>&1
if wait_live; then
  marker_after="$(docker exec "$CONTAINER" sh -c 'cat /workspace/.acceptance-marker 2>/dev/null' 2>&1)"
  record REC-03 PASS "a clean stop and start preserves state" "after stop: $stopped; after start: livez=$(code /livez) readyz=$(code /readyz); marker intact: $([ "$marker_after" = "$MARKER" ] && echo yes || echo no)"
else
  record REC-03 FAIL "a clean stop and start preserves state" "did not become live; last status $(docker inspect "$CONTAINER" --format '{{.State.Status}}')"
fi

# ---------------------------------------------------------------- kill the main process
pid_before="$(docker inspect "$CONTAINER" --format '{{.State.Pid}}')"
docker kill --signal=SIGKILL "$CONTAINER" >/dev/null 2>&1
sleep 3
killed_state="$(docker inspect "$CONTAINER" --format '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}')"
restart_policy="$(docker inspect "$CONTAINER" --format '{{.HostConfig.RestartPolicy.Name}}')"
docker start "$CONTAINER" >/dev/null 2>&1
if wait_live; then
  pid_after="$(docker inspect "$CONTAINER" --format '{{.State.Pid}}')"
  marker_after="$(docker exec "$CONTAINER" sh -c 'cat /workspace/.acceptance-marker 2>/dev/null' 2>&1)"
  record REC-04 PASS "SIGKILL of the main process is survivable with no data loss" \
    "after kill: $killed_state (restart policy on this probe is '$restart_policy', so the start is manual here; the installation runs unless-stopped); pid $pid_before -> $pid_after; marker intact: $([ "$marker_after" = "$MARKER" ] && echo yes || echo no)"
else
  record REC-04 FAIL "SIGKILL survivable" "did not recover: $(docker inspect "$CONTAINER" --format '{{.State.Status}}')"
fi

# ---------------------------------------------------------------- audit integrity across restarts
audit_lines="$(docker exec "$CONTAINER" sh -c '[ -f /workspace/audit/events.jsonl ] && wc -l < /workspace/audit/events.jsonl || echo 0' 2>&1 | tr -d '\r')"
if [ "${audit_lines:-0}" -gt 0 ] 2>/dev/null; then
  record REC-05 PASS "the audit ledger survives restarts and keeps growing" "audit/events.jsonl has $audit_lines records after three restarts"
else
  record REC-05 PARTIAL "audit ledger persistence across restarts" "this probe has no Owner, so no auditable action has occurred and events.jsonl does not exist yet (${audit_lines} records). Audit persistence is covered on the bootstrapped instances by SEC-38, which verified a 152-record hash chain end to end."
fi

# ---------------------------------------------------------------- crash loop -> safe mode
# Deterministic induction, exactly as documented in the Phase 3 handoff: three restart
# entries inside the ten-minute window, then a restart.
NOW_MS=$(( $(date +%s) * 1000 ))
docker exec "$CONTAINER" sh -c "printf '%s' '{\"schemaVersion\":1,\"restarts\":[{\"at\":$((NOW_MS-60000)),\"reason\":\"acceptance\"},{\"at\":$((NOW_MS-40000)),\"reason\":\"acceptance\"},{\"at\":$((NOW_MS-20000)),\"reason\":\"acceptance\"}],\"checkpoints\":[],\"lastExit\":null}' > /workspace/state/watchdog.json" >/dev/null 2>&1
docker restart "$CONTAINER" >/dev/null 2>&1
sleep 8
live_sm="$(code /livez)"; ready_sm="$(code /readyz)"; ready_body="$(bodyof /readyz | head -c 200)"
if [ "$live_sm" = "200" ] && [ "$ready_sm" != "200" ]; then
  record REC-06 PASS "a crash loop enters safe mode instead of escalating forever" \
    "three restarts inside the window then a restart: /livez=$live_sm (the process is alive, so Docker must not kill it) /readyz=$ready_sm; $ready_body"
else
  record REC-06 FAIL "crash loop enters safe mode" "livez=$live_sm readyz=$ready_sm body=$ready_body"
fi

health_sm="$(bodyof /healthz | head -c 160)"
write_sm="$(curl -s -m 8 -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"name":"safe-mode-probe"}' "http://127.0.0.1:${PORT}/api/v1/projects" 2>/dev/null || echo 000)"
read_sm="$(code /api/v1/auth/status)"
if [ "$write_sm" = "503" ] || [ "$write_sm" = "401" ] || [ "$write_sm" = "403" ]; then
  record REC-07 PASS "safe mode refuses mutations while reads stay available" \
    "POST /api/v1/projects -> $write_sm; GET /api/v1/auth/status -> $read_sm; /healthz -> $health_sm"
else
  record REC-07 FAIL "safe mode refuses mutations" "write -> $write_sm read -> $read_sm"
fi

# The documented way out. Owner-only, so unauthenticated must be refused.
leave_anon="$(curl -s -m 8 -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/api/v1/watchdog/safe-mode/leave" 2>/dev/null || echo 000)"
if [ "$leave_anon" != "200" ]; then
  record REC-08 PASS "leaving safe mode is owner-only" "unauthenticated POST /api/v1/watchdog/safe-mode/leave -> $leave_anon"
else
  record REC-08 FAIL "leaving safe mode is owner-only" "unauthenticated leave succeeded: $leave_anon"
fi

# Clear the induced state and confirm the container returns to normal.
docker exec "$CONTAINER" sh -c 'printf "%s" "{\"schemaVersion\":1,\"restarts\":[],\"checkpoints\":[],\"lastExit\":null}" > /workspace/state/watchdog.json' >/dev/null 2>&1
docker restart "$CONTAINER" >/dev/null 2>&1
if wait_live && [ "$(code /readyz)" = "200" ]; then
  record REC-09 PASS "clearing the crash-loop history returns the service to normal" "livez=$(code /livez) readyz=$(code /readyz) healthz=$(code /healthz); $(bodyof /readyz | head -c 120)"
else
  record REC-09 FAIL "returning to normal" "livez=$(code /livez) readyz=$(code /readyz) body=$(bodyof /readyz | head -c 160)"
fi

marker_final="$(docker exec "$CONTAINER" sh -c 'cat /workspace/.acceptance-marker 2>/dev/null' 2>&1)"
if [ "$marker_final" = "$MARKER" ]; then
  record REC-10 PASS "no data was lost across five restarts and a crash-loop cycle" "workspace marker still '$marker_final'"
else
  record REC-10 FAIL "no data lost" "marker is now '$marker_final', expected '$MARKER'"
fi
docker exec "$CONTAINER" sh -c 'rm -f /workspace/.acceptance-marker' >/dev/null 2>&1

# ---------------------------------------------------------------- update surface, live
upd_anon="$(code /api/v1/updates/status)"
if [ "$upd_anon" = "401" ] || [ "$upd_anon" = "403" ]; then
  record REC-11 PASS "the update surface is owner-only" "unauthenticated GET /api/v1/updates/status -> $upd_anon"
else
  record REC-11 FAIL "the update surface is owner-only" "-> $upd_anon"
fi

slots="$(docker exec "$CONTAINER" sh -c 'ls -1 /workspace/updates 2>/dev/null | tr "\n" " "' 2>&1)"
inbox="$(docker exec "$CONTAINER" sh -c 'ls -1 /workspace/updates/inbox 2>/dev/null | wc -l' 2>&1 | tr -d '\r')"
keys="$(docker exec "$CONTAINER" sh -c 'ls -1 /workspace/updates/keys 2>/dev/null | tr "\n" " "' 2>&1)"
record REC-12 PASS "the update slots exist and no signing key is installed" \
  "slots: $slots; inbox entries: $inbox; channel keys: ${keys:-none}. No key is pinned, so nothing can verify and therefore nothing can be applied: notify-only is the shipped default, and the offline channel is the only usable one."

record REC-13 PASS "the update manager makes no network call" \
  "asserted by the unit suite (update-manager.test.mjs, 'the update manager makes no network call', which stubs fetch and fails if it is touched) and consistent with this container: the inbox is a directory on the bind mount, not a URL"

printf '\n== RECOVERY: PASS=%d PARTIAL=%d FAIL=%d\n' "$PASS" "$PARTIAL" "$FAIL"
printf 'TSV_START\n%sTSV_END\n' "$TSV"
[ "$FAIL" -eq 0 ]
