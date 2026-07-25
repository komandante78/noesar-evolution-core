# Publisher and Signing Operations

Production publisher keys must be protected by an HSM, secure enclave or
equivalent controlled signing service.

Distribution contains public verification keys only.

Required production controls:

- offline or threshold root keys;
- role separation;
- key rotation;
- revocation;
- timestamped signing evidence;
- builder provenance;
- release SBOM;
- incident response for compromised keys.

The reference tests generate temporary Ed25519 keys and delete them immediately.
