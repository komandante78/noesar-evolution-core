\set ON_ERROR_STOP on

SELECT current_setting('server_version') AS server_version;
SELECT current_setting('server_version_num')::integer AS server_version_num;

SELECT extversion AS pgvector_version
FROM pg_extension
WHERE extname = 'vector';

SELECT version, filename, sha256, applied_at, applied_by
FROM noesar_runtime.schema_migrations
ORDER BY version;

SELECT *
FROM noesar_runtime.security_acceptance;

SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls
FROM pg_roles
WHERE rolname IN ('noesar_migrator', 'noesar_app', 'noesar_auditor')
ORDER BY rolname;

SELECT n.nspname AS schema_name, c.relname, c.relrowsecurity, c.relforcerowsecurity
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
ORDER BY n.nspname, c.relname;

SELECT tgname
FROM pg_trigger
WHERE tgname IN (
  'noesar_audit_events_immutable',
  'noesar_schema_migrations_immutable'
)
ORDER BY tgname;
