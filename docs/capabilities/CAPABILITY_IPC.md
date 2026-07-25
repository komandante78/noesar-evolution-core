# Authenticated Capability IPC

The SDK includes an HMAC reference envelope bound to actor, session, action,
payload, nonce and expiry. Nonces are single-use. This is a testable contract,
not the final Rust authenticated IPC transport.
