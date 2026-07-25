#!/usr/bin/env sh
set -eu
ENGINE="${NOESAR_ENGINE:-docker}"
IMAGE="${1:-noesar-evolution:v4-foundation-0.1.0}"
OUTPUT="${2:-noesar-evolution-v4-foundation-0.1.0.tar}"
"$ENGINE" image save "$IMAGE" -o "$OUTPUT"
sha256sum "$OUTPUT" > "$OUTPUT.sha256"
echo "$OUTPUT"
