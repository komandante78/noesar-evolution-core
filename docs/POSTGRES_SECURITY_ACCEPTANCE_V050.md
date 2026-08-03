# PostgreSQL Security Acceptance V0.5.0

The V0.5.0 line introduces NOLOGIN roles, PUBLIC revocation, `NOBYPASSRLS`,
append-only audit privileges and a security-acceptance view.

The view evaluates PostgreSQL major version, pgvector, ten recorded migrations,
forced RLS, immutable audit and migration ledgers, and application-role posture.

Static verification passes. Live execution remains `NOT_EXECUTED`.

> **Correction (2026-08-03):** this V0.5.0 static-only verdict is superseded by
> `docs/DATABASE_ACCEPTANCE.md`, which documents 16/16 (now 19/19 after the cube-memory
> migrations, `D-0261`–`D-0264`) migrations applied and RLS enforced live, with 47/47
> in-container integration checks — the "live execution remains NOT_EXECUTED" line above no
> longer holds for the roles/RLS/append-only-audit posture this file evaluates. Kept as a
> historical V0.5.0 milestone record rather than deleted or rewritten (rule 12); treat
> `DATABASE_ACCEPTANCE.md` as the current source for this subsystem.
