-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Privileges for the application role over the tables added by 0013 and 0014.
--
-- GRANT ... ON ALL TABLES IN SCHEMA applies to the tables that exist when it runs, so
-- migration 0009 could not have covered tables created four migrations later. The grants
-- belong in a migration rather than in runtime code for one specific reason: an earlier
-- draft of the supervisor issued a blanket
--     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ... TO noesar_app
-- after every migration run, which silently re-granted the DELETE on noesar_audit.events
-- that 0009 deliberately revokes. Privileges expressed in versioned SQL can be reviewed
-- as a diff; privileges expressed in a loop cannot.
BEGIN;

-- Identity. The runtime reads and updates its own user records; it never deletes them,
-- because account removal goes through the export-then-erase path, which anonymises in
-- place so that audit references survive.
GRANT SELECT, INSERT, UPDATE ON
  noesar_identity.users,
  noesar_identity.sessions,
  noesar_identity.user_invitations,
  noesar_identity.service_account_tokens,
  noesar_identity.administrative_events
TO noesar_app;

REVOKE DELETE, TRUNCATE ON noesar_identity.administrative_events FROM noesar_app;

GRANT DELETE ON
  noesar_identity.sessions,
  noesar_identity.user_invitations,
  noesar_identity.service_account_tokens
TO noesar_app;

-- Core and capability resources: full CRUD, because a user must be able to erase their
-- own conversations, files, artifacts, agents and tools.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  noesar_core.workspace_members,
  noesar_core.conversations,
  noesar_core.conversation_messages,
  noesar_core.files,
  noesar_core.artifacts,
  noesar_capability.agents,
  noesar_capability.tools,
  noesar_knowledge.vector_entries
TO noesar_app;

-- The runtime reports which migrations are applied; it must never write that ledger.
-- The immutability trigger blocks UPDATE and DELETE anyway — this makes the intent
-- explicit rather than relying on a trigger to be the only line of defence.
GRANT SELECT ON noesar_runtime.schema_migrations TO noesar_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON noesar_runtime.schema_migrations FROM noesar_app;

-- Restated, because 0009 granted these before the later migrations existed and a reader
-- should not have to reconstruct the final state from four files.
GRANT SELECT, INSERT ON noesar_audit.events TO noesar_app;
REVOKE UPDATE, DELETE, TRUNCATE ON noesar_audit.events FROM noesar_app;

COMMIT;
