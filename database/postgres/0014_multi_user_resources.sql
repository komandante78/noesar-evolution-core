-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Per-user ownership on every resource class the runtime isolates.
--
-- Phase 4 finding F4-008 recorded the gap plainly: the data plane stored no per-user
-- ownership on projects, conversations, memories, artifacts or sources, so "user
-- isolation" could not be enforced because there was nothing to enforce it against.
-- This migration adds the missing column to what exists and creates the tables for the
-- classes that had no table at all.
--
-- Every isolated resource carries the same three fields, so one policy shape covers all
-- of them and a new resource class cannot accidentally be given a weaker rule:
--
--   workspace_id    tenancy
--   owner_user_id   the principal the row belongs to
--   visibility      private | project | workspace
BEGIN;

-- ---------------------------------------------------------------------------
-- Ownership on the inherited tables
-- ---------------------------------------------------------------------------

ALTER TABLE noesar_core.projects
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES noesar_identity.users(id),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'project';

ALTER TABLE noesar_core.projects
  DROP CONSTRAINT IF EXISTS projects_visibility_check;
ALTER TABLE noesar_core.projects
  ADD CONSTRAINT projects_visibility_check CHECK (
    visibility IN ('private','project','workspace')
  );

ALTER TABLE noesar_knowledge.documents
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES noesar_identity.users(id),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

ALTER TABLE noesar_knowledge.documents
  DROP CONSTRAINT IF EXISTS documents_visibility_check;
ALTER TABLE noesar_knowledge.documents
  ADD CONSTRAINT documents_visibility_check CHECK (
    visibility IN ('private','project','workspace')
  );

ALTER TABLE noesar_knowledge.memory_items
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES noesar_identity.users(id),
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

ALTER TABLE noesar_knowledge.memory_items
  DROP CONSTRAINT IF EXISTS memory_items_visibility_check;
ALTER TABLE noesar_knowledge.memory_items
  ADD CONSTRAINT memory_items_visibility_check CHECK (
    visibility IN ('private','project','workspace')
  );

-- Backfill from created_by, which is NOT NULL on both tables, so no existing row is left
-- ownerless. A row with a NULL owner would be invisible to everyone under the policies
-- added by 0015 — silently losing data is worse than failing loudly.
UPDATE noesar_knowledge.documents SET owner_user_id = created_by WHERE owner_user_id IS NULL;
UPDATE noesar_knowledge.memory_items SET owner_user_id = created_by WHERE owner_user_id IS NULL;
UPDATE noesar_core.projects p
   SET owner_user_id = w.owner_user_id
  FROM noesar_core.workspaces w
 WHERE p.workspace_id = w.id AND p.owner_user_id IS NULL;

ALTER TABLE noesar_knowledge.documents ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE noesar_knowledge.memory_items ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE noesar_core.projects ALTER COLUMN owner_user_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Resource classes that had no table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS noesar_core.conversations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES noesar_core.projects(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES noesar_identity.users(id),
  title text NOT NULL,
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','project','workspace')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS noesar_core.conversation_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL
    REFERENCES noesar_core.conversations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES noesar_identity.users(id),
  role text NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS noesar_conversation_messages_conversation_idx
  ON noesar_core.conversation_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS noesar_core.files (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES noesar_core.projects(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES noesar_identity.users(id),
  logical_path text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  content_sha256 text NOT NULL CHECK (length(content_sha256) = 64),
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','project','workspace')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, owner_user_id, logical_path)
);

CREATE TABLE IF NOT EXISTS noesar_core.artifacts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES noesar_core.projects(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES noesar_identity.users(id),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','project','workspace')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, version)
);

CREATE TABLE IF NOT EXISTS noesar_capability.agents (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES noesar_core.projects(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES noesar_identity.users(id),
  name text NOT NULL,
  instructions text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','project','workspace')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, owner_user_id, name)
);

CREATE TABLE IF NOT EXISTS noesar_capability.tools (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES noesar_core.projects(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES noesar_identity.users(id),
  name text NOT NULL,
  endpoint text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','project','workspace')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, owner_user_id, name)
);

-- The per-user vector store. Separate from noesar_knowledge.memory_items because that
-- table is the promotion pipeline; this one is the embedding index a search actually
-- reads, and it is the surface where a cross-user leak would be invisible in the UI.
CREATE TABLE IF NOT EXISTS noesar_knowledge.vector_entries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES noesar_core.projects(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES noesar_identity.users(id),
  source_kind text NOT NULL,
  source_id uuid,
  content text NOT NULL,
  embedding vector(384) NOT NULL,
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','project','workspace')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS noesar_vector_entries_owner_idx
  ON noesar_knowledge.vector_entries(owner_user_id);
CREATE INDEX IF NOT EXISTS noesar_vector_entries_hnsw
  ON noesar_knowledge.vector_entries
  USING hnsw (embedding vector_cosine_ops);

-- Administrative actions on accounts. Distinct from noesar_audit.events, which is the
-- runtime's hash-chained ledger: this one answers "who changed whose role, and when"
-- without requiring a chain walk.
CREATE TABLE IF NOT EXISTS noesar_identity.administrative_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES noesar_identity.users(id),
  subject_user_id uuid REFERENCES noesar_identity.users(id),
  action text NOT NULL,
  result text NOT NULL CHECK (result IN ('allowed','denied','error')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS noesar_administrative_events_subject_idx
  ON noesar_identity.administrative_events(subject_user_id, occurred_at);

COMMIT;
