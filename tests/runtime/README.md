# Executed Foundation Tests

The package generator executes:

1. source ZIP SHA-256 verification;
2. source unit tests;
3. JSON and XML parsing;
4. shell syntax checks;
5. portable runtime HTTP health and bootstrap smoke tests;
6. persistent workspace write verification;
7. backup and restore round-trip;
8. Ed25519 offline update verification;
9. package manifest verification;
10. ZIP CRC, path, duplicate and symlink checks.

OCI, Windows, macOS, Unraid and GPU execution are not simulated.
