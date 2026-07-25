
# Security executive summary

The architecture separates model proposals from authority. The verified Rust authority daemon accepts canonical HMAC-signed envelopes over a private Unix socket, validates Linux peer credentials, binds request and response identity fields and enforces `productionReady=false` in the tested candidate. An authorized-peer round-trip and unauthorized-UID rejection test passed.

This closes B001 only. OS sandbox enforcement, target-platform validation and live PostgreSQL/pgvector acceptance remain open and are explicitly funded work packages.
