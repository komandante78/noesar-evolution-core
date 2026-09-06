#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# Layout detection. In the delivered package-02 layout the product sits under
# RUNTIME_SOURCE/; in the canonical repository the product IS the root. Hardcoding
# RUNTIME_SOURCE made this installer abort at the `test -f` below on a canonical
# checkout. Detect the layout instead of assuming it, so both work unchanged.
if [ -f "$PACKAGE_ROOT/RUNTIME_SOURCE/oci/Dockerfile" ]; then
  RUNTIME_ROOT="$PACKAGE_ROOT/RUNTIME_SOURCE"
else
  RUNTIME_ROOT="$PACKAGE_ROOT"
fi
IMAGE="${NOESAR_IMAGE:-noesar-evolution:v4-complete}"
CONTAINER="${NOESAR_CONTAINER:-noesar-evolution}"
PORT="${NOESAR_PORT:-8088}"
WORKSPACE="${NOESAR_WORKSPACE:-/mnt/user/appdata/noesar-evolution}"
NETWORK="${NOESAR_NETWORK:-noesar-local}"
HOST_IP="${NOESAR_HOST_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
RUN_AS="${NOESAR_RUN_AS:-10001:10001}"

command -v docker >/dev/null 2>&1 || { echo "Docker is required." >&2; exit 1; }
test -f "$RUNTIME_ROOT/oci/Dockerfile"
mkdir -p "$WORKSPACE"
chmod 0700 "$WORKSPACE"

# Where the WebUI is published. Loopback unless the operator says otherwise; the
# choice is remembered so an update or a reinstall keeps the same URL.
# shellcheck source=../deployment/lib/network-access.sh
. "$RUNTIME_ROOT/deployment/lib/network-access.sh"
noesar_install_intro "$WORKSPACE" "$RUNTIME_ROOT" "$PORT" || exit 1
PORT="$NOESAR_RESOLVED_PORT"
noesar_resolve_access "$WORKSPACE" || exit 1
BIND_ADDRESS="$NOESAR_RESOLVED_BIND_ADDRESS"
BIND_SCOPE="$NOESAR_RESOLVED_BIND_SCOPE"
ACCESS_MODE="$NOESAR_RESOLVED_ACCESS_MODE"
PROBE_ADDRESS="$(noesar_probe_address "$BIND_ADDRESS")"
# The published address must be in the Host allowlist or every browser request to it
# is answered 421 — which presents as "the install is broken", not as a policy denial.
ALLOWED_HOSTS="${NOESAR_ALLOWED_HOSTS:-localhost,127.0.0.1,::1,${BIND_ADDRESS},${HOST_IP:-}}"

docker image inspect node:22-bookworm-slim >/dev/null 2>&1 || {
  echo "Required base image node:22-bookworm-slim is not present locally." >&2
  echo "Load or pull it explicitly before retrying." >&2
  exit 1
}

docker build --pull=false -f "$RUNTIME_ROOT/oci/Dockerfile" -t "$IMAGE" "$RUNTIME_ROOT"

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "Container $CONTAINER already exists. Remove or rename it explicitly before installation." >&2
  exit 1
fi
# The Docker builtin seccomp profile is used deliberately and must not be replaced.
# security/seccomp-noesar.json ships with defaultAction=SCMP_ACT_ALLOW and a 24-syscall
# denylist; passing it via --security-opt seccomp= REPLACES the builtin deny-by-default
# allowlist and therefore WEAKENS the sandbox. That file is marked NOT_FOR_USE.
# See docs/CONTAINER_SECURITY_PROFILE.md and decision D-0024.

docker run -d --name "$CONTAINER" \
  --restart unless-stopped \
  --network "$NETWORK" \
  --publish "${BIND_ADDRESS}:${PORT}:8088" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m \
  --tmpfs /run:rw,noexec,nosuid,nodev,size=16m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 512 \
  --memory "${NOESAR_MEMORY_LIMIT:-8g}" \
  --memory-swap "${NOESAR_MEMORY_SWAP_LIMIT:-8g}" \
  --cpus "${NOESAR_CPU_LIMIT:-4}" \
  --user "$RUN_AS" \
  --env NOESAR_RELEASE_CHANNEL=complete \
  --env NOESAR_AUTHORITY_MODE=reference-node \
  --env NOESAR_DATA_PLANE=reference-json \
  --env "NOESAR_ALLOWED_HOSTS=$ALLOWED_HOSTS" \
  --env "NOESAR_BIND_ADDRESS=$BIND_ADDRESS" \
  --env "NOESAR_BIND_SCOPE=$BIND_SCOPE" \
  --env NOESAR_SECURE_COOKIES=false \
  --mount "type=bind,src=$WORKSPACE,dst=/workspace,readonly=false" \
  "$IMAGE" >/dev/null

noesar_persist_access_choice "$WORKSPACE" "$ACCESS_MODE" "$BIND_ADDRESS" "$PORT" "$BIND_SCOPE" "$RUN_AS" || true

# Probe the address the port was actually published on. Probing 127.0.0.1 while the
# publish is on a LAN address reports FAIL for an installation that came up fine.
for _ in $(seq 1 30); do
  if curl -fsS "http://${PROBE_ADDRESS}:${PORT}/healthz" >/dev/null 2>&1; then
    echo "INSTALLATION_STARTUP=PASS"
    echo "ACCESS_MODE=$ACCESS_MODE"
    echo "BIND_ADDRESS=$BIND_ADDRESS"
    echo
    echo "Open NOESAR Evolution:"
    echo "http://${BIND_ADDRESS}:${PORT}"
    noesar_print_first_signin
    echo
    echo "WEBUI=http://${BIND_ADDRESS}:${PORT}/"
    echo "WORKSPACE=$WORKSPACE"
    exit 0
  fi
  sleep 1
done

echo "INSTALLATION_STARTUP=FAIL" >&2
docker logs --tail 200 "$CONTAINER" >&2 || true
exit 1
