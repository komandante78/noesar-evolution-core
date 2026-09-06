#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# CE-031 — "the session is reachable by a user who is NOT an administrator of the host, on
# the host and from another machine", verified the way the row itself demands: *"accesso
# reale da un secondo utente, senza privilegi sul motore di contenitori"*.
#
#   tools/acceptance/ce-031-second-machine.sh [image]
#
# Exit 0 = executed and passed · 1 = executed and failed · 2 = could not be executed here,
# and says why. Two is not a pass and `step_tristate` in `scripts/test.sh` refuses to count
# it as one — a host with no container engine gets an honest declaration, never a silent skip.
#
# WHY THIS FILE EXISTS, given the row was once called ✅.
#
# On 2026-08-07 (`D-0341`) CE-031 was proved on this host by creating a system account, adding
# three `sudoers` rules and editing `sshd_config`. Three things are wrong with leaving that as
# the proof. It is a HOST modification, which the platform law forbids the product to make and
# which therefore cannot be a step of any repeatable test. It did not survive: `/etc` on that
# host lives in a RAM-backed root, so the account, the rules and the `sshd` block are gone at
# the next boot — the evidence has an expiry date nobody wrote down. And it proved reaching an
# authentication PROMPT, which is not the same claim as reaching a session.
#
# So this proves the half that belongs to the product and can be re-run by anyone who clones
# the repository, on any host with a container engine, changing nothing outside itself.
#
# WHAT IS PROVED, AND WHAT IS NOT — stated here rather than left to be inferred:
#
#   proved   a machine with its own network namespace, an unprivileged uid, NO container-engine
#            socket and no credential of this host registers and DRIVES the session over TCP;
#            and on the host itself an unprivileged uid, not in the engine's group, reaches the
#            same session while the one word correctly declares it cannot.
#   NOT      a different operating system, a different kernel, a real `sshd`, or a machine that
#            is physically not this one. Those are `CE-035`, and they need a second computer.
#            A container is an excellent second HOST for the network question and is not a
#            second machine for the portability question; conflating the two would be the
#            `L0-L8` mistake this project already paid for once.
set -eu

fail=0
check() {
  if [ "$1" = 0 ]; then printf 'PASS  %s\n' "$2"; else printf 'FAIL  %s  — %s\n' "$2" "${3:-}"; fail=$((fail + 1)); fi
}

# `verify <description> <detail-on-failure> -- <test command…>`
#
# Same shape as `ce-032-launcher-in-container.sh`, and for the same measured reason: under
# `set -eu` a bare false `[ … ]` terminates the shell with no FAIL line and exit 0, so an
# oracle written the obvious way reports success while proving nothing (`D-0390`, twice).
verify() {
  desc=$1; detail=$2; shift 3   # the third argument is the literal `--`
  if "$@"; then check 0 "$desc"; else check 1 "$desc" "$detail"; fi
}
equals() { [ "$1" = "$2" ]; }
differs() { [ "$1" != "$2" ]; }

if ! command -v docker >/dev/null 2>&1; then
  printf 'CE031_SECOND_MACHINE=UNAVAILABLE  no container engine on this host to raise a second machine with\n'
  exit 2
fi

# The image, in the order that keeps this honest on a machine that is not this one: what the
# caller named, else what the running installation is actually built from, else the newest
# product tag. Never a hardcoded tag — a tag written here would rot the day it is rebuilt.
image=${1:-${NOESAR_CE031_IMAGE:-}}
if [ -z "$image" ]; then
  image=$(docker inspect noesar-evolution --format '{{.Config.Image}}' 2>/dev/null || true)
fi
if [ -z "$image" ]; then
  image=$(docker images --format '{{.Repository}}:{{.Tag}}' 'noesar-evolution' 2>/dev/null | head -n 1 || true)
fi
if [ -z "$image" ]; then
  printf 'CE031_SECOND_MACHINE=UNAVAILABLE  no noesar-evolution image on this host to install from\n'
  exit 2
fi

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
INSTALL="noesar-evolution.ce031-install-${STAMP}"
# The stable, unstamped network §5a requires this project to reuse. A stamped bridge per run
# takes a subnet from Docker's finite pool and nothing here is allowed to remove a network.
NETWORK="noesar-e2e-net"

printf 'CE-031 — a second machine, an unprivileged user, and no engine\n\n  image    %s\n  install  %s\n  network  %s\n\n' \
  "$image" "$INSTALL" "$NETWORK"

cleanup() {
  rc=$?
  if [ "$rc" -ne 0 ]; then
    printf -- '--- disposable installation logs (dumped before removal; exit %s) ---\n' "$rc"
    docker logs "$INSTALL" 2>&1 | tail -40 || true
  fi
  # §5a: whatever this run created, this run removes, pass or fail, by name and never by prune.
  docker rm -f "$INSTALL" >/dev/null 2>&1 || true
  printf 'CLEANUP=removed %s\n' "$INSTALL"
}
trap cleanup EXIT

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

# The disposable installation. Published on the HOST'S LOOPBACK ONLY, on a port the kernel
# picks — never on a routable address, and never on a port anybody chose in advance.
#
# That asymmetry is deliberate and is what keeps the two halves from contaminating each other.
# The host half needs an address a host process can dial; a loopback publication is exactly
# that and nothing more. The second machine cannot use it — inside its own network namespace
# 127.0.0.1 is itself — so it is left with the container name across the bridge, which is the
# thing under test. A routable publication would have let a mistake in the network setup look
# like a success.
#
# The whole workspace — including this run's PostgreSQL cluster — is a tmpfs, so nothing of it
# ever lands on the host and removing the container is the entire cleanup.
docker run -d --name "$INSTALL" \
  --network "$NETWORK" \
  -p 127.0.0.1::8088 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --tmpfs /run:rw,nosuid,nodev,noexec,mode=1777 \
  --tmpfs /workspace:rw,nosuid,nodev,uid=10001,gid=10001,size=768m \
  -e NOESAR_WORKSPACE=/workspace \
  -e NOESAR_RUNTIME_ROOT=/opt/noesar \
  -e NOESAR_HOST=0.0.0.0 \
  -e NOESAR_PORT=8088 \
  -e NOESAR_BIND_ADDRESS=0.0.0.0 \
  -e NOESAR_BIND_SCOPE=custom \
  -e NOESAR_ALLOWED_HOSTS="${INSTALL},localhost,127.0.0.1,::1" \
  -e NOESAR_SECURE_COOKIES=false \
  -e NOESAR_SETUP_TOKEN_FILE=/workspace/config/first-owner-setup.token \
  -e NOESAR_DATA_PLANE=postgresql \
  -e NOESAR_POSTGRES_BINDIR=/usr/lib/postgresql/18/bin \
  -e NOESAR_POSTGRES_ROOT=/workspace/postgresql \
  -e NOESAR_MIGRATIONS_DIR=/opt/noesar/database/postgres \
  -e NOESAR_AUTHORITY_MODE=reference-node \
  -e NOESAR_LOCAL_MODEL_RUNTIME=disabled \
  "$image" >/dev/null

# A cold start initialises a PostgreSQL cluster and applies every migration. Waited for by
# asking the container what it thinks, never by sleeping a number somebody guessed.
ready=0
i=0
while [ "$i" -lt 180 ]; do
  if docker exec "$INSTALL" node -e 'fetch("http://127.0.0.1:8088/readyz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    ready=1; break
  fi
  i=$((i + 1))
  sleep 1
done
if [ "$ready" != 1 ]; then
  printf 'CE031_SECOND_MACHINE=UNAVAILABLE  the disposable installation never became ready in 180s\n'
  docker logs "$INSTALL" 2>&1 | tail -30 || true
  exit 2
fi
printf 'INSTALL_READY=%ss\n\n' "$i"

# The first-owner token, carried out of band by the administrator who installed the product —
# which is exactly how it travels in life. Read with the engine, i.e. as the ADMINISTRATOR of
# this host; the second machine never touches a path of this one.
#
# It is handed to the probe as an argument, so it is visible in this host's process list and in
# `docker inspect` for the seconds that container exists. Said rather than left to be noticed:
# the token belongs to an installation that is created and destroyed inside this script, has no
# existence before or after it, and never reaches a tracked file (§7).
token=$(docker exec "$INSTALL" cat /workspace/config/first-owner-setup.token 2>/dev/null | tr -d '\r\n' || true)
if [ -z "$token" ]; then
  printf 'CE031_SECOND_MACHINE=UNAVAILABLE  the installation produced no first-owner setup token to register with\n'
  exit 2
fi

# ------------------------------------------------------------------------------------------
# 1 · THE SECOND MACHINE
#
# Its own network namespace, uid 65534 (`nobody`), a read-only root, every capability dropped,
# NO engine socket, and not one path of this host — only `ce-031-remote-probe.mjs`, mounted
# read-only, which is the stand-in for "the product's CLI is installed on that machine".
# Removed by `--rm` the moment it is done.
# ------------------------------------------------------------------------------------------
printf -- '--- the second machine (uid 65534, own namespace, no engine socket) ---\n'
remote_status=0
docker run --rm \
  --network "$NETWORK" \
  --user 65534:65534 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  --mount "type=bind,source=${ROOT}/tools/acceptance/ce-031-remote-probe.mjs,target=/probe.mjs,readonly" \
  -e NOESAR_RUNTIME_ROOT=/opt/noesar \
  --entrypoint node \
  "$image" /probe.mjs "http://${INSTALL}:8088" "$token" || remote_status=$?

verify 'the second machine registered and drove the session, with no engine and no host path' \
  "the remote probe exited $remote_status" -- equals "$remote_status" 0

# ------------------------------------------------------------------------------------------
# 2 · THE OTHER HALF OF THE ROW: *on the host*, as a non-administrator
#
# Same question, asked of a process on this host rather than in a container. Privileges are
# DROPPED, never granted: no account is created, nothing is written, nothing outside this
# script is touched. If the host offers no way to drop them, that is declared — an unmeasured
# half reported as measured is the failure this project keeps finding in its own records.
# ------------------------------------------------------------------------------------------
printf -- '\n--- on the host, as an unprivileged uid ---\n'
drop=
if [ "$(id -u)" != 0 ]; then
  drop=none                      # already unprivileged: nothing to drop
elif command -v setpriv >/dev/null 2>&1; then
  drop=setpriv
elif command -v su >/dev/null 2>&1 && id nobody >/dev/null 2>&1; then
  drop=su
fi

as_unprivileged() {
  case $drop in
    none)    sh -c "$1" ;;
    setpriv) setpriv --reuid=65534 --regid=65534 --clear-groups sh -c "$1" ;;
    su)      su -s /bin/sh nobody -c "$1" ;;
  esac
}

# Dropping privileges is not enough: that uid must also be able to REACH this tree. A clone
# under a private home is unreadable to it for reasons that have nothing to do with the product
# — on the host this was found on, `/root` is `0710`, so the launcher below exited 126,
# "Permission denied", and the row read FAIL. That is the expected red this whole script exists
# to refuse: an environment that cannot run a check is DECLARED, never counted as a failure of
# the thing being checked. Asked of the uid itself rather than inferred from the path.
if [ -n "$drop" ] && ! as_unprivileged "[ -x '$ROOT/tools/coden-evolution' ]"; then
  no_host_half="the unprivileged uid cannot reach $ROOT — the host half needs this tree on a path it can traverse"
  drop=
fi

if [ -z "$drop" ]; then
  printf 'HOST_HALF=UNAVAILABLE  %s\n' \
    "${no_host_half:-running as root and this host offers neither setpriv nor a usable nobody account}"
  printf 'CE031_SECOND_MACHINE_FAIL=%s\n' "$fail"
  [ "$fail" = 0 ] || exit 1
  exit 2
fi
printf 'HOST_PRIVILEGE_DROP=%s  (uid now %s)\n' "$drop" "$(as_unprivileged 'id -u')"

# 2a · the one word, as that user. It must DECLARE that it cannot reach the engine, not fail
# obscurely — this is the "senza privilegi sul motore di contenitori" clause, executed on the
# host. The environment is emptied of the two variables that would hand it a socket, because
# what is under test is what an ordinary account finds, not what this script can arrange.
#
# Captured through `if`, not through `cmd; printf "$?"` inside a substitution — and that is a
# repair, not a style choice. The first version of this line was
#
#     out=$(as_unprivileged "…the launcher…"; printf 'EXIT=%s' "$?")
#
# and it took the whole script down with exit 3 the first time it ran. A command substitution
# inherits `set -e`, so the launcher's expected non-zero exit killed the SUBSHELL before the
# `printf` that was there to record it, and the outer shell then died on the assignment. That is
# `D-0390` for the third time in this corner of the product — the trap the header of this file
# warns about, sprung by the file itself. A substitution inside `if` is exempt, and `$?` in the
# `else` branch is exactly the status that was being reached for.
# And the branches are `then`/`else`, not `if !` — a second repair on the same line. With the
# condition negated, `$?` in the body is the status of the `!`, which is 0 by construction: the
# first version of this fix recorded `exit=0` for a launcher that had visibly just exited 3, and
# would have gone on recording it forever.
host_launcher_exit=0
if host_launcher_out=$(as_unprivileged "NOESAR_TUI_SOCKET_PATH= NOESAR_WORKSPACE= NOESAR_EVOLUTION_LAUNCHER_CONF=/nonexistent ${ROOT}/tools/coden-evolution 2>&1"); then
  host_launcher_exit=0
else
  host_launcher_exit=$?
fi
printf '%s\n' "$host_launcher_out" | sed 's/^/  | /' | head -12

verify 'on the host, an unprivileged account is refused by the engine and told so, exit 3' \
  "exit=$host_launcher_exit" -- equals "$host_launcher_exit" 3

verify 'and it is told where it CAN get in from here, rather than left with a dead end' \
  'the browser entrance was not named' \
  -- differs "$(printf '%s' "$host_launcher_out" | grep -c 'in a browser' || true)" 0

# 2b · and that same unprivileged account reaches the session over TCP. Not by knowing where
# anything lives on disk and not through the engine — through the loopback address the
# installation was published on, which is all an ordinary account on this host has.
#
# The port is read back from the engine rather than chosen: `-p 127.0.0.1::8088` lets the kernel
# pick a free one, so two runs never collide and no port number is hardcoded into a test.
host_published=$(docker port "$INSTALL" 8088/tcp 2>/dev/null | head -n 1 || true)
host_reach=none
if [ -n "$host_published" ] && command -v node >/dev/null 2>&1; then
  host_reach=$(as_unprivileged "node -e 'fetch(\"http://${host_published}/livez\").then(r=>console.log(r.status)).catch(e=>console.log(\"ERR:\"+e.message))'" 2>/dev/null || printf 'ERR')
fi

if [ "$host_reach" = none ]; then
  printf 'HOST_TCP=UNAVAILABLE  no node on this host, or nothing published, to speak HTTP with as the unprivileged account\n'
else
  verify 'on the host, that same unprivileged account reaches the session over TCP' \
    "GET http://${host_published}/livez -> ${host_reach}" -- equals "$host_reach" 200
fi

printf '\nCE031_SECOND_MACHINE_FAIL=%s\n' "$fail"
[ "$fail" = 0 ] || exit 1
