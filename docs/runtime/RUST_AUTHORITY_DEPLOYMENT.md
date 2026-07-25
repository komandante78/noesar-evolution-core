# Rust Authority Deployment Contract

The V0.3.0 source contains Rust authority contracts but no compiled binary.

Production evidence must bind:

- exact binary SHA-256;
- build provenance digest;
- conformance-vector digest;
- authenticated IPC;
- conformance PASS.

The reference Node image can never consume that evidence to become production;
the compiled Rust authority must be the executing process.
