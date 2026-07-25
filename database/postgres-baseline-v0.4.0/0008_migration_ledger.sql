-- SPDX-License-Identifier: AGPL-3.0-or-later
BEGIN;

CREATE TABLE IF NOT EXISTS noesar_runtime.schema_migrations (
  version text PRIMARY KEY,
  filename text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL
);

CREATE OR REPLACE FUNCTION noesar_runtime.reject_migration_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'noesar_runtime.schema_migrations is immutable';
END;
$$;

DROP TRIGGER IF EXISTS noesar_schema_migrations_immutable
  ON noesar_runtime.schema_migrations;
CREATE TRIGGER noesar_schema_migrations_immutable
BEFORE UPDATE OR DELETE ON noesar_runtime.schema_migrations
FOR EACH ROW
EXECUTE FUNCTION noesar_runtime.reject_migration_mutation();

COMMIT;
