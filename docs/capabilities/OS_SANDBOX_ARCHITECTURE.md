# OS Sandbox Architecture V0.3.0

Three execution classes are explicit:

1. `declarative`: no external process.
2. `process-restricted-development-fixture`: package-owned test fixtures only.
3. `os-isolated`: arbitrary external capability execution, requiring verified
   user, mount, PID, network, IPC and UTS namespaces, seccomp, filesystem
   isolation, resource limits and escape-test evidence.

The primary Python runtime exposes `/usr/bin/unshare` but rejects the namespace
probe. The independent container runtime accepts the probe and successfully
executes the attested OS-isolated fixture. This is useful evidence, but it is
not a portable platform matrix or a production attestation.

```text
PROCESS_CONTAINMENT=IMPLEMENTED_AND_TESTED
PRIMARY_RUNTIME_OS_PROBE=UNAVAILABLE
INDEPENDENT_CONTAINER_OS_PROBE=PASS
INDEPENDENT_OS_ISOLATED_FIXTURE=PASS
PRODUCTION_SANDBOX_ATTESTATION=NOT_ISSUED
PORTABLE_OS_SANDBOX_VERIFICATION=false
B003_CLOSED=false
```
