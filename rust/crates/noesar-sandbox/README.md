# noesar-sandbox

Per-capability process isolation: applies a capability token's own limits to a child process
*before* it exists, then execs that process. Part of NOESAR EVOLUTION's `ARCH-008` mechanism,
extracted here as a standalone crate with no dependency on the rest of that workspace.

## Why a separate process

A long-lived server process cannot narrow itself per-request without narrowing itself
permanently for every later request too. This binary exists only for one spent capability
token: it applies limits to itself, then `exec`s the target command, so the command inherits
the limits and never runs a single instruction under looser ones.

## Isolation ladder — strongest available, floor that needs nothing from the kernel

| Tier | Mechanism | Requires |
|---|---|---|
| 0 | `RLIMIT_*` + `PR_SET_NO_NEW_PRIVS` | POSIX/Linux only — works everywhere this crate runs |
| 1 | seccomp syscall filter | `CONFIG_SECCOMP_FILTER` |
| 2 | Landlock filesystem confinement | `CONFIG_SECURITY_LANDLOCK` |
| 3 | cgroup v2 accounting | a delegated writable cgroup subtree |

Tiers above 0 are applied opportunistically when the host offers them; what the kernel actually
accepted is what gets reported — a tier that was requested and refused is named with its errno,
never silently claimed.

## Usage

```sh
noesar-sandbox --detect
# probes the host and prints, as JSON, which tiers are available — installs nothing, starts no child

noesar-sandbox --spec limits.json -- <command> [args...]
# applies the limits in limits.json to this process, then execs <command>
```

`--spec` takes a file rather than inline arguments so limits never appear in a process listing.

## Building

Vendored dependencies only (`libc`), no network required:

```sh
cargo build --release
cargo test
```

## License

AGPL-3.0-or-later OR LicenseRef-NOESAR-Commercial — see the containing repository,
[NOESAR-EVOLUTION](https://github.com/komandante78/NOESAR-EVOLUTION), for the commercial license
text and the project's licensing posture.
