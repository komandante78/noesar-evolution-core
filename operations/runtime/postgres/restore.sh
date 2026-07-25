#!/usr/bin/env sh
set -eu
: "${NOESAR_DATABASE_URL:?NOESAR_DATABASE_URL is required}"
: "${NOESAR_BACKUP_INPUT:?NOESAR_BACKUP_INPUT is required}"
: "${NOESAR_CONFIRM_DATABASE_RESTORE:?Set NOESAR_CONFIRM_DATABASE_RESTORE=YES after review}"
test "$NOESAR_CONFIRM_DATABASE_RESTORE" = "YES" || {
  echo "Restore confirmation must equal YES." >&2
  exit 1
}
command -v pg_restore >/dev/null 2>&1 || {
  echo "pg_restore is required." >&2
  exit 1
}
test -f "$NOESAR_BACKUP_INPUT"
test -f "$NOESAR_BACKUP_INPUT.sha256"
(
  cd "$(dirname "$NOESAR_BACKUP_INPUT")"
  sha256sum -c "$(basename "$NOESAR_BACKUP_INPUT").sha256"
)
pg_restore "$NOESAR_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "$NOESAR_BACKUP_INPUT"
echo "POSTGRES_RESTORE=COMPLETED"
