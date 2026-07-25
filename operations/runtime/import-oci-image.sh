#!/usr/bin/env sh
set -eu
ENGINE="${NOESAR_ENGINE:-docker}"
ARCHIVE="${1:?OCI image archive required}"
(cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256")
"$ENGINE" image load -i "$ARCHIVE"
