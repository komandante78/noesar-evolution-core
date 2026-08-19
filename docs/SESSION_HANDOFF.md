# SESSION HANDOFF

**Phase:** `G-01` slice 1 — `D-0561` (work), `D-0562` (proposal, saved not executed).
**Commit:** `9009b6a`, pushed to `origin/main`. **Nothing was deployed** — this phase changed a
test, a documentation table and two tools; no runtime path exists in the diff.
**Live installation:** unchanged — `noesar-evolution:d0544-health-lane-20260818T160214Z`,
`running`/`healthy`. No container, image or network was created this phase, so §5a had nothing
to remove: containers **52 → 52**, volumes **65 → 65**, networks **10 → 10**.

## ➜ LA PROSSIMA AZIONE

**The 13 CRITICAL criteria that still carry no verdict**, in the order the register prints them:

```text
CE-002  CE-003  CE-007  CE-008  CE-013  CE-014  CE-015
CE-017  CE-018  CE-022  CE-025  CE-026  CE-029
```

`node tools/verify-acceptance-matrix.mjs` prints the list and holds the ratchet. **Four of the
thirteen are absence-shaped** — `CE-003` (an undeclared effect is impossible), `CE-013`/`CE-014`
(work data does not leave), `CE-018` (the ledger is append-only) — and that is the class this
phase learned how to close: derive the candidate set from the source, declare each member with
its reason, fail when the set grows. `D-0562` proposes extracting that into `tools/closure.mjs`
before writing it a fourth time by hand.

Owner instruction, 2026-08-19: proceed toward FINISHED **without asking** which improvement to
build. Proposals are saved, not executed.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`CE-001` is met, and it is the product's central security claim** — *nessun percorso muta il
workspace senza spendere un token coniato da un Piano autorizzato*. The suite its own method
names now exists: `services/reference-control-plane/test/ce-001-no-mutation-without-token.test.mjs`,
**20/20**.

| What it measures | Result |
|---|---|
| **the closure** — derived from the source on every run | **114** modules scanned, **28** write, **3** know where the workspace is (`workspace-actions.mjs`, `session-protocol.mjs`, `server.mjs`), each declared with the reason it is not a way to mutate authored content |
| **the executor never learns the real workspace root** | asserted; it writes through `shadow.root` only |
| **nine attacks**, each asserting the **bytes** on disk | no token · forged MAC · foreign minter · **foreign minter holding the same secret** · expired · exhausted · revoked · wrong path · wrong operation |
| **three mint-side refusals** | a path the step does not name · a path leaving the workspace while the plan declares containment · a plan nobody approved |
| **positive control** | with a real token the write **does** land — twice proven, see below |

**Why the closure is the new thing.** Every existing capability, executor and workspace-actions
suite proves that *the path it drives* refuses without a token. None of them proves there is no
**other** path, and a criterion about the absence of a route cannot be closed by testing the
routes somebody thought of. Section 2 exists for the same reason at a smaller scale: an outcome
saying `performed: false` is a **report**, and CE-001 is about the bytes.

**The control fired twice, and the second time is the useful one.** An early case written as an
"expired token" had not actually expired at `NOW`, so the write landed and the test **failed**.
The bench could therefore genuinely write, which is what makes nine refusals mean something.

**`CE-004` is met** from the two things its own method asks for, both run this session: the
**inspection** of `context-projector.mjs`'s exported surface — `CONTEXT_SECTIONS` frozen,
`validateFact`, `projectContext`, `renderProjection`, `projectionShape`, `projectionByteCeiling`,
**no append function and no free-text section to aim at** — and `context-projection.test.mjs`
**16/16**, 9 of them `CE-004` cases including *"a refused write leaves the store untouched"*.

**The register is 66 rows, not 53 — found while recording the two verdicts.**
`MASTER_PROJECT/08_INSTALLAZIONE.md` (10 `INST-*`) and `01_VISIONE_E_POSIZIONE.md` (3 `SESS-*`)
have carried the identical five-column acceptance table all along, **ten of the thirteen with a
verdict already written**, and neither was listed as a source. "53 criteria" was the size of the
list, not of the acceptance surface. Both are sources now; the surface grew 24% and the debt did
not.

**Two hand-restated copies of the same alphabet, repaired at the rule.** The verifier's id-shape
check and the guard test each wrote `(CE|CUBE|ARCH)` out by hand and so called all thirteen
well-formed new ids *malformed*. Both now **derive** the prefixes from `SOURCES`.

**The ratchet moved and was seen to hold**: unstated **36 → 34**, critical unstated **15 → 13**.
Set one notch tighter it refuses with `13 CRITICAL criteria have no recorded verdict, up from 12`.

**Verification produced this session:** battery `scripts/test.sh` **15/15, exit 0**; unit **2706
pass / 0 fail / 1 skipped**; ESLint **434 files, 0 errors**; the acceptance matrix **PASS** at
66 criteria, 32 with a verdict (28 met).

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **`restore()` mutates the workspace and spends no token.** Named in the verdict, not folded
  into it. It is bounded by a *different* property — it can only write back the bytes `#promote`
  captured, cannot be used on a run that was never promoted, and refuses a second time — and that
  property is measured as its own three cases. Anyone reading `CE-001` as "literally every write
  spends a token" should read the verdict cell, which says otherwise.
- **13 critical criteria still have no verdict.** This phase closed 2 of 15. `production_ready`
  stays **false**, correctly.
- **Nothing was deployed and no container was created.** The new suite runs in-process against
  temporary directories.
- **The secret scan was HEURISTIC**, declared: `tools/run-secret-scan.sh` reports
  `SECRET_SCAN=SKIPPED reason=image-absent` for `zricethezav/gitleaks:latest`, and rule 45 forbids
  installing tooling to satisfy the rule. Pattern scan of the staged diff: every hit was the word
  *token* in prose or in capability-token code — no credential material, no archive, no binary.
- **T3 was not run** — no image, no installation change. T2 (the battery) ran and is green.
- **`MASTER_PROJECT/15_…md` gained a 5th column.** It is not covered by `PROVENANCE.sha256`
  (which lists `00`–`14`), so no provenance claim was broken; `MANIFEST.sha256` was refreshed for
  it. `01_VISIONE_E_POSIZIONE.md` and `08_INSTALLAZIONE.md` were **read only**.
- **`F-IMAGE-STALE-001`** (previous phase) is unchanged and still open: 9 files in the running
  image are older than the tree, all of them test files plus a `scripts` block.

## FILES THIS PHASE CHANGED

```text
services/reference-control-plane/test/ce-001-no-mutation-without-token.test.mjs   NEW, 20 tests
services/reference-control-plane/test/acceptance-matrix.test.mjs   the guard stops restating the alphabet
tools/acceptance-matrix.mjs                two sources added: 08_INSTALLAZIONE, 01_VISIONE
tools/verify-acceptance-matrix.mjs         id shape derived from SOURCES; ratchet 34 / 13
MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md   a 5th column, and the CE-001 / CE-004 verdicts
docs/acceptance-matrix.json                regenerated: 53 -> 66 rows
docs/GAP_REGISTER.md                       G-01 corrected a second time
docs/DECISION_LOG.md                       D-0561, D-0562
PROJECT_STATE.json                         live keys
```

## THE IMPROVEMENT PROPOSAL — `D-0562`, **saved, not offered**

Extract this phase's closure pattern into `tools/closure.mjs` and give the other absence-shaped
criteria a derived test instead of an anecdotal one. Four of the thirteen remaining critical
criteria are of that class, and writing the derivation by hand a fourth time is how the four end
up disagreeing about what counts as a route — the same failure this phase repaired twice today in
two hand-copied regexes. **Funding fit: Restack · trait 2**, reusable beyond this product:
*"prove no other code path does X"* is a check any audited codebase wants and almost none has.

## OPEN BLOCKERS

`B-002` stale-premise (the secret-scan premise is false as written) and `B-011` low-deferred
(history rewrite, Owner-authorised, bundle backup taken). Neither blocks the next action.
