# PostgreSQL Security Acceptance V0.5.0

The V0.5.0 line introduces NOLOGIN roles, PUBLIC revocation, `NOBYPASSRLS`,
append-only audit privileges and a security-acceptance view.

The view evaluates PostgreSQL major version, pgvector, ten recorded migrations,
forced RLS, immutable audit and migration ledgers, and application-role posture.

Static verification passes. Live execution remains `NOT_EXECUTED`.
