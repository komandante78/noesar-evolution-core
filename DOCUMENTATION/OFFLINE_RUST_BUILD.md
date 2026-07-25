
# Offline Rust build contract

- `Cargo.lock`: included and verified.
- `vendor/`: 113 crate directories; aggregate vendor hash is recorded in `EVIDENCE/RUST_BUILD_PROVENANCE.json`.
- `.cargo/config.toml`: replaces crates.io with the local vendor directory.
- Build/test commands must use `--locked --offline` and `CARGO_NET_OFFLINE=true`.
- `target/`, Cargo registry caches and Cargo home are intentionally excluded.
- The two verified Linux binaries are distributed in Package 2, not in this source package.
