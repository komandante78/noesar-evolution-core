# Legacy PostgreSQL V0.3.0 Migration Set

This directory is preserved byte-for-byte from ZIP 1 V0.3.0 for audit and
rollback analysis.

It is **not executable**. Migrations `0002` through `0005` reference
`noesar_users` and `noesar_sessions`, while migration `0001` created
`noesar_identity.users` and `noesar_identity.sessions`.

```text
LEGACY_MIGRATION_SET=INVALID
EXECUTION_ALLOWED=false
REASON=SCHEMA_QUALIFICATION_MISMATCH
```
