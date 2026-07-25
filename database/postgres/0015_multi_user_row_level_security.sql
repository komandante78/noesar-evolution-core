-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Per-user Row Level Security.
--
-- Migration 0007 scoped rows by workspace and project. That is tenancy, not user
-- isolation: two people in the same workspace saw each other's documents and memories.
-- This migration adds the per-user half.
--
-- The mechanism matters. PostgreSQL combines several PERMISSIVE policies with OR, so
-- adding a second permissive policy to a table WIDENS access. The per-user rules are
-- therefore declared AS RESTRICTIVE, which combines with AND: the inherited tenancy
-- policy still has to pass, and the new ownership rule has to pass as well. Nothing that
-- 0007 allowed becomes more permissive here, and everything it allowed becomes narrower.
BEGIN;

-- ---------------------------------------------------------------------------
-- Context helpers
-- ---------------------------------------------------------------------------
--
-- These are SECURITY DEFINER because a membership lookup made by a policy on a table
-- that itself has RLS would recurse. They are safe to define that way for three specific
-- reasons, each of which is the usual way SECURITY DEFINER goes wrong:
--   * they take typed uuid arguments and build no dynamic SQL, so there is no injection
--     surface;
--   * search_path is pinned, so an attacker-controlled search_path cannot substitute a
--     different table for the ones named here;
--   * EXECUTE is revoked from PUBLIC and granted only to the application role.

CREATE OR REPLACE FUNCTION noesar_runtime.actor_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  raw text;
BEGIN
  raw := current_setting('noesar.actor_id', true);
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  -- A malformed actor id is treated as "no actor", never as an error that a caller
  -- could use to distinguish a valid id from an invalid one.
  BEGIN
    RETURN raw::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION noesar_runtime.is_workspace_member(target_workspace uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, noesar_core, noesar_identity
AS $$
  SELECT target_workspace IS NOT NULL
     AND noesar_runtime.actor_id() IS NOT NULL
     AND (
       EXISTS (
         SELECT 1 FROM noesar_core.workspace_members m
          WHERE m.workspace_id = target_workspace
            AND m.user_id = noesar_runtime.actor_id()
       )
       OR EXISTS (
         SELECT 1 FROM noesar_core.workspaces w
          WHERE w.id = target_workspace
            AND w.owner_user_id = noesar_runtime.actor_id()
       )
     );
$$;

CREATE OR REPLACE FUNCTION noesar_runtime.is_project_member(target_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, noesar_core, noesar_identity
AS $$
  SELECT target_project IS NOT NULL
     AND noesar_runtime.actor_id() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM noesar_core.project_members pm
        WHERE pm.project_id = target_project
          AND pm.user_id = noesar_runtime.actor_id()
     );
$$;

-- The single read predicate every isolated resource uses. One shape, so a new resource
-- class cannot quietly be given a weaker rule than the others.
CREATE OR REPLACE FUNCTION noesar_runtime.can_read_resource(
  owner uuid, target_workspace uuid, target_project uuid, vis text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT noesar_runtime.actor_id() IS NOT NULL
     AND (
       owner = noesar_runtime.actor_id()
       OR (vis = 'workspace' AND noesar_runtime.is_workspace_member(target_workspace))
       OR (vis = 'project' AND target_project IS NOT NULL
           AND noesar_runtime.is_project_member(target_project))
     );
$$;

-- Writing is deliberately narrower than reading: a row can be shared for reading, and
-- still only its owner may change it. Sharing is not delegation.
CREATE OR REPLACE FUNCTION noesar_runtime.can_write_resource(
  owner uuid, target_workspace uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT noesar_runtime.actor_id() IS NOT NULL
     AND owner = noesar_runtime.actor_id()
     AND noesar_runtime.is_workspace_member(target_workspace);
$$;

REVOKE ALL ON FUNCTION noesar_runtime.actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION noesar_runtime.is_workspace_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION noesar_runtime.is_project_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION noesar_runtime.can_read_resource(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION noesar_runtime.can_write_resource(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION noesar_runtime.actor_id() TO noesar_app;
GRANT EXECUTE ON FUNCTION noesar_runtime.is_workspace_member(uuid) TO noesar_app;
GRANT EXECUTE ON FUNCTION noesar_runtime.is_project_member(uuid) TO noesar_app;
GRANT EXECUTE ON FUNCTION noesar_runtime.can_read_resource(uuid, uuid, uuid, text) TO noesar_app;
GRANT EXECUTE ON FUNCTION noesar_runtime.can_write_resource(uuid, uuid) TO noesar_app;

-- ---------------------------------------------------------------------------
-- Restrictive per-user policies on the inherited tables
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS noesar_workspace_membership ON noesar_core.workspaces;
CREATE POLICY noesar_workspace_membership
ON noesar_core.workspaces AS RESTRICTIVE
USING (noesar_runtime.is_workspace_member(id));

DROP POLICY IF EXISTS noesar_project_membership ON noesar_core.projects;
CREATE POLICY noesar_project_membership
ON noesar_core.projects AS RESTRICTIVE
USING (
  owner_user_id = noesar_runtime.actor_id()
  OR noesar_runtime.is_project_member(id)
  OR (visibility = 'workspace' AND noesar_runtime.is_workspace_member(workspace_id))
);

DROP POLICY IF EXISTS noesar_document_ownership ON noesar_knowledge.documents;
CREATE POLICY noesar_document_ownership
ON noesar_knowledge.documents AS RESTRICTIVE
USING (noesar_runtime.can_read_resource(owner_user_id, workspace_id, project_id, visibility))
WITH CHECK (noesar_runtime.can_write_resource(owner_user_id, workspace_id));

DROP POLICY IF EXISTS noesar_memory_ownership ON noesar_knowledge.memory_items;
CREATE POLICY noesar_memory_ownership
ON noesar_knowledge.memory_items AS RESTRICTIVE
USING (noesar_runtime.can_read_resource(owner_user_id, workspace_id, project_id, visibility))
WITH CHECK (noesar_runtime.can_write_resource(owner_user_id, workspace_id));

-- Migration 0007 enabled RLS on noesar_audit.events and gave it a policy FOR SELECT
-- only. With FORCE ROW LEVEL SECURITY and no INSERT policy, every append was denied —
-- so PostgresRepository.appendAuditEvent() could never have written a row. Appends are
-- allowed here for a member of the workspace, acting as themselves; UPDATE and DELETE
-- remain unreachable, which is what the immutability trigger is for.
DROP POLICY IF EXISTS noesar_audit_append ON noesar_audit.events;
CREATE POLICY noesar_audit_append
ON noesar_audit.events
FOR INSERT
WITH CHECK (
  workspace_id::text = current_setting('noesar.workspace_id', true)
  AND noesar_runtime.is_workspace_member(workspace_id)
  AND (actor_user_id IS NULL OR actor_user_id = noesar_runtime.actor_id())
);

-- ---------------------------------------------------------------------------
-- Policies on the resource classes added by 0014
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  entry record;
BEGIN
  FOR entry IN
    SELECT *
    FROM (VALUES
      ('noesar_core',      'conversations',         true),
      ('noesar_core',      'conversation_messages', false),
      ('noesar_core',      'files',                 true),
      ('noesar_core',      'artifacts',             true),
      ('noesar_capability','agents',                true),
      ('noesar_capability','tools',                 true),
      ('noesar_knowledge', 'vector_entries',        true)
    ) AS t(schema_name, table_name, has_project)
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', entry.schema_name, entry.table_name);
    EXECUTE format(
      'ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', entry.schema_name, entry.table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS noesar_resource_scope ON %I.%I',
      entry.schema_name, entry.table_name);

    IF entry.has_project THEN
      EXECUTE format($f$
        CREATE POLICY noesar_resource_scope ON %I.%I
        USING (
          workspace_id::text = current_setting('noesar.workspace_id', true)
          AND noesar_runtime.can_read_resource(
                owner_user_id, workspace_id, project_id, visibility)
        )
        WITH CHECK (
          workspace_id::text = current_setting('noesar.workspace_id', true)
          AND noesar_runtime.can_write_resource(owner_user_id, workspace_id)
        )$f$, entry.schema_name, entry.table_name);
    ELSE
      -- conversation_messages has no project column of its own: it inherits scope from
      -- its conversation, and its own owner is the only reader that matters.
      EXECUTE format($f$
        CREATE POLICY noesar_resource_scope ON %I.%I
        USING (
          workspace_id::text = current_setting('noesar.workspace_id', true)
          AND (
            owner_user_id = noesar_runtime.actor_id()
            OR EXISTS (
              SELECT 1 FROM noesar_core.conversations c
               WHERE c.id = conversation_id
                 AND noesar_runtime.can_read_resource(
                       c.owner_user_id, c.workspace_id, c.project_id, c.visibility)
            )
          )
        )
        WITH CHECK (
          workspace_id::text = current_setting('noesar.workspace_id', true)
          AND noesar_runtime.can_write_resource(owner_user_id, workspace_id)
        )$f$, entry.schema_name, entry.table_name);
    END IF;
  END LOOP;
END
$$;

-- Users may read their own row and nothing else through the data plane. Account
-- administration does not go through RLS: it is a privileged runtime operation with its
-- own permission check and its own audit record, so an administrator never acquires a
-- blanket SELECT over the identity table as a side effect of being an administrator.
ALTER TABLE noesar_identity.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_identity.users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS noesar_users_self ON noesar_identity.users;
CREATE POLICY noesar_users_self
ON noesar_identity.users
USING (id = noesar_runtime.actor_id())
WITH CHECK (id = noesar_runtime.actor_id());

ALTER TABLE noesar_core.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_core.workspace_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS noesar_workspace_members_scope ON noesar_core.workspace_members;
CREATE POLICY noesar_workspace_members_scope
ON noesar_core.workspace_members
USING (noesar_runtime.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Acceptance view
-- ---------------------------------------------------------------------------
--
-- Dropped and recreated rather than replaced, for the same reason spelled out in 0012:
-- CREATE OR REPLACE VIEW may only append columns.
DROP VIEW IF EXISTS noesar_runtime.security_acceptance;

CREATE VIEW noesar_runtime.security_acceptance AS
SELECT
  current_setting('server_version_num')::integer >= 180000
    AS postgres_18_or_newer,
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
    AS pgvector_installed,
  (
    SELECT count(*) >= 15
    FROM noesar_runtime.schema_migrations
    WHERE version BETWEEN '0001' AND '0015'
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
  (
    SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity)
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE (n.nspname, c.relname) IN (
      ('noesar_core', 'conversations'),
      ('noesar_core', 'conversation_messages'),
      ('noesar_core', 'files'),
      ('noesar_core', 'artifacts'),
      ('noesar_capability', 'agents'),
      ('noesar_capability', 'tools'),
      ('noesar_knowledge', 'vector_entries'),
      ('noesar_identity', 'users')
    )
  ) AS user_isolation_verified,
  EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'noesar_knowledge' AND c.relname = 'documents'
      AND p.polname = 'noesar_document_ownership' AND p.polpermissive = false
  ) AS user_isolation_restrictive,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'noesar_audit_events_immutable' AND NOT tgisinternal
  ) AS audit_ledger_immutable,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'noesar_audit_events_hash_chain' AND NOT tgisinternal
  ) AS audit_hash_chain_guard,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'noesar_schema_migrations_immutable' AND NOT tgisinternal
  ) AS migration_ledger_immutable,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'noesar_production_attestations_immutable' AND NOT tgisinternal
  ) AS production_attestation_ledger_immutable,
  EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'noesar_app' AND NOT rolbypassrls
  ) AS application_role_no_bypassrls;

REVOKE ALL ON noesar_runtime.security_acceptance FROM PUBLIC;
GRANT SELECT ON noesar_runtime.security_acceptance TO noesar_auditor;
GRANT SELECT ON noesar_runtime.security_acceptance TO noesar_app;

COMMIT;
