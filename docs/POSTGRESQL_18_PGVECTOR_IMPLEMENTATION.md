# PostgreSQL 18 and pgvector — implementation

**Status:** `POSTGRESQL_18=PASS` · `PGVECTOR=PASS` · `DATABASE_BACKUP_RESTORE=PASS`
**Closes:** blocker **B-005**, open since Phase 3.

---

## What was actually required, and what was built

Phase 4 recorded `B005=OPEN`: the schemas and the repository adapter shipped, but no
PostgreSQL had ever run, so nothing had been executed. The runtime *failed closed* rather
than substituting SQLite, which was the right behaviour and is unchanged — it just meant
the product had no working data plane.

This is now a real one, subject to the deployment constraint that shaped every decision
below: **one container**. Not a second PostgreSQL container, not a database the operator
has to supply.

| Requirement | How it is met |
|---|---|
| One external container | PostgreSQL runs as a supervised child process of the control plane |
| Database as an internal supervised process | `src/postgres-supervisor.mjs` owns its lifecycle |
| No second PostgreSQL container | none is created; verified against `docker ps -a` |
| No mandatory external database | the cluster is created on first start from nothing |
| Data under `NOESAR_EVOLUTION_RUNTIME` | `/workspace/postgresql/{data,run,backups}` |
| Non-root database user | `postgres` runs as uid 10001, the same unprivileged uid as the runtime |
| Secure local authentication | unix socket only, `scram-sha-256`, no TCP listener at all |
| Runtime-generated credentials | 32 bytes of CSPRNG per role, generated at first start |
| No secret in Git, images or logs | secrets live in `/workspace/config/postgres/*.secret`, mode 0600 |
| Separate health and readiness | `/livez` never touches the database; `/readyz` is 503 until it answers |
| Backup and restore | `pg_dump --format=custom` + sha256 sidecar; `pg_restore` refuses a mismatch |
| Versioned migrations | 16 files, ledgered by sha256, re-application refused on drift |
| Schema and Row Level Security | migrations 0007 and 0015; 15 tables `ENABLE` + `FORCE` |
| Vector insert / search / delete | pgvector 0.8.5, L2 / cosine / inner product, HNSW index |
| Isolation between projects and users | see `MULTI_USER_SECURITY_MODEL.md` |
| Failure recovery | SIGKILL of the postmaster is detected and the cluster restarted |
| Clean shutdown | SIGINT (fast shutdown), verified `clean: true` |

```text
POSTGRESQL_MAJOR=18        actual: 18.4 (Debian 18.4-1.pgdg12+1)
PGVECTOR=REQUIRED          actual: 0.8.5
SUBSTITUTED_WITH_SQLITE=false
```

## Base image and provenance

The PostgreSQL 18 packages are not in Debian bookworm, so the PostgreSQL Global
Development Group archive is added. Every part of that is pinned and reviewable:

| Item | Value |
|---|---|
| Base | `noesar-evolution:phase4` → `phase3` → `node:22-bookworm-slim@sha256:6c74791e…` |
| Repository | `https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main` |
| Signing key | `oci/keys/apt.postgresql.org.asc`, **public**, shipped in-tree rather than fetched at build time, sha256 `0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76` |
| `postgresql-18` | `18.4-1.pgdg12+1` (exact version pin) |
| `postgresql-client-18` | `18.4-1.pgdg12+1` |
| `postgresql-18-pgvector` | `0.8.5-1.pgdg12+1` |

The key's checksum was confirmed from two independent fetches before it was committed.
Shipping it in-tree rather than downloading it during the build means the trust anchor is
reviewable in the repository instead of being trust-on-first-use at build time.

This build **requires network access**, unlike the Phase 4 overlay. That is a stated
change, not an oversight: the packages do not exist in the archives Phase 3 recorded.
Everything else about the layer set is inherited from the audited Phase 3 image.

## The wire protocol client

`src/pg-client.mjs` implements the PostgreSQL v3 frontend/backend protocol in-tree:
unix and TCP sockets, SCRAM-SHA-256, the extended query protocol with real parameter
binding, text-format results, and a connection pool.

Two alternatives were rejected, for reasons worth recording:

* **Depending on `pg`.** It pulls in seven transitive packages, puts a network step into a
  build that is otherwise offline, and moves a security-relevant surface outside this
  repository's audit.
* **Shelling out to `psql`.** It cannot express the extended query protocol, so every
  value would have to be interpolated into SQL text. This product drives Row Level
  Security from session GUCs supplied by the caller. Interpolating those is exactly the
  injection surface RLS exists to close.

The client is deliberately narrow — SCRAM only, text results, one statement in flight per
connection — and raises rather than degrading outside that. It refuses `md5` and
cleartext authentication, refuses a SCRAM iteration count below the RFC 7677 floor of
4096, and verifies the server signature, because mutual authentication is the half of
SCRAM a client is free to skip and must not.

Correctness is pinned to the published RFC 7677 test vector
(`test/pg-client.test.mjs`), so a regression in the SCRAM implementation fails a test
rather than an installation.

## Connection surface

There is no TCP listener. Not one bound to loopback — none at all:

```text
listen_addresses = ''
unix_socket_directories = '/workspace/postgresql/run'
unix_socket_permissions = 0700
password_encryption = 'scram-sha-256'
```

`pg_hba.conf` contains exactly one rule:

```text
local   all   all   scram-sha-256
```

No `host` line, no `hostssl` line. An unused permissive rule is a rule waiting to become
used, and there is nothing to reach anyway. The configuration is rewritten on every start
so that an edit to the generated file cannot silently open a listener that survives a
restart.

## Roles

| Role | Purpose | Notable property |
|---|---|---|
| `noesar_admin` | cluster superuser; migrations, backup, restore, identity projection | never used on a request path |
| `noesar_app` | the runtime's connection pool | `NOSUPERUSER NOBYPASSRLS` — a **subject** of RLS, not exempt from it |

`NOBYPASSRLS` is verified at run time, not merely declared: `PI-05` reads
`rolbypassrls` back from `pg_roles` as the live application role.

## Migrations

16 migrations, applied in order, each recorded with its sha256. A migration whose file
changed after it was applied is refused rather than replayed — that is a fork in history,
and replaying it produces a schema matching neither version.

Two ledgers exist deliberately:

* `noesar_migration.applied` — the supervisor's own bookkeeping, created **before**
  migration 0001 so it can record the first migration too. This matters because 0007
  issues `CREATE POLICY`, which has no `IF NOT EXISTS` form: a crash mid-run followed by a
  blind re-apply would fail.
* `noesar_runtime.schema_migrations` — the product's own contract, created by 0008 and
  made immutable by a trigger. `security_acceptance` counts its rows, so leaving it empty
  would report `migration_count_verified=false` on a fully migrated database.

The first is the operational truth; the second is mirrored from it.

### A defect in the delivered migration set

**Migration 0012 could never have been applied on any cluster.** It reshapes the
`noesar_runtime.security_acceptance` view with `CREATE OR REPLACE VIEW`, inserting
`audit_hash_chain_guard` *before* `migration_ledger_immutable`. PostgreSQL permits only
**appending** columns to a view:

```text
ERROR: cannot change name of view column "migration_ledger_immutable" to "audit_hash_chain_guard"
```

This is deterministic — it fails on every cluster that ran 0010 first, which is every
cluster. It is direct evidence that the delivered migration set had never been executed
against a real PostgreSQL, which is exactly what `B005=OPEN` said.

Fixed by dropping and recreating the view, with the reason recorded in the migration
itself. Recorded as finding **F4C-001**.

### New migrations

| File | Purpose |
|---|---|
| `0013_multi_user_identity.sql` | six roles, account lifecycle, workspace members, invitations, service-account tokens |
| `0014_multi_user_resources.sql` | per-user ownership on every isolated resource class |
| `0015_multi_user_row_level_security.sql` | per-user RLS, restrictive policies, acceptance view |
| `0016_application_privileges.sql` | privileges for the tables 0013 and 0014 added |

`MIGRATIONS.json` is generated by `tools/generate-migration-manifest.mjs`, and
`--check` fails if it drifts from the files. Keeping it by hand is how a manifest and the
migrations it describes come apart.

## Vector operations

pgvector 0.8.5. Verified on a live cluster (`DB-14`…`DB-18`) and again on the installed
instance (`PI-02`, `PI-03`):

* 384-dimension insert
* L2 nearest neighbour (`<->`), exact match returns distance 0
* cosine distance (`<=>`)
* inner product (`<#>`)
* HNSW index creation (`vector_l2_ops`, `vector_cosine_ops`)
* delete
* a wrong-dimension embedding rejected by the column type

## Backup and restore

`pg_dump --format=custom --no-owner --no-privileges`, written 0600 with a sha256 sidecar.
`restore()` verifies the checksum before touching the database and refuses a mismatch —
verified by deliberately corrupting an archive (`DB-28`).

Restore into a fresh database was verified end to end: the migration ledger and the
pgvector extension both survive (`DB-26`, `DB-27`, `PI-12`).

## Failure recovery and shutdown

`SIGKILL` to the postmaster — the harshest realistic failure — is detected by the
supervisor, which restarts the cluster with exponential backoff and a bounded restart
count. No committed data was lost (`DB-30`, `DB-31`), because every commit is fsynced
(`fsync=on`, `full_page_writes=on`, `synchronous_commit=on`, `--data-checksums`).

Shutdown uses **SIGINT**, PostgreSQL's *fast* shutdown, not SIGTERM. SIGTERM is *smart*
shutdown: it waits for clients to disconnect, which can outlive the container's stop
timeout and be SIGKILLed mid-checkpoint. Verified `clean: true`, with `postmaster.pid`
removed (`DB-32`, `DB-33`), and again on the installed instance across a real
`docker restart`.

### A defect found in this work

The restart timer was `unref`'d. An unref'd timer does not hold the event loop open, so
with nothing else pending the process **exited with status 0 instead of restarting the
database it had just watched die** — reporting success. Observed rather than reasoned
about: the integration exercise ended at `restart.scheduled` and claimed to pass.
Recorded as **F4C-002**.

## Evidence

| Suite | Result |
|---|---|
| `tools/acceptance/postgres-integration.mjs` (in-container, from an empty data directory) | **47/47 PASS** |
| `tools/acceptance/post-install-checks.mjs` (against the installed instance) | **15/15 PASS** |
| `test/pg-client.test.mjs` (unit, includes the RFC 7677 vector) | **16/16 PASS** |
| `test/data-plane.test.mjs` | **10/10 PASS** |
| `test/readiness-data-plane.test.mjs` | **4/4 PASS** |

Everything above ran under the full production hardening: read-only root filesystem,
`cap-drop ALL`, `no-new-privileges`, uid 10001, `pids-limit 512`, tmpfs `noexec`.

## Limits, stated

* **`shm-size` is 64 MiB**, so query parallelism is switched off
  (`max_parallel_workers_per_gather = 0`) rather than left to fail unpredictably under
  load when dynamic shared memory cannot be allocated.
* **No TLS**, because there is no TCP listener to protect. If a future deployment ever
  exposes one, `pg_hba.conf` and `listen_addresses` both have to change and this document
  is wrong until it is updated.
* **No connection encryption on the socket** — unix socket permissions (0700, single uid)
  are the control.
* **Point-in-time recovery is not configured.** Backups are logical dumps; WAL archiving
  is not enabled. Adequate for this installation, not for a large one.
* The `postgres.ready` log line's `migrations` field counts migrations applied *by that
  start*, so it is `0` on a restart of an already-migrated cluster. The `data-plane.ready`
  line on the next line reports the true total.
