# Production Readiness Gate V0.4.0

A valid release requires:

- exact Rust binary hash;
- build provenance file and hash;
- conformance report file and hash;
- authority protocol schema hash;
- authenticated IPC transport;
- successful Rust tests;
- PostgreSQL 18;
- pgvector;
- exact migration-manifest hash;
- live acceptance report and hash;
- verified migrations and forced RLS;
- active repository adapter;
- completed backup/restore drill;
- explicit rejection of the invalid V0.3.0 migration line.

The reference runtime cannot satisfy these requirements by environment variables.
