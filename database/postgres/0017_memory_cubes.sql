-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- MASTER_PROJECT/14_MEMORIA_A_CUBI.md, CUBE-001/002/004/005/007 (schema half). §9.2's own
-- proposed DDL, applied close to verbatim -- see the module comment there for why each
-- constraint exists (immutable signature, derived_must_cite, the nine closed categories).
--
-- WHY THIS MIGRATION EXISTS EVEN THOUGH NOTHING READS IT YET. `noesar_knowledge.memory_items`
-- (0006) and `vector_entries` (0014) already exist and are UNREFERENCED by any file in
-- services/reference-control-plane/src/ -- live memory today is entirely `ai-workspace.json`.
-- This migration does not fix that; it lays the schema half of the replacement, verifiable on
-- its own terms (a trigger and three constraints, each with a test that tries to violate it)
-- before any application code depends on it. `09_PIANO.md`'s own principle applies: build the
-- piece that can be proven first.
--
-- THE ONE ADDITION BEYOND `14 §9.2`'s LITERAL TEXT: `visibility` on `memory_records`. The
-- doc's schema omits it; every other resource table in this database (`documents`,
-- `vector_entries`, `projects`) carries it and is gated by the SAME
-- `noesar_runtime.can_read_resource`/`can_write_resource` functions (0015). Omitting it here
-- would mean either a bespoke RLS policy nothing else uses, or memory records readable by
-- anyone in the workspace regardless of who wrote them -- neither was asked for. Defaults to
-- 'private', matching `documents`.
--
-- THREE OPEN OWNER QUESTIONS FROM `14 §7`, ADOPTED AS THE DOC'S OWN PROPOSED DEFAULTS
-- (D-0260, `noesar-evolution` skill's own "decide technical choices yourself"): the nine
-- categories are exactly `14 §3.2`'s list, unextended; `promotion_state` keeps the six states
-- `14 §9.2` already encodes (session/*-candidate/project/global/revoked) with no schema
-- change needed to honour "candidate is automatic, project/global needs approval" -- that
-- rule lives in application code (a later phase), not in this schema. Retention and the
-- Corpus-cube-vs-knowledge-graph question do not require a schema decision in THIS migration
-- and are left open, named in `docs/DECISION_LOG.md` rather than silently assumed here.
BEGIN;

-- ── the models an embedding can be identified as coming from ──────────────────
CREATE TABLE IF NOT EXISTS noesar_knowledge.embedding_models (
  id          uuid PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  dimensions  integer NOT NULL CHECK (dimensions BETWEEN 1 AND 16000),
  is_current  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Only one model is ever "current" -- the one every recall() query filters by (14 §9.3/§9.4).
CREATE UNIQUE INDEX IF NOT EXISTS embedding_models_one_current
  ON noesar_knowledge.embedding_models(is_current) WHERE is_current;

-- ── the cube: four, distinct by epistemic state (14 §2) ────────────────────────
DO $$ BEGIN
  CREATE TYPE noesar_knowledge.cube AS ENUM ('library','workshop','corpus','experience');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── the signature: one canonical address per memory, immutable for its whole life ──
CREATE TABLE IF NOT EXISTS noesar_knowledge.memory_records (
  id             uuid PRIMARY KEY,
  cube           noesar_knowledge.cube NOT NULL,
  signature      text NOT NULL UNIQUE,
  workspace_id   uuid NOT NULL REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  project_id     uuid REFERENCES noesar_core.projects(id) ON DELETE CASCADE,
  owner_user_id  uuid NOT NULL REFERENCES noesar_identity.users(id),
  visibility     text NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private','project','workspace')),

  category       text NOT NULL CHECK (category IN (
                   'decisione','procedura','convenzione','vincolo',
                   'fatto','difetto','preferenza','riferimento','lezione')),
  content        text NOT NULL,
  provenance     jsonb NOT NULL,
  contamination  text NOT NULL DEFAULT 'unverified' CHECK (contamination IN
                   ('verified','unverified','suspect','revoked')),
  promotion_state text NOT NULL CHECK (promotion_state IN (
                   'session','project-candidate','project',
                   'global-candidate','global','revoked')),

  -- A generated element is never returned alone: CUBE-002.
  derived        boolean NOT NULL DEFAULT false,
  derived_from   uuid[] NOT NULL DEFAULT '{}',
  CONSTRAINT derived_must_cite CHECK (NOT derived OR cardinality(derived_from) > 0),

  -- A correction is a new record that supersedes the old one, never an overwrite.
  superseded_by  uuid REFERENCES noesar_knowledge.memory_records(id),

  -- Only the 'experience' cube's inductions carry a confirm/refute balance.
  confirmations  integer NOT NULL DEFAULT 0,
  refutations    integer NOT NULL DEFAULT 0,
  CONSTRAINT counters_only_for_experience CHECK (
    cube = 'experience' OR (confirmations = 0 AND refutations = 0)),

  observed_at    timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- CUBE-001: the signature is the citable address. A trigger, not a convention, because a
-- convention is exactly what a distracted UPDATE crosses without any test noticing.
CREATE OR REPLACE FUNCTION noesar_knowledge.signature_is_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.signature IS DISTINCT FROM OLD.signature THEN
    RAISE EXCEPTION 'the signature is immutable: % -> %', OLD.signature, NEW.signature;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS memory_records_signature_immutable ON noesar_knowledge.memory_records;
CREATE TRIGGER memory_records_signature_immutable
  BEFORE UPDATE ON noesar_knowledge.memory_records
  FOR EACH ROW EXECUTE FUNCTION noesar_knowledge.signature_is_immutable();

-- ── the index: one row per (record, model). This is where the elasticity lives (14 §1) ──
CREATE TABLE IF NOT EXISTS noesar_knowledge.memory_vectors (
  record_id   uuid NOT NULL REFERENCES noesar_knowledge.memory_records(id) ON DELETE CASCADE,
  model_id    uuid NOT NULL REFERENCES noesar_knowledge.embedding_models(id) ON DELETE CASCADE,
  embedding   vector(384) NOT NULL,
  indexed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (record_id, model_id)
);

CREATE INDEX IF NOT EXISTS memory_vectors_hnsw
  ON noesar_knowledge.memory_vectors USING hnsw (embedding vector_cosine_ops);

-- Six catalogues that work WITHOUT vectors (14 §3.3) -- the seventh is memory_vectors_hnsw.
CREATE INDEX IF NOT EXISTS memory_records_time
  ON noesar_knowledge.memory_records(observed_at DESC);
CREATE INDEX IF NOT EXISTS memory_records_proj
  ON noesar_knowledge.memory_records(project_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS memory_records_cat
  ON noesar_knowledge.memory_records(cube, category, observed_at DESC);
CREATE INDEX IF NOT EXISTS memory_records_actor
  ON noesar_knowledge.memory_records(owner_user_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS memory_records_contam
  ON noesar_knowledge.memory_records(contamination) WHERE contamination <> 'verified';
CREATE INDEX IF NOT EXISTS memory_records_promo
  ON noesar_knowledge.memory_records(promotion_state) WHERE promotion_state LIKE '%candidate';

-- ── row-level security: the same functions and posture as every other resource table ──
ALTER TABLE noesar_knowledge.memory_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_knowledge.memory_records FORCE ROW LEVEL SECURITY;
ALTER TABLE noesar_knowledge.memory_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_knowledge.memory_vectors FORCE ROW LEVEL SECURITY;
ALTER TABLE noesar_knowledge.embedding_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_knowledge.embedding_models FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS noesar_memory_records_scope ON noesar_knowledge.memory_records;
CREATE POLICY noesar_memory_records_scope
ON noesar_knowledge.memory_records AS RESTRICTIVE
USING (
  workspace_id::text = current_setting('noesar.workspace_id', true)
  AND noesar_runtime.can_read_resource(owner_user_id, workspace_id, project_id, visibility)
)
WITH CHECK (
  workspace_id::text = current_setting('noesar.workspace_id', true)
  AND noesar_runtime.can_write_resource(owner_user_id, workspace_id)
);

-- memory_vectors carries no workspace_id of its own (it indexes a record that already has
-- one): scope follows the record it points to, via a join rather than a duplicated column
-- that could drift from the record's own workspace.
DROP POLICY IF EXISTS noesar_memory_vectors_scope ON noesar_knowledge.memory_vectors;
CREATE POLICY noesar_memory_vectors_scope
ON noesar_knowledge.memory_vectors AS RESTRICTIVE
USING (EXISTS (
  SELECT 1 FROM noesar_knowledge.memory_records r
  WHERE r.id = record_id
    AND r.workspace_id::text = current_setting('noesar.workspace_id', true)
    AND noesar_runtime.can_read_resource(r.owner_user_id, r.workspace_id, r.project_id, r.visibility)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM noesar_knowledge.memory_records r
  WHERE r.id = record_id
    AND r.workspace_id::text = current_setting('noesar.workspace_id', true)
    AND noesar_runtime.can_write_resource(r.owner_user_id, r.workspace_id)
));

-- embedding_models names no owner and no workspace: it is installation-wide catalogue data
-- (which models exist, which is current), not a per-user or per-workspace resource. Every
-- authenticated actor may read it; only the context assertion (any workspace context at all)
-- gates access, the same posture noesar_runtime.schema_migrations takes for read-only ledgers.
DROP POLICY IF EXISTS noesar_embedding_models_read ON noesar_knowledge.embedding_models;
CREATE POLICY noesar_embedding_models_read
ON noesar_knowledge.embedding_models AS RESTRICTIVE
USING (noesar_runtime.actor_id() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE ON noesar_knowledge.embedding_models TO noesar_app;
GRANT SELECT, INSERT, UPDATE ON noesar_knowledge.memory_records TO noesar_app;
-- DELETE is granted on the index only: 14 §9.3 step 4 removes a superseded model's rows once
-- the new index's coverage reaches 100%. memory_records itself is never deleted -- correction
-- is superseded_by, and that is enforced by there being no DELETE grant, not by convention.
GRANT SELECT, INSERT, UPDATE, DELETE ON noesar_knowledge.memory_vectors TO noesar_app;

COMMIT;
