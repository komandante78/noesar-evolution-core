-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- MASTER_PROJECT/14_MEMORIA_A_CUBI.md, CUBE-004 -- closes the architectural tension
-- D-0261 found and left open: CUBE-004 (Critical) demands the four cubes be separated
-- "by different tables/types... not even a programming error" can confuse them, but the
-- concrete schema 0017 implements (14 §9.2, verbatim) puts all four in ONE table,
-- memory_records, distinguished only by an ENUM column. A SELECT that forgets
-- `WHERE cube = 'library'` compiles, runs, and silently returns Corpus rows too.
--
-- THE FIX THE OWNER CHOSE (D-0262): typed views, not separate tables. Four views, one per
-- cube, each `WHERE cube = '<x>'` and `WITH CHECK OPTION` so a write that would produce a
-- row failing that condition is rejected before it reaches the table -- not by application
-- discipline, by the view definition itself. Direct SELECT/INSERT/UPDATE on
-- memory_records is revoked from noesar_app: the ONLY path left is through a view that
-- cannot return or accept the wrong cube. This keeps the single shared table (0017's
-- triggers, constraints and indexes apply uniformly, nothing duplicated across four
-- schemas that could drift) while making CUBE-004's guarantee structural rather than
-- conventional.
--
-- WHY THE VIEWS ARE OWNED BY noesar_migrator, NOT BY WHOEVER RUNS THIS MIGRATION.
-- PostgreSQL views execute permission checks against the VIEW OWNER by default (the
-- point of the exercise: noesar_app keeps working through the view after its own direct
-- grant on memory_records is revoked). But if the owner were a superuser (this migration
-- runs as noesar_admin, the cluster superuser), row-level security would be bypassed
-- ENTIRELY for every query through the view, superuser-ownership is one of the two
-- unconditional RLS bypasses and FORCE ROW LEVEL SECURITY does not override it -- which
-- would turn "typed views" into "read every workspace's memories through a view". The
-- fix is to hand the views to noesar_migrator: NOSUPERUSER, NOBYPASSRLS, not the table's
-- owner (0009), so it is fully subject to memory_records' RLS policy same as noesar_app
-- would have been querying it directly. The policy's own predicate (session GUCs via
-- current_setting/actor_id(), 0015) does not change meaning based on which role's grants
-- are used for the ACL check, so scoping is unaffected by the indirection -- verified
-- live below, not assumed.
--
-- WHY memory_vectors' POLICY IS REWRITTEN TOO. Its 0017 policy joins memory_records
-- inline (`EXISTS (SELECT 1 FROM memory_records r WHERE ...)`), which is an ordinary SQL
-- reference: the role actually running the query (noesar_app) needs its own SELECT grant
-- on memory_records for that subquery to plan at all. Revoking noesar_app's grant on
-- memory_records without touching this would have broken every memory_vectors query with
-- "permission denied for table memory_records" -- a regression this migration must not
-- ship. The fix mirrors the one already in 0015 for is_workspace_member/is_project_member
-- (the file's own comment: "a membership lookup made by a policy on a table that itself
-- has RLS would recurse"): two SECURITY DEFINER functions that restate the exact same
-- predicate memory_records' own policy uses, owned by a role with direct table access, so
-- memory_vectors' policy calls a function instead of joining a table noesar_app can no
-- longer see directly.
--
-- A SECOND, INDEPENDENT DEFECT FOUND VERIFYING THIS LIVE, NOT INTRODUCED BY IT: 0017
-- declares all three of its policies (`memory_records`, `memory_vectors`,
-- `embedding_models`) `AS RESTRICTIVE`, and each is the ONLY policy on its table.
-- PostgreSQL combines RESTRICTIVE policies with AND on top of PERMISSIVE ones, but a
-- RESTRICTIVE policy can only narrow a grant that already exists -- with zero PERMISSIVE
-- policies present, there is nothing to narrow and access is denied unconditionally,
-- for every role, including noesar_app with a valid actor/workspace context. Reproduced
-- live against the unmodified 0017 schema (no 0018 involved): a `noesar_app` INSERT with
-- a real matching workspace/owner still failed ("new row violates row-level security
-- policy"), and adding a trivial `USING (true)` PERMISSIVE policy alongside the existing
-- one was enough to let it through. 0015's OWN two other RESTRICTIVE policies
-- (`noesar_document_ownership`, `noesar_memory_ownership`) only work because `documents`
-- and `memory_items` already carried a PERMISSIVE tenancy policy from migration 0007 --
-- RESTRICTIVE narrows what 0007 grants. `memory_records`/`memory_vectors`/
-- `embedding_models` are new in 0017 and never had that predecessor: the RESTRICTIVE
-- marker was very likely copied from the 0015 ownership-policy pattern without its
-- prerequisite. Silent since deploy because, per 0017's own header, nothing has read or
-- written these tables yet. Cannot be fixed by editing 0017 -- it is already applied to
-- the live product (D-0261) and migrations are immutable once applied (0008's ledger
-- trigger). The fix below drops each policy's RESTRICTIVE marker, making it PERMISSIVE
-- (PostgreSQL's default) and therefore self-sufficient -- the same shape 0015's own loop
-- already uses for `vector_entries`/`conversations`/`agents`/`tools`, where
-- can_read_resource/can_write_resource are the WHOLE rule, not a narrowing layer on top
-- of an earlier grant that, for these three tables, never existed.
BEGIN;

-- ── read/write predicates for memory_records, restated as functions ──────────────────
-- Same three SECURITY DEFINER safety properties as 0015's helpers: typed uuid argument
-- (no dynamic SQL, no injection surface), pinned search_path (an attacker-controlled
-- search_path cannot substitute a different table for the one named here), EXECUTE
-- revoked from PUBLIC and granted only to noesar_app.
CREATE OR REPLACE FUNCTION noesar_knowledge.can_read_memory_record(target_record uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, noesar_knowledge, noesar_runtime
AS $$
  SELECT EXISTS (
    SELECT 1 FROM noesar_knowledge.memory_records r
    WHERE r.id = target_record
      AND r.workspace_id::text = current_setting('noesar.workspace_id', true)
      AND noesar_runtime.can_read_resource(
            r.owner_user_id, r.workspace_id, r.project_id, r.visibility)
  );
$$;

CREATE OR REPLACE FUNCTION noesar_knowledge.can_write_memory_record(target_record uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, noesar_knowledge, noesar_runtime
AS $$
  SELECT EXISTS (
    SELECT 1 FROM noesar_knowledge.memory_records r
    WHERE r.id = target_record
      AND r.workspace_id::text = current_setting('noesar.workspace_id', true)
      AND noesar_runtime.can_write_resource(r.owner_user_id, r.workspace_id)
  );
$$;

REVOKE ALL ON FUNCTION noesar_knowledge.can_read_memory_record(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION noesar_knowledge.can_write_memory_record(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION noesar_knowledge.can_read_memory_record(uuid) TO noesar_app;
GRANT EXECUTE ON FUNCTION noesar_knowledge.can_write_memory_record(uuid) TO noesar_app;

-- The two functions above are SECURITY DEFINER (owned by whoever runs this migration,
-- the same superuser that already owns memory_records itself) precisely so they can see
-- the table regardless of what noesar_app is granted on it below -- unlike the views,
-- these never return row data to the caller, only a boolean, so the superuser-owner
-- RLS-bypass that made view-ownership dangerous is exactly what makes this safe: the
-- function computes the identical predicate the table's own policy would have applied.

-- ── the RESTRICTIVE-with-no-PERMISSIVE-policy fix (see header) ───────────────────────
-- Same USING/WITH CHECK bodies 0017 already had; only the RESTRICTIVE marker is gone, so
-- each of these three is now a complete, self-sufficient rule instead of a narrower with
-- nothing under it to narrow.
DROP POLICY IF EXISTS noesar_memory_records_scope ON noesar_knowledge.memory_records;
CREATE POLICY noesar_memory_records_scope
ON noesar_knowledge.memory_records
USING (
  workspace_id::text = current_setting('noesar.workspace_id', true)
  AND noesar_runtime.can_read_resource(owner_user_id, workspace_id, project_id, visibility)
)
WITH CHECK (
  workspace_id::text = current_setting('noesar.workspace_id', true)
  AND noesar_runtime.can_write_resource(owner_user_id, workspace_id)
);

DROP POLICY IF EXISTS noesar_embedding_models_read ON noesar_knowledge.embedding_models;
CREATE POLICY noesar_embedding_models_read
ON noesar_knowledge.embedding_models
USING (noesar_runtime.actor_id() IS NOT NULL);

DROP POLICY IF EXISTS noesar_memory_vectors_scope ON noesar_knowledge.memory_vectors;
CREATE POLICY noesar_memory_vectors_scope
ON noesar_knowledge.memory_vectors
USING (noesar_knowledge.can_read_memory_record(record_id))
WITH CHECK (noesar_knowledge.can_write_memory_record(record_id));

-- ── the surrogate owner: subject to RLS same as noesar_app, unlike the table owner ───
GRANT SELECT, INSERT, UPDATE ON noesar_knowledge.memory_records TO noesar_migrator;

-- ── four typed views, one per cube ────────────────────────────────────────────────────
CREATE OR REPLACE VIEW noesar_knowledge.library_memories AS
  SELECT * FROM noesar_knowledge.memory_records WHERE cube = 'library'
  WITH CHECK OPTION;
CREATE OR REPLACE VIEW noesar_knowledge.workshop_memories AS
  SELECT * FROM noesar_knowledge.memory_records WHERE cube = 'workshop'
  WITH CHECK OPTION;
CREATE OR REPLACE VIEW noesar_knowledge.corpus_memories AS
  SELECT * FROM noesar_knowledge.memory_records WHERE cube = 'corpus'
  WITH CHECK OPTION;
CREATE OR REPLACE VIEW noesar_knowledge.experience_memories AS
  SELECT * FROM noesar_knowledge.memory_records WHERE cube = 'experience'
  WITH CHECK OPTION;

-- A caller that never mentions `cube` still lands in the right table: the view supplies
-- it, and CHECK OPTION would reject any explicit value other than the view's own anyway.
ALTER VIEW noesar_knowledge.library_memories ALTER COLUMN cube SET DEFAULT 'library';
ALTER VIEW noesar_knowledge.workshop_memories ALTER COLUMN cube SET DEFAULT 'workshop';
ALTER VIEW noesar_knowledge.corpus_memories ALTER COLUMN cube SET DEFAULT 'corpus';
ALTER VIEW noesar_knowledge.experience_memories ALTER COLUMN cube SET DEFAULT 'experience';

ALTER VIEW noesar_knowledge.library_memories OWNER TO noesar_migrator;
ALTER VIEW noesar_knowledge.workshop_memories OWNER TO noesar_migrator;
ALTER VIEW noesar_knowledge.corpus_memories OWNER TO noesar_migrator;
ALTER VIEW noesar_knowledge.experience_memories OWNER TO noesar_migrator;

-- ── the door that closes: memory_records itself is no longer reachable directly ──────
REVOKE SELECT, INSERT, UPDATE ON noesar_knowledge.memory_records FROM noesar_app;

GRANT SELECT, INSERT, UPDATE ON
  noesar_knowledge.library_memories,
  noesar_knowledge.workshop_memories,
  noesar_knowledge.corpus_memories,
  noesar_knowledge.experience_memories
TO noesar_app;

COMMIT;
