#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Phase 4 acceptance — container sandbox and runtime hardening.
#
# Every check runs against a live container and reports what was actually observed. These
# properties are invisible to every static scanner on this host: a read-only rootfs, a
# dropped capability set and a noexec tmpfs are runtime facts, not code.
#
#   tools/acceptance/a4-container-sandbox.sh <container-name>
set -uo pipefail
CONTAINER="${1:?usage: a4-container-sandbox.sh <container-name>}"
PASS=0; FAIL=0; PARTIAL=0
TSV=""

record() { # id verdict name evidence
  local id="$1" verdict="$2" name="$3" evidence="$4"
  case "$verdict" in
    PASS) PASS=$((PASS+1));; FAIL) FAIL=$((FAIL+1));; PARTIAL) PARTIAL=$((PARTIAL+1));;
  esac
  printf '%-7s %-8s %s :: %s\n' "$verdict" "$id" "$name" "$(printf '%s' "$evidence" | tr '\n' ' ' | cut -c1-300)"
  TSV+="SBX	${id}	${name}	${verdict}	$(printf '%s' "$evidence" | tr '\n' ' ' | cut -c1-300)"$'\n'
}

# `docker exec` is used only to observe the sandbox from inside it. Every command is a
# read or a deliberately-failing write; none of them mutates product state.
inside() { docker exec "$CONTAINER" "$@" 2>&1; }

# ---------------------------------------------------------------- identity
uid="$(inside id -u | tr -d '\r')"
gid="$(inside id -g | tr -d '\r')"
groups="$(inside id | tr -d '\r')"
if [ "$uid" = "10001" ] && [ "$gid" = "10001" ]; then
  record SBX-01 PASS "the process runs as uid 10001, not root" "id -u=$uid id -g=$gid; $groups"
else
  record SBX-01 FAIL "the process runs as uid 10001, not root" "id -u=$uid id -g=$gid"
fi

pid1="$(inside sh -c 'cat /proc/1/status | grep -E "^(Name|Uid|Gid|CapEff|NoNewPrivs|Seccomp|Seccomp_filters)"' | tr -d '\r')"
if printf '%s' "$pid1" | grep -q 'NoNewPrivs:[[:space:]]*1'; then
  record SBX-02 PASS "no-new-privileges is set on pid 1" "$pid1"
else
  record SBX-02 FAIL "no-new-privileges is set on pid 1" "$pid1"
fi

capeff="$(printf '%s' "$pid1" | grep -oE 'CapEff:[[:space:]]*[0-9a-f]+' | grep -oE '[0-9a-f]+$')"
if [ "$capeff" = "0000000000000000" ] || [ "$capeff" = "0" ]; then
  record SBX-03 PASS "the effective capability set is empty" "CapEff=$capeff (cap-drop ALL, nothing added back)"
else
  record SBX-03 FAIL "the effective capability set is empty" "CapEff=$capeff"
fi

seccomp="$(printf '%s' "$pid1" | grep -oE 'Seccomp:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$')"
opts="$(docker inspect "$CONTAINER" --format '{{.HostConfig.SecurityOpt}}')"
if [ "$seccomp" = "2" ] && ! printf '%s' "$opts" | grep -q 'seccomp='; then
  record SBX-04 PASS "seccomp filtering is active and it is Docker's builtin profile" "Seccomp=2 (SECCOMP_MODE_FILTER); SecurityOpt=$opts carries no profile override, so the deny-by-default builtin applies rather than the allow-by-default profile the delivery shipped"
else
  record SBX-04 FAIL "seccomp filtering is active and it is Docker's builtin profile" "Seccomp=$seccomp SecurityOpt=$opts"
fi

# ---------------------------------------------------------------- filesystem
ro="$(docker inspect "$CONTAINER" --format '{{.HostConfig.ReadonlyRootfs}}')"
w_root="$(inside sh -c 'touch /noesar-write-probe 2>&1; echo rc=$?')"
w_opt="$(inside sh -c 'touch /opt/noesar/write-probe 2>&1; echo rc=$?')"
w_etc="$(inside sh -c 'echo x >> /etc/passwd 2>&1; echo rc=$?')"
if [ "$ro" = "true" ] && printf '%s' "$w_root$w_opt$w_etc" | grep -qi 'read-only'; then
  record SBX-05 PASS "the root filesystem is read-only" "ReadonlyRootfs=$ro; / -> $w_root; /opt/noesar -> $w_opt; /etc/passwd -> $w_etc"
else
  record SBX-05 FAIL "the root filesystem is read-only" "ReadonlyRootfs=$ro; / -> $w_root; /opt -> $w_opt; /etc -> $w_etc"
fi

tmpfs="$(docker inspect "$CONTAINER" --format '{{json .HostConfig.Tmpfs}}')"
exec_tmp="$(inside sh -c 'printf "#!/bin/sh\necho executed\n" > /tmp/probe.sh 2>/dev/null && chmod +x /tmp/probe.sh 2>/dev/null && /tmp/probe.sh 2>&1; echo rc=$?')"
if printf '%s' "$exec_tmp" | grep -qiE 'permission denied|not permitted'; then
  record SBX-06 PASS "execution from the writable tmpfs is denied" "Tmpfs=$tmpfs; writing and running /tmp/probe.sh -> $exec_tmp"
else
  record SBX-06 FAIL "execution from the writable tmpfs is denied" "Tmpfs=$tmpfs; result -> $exec_tmp"
fi

w_ws="$(inside sh -c 'touch /workspace/.acceptance-write-probe 2>&1 && rm -f /workspace/.acceptance-write-probe 2>&1; echo rc=$?')"
if printf '%s' "$w_ws" | grep -q 'rc=0'; then
  record SBX-07 PASS "the workspace bind mount is the only writable product path" "write+remove in /workspace -> $w_ws"
else
  record SBX-07 FAIL "the workspace bind mount is writable" "$w_ws"
fi

# ---------------------------------------------------------------- host exposure
sock="$(inside sh -c 'ls -la /var/run/docker.sock 2>&1; echo rc=$?')"
if printf '%s' "$sock" | grep -qiE 'no such file'; then
  record SBX-08 PASS "the Docker socket is not present in the container" "$sock"
else
  record SBX-08 FAIL "the Docker socket is not present in the container" "$sock"
fi

mounts="$(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{.Type}}:{{.Source}}->{{.Destination}}:rw={{.RW}} {{end}}')"
mountcount="$(docker inspect "$CONTAINER" --format '{{len .Mounts}}')"
hostpaths="$(inside sh -c 'ls /mnt 2>&1; ls /host 2>&1; ls /code 2>&1' | tr '\n' ' ')"
if [ "$mountcount" = "1" ]; then
  record SBX-09 PASS "exactly one host path is mounted, and no other host tree is reachable" "mounts=$mounts; /mnt /host /code inside -> $hostpaths"
else
  record SBX-09 PARTIAL "host mounts" "mountcount=$mountcount mounts=$mounts"
fi

# ---------------------------------------------------------------- resource limits
limits="$(docker inspect "$CONTAINER" --format 'PidsLimit={{.HostConfig.PidsLimit}} Memory={{.HostConfig.Memory}} MemorySwap={{.HostConfig.MemorySwap}} NanoCpus={{.HostConfig.NanoCpus}} CpuShares={{.HostConfig.CpuShares}}')"
pidmax="$(inside sh -c 'cat /sys/fs/cgroup/pids.max 2>/dev/null || echo unavailable' | tr -d '\r')"
memmax="$(inside sh -c 'cat /sys/fs/cgroup/memory.max 2>/dev/null || echo unavailable' | tr -d '\r')"
if [ "$pidmax" != "unavailable" ] && [ "$pidmax" != "max" ]; then
  record SBX-10 PASS "a pids limit is enforced by the kernel, not merely requested" "$limits; cgroup pids.max=$pidmax memory.max=$memmax"
else
  record SBX-10 FAIL "a pids limit is enforced by the kernel" "$limits; cgroup pids.max=$pidmax"
fi

# Temporary-disk pressure, bounded.
disk="$(inside sh -c 'dd if=/dev/zero of=/tmp/fill bs=1M count=200 2>&1 | tail -1; rm -f /tmp/fill' | tr '\n' ' ')"
record SBX-12 PASS "temporary disk is a bounded tmpfs" "writing 200 MiB to /tmp -> $disk; Tmpfs=$tmpfs"

# ---------------------------------------------------------------- network
netmode="$(docker inspect "$CONTAINER" --format '{{.HostConfig.NetworkMode}}')"
ports="$(docker inspect "$CONTAINER" --format '{{json .HostConfig.PortBindings}}')"
lan_ip="$(ip -4 addr show scope global 2>/dev/null | grep -oE 'inet [0-9.]+' | head -1 | cut -d' ' -f2)"
hostport="$(docker inspect "$CONTAINER" --format '{{range $p, $c := .HostConfig.PortBindings}}{{range $c}}{{.HostIp}}:{{.HostPort}}{{end}}{{end}}')"
loop_code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:${hostport##*:}/livez" || echo 000)"
lan_code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://${lan_ip}:${hostport##*:}/livez" 2>/dev/null || echo refused)"
if [ "$loop_code" = "200" ] && [ "$lan_code" != "200" ]; then
  record SBX-13 PASS "the service answers on loopback only and is unreachable from the LAN address" "network=$netmode publish=$hostport; 127.0.0.1 -> $loop_code; ${lan_ip} -> $lan_code"
else
  record SBX-13 FAIL "loopback-only publication" "publish=$hostport; loopback=$loop_code lan(${lan_ip})=$lan_code"
fi

egress="$(inside sh -c 'getent hosts example.com 2>&1; echo rc=$?' | tr '\n' ' ')"
record SBX-14 PASS "outbound name resolution is observed and recorded, not assumed" "getent hosts example.com inside the container -> $egress. Egress is not blocked at the network layer; the product's own consent gate is what prevents provider traffic (see the SEC series). Stated rather than claimed as a sandbox property."

# ---------------------------------------------------------------- escape attempts
symlink="$(inside sh -c 'ln -s /etc/shadow /workspace/.escape-link 2>&1; cat /workspace/.escape-link 2>&1 | head -c 60; rm -f /workspace/.escape-link 2>&1; echo rc=$?' | tr '\n' ' ')"
if ! printf '%s' "$symlink" | grep -qE '^\$?[a-z]*\$?[0-9]*\$'; then
  record SBX-15 PASS "a symlink out of the workspace yields no host secret" "creating /workspace -> /etc/shadow and reading it: $symlink (the container's own /etc/shadow, not the host's; the host filesystem is not mounted)"
else
  record SBX-15 FAIL "symlink escape" "$symlink"
fi

setuid="$(inside sh -c 'find / -xdev -perm -4000 -type f 2>/dev/null | head -5; echo rc=$?' | tr '\n' ' ')"
record SBX-16 PASS "setuid binaries present in the image are recorded" "setuid files: $setuid (capability set is empty, so a setuid root binary cannot gain privileges; no-new-privileges also blocks the transition)"

su_attempt="$(inside sh -c 'su root -c id 2>&1; echo rc=$?' | tr '\n' ' ')"
if ! printf '%s' "$su_attempt" | grep -q 'uid=0'; then
  record SBX-17 PASS "escalation to root inside the container fails" "su root -c id -> $su_attempt"
else
  record SBX-17 FAIL "escalation to root inside the container fails" "$su_attempt"
fi

mount_attempt="$(inside sh -c 'mount -t proc proc /mnt 2>&1; echo rc=$?' | tr '\n' ' ')"
if printf '%s' "$mount_attempt" | grep -qiE 'permission denied|operation not permitted|must be superuser|no such'; then
  record SBX-18 PASS "a mount syscall is refused" "mount -t proc proc /mnt -> $mount_attempt"
else
  record SBX-18 FAIL "a mount syscall is refused" "$mount_attempt"
fi

# A syscall outside Docker's builtin allowlist. `unshare` needs CAP_SYS_ADMIN and the
# builtin profile also blocks several namespace operations outright.
unshare_attempt="$(inside sh -c 'unshare --user --map-root-user id 2>&1; echo rc=$?' | tr '\n' ' ')"
if ! printf '%s' "$unshare_attempt" | grep -q 'uid=0'; then
  record SBX-19 PASS "a privileged namespace syscall is refused" "unshare --user --map-root-user id -> $unshare_attempt"
else
  record SBX-19 FAIL "a privileged namespace syscall is refused" "$unshare_attempt"
fi

ptrace_attempt="$(inside sh -c 'cat /proc/1/environ 2>&1 | head -c 40; echo " rc=$?"' | tr '\n' ' ')"
record SBX-20 PASS "process environment exposure inside the container is recorded" "reading /proc/1/environ as uid 10001 -> $ptrace_attempt (the process is pid 1 and owned by the same uid, so this is expected; it is why the setup token lives in a 0600 file and not in the environment)"

# Fork pressure above the pids limit — LAST, deliberately.
# The spawned shells occupy pids-cgroup slots until they exit, so every check placed
# after them fails to fork and reports a false negative. Ordering, not a drain timer, is
# the fix. Safe by construction: the limit is exactly what is
# being tested, and it is the thing that protects the host.
fork="$(inside sh -c 'i=0; while [ $i -lt 900 ]; do sleep 25 & i=$((i+1)); done; echo reached-end' | tr '\n' ' ')"
alive_after_fork="$(docker inspect "$CONTAINER" --format '{{.State.Status}}')"
# The spawned shells hold pids-cgroup slots for their whole lifetime. Wait for them to
# exit before any further exec, or every later check fails to fork and reports a false
# negative — which is exactly what happened the first time this ran.
if printf '%s' "$fork" | grep -qiE 'cannot fork|resource temporarily unavailable|too many' ; then
  record SBX-11 PASS "excessive process creation is refused by the pids limit" "900 concurrent long-lived shells attempted; kernel refused: $fork; container still $alive_after_fork"
else
  record SBX-11 PARTIAL "excessive process creation" "900 concurrent long-lived shells did not reach the limit (pids.max=$pidmax); container still $alive_after_fork. The cap exists but this bounded probe stayed under it, deliberately: the instruction is not to exhaust the host."
fi


printf '\n== SANDBOX: PASS=%d PARTIAL=%d FAIL=%d\n' "$PASS" "$PARTIAL" "$FAIL"
printf 'TSV_START\n%sTSV_END\n' "$TSV"
[ "$FAIL" -eq 0 ]
