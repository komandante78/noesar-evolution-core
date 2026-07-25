# Phase 4 — ATOM-absent acceptance

This closes the `[UNVERIFIED]` label that has stood since Phase 1.

## Verdict

```text
FOSS_CORE_DEPENDS_ON_ATOM=false            VERIFIED (was: holds by design, unverified)
PRIVATE_ATOM_IMPLEMENTATION_PRESENT=false  VERIFIED
CORE_FUNCTIONAL_WITHOUT_ATOM=PASS
```

## J1 — the image builds with no ATOM component present

`noesar-evolution:phase4` was built with `--network=none` from `oci/Dockerfile.phase4`,
whose entire build context is this repository. There is no ATOM component in it to remove:
see J5. The build had no network, so nothing could have been fetched either.

## J2 — the container starts and serves

`noesar-evolution` on `127.0.0.1:8100`, `Up (healthy)`, `/livez` 200, `/readyz` ready,
`/healthz` healthy with 17 components and 0 unhealthy. No ATOM environment variable,
endpoint, module, licence or key is present, and none is missing: nothing looks for one.

## J3 — the test suites pass with nothing proprietary present

`npm test`: **351 / 351 pass**, 0 fail, 0 skipped. That is the 317 the Phase 3 close
recorded plus 34 added in this phase. No test is conditioned on an ATOM component, and no
test was skipped for its absence.

## J4 — the core delivers what its documentation claims, unaided

136 acceptance checks with captured evidence, **132 PASS, 3 PARTIAL, 1 BLOCKED, 0 FAIL**
(`docs/ACCEPTANCE_RESULTS.tsv`). Everything the product documents as core function was
exercised without any proprietary component: Ask/Create/Act chat with real streaming,
branch fork/merge/compare/undo, message edit by supersession and per-branch exclusion,
context and token inspection, projects with verified isolation, memory at global, project
and conversation scope, hybrid and full-context retrieval with citations, file ingestion
including PDF, Office, ZIP, image OCR and media metadata, artifacts of five types with
versioning, export and import, retention and purge, local and mock external providers with
consent gating and redaction, agents with plan/approve/execute and MCP over HTTP and stdio,
the whole authentication and MFA surface, logging, debug mode, watchdog, safe mode and the
update manager.

The three PARTIAL results (F4-010 DNS rebinding, F4-011 MIME sniffing, F4-012 an
unreachable size limit) and the one BLOCKED result (no image renderer on this host to
synthesise an OCR fixture) are unrelated to ATOM.

## J5 — the pre-publication sweep

Searched for `atom` across everything the Dockerfile copies into the image —
`package.json`, `services/reference-control-plane/`, `apps/webui-static/` — excluding the
unrelated word `atomic`:

```text
package.json                              0 files
services/reference-control-plane          0 files
apps/webui-static                         0 files
```

The only matches anywhere in the shipped runtime are the substring inside `AtomicJsonStore`
and `atomic` file writes (`server.mjs:18`, `server.mjs:52`, `update-manager.mjs:377`),
which are about atomicity, not ATOM. There are no `ATOM_*` environment variables, no
`/atom` route, and no `atom-provider` reference in the image.

The repository does still carry the **public boundary**, which is allowed and intended:
`docs/ATOM_PUBLIC_PRIVATE_BOUNDARY.md`, `docs/ATOM_BOUNDARY_AUDIT.md` and the
`atom-provider.schema.json` contract. Contract and documentation only — no implementation,
no weights, no corpus, no derived fixture. That matches the Phase 1 audit finding, now
confirmed against the artefact that actually runs rather than against the source tree.

## What this does and does not prove

It proves the open core is complete and independently useful, which is what CLAUDE10 §52
requires. It does **not** prove that a future ATOM integration will work, because no
implementation of the provider contract exists here to integrate. That is the right shape:
the core defines the boundary, and any implementation may satisfy it.
