# Database and vector store acceptance

> Rewritten at the Phase 4 completion gate. The previous version recorded
> `POSTGRES_INSTALLED=false` and `B005=OPEN`; both are now closed. The earlier text is
> preserved at
> `BACKUPS/phase4c_docs_20260725T131312Z/DATABASE_ACCEPTANCE.md.pre_phase4_completion.bak`.

## Verdict

```text
POSTGRES_INSTALLED=true
POSTGRESQL_VERSION=18.4 (Debian 18.4-1.pgdg12+1)
PGVECTOR_ACTIVE=true
PGVECTOR_VERSION=0.8.5
ACTIVE_DATA_PLANE=postgresql
MIGRATIONS_APPLIED=16/16
ROW_LEVEL_SECURITY_TABLES=15
DATABASE_BACKUP_RESTORE=PASS
B005=CLOSED
SUBSTITUTED_WITH_SQLITE=false
```

Implementation detail, rationale and stated limits:
`POSTGRESQL_18_PGVECTOR_IMPLEMENTATION.md`.

## What the runtime reports, unprompted

```text
data-plane.ready  mode=postgresql
                  server_version="18.4 (Debian 18.4-1.pgdg12+1)"
                  pgvector=0.8.5
                  migrations=16
                  rls_tables=15
                  production_ready=true
```

The fail-closed property Phase 4 recorded as correct behaviour is **unchanged**. Setting
`NOESAR_DATA_PLANE=postgresql` still does not entitle the process to claim a PostgreSQL
data plane: only a supervisor that has reached `ready` — cluster started, migrations
applied, health answered — does. Anything short of that takes the same fail-closed path as
before, so a broken or misconfigured database makes the runtime refuse to serve rather than
quietly write JSON. `assertDevelopmentDataPlane()` is untouched and its test still asserts
that it throws.

`/readyz` returns 503 with reason `data-plane-not-connected` while the database is not
connected. `/livez` is deliberately unaffected, so a cluster still replaying WAL is never
killed by the container health check.

## Evidence

| Suite | Where | Result |
|---|---|---|
| `tools/acceptance/postgres-integration.mjs` | in-container, from an empty data directory | **47/47 PASS** |
| `tools/acceptance/post-install-checks.mjs` | against the installed instance | **15/15 PASS** |
| `test/pg-client.test.mjs` | unit; includes the RFC 7677 SCRAM vector | **16/16 PASS** |
| `test/data-plane.test.mjs` | unit | **10/10 PASS** |
| `test/readiness-data-plane.test.mjs` | unit | **4/4 PASS** |

All in-container work ran under full production hardening: read-only root filesystem,
`cap-drop ALL`, `no-new-privileges`, uid 10001, `pids-limit 512`, tmpfs `noexec`.

### What the 47 checks cover

| Group | Checks |
|---|---|
| Lifecycle | cluster created from nothing; PostgreSQL ≥ 18; pgvector present; app role cannot bypass RLS; RLS enforced |
| Migrations | all applied; a second run applies nothing; ledger carries a sha256 per file; the application role cannot write the ledger |
| Connection surface | no `host` rule in `pg_hba.conf`; `listen_addresses` empty; socket directory 0700 |
| Credentials | both secrets 0600; no password in the process environment |
| pgvector | 384-dimension insert; L2 nearest neighbour exact; cosine; HNSW index; delete; wrong dimension refused |
| RLS — tenancy | own workspace only; another tenant's workspace hidden even when named directly; cross-workspace write refused; a context-free read returns nothing |
| RLS — per user | another user's private document invisible **in the same project**; a project-shared one visible; a readable-but-unowned row cannot be modified; vector search never returns another user's private entry; the owner still sees their own; the identity table exposes only the acting user |
| Audit | an event can actually be appended; an appended event cannot be deleted |
| Acceptance view | migrations verified; user isolation verified and restrictive |
| Backup | checksummed custom-format archive; restores with ledger and pgvector intact; a tampered archive refused |
| Recovery | SIGKILL of the postmaster detected and the cluster restarted; no committed data lost; the acceptance view answers again |
| Shutdown | clean stop; `postmaster.pid` removed |

## Defects found and repaired

| Id | Severity | What |
|---|---|---|
| **F4C-001** | high | migration `0012` could never apply on any cluster — `CREATE OR REPLACE VIEW` cannot reorder columns. Direct evidence that the delivered migration set had never been executed. |
| **F4C-002** | high | the supervisor's restart timer was `unref`'d, so a crashed database was never restarted when nothing else held the event loop open — and the process exited **0**, reporting success. |
| **F4C-003** | medium | `noesar_audit.events` had RLS forced with a `SELECT`-only policy, so every append was denied and `appendAuditEvent()` could never have written a row. |
| **F4C-007** | medium | a draft of the supervisor re-granted `DELETE` on the append-only audit ledger after every migration run, silently undoing migration 0009's revoke. Privileges moved into a versioned migration, where they are reviewable as a diff. |

## Limits, stated

* **The Owner bootstrap has not been performed on the installed instance**, so no
  application data exists there yet and the per-user isolation checks ran on a probe
  installation built from the same image. The installed instance was verified for
  everything that does not require an account (`PI-01`…`PI-15`).
* `shm-size` is 64 MiB, so query parallelism is disabled rather than left to fail
  unpredictably under load.
* No TLS and no point-in-time recovery. Backups are logical dumps; WAL archiving is not
  configured.
* `noesar_restore_check` exists on the installed cluster: the restore verification created
  it, and it was deliberately left in place rather than dropped, because nothing in this
  phase deletes anything.
