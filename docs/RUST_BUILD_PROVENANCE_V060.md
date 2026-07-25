# Rust Build Provenance V0.6.0

The release build workflow requires:

- `Cargo.lock`;
- `cargo test --workspace --locked --all-targets`;
- locked release build of `noesar-authority-daemon`;
- exact binary SHA-256;
- Cargo manifest and lock hashes;
- deterministic Rust source-tree hash;
- Rust and Cargo versions;
- target triple;
- passing test report;
- passing authority-conformance report.

No `Cargo.lock`, binary or provenance claim is manufactured by this package.
