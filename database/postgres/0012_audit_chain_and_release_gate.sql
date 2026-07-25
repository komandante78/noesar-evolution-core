-- SPDX-License-Identifier: AGPL-3.0-or-later
BEGIN;

CREATE OR REPLACE FUNCTION noesar_audit.enforce_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  expected_previous_hash text;
  lock_key bigint;
BEGIN
  IF NEW.previous_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'previous_hash must be lowercase SHA-256 hex';
  END IF;
  IF NEW.event_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'event_hash must be lowercase SHA-256 hex';
  END IF;

  lock_key := hashtextextended(
    coalesce(NEW.workspace_id::text, 'global'),
    0
  );
  PERFORM pg_advisory_xact_lock(lock_key);

  SELECT event_hash
  INTO expected_previous_hash
  FROM noesar_audit.events
  WHERE workspace_id IS NOT DISTINCT FROM NEW.workspace_id
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;

  expected_previous_hash := coalesce(
    expected_previous_hash,
    repeat('0', 64)
  );

  IF NEW.previous_hash <> expected_previous_hash THEN
    RAISE EXCEPTION
      'audit previous_hash mismatch: expected %, received %',
      expected_previous_hash,
      NEW.previous_hash;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
  noesar_audit_events_hash_chain
ON noesar_audit.events;

CREATE TRIGGER noesar_audit_events_hash_chain
BEFORE INSERT
ON noesar_audit.events
FOR EACH ROW
EXECUTE FUNCTION noesar_audit.enforce_hash_chain();

-- CREATE OR REPLACE VIEW may only APPEND columns: PostgreSQL rejects any change to the
-- name, order or type of an existing one with
--   cannot change name of view column "migration_ledger_immutable" to "audit_hash_chain_guard"
-- Migration 0010 defined this view with migration_ledger_immutable in sixth position, and
-- this migration inserts audit_hash_chain_guard before it. Replacing therefore fails
-- deterministically on every cluster that ran 0010 first, which is every cluster.
-- Dropping and recreating is the only way to reshape a view; nothing depends on this one,
-- so there is nothing to cascade to and no CASCADE is used.
DROP VIEW IF EXISTS noesar_runtime.security_acceptance;

CREATE VIEW noesar_runtime.security_acceptance AS
SELECT
  current_setting('server_version_num')::integer >= 180000
    AS postgres_18_or_newer,
  EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'vector'
  ) AS pgvector_installed,
  (
    SELECT count(*) = 12
    FROM noesar_runtime.schema_migrations
    WHERE version BETWEEN '0001' AND '0012'
  ) AS migration_count_verified,
  (
    SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity)
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE (n.nspname, c.relname) IN (
      ('noesar_core', 'workspaces'),
      ('noesar_core', 'projects'),
      ('noesar_core', 'project_members'),
      ('noesar_audit', 'events'),
      ('noesar_knowledge', 'documents'),
      ('noesar_knowledge', 'memory_items')
    )
  ) AS row_level_security_verified,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'noesar_audit_events_immutable'
      AND NOT tgisinternal
  ) AS audit_ledger_immutable,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'noesar_audit_events_hash_chain'
      AND NOT tgisinternal
  ) AS audit_hash_chain_guard,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'noesar_schema_migrations_immutable'
      AND NOT tgisinternal
  ) AS migration_ledger_immutable,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'noesar_production_attestations_immutable'
      AND NOT tgisinternal
  ) AS production_attestation_ledger_immutable,
  EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'noesar_app' AND NOT rolbypassrls
  ) AS application_role_no_bypassrls;

REVOKE ALL
ON noesar_runtime.security_acceptance
FROM PUBLIC;

GRANT SELECT
ON noesar_runtime.security_acceptance
TO noesar_auditor;

COMMIT;
