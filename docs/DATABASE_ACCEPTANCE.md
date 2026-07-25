# Phase 4 — Database and vector store acceptance

## Verdict

```text
POSTGRES_INSTALLED=false
PGVECTOR_ACTIVE=false
ACTIVE_DATA_PLANE=reference-json
B005=OPEN
SUBSTITUTED_WITH_SQLITE=false
```

## What the runtime actually does

`services/reference-control-plane/src/data-plane.mjs` recognises two modes,
`reference-json` and `postgresql`. The container runs with
`NOESAR_DATA_PLANE=reference-json`, and the module reports, unprompted:

```text
connected: false
migrated: false
productionReady: false
repositoryAdapterActive: false
reason: "JSON stores are retained only for reference and tests."
```

Setting `NOESAR_DATA_PLANE=postgresql` does **not** silently fall back. It fails closed:

> Fail-closed: the Node reference process does not claim an active PostgreSQL repository
> without the production adapter.

That is the correct behaviour and it is worth stating plainly: the product refuses to
claim a data plane it is not running. Nothing was substituted with SQLite, and nothing
needed to be — the reference data plane is atomic JSON files under `/workspace/state`.

## What ships but is not installed

| Artefact | Present | Executed |
|---|---|---|
| `database/postgres-baseline-v0.5.0/0001–0008` | yes | no |
| `database/postgres/` migrations (12 recorded) | yes | no |
| `pgvector` extension declaration | yes, in `0001_schemas_and_extensions.sql` | no |
| Row Level Security policies | yes, in `0007_row_level_security.sql` | no |
| `src/postgres-repository.mjs` adapter | yes, with its own unit tests | not wired to a live database |
| Migration attestation ledger | implemented | no attestation recorded |

## Why this does not block Phase 5

`docs/PHASE_PLAN.md` defines Phase 5 as documentation, licensing audit, release and
packaging. PostgreSQL is a **production-promotion** requirement, not a Phase 5
prerequisite: `docs/PRODUCTION_READINESS_V050.md` makes promotion a conjunction of six
evidence groups, of which the PostgreSQL group is one, and
`docs/POSTGRES_PRODUCTION_GATE_V060.md` requires seven evidence kinds plus a bound
migration-manifest hash before the SQL gate returns true.

So the honest position is: **`productionReady=false` and the product says so itself.**
Phase 5 can proceed. Production cannot, and no document in this repository claims
otherwise.

## B005 — what exactly is missing

```text
B005  PostgreSQL 18 + pgvector data plane not installed and not exercised
      severity: medium
      blocks_phase_5: no
      blocks_production: yes
```

To close it: install PostgreSQL 18 with pgvector, apply migrations `0001`–`0008` (plus
the `database/postgres/` set) against it, run `tools/verify-postgres-migrations.py` and
`tools/verify-postgres-contract.py` — both of which need `python3`, absent on this host —
start the runtime with `NOESAR_DATA_PLANE=postgresql` and a `NOESAR_DATABASE_URL`, then
exercise: initialisation, migration ledger, schema, RLS with two roles, persistence,
vector insert/search/delete, cross-tenant isolation, backup and restore, restart, and
failure recovery. That is a separate installation with its own acceptance, exactly as
Phase 3 recorded.

Note the connection to F4-008: RLS in the Postgres schema is the *only* place real
user-to-user isolation exists. Until that data plane is installed, multi-user deployment
is not supported by this build.
