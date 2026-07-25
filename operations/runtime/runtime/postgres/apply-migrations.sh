#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
MIGRATIONS="$ROOT/database/postgres"
PLAN="${NOESAR_MIGRATION_PLAN:-$ROOT/operations/runtime/postgres/migration-plan.json}"

: "${NOESAR_DATABASE_URL:?NOESAR_DATABASE_URL is required}"
: "${NOESAR_CONFIRM_DATABASE_MIGRATION:?Set NOESAR_CONFIRM_DATABASE_MIGRATION=YES after backup and review}"
test "$NOESAR_CONFIRM_DATABASE_MIGRATION" = "YES" || {
  echo "Migration confirmation must equal YES." >&2
  exit 1
}
command -v psql >/dev/null 2>&1 || {
  echo "psql is required; this package installs nothing automatically." >&2
  exit 1
}

python3 "$ROOT/tools/verify-postgres-migrations.py"
python3 "$ROOT/tools/verify-postgres-contract.py"
# NOTE: migration-plan.py is a V0.5.0-baseline planning tool (10 migrations,
# schemaVersion 3.0) retained for historical-baseline verification; it does not
# describe the current 12-migration database/postgres set applied below.
# See REPORTS/CODE_CONSOLIDATION_V1/11_OPEN_BLOCKERS.txt.
python3 "$ROOT/operations/runtime/postgres/migration-plan.py" --output "$PLAN"

for migration in "$MIGRATIONS"/0*.sql; do
  filename=$(basename "$migration")
  version=${filename%%_*}
  checksum=$(sha256sum "$migration" | awk '{print $1}')
  echo "Applying $filename"
  psql "$NOESAR_DATABASE_URL" \
    --set ON_ERROR_STOP=1 \
    --file "$migration"
  psql "$NOESAR_DATABASE_URL" \
    --set ON_ERROR_STOP=1 \
    --set "migration_version=$version" \
    --set "migration_filename=$filename" \
    --set "migration_sha256=$checksum" \
    --command "
      INSERT INTO noesar_runtime.schema_migrations (
        version, filename, sha256, applied_by
      )
      VALUES (
        :'migration_version',
        :'migration_filename',
        :'migration_sha256',
        current_user
      )
      ON CONFLICT (version) DO NOTHING;
    "
done

echo "POSTGRES_MIGRATIONS_V050=APPLIED"
