#!/usr/bin/env sh
set -eu
WORKSPACE="${1:?workspace path required}"
DESTINATION="${2:?backup destination required}"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$DESTINATION"
ARCHIVE="$DESTINATION/noesar-backup-$TIMESTAMP.tar.gz"

test -d "$WORKSPACE" || { echo "Workspace not found: $WORKSPACE" >&2; exit 1; }
tar -C "$WORKSPACE" -czf "$ARCHIVE" .
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
chmod 0600 "$ARCHIVE" "$ARCHIVE.sha256"
echo "$ARCHIVE"
