#!/usr/bin/env bash
set -euo pipefail
CONTAINER="${NOESAR_CONTAINER:-noesar-evolution}"
IMAGE="${NOESAR_IMAGE:-noesar-evolution:v4-complete}"

docker rm -f "$CONTAINER" 2>/dev/null || true
if [ "${REMOVE_IMAGE:-false}" = "true" ]; then docker image rm "$IMAGE" 2>/dev/null || true; fi
echo "NOESAR_RUNTIME_REMOVED=true"
echo "Persistent workspace was not deleted."
