#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_ROOT="$PACKAGE_ROOT"
IMAGE="${NOESAR_IMAGE:-noesar-evolution:v4-complete}"
CONTAINER="${NOESAR_CONTAINER:-noesar-evolution}"
PORT="${NOESAR_PORT:-8088}"
WORKSPACE="${NOESAR_WORKSPACE:-/mnt/user/appdata/noesar-evolution}"
NETWORK="${NOESAR_NETWORK:-noesar-local}"
BIND_ADDRESS="${NOESAR_BIND_ADDRESS:-127.0.0.1}"
HOST_IP="${NOESAR_HOST_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
ALLOWED_HOSTS="${NOESAR_ALLOWED_HOSTS:-localhost,127.0.0.1,::1,${HOST_IP:-}}"

command -v docker >/dev/null 2>&1 || { echo "Docker is required." >&2; exit 1; }
test -f "$RUNTIME_ROOT/oci/Dockerfile"
mkdir -p "$WORKSPACE"
chmod 0700 "$WORKSPACE"

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
  --cpus "${NOESAR_CPU_LIMIT:-4}" \
  --env NOESAR_RELEASE_CHANNEL=complete \
  --env NOESAR_AUTHORITY_MODE=reference-node \
  --env NOESAR_DATA_PLANE=reference-json \
  --env "NOESAR_ALLOWED_HOSTS=$ALLOWED_HOSTS" \
  --env NOESAR_SECURE_COOKIES=false \
  --mount "type=bind,src=$WORKSPACE,dst=/workspace,readonly=false" \
  "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    echo "INSTALLATION_STARTUP=PASS"
    echo "WEBUI=http://${BIND_ADDRESS}:${PORT}/"
    echo "WORKSPACE=$WORKSPACE"
    exit 0
  fi
  sleep 1
done

echo "INSTALLATION_STARTUP=FAIL" >&2
docker logs --tail 200 "$CONTAINER" >&2 || true
exit 1
