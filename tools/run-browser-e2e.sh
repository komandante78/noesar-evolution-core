#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Run the browser acceptance suite against a DISPOSABLE probe of the current source.
#
# Nothing here touches the real installation. A fresh container is built offline as a
# two-directory overlay on the audited image, given an empty workspace of its own, and
# driven by the digest-pinned Puppeteer image over a dedicated Docker network. The probe
# bootstraps its own throwaway Owner from its own generated setup token, so no real
# credential is ever supplied to, or read by, this script.
#
# Containers, the probe image and the runner are REMOVED at the end, pass or fail:
# CLAUDE10.md §5a requires this run to clean up after itself. Probe logs are dumped to
# stdout before removal, so nothing diagnostic is lost with the container. Set
# NOESAR_E2E_KEEP=1 to preserve them for interactive debugging; anything left behind that
# way is a survivor you must remove yourself.
#
# The repository is mounted UNDER the Puppeteer image's home directory on purpose. An
# `import 'puppeteer'` from a file outside that tree cannot resolve: NODE_PATH is a
# CommonJS mechanism and does nothing for ES modules, so the only thing that works is
# for the importing file to sit somewhere the node_modules walk-up reaches
# /home/pptruser/node_modules.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_ROOT="${NOESAR_ARTIFACT_ROOT:-/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

BASE_IMAGE="${NOESAR_E2E_BASE_IMAGE:-noesar-evolution:phase4-complete-lan}"
PROBE_IMAGE="noesar-evolution:webui-e2e-${STAMP}"
PROBE_NAME="noesar-evolution.e2e-probe-${STAMP}"
RUNNER_NAME="noesar-evolution.e2e-runner-${STAMP}"
# A single stable network, created once and reused.
#
# The first version stamped the network name too. Nothing here may delete a network
# (CLAUDE10.md §4 rule 12), so every run left one behind and eleven accumulated on the
# host during this phase before it was noticed. Reuse is also sufficient for isolation:
# the probe and runner names still carry the stamp, so two runs never collide.
NETWORK="noesar-e2e-net"
WORKSPACE="${ARTIFACT_ROOT}/e2e/${STAMP}/workspace"
PUPPETEER_IMAGE="ghcr.io/puppeteer/puppeteer@sha256:9665f5b57abc5cc7080a641878964018de219055a4d2c9d8d050ceb1161778ba"

echo "PROBE_IMAGE=${PROBE_IMAGE}"
echo "BASE_IMAGE=${BASE_IMAGE}"
echo "WORKSPACE=${WORKSPACE}"

mkdir -p "${WORKSPACE}"
# The container runs as 10001:10001 with a read-only root filesystem.
chown -R 10001:10001 "${ARTIFACT_ROOT}/e2e/${STAMP}"

# --- build the probe image, offline ----------------------------------------
# --network=none and --pull=false: the overlay must not re-resolve anything. The only
# difference from the audited base image is first-party source.
cat >"${ARTIFACT_ROOT}/e2e/${STAMP}/Dockerfile.e2e" <<DOCKERFILE
# SPDX-License-Identifier: AGPL-3.0-or-later
# Disposable probe: the audited image with the working tree's WebUI and control plane.
FROM ${BASE_IMAGE}
USER root
COPY --chown=10001:10001 apps/webui-static/ /opt/noesar/apps/webui-static/
COPY --chown=10001:10001 services/reference-control-plane/src/ /opt/noesar/services/reference-control-plane/src/
USER 10001:10001
DOCKERFILE

docker build --network=none --pull=false \
  -f "${ARTIFACT_ROOT}/e2e/${STAMP}/Dockerfile.e2e" \
  -t "${PROBE_IMAGE}" "${PROJECT_ROOT}" >/dev/null
echo "BUILD=ok"

docker network inspect "${NETWORK}" >/dev/null 2>&1 || docker network create "${NETWORK}" >/dev/null
echo "NETWORK=${NETWORK}"

# The Host allowlist is baked from the same setting as the publish. The runner reaches
# the probe by container name, so that name must be allowed or every request answers 421
# — the defect the LAN access gate found and fixed.
#
# `/run` needs to be writable, mode 1777, since D-0242 added codev's unix socket
# (`/run/codev-peer.sock`) — this probe never got that flag and has crash-looped on boot
# (EROFS) since, found running T2 for D-0255 rather than by anyone using this script in between.
docker run -d --name "${PROBE_NAME}" \
  --network "${NETWORK}" \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --tmpfs /run:rw,nosuid,nodev,noexec,mode=1777 \
  --mount "type=bind,source=${WORKSPACE},target=/workspace,readonly=false" \
  -e NOESAR_WORKSPACE=/workspace \
  -e NOESAR_RUNTIME_ROOT=/opt/noesar \
  -e NOESAR_HOST=0.0.0.0 \
  -e NOESAR_PORT=8088 \
  -e NOESAR_BIND_ADDRESS=0.0.0.0 \
  -e NOESAR_BIND_SCOPE=custom \
  -e NOESAR_ALLOWED_HOSTS="${PROBE_NAME},localhost,127.0.0.1,::1" \
  -e NOESAR_SECURE_COOKIES=false \
  -e NOESAR_SETUP_TOKEN_FILE=/workspace/config/first-owner-setup.token \
  -e NOESAR_DATA_PLANE=postgresql \
  -e NOESAR_POSTGRES_BINDIR=/usr/lib/postgresql/18/bin \
  -e NOESAR_POSTGRES_ROOT=/workspace/postgresql \
  -e NOESAR_MIGRATIONS_DIR=/opt/noesar/database/postgres \
  -e NOESAR_AUTHORITY_MODE=reference-node \
  -e NOESAR_LOCAL_MODEL_RUNTIME=disabled \
  "${PROBE_IMAGE}" >/dev/null
echo "PROBE=${PROBE_NAME}"

cleanup() {
  local rc=$?
  if [ "${rc}" -ne 0 ]; then
    echo "--- probe logs (dumped before removal; exit ${rc}) ---"
    docker logs "${PROBE_NAME}" 2>&1 | tail -60 || true
  fi
  docker stop "${PROBE_NAME}" "${RUNNER_NAME}" >/dev/null 2>&1 || true
  if [ "${NOESAR_E2E_KEEP:-0}" = "1" ]; then
    echo "--- probe and runner PRESERVED (NOESAR_E2E_KEEP=1) — remove them yourself ---"
    return
  fi
  # CLAUDE10.md §5a: this run removes what it created. Targets are named, never pruned.
  echo "--- removing probe, runner and probe image ---"
  docker rm "${PROBE_NAME}" "${RUNNER_NAME}" >/dev/null 2>&1 || true
  docker rmi "${PROBE_IMAGE}" >/dev/null 2>&1 || true
  # The workspace holds this run's throwaway PostgreSQL cluster. On failure it is the
  # only forensic artifact left, so it is kept and its path reported; it is only deleted
  # when the run passed. The guard is insurance against ARTIFACT_ROOT being overridden
  # into something unexpected: refuse to recurse unless the path is this run's own.
  if [ "${rc}" -ne 0 ]; then
    echo "--- workspace PRESERVED for diagnosis: ${WORKSPACE} ---"
  elif [ -n "${STAMP}" ] && [ "${WORKSPACE}" = "${ARTIFACT_ROOT}/e2e/${STAMP}/workspace" ]; then
    rm -rf "${ARTIFACT_ROOT:?}/e2e/${STAMP:?}" 2>/dev/null || true
  else
    echo "--- workspace NOT removed: path failed the safety check (${WORKSPACE}) ---"
  fi
}
trap cleanup EXIT

# --- wait for readiness ------------------------------------------------------
# A fresh PostgreSQL cluster is initialised and 16 migrations applied on first start.
ready=0
for _ in $(seq 1 120); do
  if docker exec "${PROBE_NAME}" node -e "fetch('http://127.0.0.1:8088/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 2
done
if [ "${ready}" -ne 1 ]; then
  echo "READY=false"
  echo "--- probe logs ---"
  docker logs "${PROBE_NAME}" 2>&1 | tail -40
  exit 1
fi
echo "READY=true"

SETUP_TOKEN="$(tr -d '\n' <"${WORKSPACE}/config/first-owner-setup.token")"
if [ -z "${SETUP_TOKEN}" ]; then echo "SETUP_TOKEN=missing"; exit 1; fi
echo "SETUP_TOKEN=present"

# --- drive the browser -------------------------------------------------------
# The driver is selectable so a second suite can reuse this whole probe apparatus instead
# of copying it. Duplicating 160 lines of container plumbing would mean two places to fix
# the next time the probe's environment changes, and they would drift.
DRIVER="${NOESAR_E2E_DRIVER:-tools/browser-e2e.mjs}"
if [ ! -f "${PROJECT_ROOT}/${DRIVER}" ]; then
  echo "DRIVER_MISSING=${DRIVER}"
  exit 1
fi
echo "DRIVER=${DRIVER}"
set +e
docker run --name "${RUNNER_NAME}" \
  --network "${NETWORK}" \
  -v "${PROJECT_ROOT}:/home/pptruser/repo:ro" \
  -e NOESAR_E2E_BASE_URL="http://${PROBE_NAME}:8088" \
  -e NOESAR_E2E_SETUP_TOKEN="${SETUP_TOKEN}" \
  --entrypoint node \
  "${PUPPETEER_IMAGE}" "/home/pptruser/repo/${DRIVER}"
RESULT=$?
set -e

echo "BROWSER_E2E_EXIT=${RESULT}"
exit "${RESULT}"
