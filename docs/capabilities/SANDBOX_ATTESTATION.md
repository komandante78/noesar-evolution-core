# Sandbox Attestation

A production OS sandbox attestation must match:

```text
PROFILE_SHA256=c4545be71b247c7267691dc685ed03ec44b5aa59289cdebcb33072e04e95147d
```

It must assert all namespaces, seccomp, resource limits, filesystem isolation
and escape-test PASS evidence. The V0.3.0 package verifies attestations but does
not issue one.
