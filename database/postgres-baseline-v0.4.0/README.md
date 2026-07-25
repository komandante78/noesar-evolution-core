# PostgreSQL V0.4.0 Baseline

This is a corrected, schema-qualified baseline for PostgreSQL 18 and pgvector.

Schemas:

- `noesar_identity`
- `noesar_core`
- `noesar_audit`
- `noesar_capability`
- `noesar_knowledge`
- `noesar_runtime`

The V0.3.0 migrations are preserved separately and disabled because their
cross-migration references are inconsistent.

```text
POSTGRES_SCHEMA_BASELINE=CORRECTED
MIGRATION_STATIC_VERIFY=PENDING
POSTGRES_EXECUTION=NOT_EXECUTED
PGVECTOR_EXECUTION=NOT_EXECUTED
```
