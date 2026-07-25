# B003 — OS-level containment implementation and target validation

The complete delivery now includes `security/seccomp-noesar.json`, capability
sandbox profiles, no-new-privileges, read-only root filesystem, dropped Linux
capabilities, tmpfs restrictions, PID/memory/CPU limits and audit contracts.

Installation acceptance must validate the profile against the owner's kernel,
Docker version and required workloads. Platform-equivalent Windows and macOS
controls are validated when those installers are executed.
