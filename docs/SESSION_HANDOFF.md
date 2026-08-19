# SESSION HANDOFF

**Phase:** `D-0571` — `CE-002` and `CE-029` recorded by execution. `D-0572` proposed, not built.
**Live installation:** unchanged — **`noesar-evolution:d0569-measure-first-20260819T104500Z`**.
**No product code was changed this phase**, so no build, no deployment and no container was created.

## ➜ LA PROSSIMA AZIONE

**Six CRITICAL criteria still carry no verdict:**

```text
CE-003  CE-007  CE-013  CE-014  CE-015  CE-025
```

`node tools/verify-acceptance-matrix.mjs` prints them and holds the ratchet (**27 / 6**).

- `CE-013` + `CE-014` are the **canary pair** and should be taken together, the way `CE-002` and
  `CE-029` were: work data must not enter the product's semantics, and the search query is built
  by the engine so the user's code never appears in an outgoing request.
- `CE-003` and `CE-025` are **probe-shaped** — a tool that attempts an undeclared effect, an
  Author that attempts to write outside the step's file list.
- `CE-007` (prompt injection, zero bypass) and `CE-015` (a web result is not applicable until it
  has been executed in a sandbox) are the two that may need **product work**, not only a suite.
  Measure before scoping.

Owner instruction, 2026-08-19: proceed toward FINISHED **without asking** which improvement to
build. Proposals are saved, not executed.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

### `CE-002` — every surface, not a sample

`ce-002-token-refused-on-every-surface.test.mjs`, **23/23**. Five surfaces × three states, one
executed attempt each, and for each the proof that nothing happened:

| Surface | The proof it did nothing |
|---|---|
| `executor.mjs` WRITE | shadow **and** source bytes unchanged |
| `executor.mjs` EXECUTE | refused before the sandbox binary is even looked for |
| `workspace-actions.mjs` promotion | the workspace file keeps its original bytes |
| `local-model-runtime.launch()` | `403`, and nothing was launched |
| `sector-modules.installSectorModule()` | no module directory exists afterwards |
| `POST /api/v1/capability/spend` | `422 capability_refused`, real listener, owner session, CSRF |

Every refusal is checked **by reason**, not by outcome. The half that can rot is the **closure**:
every `.spend(` under `src/` is derived from the source at each run and must be a declared,
attacked surface or the one declared non-capability site (`coden-bridge.mjs`, a rate budget). A
sixth surface added tomorrow fails this suite instead of slipping past it.

### `CE-029` — the criterion's own method, on a real listener

`ce-029-no-model-refuses-to-author.test.mjs`, **12/12**. A listener started with **no
`NOESAR_AUTHORING_ENDPOINT`** — the single absence `buildAuthor()` reads — answers `POST
/api/v1/workspace-actions/plan` with **201**, not a silence and not a 503, carrying
`authoring.available:false`, `authored:0` and the reason in full. "No empty content" is measured
**on the bytes**: `plan → measure → approve` on that installation promotes exactly the caller's
bytes, read back from disk. The second route to empty is closed separately — a *configured* model
answering with an empty block is refused by name (`EMPTY`).

### The ratchet moved, and was seen to fire first

`29 → 27` unstated, `8 → 6` critical. Set one notch tighter it refused with `FAIL (2)`, measured,
before being restored to the new floor.

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **Two findings were opened and NEITHER was fixed.** Both change the product, and this phase
  changed no product code on purpose (it would have required a build and a deployment):
  - **`F-REVOKE-001`** — `TokenMinter#revoke` has **zero** callers in the product. Revocation is
    implemented and unreachable: a token issued in error can only be waited out. `D-0572`
    proposes the route. A closure test pins the caller count at `0` and fails the day one appears.
  - **`F-AUTH-UI-001`** — **no file under `apps/` reads `authoring.reason`.** The reason `CE-029`
    proves is on the API response never reaches either shell, so an operator on an installation
    with no model sees a plan and no statement that nothing could be written. The precedent for
    the repair is already in the tree: `reasoningSummary()` in `coden-view-model.js`.
- **`CE-002`'s width is declared, not rounded up.** The **Rust** engine (`noesar-capability`,
  `noesar-executor`) is a second implementation with its own `#[test]`s and is **not** covered by
  this JavaScript suite. The *revoked* state at the HTTP surface is reached through the branch
  revocation shares, because of `F-REVOKE-001`.
- **`CE-029` covers the response, which is its stated method** — not how the shells render it.
  That is `F-AUTH-UI-001` and is tracked separately rather than folded into the verdict.
- **`MANIFEST.sha256` was not regenerated** for the two new files. `F-MANIFEST-001` (open since
  `D-0399`) already records that the manifest is stale by ~670 entries; this phase neither
  worsened nor repaired it. `[UNVERIFIED]` against the new file set.
- **T3 was not run and no browser suite was run.** Nothing this phase produced is reachable from a
  browser: two test files, two document cells, one ratchet constant.

## SESSION CLOSE — `CLAUDE10.md` §5a

**No container, image tag or network was created this phase.** The only Docker use was the
existing `tools/run-eslint.sh` disposable `--rm` linter. The two project containers are unchanged:
the running `noesar-evolution` and its one kept rollback.

## THE IMPROVEMENT PROPOSAL — `D-0572`

Make revocation an act, not a latent method: `POST /api/v1/capability/revoke` (session +
`workspace.write` + CSRF + a `capability.revoked` ledger line) and the matching CodeN address.
**Funding fit: Restack · traits 5 and 3** — a withdrawable authority is an auditable one, and
revocation stays local and offline on the installation's own engine.

`D-0564` (anchor the ledger head, signed with the owner key) remains carried and unbuilt.

## OPEN BLOCKERS

`B-002` stale-premise and `B-011` low-deferred. Neither blocks the next action.
