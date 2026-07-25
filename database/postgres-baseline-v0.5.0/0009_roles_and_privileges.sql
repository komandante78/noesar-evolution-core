-- SPDX-License-Identifier: AGPL-3.0-or-later
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'noesar_migrator') THEN
    CREATE ROLE noesar_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'noesar_app') THEN
    CREATE ROLE noesar_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'noesar_auditor') THEN
    CREATE ROLE noesar_auditor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA noesar_identity FROM PUBLIC;
REVOKE ALL ON SCHEMA noesar_core FROM PUBLIC;
REVOKE ALL ON SCHEMA noesar_audit FROM PUBLIC;
REVOKE ALL ON SCHEMA noesar_capability FROM PUBLIC;
REVOKE ALL ON SCHEMA noesar_knowledge FROM PUBLIC;
REVOKE ALL ON SCHEMA noesar_runtime FROM PUBLIC;

GRANT USAGE ON SCHEMA
  noesar_identity,
  noesar_core,
  noesar_audit,
  noesar_capability,
  noesar_knowledge,
  noesar_runtime
TO noesar_app;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA
  noesar_identity,
  noesar_core,
  noesar_capability,
  noesar_knowledge
TO noesar_app;

GRANT SELECT, INSERT ON noesar_audit.events TO noesar_app;
REVOKE UPDATE, DELETE, TRUNCATE ON noesar_audit.events FROM noesar_app;

GRANT SELECT ON ALL TABLES IN SCHEMA
  noesar_identity,
  noesar_core,
  noesar_audit,
  noesar_capability,
  noesar_knowledge,
  noesar_runtime
TO noesar_auditor;

GRANT USAGE, CREATE ON SCHEMA
  noesar_identity,
  noesar_core,
  noesar_audit,
  noesar_capability,
  noesar_knowledge,
  noesar_runtime
TO noesar_migrator;

REVOKE UPDATE, DELETE, TRUNCATE
ON noesar_runtime.schema_migrations
FROM noesar_app, noesar_auditor;

COMMIT;
