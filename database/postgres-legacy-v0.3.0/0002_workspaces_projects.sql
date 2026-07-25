BEGIN;

CREATE TABLE IF NOT EXISTS noesar_workspaces (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES noesar_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS noesar_projects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES noesar_workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  classification text NOT NULL DEFAULT 'INTERNAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS noesar_project_members (
  project_id uuid NOT NULL REFERENCES noesar_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES noesar_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','developer','user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

COMMIT;
