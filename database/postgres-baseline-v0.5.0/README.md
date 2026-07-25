# PostgreSQL V0.5.0 Migration Line

V0.5.0 extends the corrected V0.4.0 baseline with:

- explicit NOLOGIN roles for migration, application and audit access;
- `NOBYPASSRLS` for application and audit roles;
- revocation of PUBLIC schema access;
- append-only audit privileges;
- immutable migration-ledger privileges;
- transaction context inspection and assertion;
- a security-acceptance view for PostgreSQL 18, pgvector, migration count,
  forced RLS, immutable ledgers and application-role posture.

```text
MIGRATION_COUNT=10
POSTGRES_EXECUTION=NOT_EXECUTED
PGVECTOR_EXECUTION=NOT_EXECUTED
SECURITY_ACCEPTANCE_VIEW_EXECUTION=NOT_EXECUTED
```
