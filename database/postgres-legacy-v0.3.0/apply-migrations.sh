#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

: "${NOESAR_DATABASE_URL:?NOESAR_DATABASE_URL is required}"
command -v psql >/dev/null 2>&1 || {
  echo "psql is required; no package will be installed automatically." >&2
  exit 1
}

python3 "$ROOT/../../tools/verify-postgres-migrations.py"

for migration in "$ROOT"/0*.sql; do
  echo "Applying $(basename "$migration")"
  psql "$NOESAR_DATABASE_URL" \
    --set ON_ERROR_STOP=1 \
    --single-transaction \
    --file "$migration"
done

echo "POSTGRES_MIGRATIONS=APPLIED"
