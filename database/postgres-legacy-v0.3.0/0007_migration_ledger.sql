BEGIN;

CREATE TABLE IF NOT EXISTS noesar_schema_migrations (
  version text PRIMARY KEY,
  filename text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL
);

COMMIT;
