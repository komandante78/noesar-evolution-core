#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
IMAGE="${NOESAR_IMAGE:-noesar-evolution:v4-complete}"
exec docker build --pull=false -f "$ROOT/oci/Dockerfile" -t "$IMAGE" "$ROOT"
