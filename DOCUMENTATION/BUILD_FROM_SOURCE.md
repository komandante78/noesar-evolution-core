
# Build from source

The canonical source is under `SOURCE/PRODUCT/`.

## Reference control plane

Use Node.js 22 or a compatible supported runtime:

```bash
cd SOURCE/PRODUCT
npm test
node services/reference-control-plane/src/server.mjs
```

## Rust authority workspace

The Rust workspace is fully vendored:

```bash
cd SOURCE/PRODUCT/rust
export CARGO_NET_OFFLINE=true
cargo metadata --workspace --locked --offline --format-version 1
cargo test --workspace --locked --offline
cargo build --workspace --release --locked --offline
```

No network is required when the included `Cargo.lock`, `.cargo/config.toml` and `vendor/` remain intact. The verified build used Rust/Cargo 1.97.1 in `rust:1-bookworm` with no image pull.

## Current boundary

A successful source build does not close the OS sandbox, platform execution or live PostgreSQL gates. See `CURRENT_RELEASE_STATUS.md`.
