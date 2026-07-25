# Sandbox Attestation V2

The exact sandbox profile hash is:

```text
876fa735264b4a015470b40d41ccfbad4442212ea31eb51fd6cd4c6815335ec9
```

A production attestation must bind:

- capability ID and version;
- production adapter;
- launcher file and SHA-256;
- seccomp profile and SHA-256;
- escape-test report and SHA-256;
- platform and kernel;
- no-new-privileges;
- restricted UID and GID maps;
- user, mount, PID, network, IPC and UTS namespaces;
- resource, filesystem and process isolation;
- deny-by-default networking;
- allowlisted read-only root filesystem.

This package verifies such evidence but does not issue it.
