#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
IMAGE="${NOESAR_IMAGE:-noesar-evolution:v4-complete}"
NAME="${NOESAR_CONTAINER:-noesar-evolution}"
PORT="${NOESAR_PORT:-8088}"
WORKSPACE="${NOESAR_WORKSPACE:-$PWD/noesar-workspace}"
NETWORK="${NOESAR_NETWORK:-noesar-local}"
MEMORY="${NOESAR_MEMORY_LIMIT:-8g}"
MEMORY_SWAP="${NOESAR_MEMORY_SWAP_LIMIT:-8g}"
CPUS="${NOESAR_CPU_LIMIT:-4}"
RUN_AS="${NOESAR_RUN_AS:-10001:10001}"
SECURE_COOKIES="${NOESAR_SECURE_COOKIES:-false}"
RELEASE_CHANNEL="${NOESAR_RELEASE_CHANNEL:-complete}"

case "$RELEASE_CHANNEL" in
  complete|development) ;;
  *) echo "Unsupported release channel: $RELEASE_CHANNEL" >&2; exit 1 ;;
esac

mkdir -p "$WORKSPACE"
chmod 0700 "$WORKSPACE"

# This script used to hardcode 127.0.0.1 in the publish, so there was no supported way
# to reach it from another machine at all. It now takes the same access decision as the
# Unraid installers, with the same loopback default.
# shellcheck source=../lib/network-access.sh
. "$SCRIPT_DIR/../lib/network-access.sh"
noesar_install_intro "$WORKSPACE" "$SCRIPT_DIR/../.." "$PORT" || exit 1
PORT="$NOESAR_RESOLVED_PORT"
noesar_resolve_access "$WORKSPACE" || exit 1
BIND_ADDRESS="$NOESAR_RESOLVED_BIND_ADDRESS"
BIND_SCOPE="$NOESAR_RESOLVED_BIND_SCOPE"
ACCESS_MODE="$NOESAR_RESOLVED_ACCESS_MODE"
ALLOWED_HOSTS="${NOESAR_ALLOWED_HOSTS:-localhost,127.0.0.1,::1,${BIND_ADDRESS}}"
noesar_persist_access_choice "$WORKSPACE" "$ACCESS_MODE" "$BIND_ADDRESS" "$PORT" "$BIND_SCOPE" "$RUN_AS" || true

echo
echo "Open NOESAR Evolution:"
echo "http://${BIND_ADDRESS}:${PORT}"
noesar_print_first_signin
echo
docker network inspect "$NETWORK" >/dev/null 2>&1 \
  || docker network create --internal "$NETWORK" >/dev/null

exec docker run --rm --name "$NAME" \
  --network "$NETWORK" \
  --publish "${BIND_ADDRESS}:${PORT}:8088" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m \
  --tmpfs /run:rw,noexec,nosuid,nodev,size=16m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 512 \
  --memory "$MEMORY" \
  --memory-swap "$MEMORY_SWAP" \
  --cpus "$CPUS" \
  --user "$RUN_AS" \
  --env "NOESAR_RELEASE_CHANNEL=$RELEASE_CHANNEL" \
  --env NOESAR_AUTHORITY_MODE=reference-node \
  --env NOESAR_DATA_PLANE=reference-json \
  --env "NOESAR_ALLOWED_HOSTS=$ALLOWED_HOSTS" \
  --env "NOESAR_BIND_ADDRESS=$BIND_ADDRESS" \
  --env "NOESAR_BIND_SCOPE=$BIND_SCOPE" \
  --env "NOESAR_SECURE_COOKIES=$SECURE_COOKIES" \
  --mount "type=bind,src=$(CDPATH= cd -- "$WORKSPACE" && pwd),dst=/workspace,readonly=false" \
  "$IMAGE"
