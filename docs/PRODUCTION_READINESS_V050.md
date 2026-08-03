# Production Readiness V0.5.0

Promotion is a conjunction of six evidence groups:

1. compiled, tested and provenance-verified Rust authority with authenticated IPC;
2. PostgreSQL 18, pgvector, migrations, RLS, immutable ledgers, active repository
   adapter and backup/restore evidence;
3. integrated and attested production sandbox;
4. complete supported-platform matrix;
5. TUF, Sigstore and SLSA update trust;
6. independent penetration test.

Any missing group keeps `productionReady=false`.

## Status (s311)

Groups 1–5 have live evidence elsewhere in this project (authority/data-plane/sandbox
status is queried directly from `/healthz` at runtime, not restated here — see
`docs/DECISION_LOG.md` for the deploys that produced it). Group 6, **independent
penetration test**, is the one gate this project cannot close by writing code: it
requires an external party, by definition — a self-review (however rigorous) is not
independent. `D-0296` ran the closest automatable substitute — a structured internal
security review of the newest security-relevant surface (WebAuthn) — and found and fixed
one real defect, which is evidence toward group 6 but does not satisfy it. Group 6
remains an Owner-scheduled, non-automatable action. Scope prepared in advance for
whoever runs it: `docs/security/INDEPENDENT_PENTEST_SCOPE.md`.
