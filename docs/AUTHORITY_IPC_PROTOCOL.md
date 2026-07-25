# Authority IPC Protocol V0.4.0

The protocol envelope binds:

- actor;
- session;
- action;
- payload;
- nonce;
- issue time;
- expiry;
- HMAC-SHA-256 signature.

Maximum lifetime is 30 seconds. Verification rejects unsupported actions,
invalid clock windows, signature mismatch and nonce replay.

This is an executable reference contract. The final transport must run over
authenticated local IPC and be implemented by the compiled Rust authority.
