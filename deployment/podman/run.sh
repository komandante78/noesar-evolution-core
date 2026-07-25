#!/usr/bin/env sh
set -eu

IMAGE="${NOESAR_IMAGE:-localhost/noesar-evolution:v4-complete}"
NAME="${NOESAR_CONTAINER:-noesar-evolution}"
PORT="${NOESAR_PORT:-8088}"
WORKSPACE="${NOESAR_WORKSPACE:-$PWD/noesar-workspace}"
NETWORK="${NOESAR_NETWORK:-noesar-local}"
MEMORY="${NOESAR_MEMORY_LIMIT:-8g}"
CPUS="${NOESAR_CPU_LIMIT:-4}"
ALLOWED_HOSTS="${NOESAR_ALLOWED_HOSTS:-localhost,127.0.0.1,::1}"
SECURE_COOKIES="${NOESAR_SECURE_COOKIES:-false}"

mkdir -p "$WORKSPACE"
chmod 0700 "$WORKSPACE"
podman network inspect "$NETWORK" >/dev/null 2>&1 \
  || podman network create --internal "$NETWORK" >/dev/null

exec podman run --rm --name "$NAME" \
  --network "$NETWORK" \
  --publish "127.0.0.1:${PORT}:8088" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m \
  --tmpfs /run:rw,noexec,nosuid,nodev,size=16m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 512 \
  --memory "$MEMORY" \
  --cpus "$CPUS" \
  --userns keep-id \
  --env "NOESAR_RELEASE_CHANNEL=$RELEASE_CHANNEL" \
  --env NOESAR_AUTHORITY_MODE=reference-node \
  --env NOESAR_DATA_PLANE=reference-json \
  --env "NOESAR_ALLOWED_HOSTS=$ALLOWED_HOSTS" \
  --env "NOESAR_SECURE_COOKIES=$SECURE_COOKIES" \
  --mount "type=bind,src=$(cd "$WORKSPACE" && pwd),dst=/workspace,rw" \
  "$IMAGE"
