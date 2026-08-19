# SESSION HANDOFF

**Phase:** `D-0575` — `CE-007`, `CE-013`, `CE-015` recorded. `D-0576` proposed.
**Live installation:** unchanged — **`noesar-evolution:d0569-measure-first-20260819T104500Z`**.
**No product code was changed**, so no build, no deployment, no container.

## ➜ LA PROSSIMA AZIONE

**Every CRITICAL criterion of the acceptance matrix now carries a verdict.**

```text
critical with no verdict:  0     (was 15 when the matrix was first read by a machine)
unstated overall:         21     (all HIGH or MEDIUM)
```

`node tools/verify-acceptance-matrix.mjs` holds the ratchet at **21 / 0**.

**The next action is the Owner's to choose, and the three candidates are not equal:**

1. **The 21 HIGH/MEDIUM rows.** The same method as the last three phases, at lower severity.
   `verify-acceptance-matrix.mjs` prints them. This is the cheap, mechanical continuation.
2. **The three open findings, which are product work and need a deployment** —
   `F-REVOKE-001` (revocation implemented and unreachable), `F-AUTH-UI-001` (no shell reads
   `authoring.reason`), `F-TOOLSCOPE-001` (`scopeRequestToTool()` has no caller). Each has a
   recorded proposal: `D-0572`, `D-0574`, and the repair described in `F-AUTH-UI-001` itself.
3. **`D-0564`**, still the most valuable unbuilt idea: anchor the event ledger's head, signed
   with the owner key. Every run now records several grants and a measurement, and the chain
   protecting all of it is a hash with no key — it detects an edit, not a rewrite.

**A CRITICAL verdict is not the same as a shipped product.** `production_ready` stays **false**:
the matrix now says the security claims hold, which is a different sentence from "the product is
finished". The 21 remaining rows and the three findings are what stands between the two.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

### `CE-007` — three targets, not one

`ce-007-…test.mjs`, **10/10**. The criterion names **instructions**, **policy** and **token**; an
injection suite normally tests the first and the third is where the consequence is a write to
someone's disk. A corpus of **10** — one per declared signal, plus a forged fence, plus a case no
detector matches — runs against all three, and the number of cases executed is asserted against
the corpus length, because *zero bypass* is a count. Driven through `ChatOrchestrator.compare()`,
the **real call site**: that `wrapUntrusted()` is correct in isolation says nothing about whether
the product uses it. The token half goes to bytes — an injection inside a repository file, with a
model that obeys it, changes neither the plan's file set, nor the minted token's paths and
operations (read from the ledger), nor a byte of the bystander file.

### `CE-013` — refused by the schema, and explicitly not a denylist

`ce-013-…test.mjs`, **12/12**. Every canary is refused inside `validateFact()` with the *schema's*
vocabulary — no such section, not a field of this section, wrong type, over the cap — never by
anything recognising the content. Asserted both ways: the same shapes with an innocuous value are
refused identically, and a canary that **fits** a declared field **is accepted**. Saying that
plainly is more honest than implying the schema screens words. Closure: every field of every
section is one of four bounded kinds, so there is nowhere free-form for work data to live. An
over-length value is **rejected, not clipped** — clipping would be the silent failure.

### `CE-015` — two meanings of "applicable", both covered

`ce-015-…test.mjs`, **9/9**. A research report has **no path** to the workspace (the store is only
`put`/`get`/`revoke`, derived from source) — true, measured, and *not enough on its own*, because
it is the nothing-applies-anything answer. So the attempt the method names is run on a body that
**is** a web result: `approve()` without `measure()` → `NOT_MEASURED`, bytes unchanged; and the
order is read from the **ledger**, `executor.ran` and `shadow.compared` before
`workspace_action.promoted`. On the acquisition side, a descriptor **altered after signing** — the
classic from-the-web failure — is refused `SIGNATURE_INVALID`, and with no registry nothing
verifies: the absence of a check is never a pass.

### The measurement was checked, and one of my own tests was wrong

- **`CE-007`'s containment oracle was proven to fire**: routing the injected text into the
  `system` message turned 2 of its 10 tests red, then restored.
- **A `CE-015` test passed for the wrong reason and was repaired.** Named *«a shadow that is
  gone»*, it was actually being refused by the *status* check, because `reject()` moves the status
  too. It now asserts the `kind` and carries the name of what it measures.

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **`MEASUREMENT_LOST` is not proven.** The refusal a restart produces — the one `CE-008` and
  `CE-015` both lean on — has **no public door** a test can open. Declared inside the test that
  would otherwise have implied coverage. `D-0576` proposes the seam.
- **21 HIGH/MEDIUM criteria still carry no verdict.** `production_ready` stays **false**.
- **`F-REVOKE-001`, `F-AUTH-UI-001`, `F-TOOLSCOPE-001` are all still open and unfixed.** All three
  change the product and would require a build and a deployment.
- **`MANIFEST.sha256` was not regenerated** for the three new files. `F-MANIFEST-001` (open since
  `D-0399`) already records it stale by ~670 entries. `[UNVERIFIED]` against the new file set.
- **No browser suite, no accessibility audit, no `scripts/test.sh` battery, no T3.** Nothing this
  phase produced is reachable from a browser.
- **The CRITICAL ratchet is at its floor.** It can no longer be tightened, so this phase exercised
  only the *unstated* ratchet one notch tighter (`FAIL (1)`), not both. Stated, not implied.

## SESSION CLOSE — `CLAUDE10.md` §5a

**No container, image tag or network was created.** The only Docker use was the existing
`tools/run-eslint.sh` disposable `--rm` linter. Two project containers, unchanged: the running
`noesar-evolution` and its one kept rollback.

## THE IMPROVEMENT PROPOSAL — `D-0576`

Give the lost-shadow branch a door a test can open — a restart-simulating reload, not a poke into
a private field. A recovery path that has been executed once is worth more than one that has only
been written. **Funding fit: Restack · trait 5** — measurable reliability.

`D-0572`, `D-0574` and `D-0564` remain carried and unbuilt.

## OPEN BLOCKERS

`B-002` stale-premise and `B-011` low-deferred. Neither blocks the next action.
