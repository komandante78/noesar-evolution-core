#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
IMAGE="${NOESAR_IMAGE:-localhost/noesar-evolution:v4-complete}"
exec podman build --pull-never -f "$ROOT/oci/Containerfile" -t "$IMAGE" "$ROOT"
