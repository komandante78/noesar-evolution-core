
# Deployment matrix

| Target | Materials included | Execution status |
|---|---|---|
| Linux portable/systemd | Installer, service and runtime source | NOT YET VALIDATED on a real target in this release |
| Windows | PowerShell installer/start scripts | NOT YET VALIDATED |
| macOS | Portable installer | NOT YET VALIDATED |
| Unraid | Templates/configuration | NOT YET VALIDATED |
| OCI/Docker/Podman | Dockerfile, Containerfile and scripts | Static source-path audit passed; image not built in final packaging |
| Air-gapped operation | Offline Rust vendor and update verification source | PARTIALLY VERIFIED |

This matrix is B004 and remains open until execution evidence exists for each supported target.
