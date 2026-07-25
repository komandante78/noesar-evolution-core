
# Current verified release status

Generated from the supplied canonical candidate and the completed `RUST_MANIFEST_REMEDIATION_V1` evidence.

## Verified

| Area | Result | Evidence |
|---|---|---|
| Canonical source manifest | PASS | 368/368 tracked entries verified |
| Rust dependency lock/vendor | PASS | 113 packages, 113 vendored crate directories, offline resolution |
| Rust workspace tests | PASS | Full workspace, locked and offline |
| Rust release build | PASS | `noesar-authority-daemon`, `noesar-control-plane` |
| Authority daemon/client round-trip | PASS | HMAC-signed request over Unix socket |
| Unauthorized peer rejection | PASS | Linux SO_PEERCRED UID allowlist negative test |
| Node reference tests | PASS | 112/112 |
| JSON validation | PASS | 78/78 |
| Shell syntax | PASS | 23/23 |
| JavaScript syntax | PASS | 41/41 |

## Open work

- B003: implement and validate OS-level sandbox enforcement, including the missing seccomp policy and platform-equivalent controls.
- B004: execute installers and runtime on real Linux, Windows, macOS, Unraid and OCI targets.
- B005: execute migrations, pgvector, RLS, audit-chain concurrency, backup and restore against a live PostgreSQL environment.
- B006: complete the remaining Master V4 implementation work packages.

## Claim boundary

The existing source snapshot contains older status files created before the Rust remediation. They are retained for traceability. This document and the enclosed remediation evidence supersede their B001/Cargo-lock/build fields. Production and final-product readiness remain false.
