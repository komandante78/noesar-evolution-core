-- SPDX-License-Identifier: AGPL-3.0-or-later
BEGIN;

CREATE TABLE IF NOT EXISTS noesar_runtime.production_attestations (
  id uuid PRIMARY KEY,
  release text NOT NULL,
  kind text NOT NULL CHECK (
    kind IN (
      'rust-authority',
      'postgresql-data-plane',
      'migration-manifest',
      'sandbox',
      'platform-matrix',
      'update-trust',
      'penetration-test'
    )
  ),
  artifact_sha256 text NOT NULL CHECK (
    artifact_sha256 ~ '^[0-9a-f]{64}$'
  ),
  evidence_sha256 text NOT NULL CHECK (
    evidence_sha256 ~ '^[0-9a-f]{64}$'
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_by text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    release,
    kind,
    artifact_sha256,
    evidence_sha256
  )
);

CREATE INDEX IF NOT EXISTS
  noesar_production_attestations_release_kind_idx
ON noesar_runtime.production_attestations(release, kind);

CREATE OR REPLACE FUNCTION
  noesar_runtime.reject_production_attestation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'noesar_runtime.production_attestations is append-only';
END;
$$;

DROP TRIGGER IF EXISTS
  noesar_production_attestations_immutable
ON noesar_runtime.production_attestations;

CREATE TRIGGER noesar_production_attestations_immutable
BEFORE UPDATE OR DELETE
ON noesar_runtime.production_attestations
FOR EACH ROW
EXECUTE FUNCTION
  noesar_runtime.reject_production_attestation_mutation();

CREATE OR REPLACE FUNCTION noesar_runtime.production_gate(
  expected_release text,
  expected_migration_manifest_sha256 text
)
RETURNS TABLE (
  rust_authority boolean,
  postgresql_data_plane boolean,
  migration_manifest boolean,
  sandbox boolean,
  platform_matrix boolean,
  update_trust boolean,
  penetration_test boolean,
  production_ready boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH evidence AS (
    SELECT
      bool_or(kind = 'rust-authority') AS rust_authority,
      bool_or(kind = 'postgresql-data-plane') AS postgresql_data_plane,
      bool_or(
        kind = 'migration-manifest'
        AND artifact_sha256 = expected_migration_manifest_sha256
      ) AS migration_manifest,
      bool_or(kind = 'sandbox') AS sandbox,
      bool_or(kind = 'platform-matrix') AS platform_matrix,
      bool_or(kind = 'update-trust') AS update_trust,
      bool_or(kind = 'penetration-test') AS penetration_test
    FROM noesar_runtime.production_attestations
    WHERE release = expected_release
  )
  SELECT
    coalesce(rust_authority, false),
    coalesce(postgresql_data_plane, false),
    coalesce(migration_manifest, false),
    coalesce(sandbox, false),
    coalesce(platform_matrix, false),
    coalesce(update_trust, false),
    coalesce(penetration_test, false),
    coalesce(rust_authority, false)
      AND coalesce(postgresql_data_plane, false)
      AND coalesce(migration_manifest, false)
      AND coalesce(sandbox, false)
      AND coalesce(platform_matrix, false)
      AND coalesce(update_trust, false)
      AND coalesce(penetration_test, false)
  FROM evidence;
$$;

REVOKE ALL
ON noesar_runtime.production_attestations
FROM PUBLIC;

GRANT SELECT, INSERT
ON noesar_runtime.production_attestations
TO noesar_migrator;

GRANT SELECT
ON noesar_runtime.production_attestations
TO noesar_auditor;

REVOKE UPDATE, DELETE, TRUNCATE
ON noesar_runtime.production_attestations
FROM noesar_migrator, noesar_app, noesar_auditor;

COMMIT;
