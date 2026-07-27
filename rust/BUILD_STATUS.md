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

## Re-measured 2026-07-27 — two conditions the claim above did not state

**The offline build needs `RUSTUP_TOOLCHAIN` pinned.** `rust-toolchain.toml` asks for
`channel = "stable"`, which rustup treats as a toolchain name distinct from a
version-named installed toolchain and syncs over the network *before cargo runs*. Under
`--network=none` the build dies there and never reaches cargo. `build-authority-release.sh`
now pins the installed default when the caller has not set one (`D-0173`).

**Nothing produced the reports the release path consumes.** `NOESAR_RUST_TEST_REPORT` was
an input, so the verdict on the tests came from the caller rather than from running them;
it is now written by this script from its own exit status. The conformance report had no
producer at all — `tools/emit-conformance-report.mjs` is it, and it executes
`conformance/authority-vectors.json` through the reference control plane's suites
(`D-0174`).

```text
RUST_TOOLCHAIN_PIN_REQUIRED=true
RUST_TESTS_REPORT_IS_AN_OUTPUT=true
CONFORMANCE_REPORT_PRODUCER=tools/emit-conformance-report.mjs
```

Measured in that container on 2026-07-27: workspace 14 test binaries, 19 passed, 0 failed;
conformance 52 checks, 0 failures; the full release script exit 0 with provenance issued.
