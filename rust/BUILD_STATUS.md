# Rust Build Status V0.6.0

The package includes a source-level Unix authority daemon using `SO_PEERCRED`,
length-prefixed canonical JSON and Authority Protocol V1.1.

```text
CARGO_LOCK_INCLUDED=true
LOCKED_BUILD_EXECUTED=true
RUST_TESTS_EXECUTED=true
RUST_BINARY_INCLUDED=false
BUILD_PROVENANCE_ISSUED=true
PROVENANCE_SIGNED=false
UNIX_SO_PEERCRED_SOURCE=IMPLEMENTED
WINDOWS_NAMED_PIPE_PEER_CREDENTIALS=NOT_IMPLEMENTED
```

`build-authority-release.sh` refuses to build without an explicit `Cargo.lock`.
As of RUST_MANIFEST_REMEDIATION_V1 (2026-07-24), `Cargo.lock` and `vendor/`
are present and a locked, offline `cargo test --workspace` and
`cargo build --workspace --release` both PASS in a hardened, network-isolated
`rust:1-bookworm` container (`--network=none`, `--cap-drop=ALL`), and an
authority daemon/client round-trip (including a SO_PEERCRED
peer-rejection negative test) PASSED against the real compiled
`noesar-authority-daemon` binary. See
`REPORTS/RUST_MANIFEST_REMEDIATION_V1/FINAL_REPORT.txt` for full evidence.
Release binaries were verified but are intentionally not committed into
this source tree (`RUST_BINARY_INCLUDED=false`); provenance was recorded
but not cryptographically signed (`PROVENANCE_SIGNED=false`). This
package is still explicitly `PRODUCTION_READY=false`.
