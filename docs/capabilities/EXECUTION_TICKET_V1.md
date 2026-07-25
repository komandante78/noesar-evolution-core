# Execution Ticket V1

The ticket is HMAC-SHA-256 signed and binds:

- actor and session;
- capability ID and version;
- plan hash;
- sandbox profile;
- complete production-evidence digest;
- authority, PostgreSQL, sandbox, policy, package and readiness digests;
- issue and expiry times;
- a single-use nonce.

Maximum lifetime is 30 seconds. Replay is rejected.
