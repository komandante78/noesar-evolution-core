# PostgreSQL Production Gate V0.6.0

The append-only ledger records accepted evidence for:

1. Rust authority;
2. PostgreSQL data plane;
3. exact migration manifest;
4. sandbox;
5. platform matrix;
6. update trust;
7. independent penetration test.

The SQL production gate returns true only when all seven evidence kinds are
present for release V0.6.0 and the exact migration-manifest SHA-256 is bound.
