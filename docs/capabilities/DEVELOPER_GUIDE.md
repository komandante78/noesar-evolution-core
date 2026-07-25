# Developer Guide

## Build a capability

1. Select the smallest capability kind.
2. Declare every permission.
3. Declare data leaving the device.
4. Declare every filesystem path class.
5. Generate the payload inventory.
6. Canonicalize and sign `manifest.json`.
7. Package only declared files.
8. Test in quarantine.
9. Submit for publisher or customer review.

## Do not

- embed secrets;
- request broad host access;
- download code at runtime;
- hide network destinations;
- use a signature as a substitute for sandboxing;
- claim NOESAR certification without authorization;
- package private ATOM implementation in a public module.
