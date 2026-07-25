# Security — CANONICAL_CANDIDATE_V1 (V0.6.0 base + V0.5.0 consolidated material)

Authority additions:

- no TCP authority transport;
- absolute Unix socket path;
- world-writable parent rejection;
- symlink and non-socket rejection;
- one request per connection;
- maximum one-MiB frames;
- request ID, nonce, actor, session and action response binding;
- Linux `SO_PEERCRED` source validation;
- UID allowlist;
- socket permission `0600`;
- HMAC secret loaded from a private non-symlink file;
- locked build and provenance evidence requirements.

PostgreSQL additions:

- append-only production-attestation ledger;
- exact migration-manifest hash binding;
- seven independent production evidence kinds;
- per-workspace advisory transaction lock;
- genesis and continuity validation for audit hashes;
- lowercase SHA-256 enforcement;
- twelve-migration acceptance requirement;
- legacy V0.3.0 migration set is quarantined and non-executable
  (`LEGACY_MIGRATION_SET=INVALID`, `EXECUTION_ALLOWED=false`), verified by
  `tools/verify-postgres-migrations.py`.

Capability layer additions (consolidated from 03_CAPABILITIES_V0_5_0,
04_SECURITY_V0_5_0):

- publisher registration and trust-level policy
  (`capabilities/security/trust-level-policy.json`);
- role/action authorization matrix
  (`capabilities/security/role-action-matrix.json`);
- capability manifest/execution-ticket/production-evidence signature and
  hash verification (`capabilities/reference/noesar_capabilities/`);
- WASI sandbox execution contract and profile
  (`capabilities/sandbox/`) — process-boundary contract only; **no
  OS-level sandbox enforcement (seccomp/landlock/App Sandbox) is
  implemented** (open blocker B003).

Still unverified (unchanged from the base product, not re-verified by this
consolidation pass):

- Rust compilation and cargo tests (no cargo/rustc toolchain on this host);
- actual daemon/client round trip;
- signed provenance;
- PostgreSQL 18 and pgvector execution (no live server started, by
  constraint);
- live audit-chain concurrency;
- live production-gate evidence;
- backup/restore and adversarial RLS.

Newly identified during this consolidation pass (see
`REPORTS/CODE_CONSOLIDATION_V1/11_OPEN_BLOCKERS.txt` for detail):

- `tests/runtime/production-gate-smoke.py` depends on a
  `runtime/bin/verify-production-attestations.py` module that was never
  imported into this candidate; the attestation-tamper test suite it
  exercises is therefore unverified here;
- `tests/runtime/runtime-v0{30,40,50}-smoke.mjs` and
  `secure-runtime-smoke.mjs` depend on a `runtime/bin/entrypoint.sh`
  launcher that was never imported into this candidate; end-to-end
  authority/runtime boot smoke coverage is unverified here.

No hardcoded credentials, private keys, or cloud access-key patterns were
found during the consolidation pass (secret-pattern scan folded into
`tools/verify-package.py`, blocked pending python3 availability — see
toolchain notes).
