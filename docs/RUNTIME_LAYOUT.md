# Runtime Layout

Where the installed product keeps its state on this host, and who may read it.

```text
RUNTIME_ROOT = /mnt/cachec/NOESAR_EVOLUTION_RUNTIME
```

The container mounts `RUNTIME_ROOT` at `/workspace`. Nothing else on the host is mounted:
no host root, no `/mnt/user`, no general `/mnt/cachec`, no Docker socket, no other
project's directory.

## Directories

| Path | Owner | Mode | Written by | Contents |
|---|---|---|---|---|
| `RUNTIME_ROOT/` | `10001:10001` | `0700` | container | mount point for `/workspace` |
| `config/` | `10001:10001` | `0700` | container | `first-owner-setup.token` (`0600`), `auth-master.key` (`0600`), `provider-credentials.key` (`0600`) |
| `state/` | `10001:10001` | `0700` | container | `auth.json`, `state.json`, `ai-workspace.json`, `watchdog.json` |
| `audit/` | `10001:10001` | `0700` | container | `events.jsonl` — append-only, SHA-256 hash chained |
| `logs/` | `10001:10001` | `0700` | container | `noesar.log` plus rotated `noesar-<ts>-<seq>.log.gz` |
| `updates/` | `10001:10001` | `0700` | container | `inbox/ staging/ current/ previous/ keys/ state.json` |
| `backups/` | `10001:10001` | `0700` | container | pre-update workspace copies |
| `data/` | `10001:10001` | `0700` | reserved | reserved for a future data plane (empty; PostgreSQL is not installed) |
| `projects/` | `10001:10001` | `0700` | reserved | reserved for per-project material |
| `diagnostics/` | `10001:10001` | `0700` | reserved | reserved for exported diagnostic bundles |
| `tmp/` | `10001:10001` | `0700` | reserved | reserved; the container's own `/tmp` is a `noexec` tmpfs, not this |

`files/` is created by the runtime on first upload, under `/workspace/files`, mode `0700`.

## Rules

- **`0700` everywhere, `0600` for files.** There is no `chmod 777` anywhere in this
  installation, and nothing is world-writable — verified with
  `find RUNTIME_ROOT -perm -o+w`, which returns nothing.
- **Ownership is `10001:10001`, set explicitly.** An Unraid share defaults to `99:100`;
  without the `chown` the container starts and then cannot persist. The delivered
  installer only `chmod`s, which is why Phase 2 raised this and Phase 3 does it.
- **No secret is ever in the repository.** Every key and token above is generated at
  runtime inside `config/` and is covered by `.gitignore` by virtue of living outside the
  repository entirely.
- **Operational logs and audit are different stores.** Rotation and quota enforcement
  delete files in `logs/`; they cannot reach `audit/`. The logger refuses to be
  constructed against a directory whose path contains an `audit` segment.

## Backups

Pre-install and pre-update backups live in
`/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/`, each with a self-verifying
`SHA256SUMS.txt`. Known gap, stated plainly: they share a device with the runtime, so
they cover install and update rollback but are **not** disaster recovery.
