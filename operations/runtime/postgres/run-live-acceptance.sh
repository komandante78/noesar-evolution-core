#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
: "${NOESAR_DATABASE_URL:?NOESAR_DATABASE_URL is required}"
: "${NOESAR_POSTGRES_ACCEPTANCE_REPORT:?NOESAR_POSTGRES_ACCEPTANCE_REPORT is required}"
command -v psql >/dev/null 2>&1 || {
  echo "psql is required." >&2
  exit 1
}
umask 077
mkdir -p "$(dirname "$NOESAR_POSTGRES_ACCEPTANCE_REPORT")"
psql "$NOESAR_DATABASE_URL" \
  --set ON_ERROR_STOP=1 \
  --file "$ROOT/operations/postgres/acceptance.sql" \
  > "$NOESAR_POSTGRES_ACCEPTANCE_REPORT"
sha256sum "$NOESAR_POSTGRES_ACCEPTANCE_REPORT" \
  > "$NOESAR_POSTGRES_ACCEPTANCE_REPORT.sha256"
echo "POSTGRES_V050_LIVE_ACCEPTANCE=RECORDED"
