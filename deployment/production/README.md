# Production Candidate Contract

V0.3.0 does not include a production runtime.

A future production launcher must require:

- compiled Rust authority binary;
- verified binary SHA-256;
- build provenance digest;
- conformance-vector digest and PASS evidence;
- authenticated IPC;
- PostgreSQL connection;
- exact migration-manifest digest;
- verified migrations and row-level security;
- pgvector version;
- completed backup/restore drill.

`runtime/bin/verify-production-attestations.py` verifies the evidence format.
It does not generate attestations and cannot promote the Node reference image.
