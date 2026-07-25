-- SPDX-License-Identifier: AGPL-3.0-or-later
BEGIN;

CREATE OR REPLACE FUNCTION noesar_runtime.current_context()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'actorId', NULLIF(current_setting('noesar.actor_id', true), ''),
    'workspaceId', NULLIF(current_setting('noesar.workspace_id', true), ''),
    'projectId', NULLIF(current_setting('noesar.project_id', true), '')
  );
$$;

CREATE OR REPLACE FUNCTION noesar_runtime.assert_context()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
  IF NULLIF(current_setting('noesar.actor_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'noesar.actor_id is required';
  END IF;
  IF NULLIF(current_setting('noesar.workspace_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'noesar.workspace_id is required';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW noesar_runtime.security_acceptance AS
SELECT
  current_setting('server_version_num')::integer >= 180000
    AS postgres_18_or_newer,
  EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'vector'
  ) AS pgvector_installed,
  (
    SELECT count(*) = 10
    FROM noesar_runtime.schema_migrations
    WHERE version BETWEEN '0001' AND '0010'
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
    WHERE tgname = 'noesar_schema_migrations_immutable'
      AND NOT tgisinternal
  ) AS migration_ledger_immutable,
  EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'noesar_app' AND NOT rolbypassrls
  ) AS application_role_no_bypassrls;

REVOKE ALL ON noesar_runtime.security_acceptance FROM PUBLIC;
GRANT SELECT ON noesar_runtime.security_acceptance TO noesar_auditor;

COMMIT;
