# PostgreSQL 18 Data Plane

This directory defines the target production schema for identity, sessions,
workspaces, projects, audit, capabilities, documents, memory, model descriptors
and pgvector embeddings.

```text
POSTGRES_SCHEMA=IMPLEMENTED
MIGRATION_STATIC_VERIFY=PASS
POSTGRES_EXECUTION=NOT_EXECUTED
PGVECTOR_EXECUTION=NOT_EXECUTED
PRODUCTION_REPOSITORY_ADAPTER=NOT_ACTIVE
```

The reference Node runtime remains file-backed and refuses to claim PostgreSQL
activation. Migrations must be applied by an explicit operator using
`NOESAR_DATABASE_URL`.
