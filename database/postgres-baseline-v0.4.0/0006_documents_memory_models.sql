-- SPDX-License-Identifier: AGPL-3.0-or-later
BEGIN;

CREATE TABLE IF NOT EXISTS noesar_knowledge.documents (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL
    REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  project_id uuid
    REFERENCES noesar_core.projects(id) ON DELETE CASCADE,
  logical_path text NOT NULL,
  media_type text NOT NULL,
  content_sha256 text NOT NULL CHECK (length(content_sha256) = 64),
  classification text NOT NULL,
  created_by uuid NOT NULL REFERENCES noesar_identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, logical_path)
);

CREATE TABLE IF NOT EXISTS noesar_knowledge.memory_items (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL
    REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  project_id uuid
    REFERENCES noesar_core.projects(id) ON DELETE CASCADE,
  provenance jsonb NOT NULL,
  content text NOT NULL,
  embedding vector(384),
  promotion_state text NOT NULL CHECK (
    promotion_state IN (
      'session',
      'project-candidate',
      'project',
      'global-candidate',
      'global',
      'revoked'
    )
  ),
  created_by uuid NOT NULL REFERENCES noesar_identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS noesar_memory_embedding_hnsw
  ON noesar_knowledge.memory_items
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS noesar_runtime.model_descriptors (
  id text NOT NULL,
  version text NOT NULL,
  descriptor jsonb NOT NULL,
  artifact_sha256 text NOT NULL CHECK (length(artifact_sha256) = 64),
  trust_state text NOT NULL CHECK (
    trust_state IN ('quarantined','verified','active','revoked')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);

COMMIT;
