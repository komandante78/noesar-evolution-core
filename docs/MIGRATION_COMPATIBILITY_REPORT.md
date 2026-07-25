# Migration Compatibility Report

## V0.3.0 defect

`0001_identity_and_sessions.sql` created:

- `noesar_identity.users`
- `noesar_identity.sessions`

Later migrations referenced:

- `noesar_users`
- `noesar_sessions`

Those objects do not exist in the V0.3.0 schema. The sequence therefore could
not be accepted as an executable PostgreSQL baseline.

## V0.4.0 remediation

- V0.3.0 files preserved under `database/postgres-legacy-v0.3.0`.
- Legacy execution explicitly disabled.
- New V0.4.0 baseline uses schema-qualified objects throughout.
- Audit and migration ledgers are immutable.
- RLS is enabled and forced.
- Migration checksums are regenerated for the corrected baseline.

No claim of PostgreSQL execution is made.
