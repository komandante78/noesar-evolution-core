# Secure Offline Updates

The verifier requires:

- update artifact;
- JSON metadata containing the artifact SHA-256;
- detached Ed25519 signature over the exact metadata bytes;
- trusted Ed25519 public key.

No root private key is included.

Final update promotion additionally requires freshness, rollback protection,
delegated roles, compatibility checks, migration dry run, backup, explicit
authorization and post-activation verification.
