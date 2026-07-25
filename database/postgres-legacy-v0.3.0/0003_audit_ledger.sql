BEGIN;

CREATE TABLE IF NOT EXISTS noesar_audit_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES noesar_users(id),
  session_id uuid REFERENCES noesar_sessions(id),
  workspace_id uuid REFERENCES noesar_workspaces(id),
  project_id uuid REFERENCES noesar_projects(id),
  action text NOT NULL,
  result text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash text NOT NULL,
  event_hash text NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS noesar_audit_events_occurred_at_idx
  ON noesar_audit_events (occurred_at);
CREATE INDEX IF NOT EXISTS noesar_audit_events_actor_idx
  ON noesar_audit_events (actor_user_id, occurred_at);

COMMIT;
