# Single-Container Deployment

One external OCI container is the default. Docker socket is not mounted. No
nested runtime is required. Isolation uses OS processes, namespaces, brokers and
WASM.

Persistent layout under `/workspace`: config, data, models, capabilities,
memory, documents, knowledge, evaluations, releases, audit, logs, backups and
licenses. Runtime is non-root with read-only root, explicit writable mounts,
dropped capabilities, no-new-privileges, health checks, graceful shutdown and
CPU fallback. No hard-coded Unraid path is allowed.
