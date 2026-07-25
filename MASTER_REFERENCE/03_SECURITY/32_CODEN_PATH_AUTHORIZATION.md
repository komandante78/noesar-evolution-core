# CodeN Ultra Path Authorization

Before any host/server write, delete, execution, package installation or
permission change, CodeN displays canonical path, mount, symlink state, files,
recursive scope, commands, dependencies, network, secrets, privileges, disk
impact, risk, backup, verification and rollback.

Normal flow: read-only inspect, canonicalize, policy analysis, plan, consent,
safety backup, bounded execution, verify and audit.

Consent scopes: one operation, listed files, folder/session, persistent folder
or deny. Implementations require protected path resolution, anti-symlink and
mount-boundary controls on Linux, Windows and macOS.
