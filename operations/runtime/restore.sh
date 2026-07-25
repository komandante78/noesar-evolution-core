#!/usr/bin/env sh
set -eu

ARCHIVE="${1:?backup archive required}"
WORKSPACE="${2:?workspace destination required}"
SIDECAR="${ARCHIVE}.sha256"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

test -f "$ARCHIVE" || { echo "Archive not found" >&2; exit 1; }
test -f "$SIDECAR" || { echo "SHA-256 sidecar not found" >&2; exit 1; }
(cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$SIDECAR")")

case "$WORKSPACE" in
  ""|"/"|"/home"|"/root"|"/usr"|"/var"|"/etc")
    echo "Unsafe workspace destination" >&2
    exit 1
    ;;
esac

PARENT=$(dirname "$WORKSPACE")
mkdir -p "$PARENT"
STAGING=$(mktemp -d "$PARENT/.noesar-restore.XXXXXX")
trap 'rm -rf "$STAGING"' EXIT

python3 "$SCRIPT_DIR/safe_extract_backup.py" "$ARCHIVE" "$STAGING"

if [ -e "$WORKSPACE" ]; then
  SAFETY="${WORKSPACE}.pre-restore.$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$WORKSPACE" "$SAFETY"
  echo "Safety copy: $SAFETY"
fi

mv "$STAGING" "$WORKSPACE"
trap - EXIT
echo "Restored: $WORKSPACE"
