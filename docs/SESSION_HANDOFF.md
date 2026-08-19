# SESSION HANDOFF

**Phase:** `D-0573` — `CE-003`, `CE-014` and `CE-025` recorded by execution. `D-0574` proposed.
**Live installation:** unchanged — **`noesar-evolution:d0569-measure-first-20260819T104500Z`**.
**No product code was changed**, so no build, no deployment, no container.

## ➜ LA PROSSIMA AZIONE

**Three CRITICAL criteria remain, and they are the three hardest:**

```text
CE-007   CE-013   CE-015
```

`node tools/verify-acceptance-matrix.mjs` prints them and holds the ratchet (**24 / 3**).
Each one's starting point was measured this session, so the next phase opens without re-reading:

| Criterion | Where it lives, measured | The hard part |
|---|---|---|
| `CE-007` — repository and web content cannot alter instructions, policy **or token** | `src/ai-workspace/untrusted-content.mjs` (132 lines: `UNTRUSTED_POLICY`, `detectInjection`, `neutralizeFence`, `wrapUntrusted`, `enforceToolScope`) + the existing `prompt-injection-containment.test.mjs` | «zero bypass» needs a real corpus, and the **token** half has no probe yet — the existing suite is about instructions, not grants |
| `CE-013` — work data does not leave and does not enter the product's semantics | `src/context-projector.mjs` (already ✅ for `CE-004`: `CONTEXT_SECTIONS` frozen, `validateFact`, no append function) + `src/memory-service.mjs` (`CUBES`, `CATEGORIES`) | the criterion says «verificato dallo schema», so the canary must be refused **by the schema**, not by a check beside it |
| `CE-015` — a web result is not applicable until executed and verified in a sandbox | `packages/verified-acquisition/` (`authenticity.mjs`, `descriptor-schema.mjs`, `transport.mjs`) + `src/model-acquisition.mjs` | this is the one most likely to need **product work**, not only a suite. Measure before scoping. |

Owner instruction, 2026-08-19: proceed toward FINISHED **without asking** which improvement to
build. Proposals are saved, not executed.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

### `CE-003` — *impossible*, proven as a shape rather than as a refusal

`ce-003-undeclared-effect-impossible.test.mjs`, **10/10**. The probe offers every field a caller
can offer — `paths`, `files`, `declaredEffects`, four operations, `../../etc/passwd` — and **none
of them is an input**: `request()` reads the path from `ADAPTER_MANIFESTS`, a frozen declaration
in this repository, and the minted token carries exactly `['adapter://sector-modules/write']` /
`['WRITE']`. The refusal (`OUT_OF_SCOPE`, `UNKNOWN_ADAPTER`) is asserted too and labelled the
**weak** half, because a check is one forgotten call site from being allowed. Closure: every
`.mint(` under `src/` must be one of three declared paths.

### `CE-014` — three outgoing requests, not one

`ce-014-query-built-by-the-engine.test.mjs`, **10/10**. The forgotten egress is the **gate**:
`research.mjs` classifies before anything leaves and again on what came back. All three are
recorded as one wire trace; no canary appears in any of them. The provider payload is exactly
`objective` + `criteria`, key for key; a caller attaching `workspaceContents`/`context`/`files`/
`attachments` full of canaries gets none of them onto the wire. **The structural half is stronger
than the canary**: `research.mjs` imports `node:crypto` and nothing else and calls no filesystem
reader, so the channel does not exist rather than being guarded.

### `CE-025` — the subset proven as a set, and all the way to disk

`ce-025-author-never-names-a-path.test.mjs`, **7/7**. The probe answers in the model's own voice,
in every spelling `PATH_DIRECTIVE` accepts. Bytes land under the **Plan's** key; the directive is
stripped from the content too; each claim is recorded as `{path, claimed}`. A provider that says
it already checked is not believed — the rule is re-applied. End to end, `plan → measure →
approve` changes **exactly one file** and the directory listing is identical before and after.

### The measurement was itself checked, twice

- **`CE-014`'s canary oracle was proven to fire**: a canary injected into the provider payload
  turned 3 of the 10 tests red, then was restored.
- **A defect was found in this session's own instrument and fixed at the rule.** `CE-003`'s
  closure counted a **comment** in `skill-catalog.mjs` as a caller. Both closures now strip
  trailing `//` comments, and `D-0571`'s `CE-002` file was patched with the same rule and re-run
  green (**23/23**) — `CLAUDE10.md` §40c, fix the rule and not only the instance.

### The ratchet

`27 → 24` unstated, `6 → 3` critical. Seen to `FAIL (2)` one notch tighter before being set.

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **Three of the six criticals are not closed.** `CE-007`, `CE-013`, `CE-015`, above, with their
  measured starting points. `production_ready` stays **false**.
- **`CE-003`'s declared width:** `scopeRequestToTool()` has **zero** callers in the product. It is
  not a hole — that surface mints nothing (`toolCatalogStatus().enforced === false`, asserted) and
  a catalog tool is not a registered adapter, so it cannot obtain a token. `D-0574` proposes the
  wiring for the day a route does; the closure fails if one lands without it.
- **`F-REVOKE-001` and `F-AUTH-UI-001` (opened `D-0571`) are still open and unfixed.** Both change
  the product and would require a deployment.
- **`MANIFEST.sha256` was not regenerated** for the three new files. `F-MANIFEST-001` (open since
  `D-0399`) already records it stale by ~670 entries; unchanged either way. `[UNVERIFIED]`.
- **No browser suite, no accessibility audit, no `scripts/test.sh` battery, no T3.** Nothing this
  phase produced is reachable from a browser: three test files, three document cells, one constant.

## SESSION CLOSE — `CLAUDE10.md` §5a

**No container, image tag or network was created.** The only Docker use was the existing
`tools/run-eslint.sh` disposable `--rm` linter. The two project containers are unchanged: the
running `noesar-evolution` and its one kept rollback.

## THE IMPROVEMENT PROPOSAL — `D-0574`

Wire `scopeRequestToTool()` onto the mint path **before** any route lets a catalog tool obtain a
token, so the intersection is never something added afterwards.
**Funding fit: Restack · traits 5 and 1** — measurable reliability, and a delimited
declared-effect intersection reusable by any tool ecosystem, not only this product.

`D-0572` (make revocation an act) and `D-0564` (anchor the ledger head) remain carried and unbuilt.

## OPEN BLOCKERS

`B-002` stale-premise and `B-011` low-deferred. Neither blocks the next action.
