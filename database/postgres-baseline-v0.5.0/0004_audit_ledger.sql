-- SPDX-License-Identifier: AGPL-3.0-or-later
BEGIN;

CREATE TABLE IF NOT EXISTS noesar_audit.events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES noesar_identity.users(id),
  session_id uuid REFERENCES noesar_identity.sessions(id),
  workspace_id uuid REFERENCES noesar_core.workspaces(id),
  project_id uuid REFERENCES noesar_core.projects(id),
  action text NOT NULL,
  result text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash text NOT NULL CHECK (length(previous_hash) = 64),
  event_hash text NOT NULL UNIQUE CHECK (length(event_hash) = 64)
);

CREATE INDEX IF NOT EXISTS noesar_audit_events_occurred_at_idx
  ON noesar_audit.events(occurred_at);
CREATE INDEX IF NOT EXISTS noesar_audit_events_actor_idx
  ON noesar_audit.events(actor_user_id, occurred_at);

CREATE OR REPLACE FUNCTION noesar_audit.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'noesar_audit.events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS noesar_audit_events_immutable
  ON noesar_audit.events;
CREATE TRIGGER noesar_audit_events_immutable
BEFORE UPDATE OR DELETE ON noesar_audit.events
FOR EACH ROW EXECUTE FUNCTION noesar_audit.reject_mutation();

COMMIT;
