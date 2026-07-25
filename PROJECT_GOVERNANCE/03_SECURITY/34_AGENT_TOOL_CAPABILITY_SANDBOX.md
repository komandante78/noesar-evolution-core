# Agent, Tool and Capability Sandbox

Lifecycle: manifest/publisher verification, permission analysis, quarantine,
static/dynamic checks, bounded token issuance, process/WASM sandbox, brokered
filesystem/network/secrets, quotas, output validation, audit and rollback.

Linux: unprivileged process, namespaces where available, Landlock, seccomp,
AppArmor/SELinux, cgroups v2, read-only mounts and brokered network.
Windows: restricted token, Job Objects, AppContainer where applicable, ACL
broker, constrained PowerShell and network policy.
macOS: signed helper, sandbox profile, hardened runtime, Keychain and bounded
bridge. Wasmtime/WASI is used for suitable portable modules, not arbitrary
native ML runtimes.
