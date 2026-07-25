#!/usr/bin/env sh
set -eu
: "${NOESAR_DATABASE_URL:?NOESAR_DATABASE_URL is required}"
: "${NOESAR_BACKUP_OUTPUT:?NOESAR_BACKUP_OUTPUT is required}"
command -v pg_dump >/dev/null 2>&1 || {
  echo "pg_dump is required." >&2
  exit 1
}
umask 077
mkdir -p "$(dirname "$NOESAR_BACKUP_OUTPUT")"
pg_dump "$NOESAR_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$NOESAR_BACKUP_OUTPUT"
sha256sum "$NOESAR_BACKUP_OUTPUT" > "$NOESAR_BACKUP_OUTPUT.sha256"
printf '%s\n' '{"format":"pg-custom","release":"0.4.0","verified":false}' \
  > "$NOESAR_BACKUP_OUTPUT.metadata.json"
chmod 0600 \
  "$NOESAR_BACKUP_OUTPUT" \
  "$NOESAR_BACKUP_OUTPUT.sha256" \
  "$NOESAR_BACKUP_OUTPUT.metadata.json"
echo "POSTGRES_BACKUP=CREATED"
