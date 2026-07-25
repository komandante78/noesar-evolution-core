# Publisher and Package Revocation

The trusted publisher registry stores:

- publisher ID;
- trust level;
- public-key path;
- SHA-256 fingerprint;
- active or revoked state;
- registering Owner;
- registration timestamp.

Publisher and package revocation require an Owner session with recent strong
reauthentication. Verification and invocation check revocation state.
