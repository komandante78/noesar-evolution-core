# Capability IPC V2

The V2 envelope binds identity, session, action, plan, capability and time.

Allowed actions:

- `capability.plan`
- `capability.approve`
- `capability.execute`
- `capability.disable`
- `capability.rollback`
- `capability.status`

Maximum lifetime is 30 seconds. Signatures are HMAC-SHA-256. Nonces are
single-use and retained past expiry to prevent replay.
