# SESSION HANDOFF

**Phase:** `G-01` slice 2 — `D-0563` (work), `D-0564` (proposal, saved not executed).
**Commit:** `b41c647`, pushed to `origin/main`. **Nothing was deployed** — two test files and two
documentation cells; no runtime path is in the diff.
**Live installation:** unchanged — `noesar-evolution:d0544-health-lane-20260818T160214Z`,
`running`/`healthy`. No container, image or network was created, so §5a had nothing to remove.

## ➜ LA PROSSIMA AZIONE

**Four of the fifteen critical criteria are now closed. Eleven remain:**

```text
CE-002  CE-003  CE-007  CE-008  CE-013  CE-014  CE-015  CE-022  CE-025  CE-026  CE-029
```

`node tools/verify-acceptance-matrix.mjs` prints them and holds the ratchet (**32 / 11**).

**Read these three warnings before picking one — each would otherwise cost a false PASS:**

- **`CE-008`** (*l'ombra precede l'autorizzazione: nessun dialogo di autorizzazione senza risultato
  misurato*) — **read `approve()` first.** `simulate()` is *optional* in the current design, and
  the reference provider answers `supported: false`. As literally worded this criterion may be
  **NOT MET**, and recording it met because "the shadow runs inside approve" would be reading the
  sentence to fit the code. `CE-026` sits next to it and may well be met on the same reading.
- **`CE-022`** (*il criterio di "fatto" passa col solo provider di riferimento, senza ATOM*) — the
  battery already runs with no ATOM daemon reachable, so this looks free. **Verify that claim**
  (`atom-fallback-declared.test.mjs`, the env the suites run under) before recording it: "no ATOM
  was running" and "the suite does not need ATOM" are different statements.
- **`CE-003`, `CE-013`, `CE-014`** are **absence-shaped** — the class `D-0562` proposes a shared
  closure helper for. They cannot be closed by testing the routes somebody thought of.

Owner instruction, 2026-08-19: proceed toward FINISHED **without asking** which improvement to
build. Proposals are saved, not executed.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`CE-017` — a checkpoint precedes every mutative step, and restore is byte-identical.**
`services/reference-control-plane/test/ce-017-checkpoint-precedes-mutation.test.mjs`, **5/5**.

| Measured | How |
|---|---|
| byte-identical restore | **sha256 of the whole tree** before the plan and after the restore, compared as a map — paths *and* digests |
| both wired classes | **modify** (the original bytes come back) and **create** (the file is removed) |
| the ordering itself | no test can stand between two statements, so the checksum map **is** the ordering claim: those bytes can only return if they were read before being overwritten |
| blast radius of the undo | a file the plan never named is untouched — even when someone else edited it between the promotion and the restore |
| the checkpoint is **per run** | restoring the second run returns to the **first**, not to the origin |
| no encoding is assumed | binary bytes survive the round trip exactly |
| scope, not rounded up | `workspaceActionsStatus()` is **asserted**: WRITE only. Wiring `DELETE` or `EXECUTE` fails this file and the verdict must be earned again on the new class |

**`CE-018` — the ledger is append-only, with a chained digest.** `ce-018-ledger-append-only.test.mjs`,
**6/6**. The chain itself was already well tested (four tamper vectors in
`conformance/event-vectors.json`, a doctored journal in `durability.test.mjs`) and **none of it was
tied to the criterion**, which is why nothing could say whether it held. New here: append-only
measured **on the bytes** — the prefix already written is unchanged after four more events — an
edited line refused with `CHAIN_BROKEN` on reload, and a torn **final** line recovered and counted
rather than silently dropped.

**Its verdict carries its limit, written into the cell, because the sentence promises more than the
code delivers.** The chain is `createHash` with **no key**: it detects an edit, not a wholesale
rewrite. The suite performs that attack — two different histories, two internally valid chains,
distinguishable only by a head digest somebody wrote down elsewhere — and a source assertion fails
if `createHmac` ever appears, so the verdict cannot be silently inherited through the change that
would invalidate it. `D-0564` proposes the anchor.

**The ratchet moved again and was seen to hold**: unstated **34 → 32**, critical **13 → 11**. One
notch tighter it refuses with `11 CRITICAL criteria have no recorded verdict, up from 10`.

**Verification produced this session:** battery `scripts/test.sh` **15/15, exit 0**; unit **2716
pass / 0 fail / 1 skipped**; ESLint **436 files, 0 errors**; matrix **PASS** — 66 criteria, 34 with
a verdict (30 met).

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **11 critical criteria still have no verdict.** This session closed 4 of 15 across two phases.
  `production_ready` stays **false**, correctly.
- **`CE-018` is met at the strength the code has, not at the strength the sentence suggests.**
  Anyone quoting it must quote the cell, which says *unkeyed*. Until `D-0564` is built, a party who
  can write the journal can produce a consistent chain over altered facts.
- **`CE-017`'s verdict covers WRITE only.** `DELETE` and `EXECUTE` are not wired, so no verdict was
  earned for them; the suite asserts that rather than trusting this paragraph.
- **Nothing was deployed and no container was created.**
- **The secret scan was HEURISTIC**, declared: the `gitleaks` image is absent and rule 45 forbids
  installing tooling to satisfy the rule. Pattern scan of the staged diff: no key, token, password
  or credential-bearing string; no archive, binary, database or `.env` staged.
- **T3 was not run** — no image and no installation change. T2 (the battery) ran and is green.
- **`F-IMAGE-STALE-001`** is unchanged and still open: 9 files in the running image are older than
  the tree, all test files plus a `scripts` block, no runtime module.

## FILES THIS PHASE CHANGED

```text
services/reference-control-plane/test/ce-017-checkpoint-precedes-mutation.test.mjs   NEW, 5 tests
services/reference-control-plane/test/ce-018-ledger-append-only.test.mjs             NEW, 6 tests
MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md   the CE-017 and CE-018 verdict cells
tools/verify-acceptance-matrix.mjs             ratchet 32 / 11, and its prose re-measured
docs/acceptance-matrix.json                    regenerated
docs/GAP_REGISTER.md                           G-01 and the header paragraph re-measured
docs/DECISION_LOG.md                           D-0563, D-0564
MANIFEST.sha256                                the 15_… hash refreshed
PROJECT_STATE.json                             live keys
```

## THE IMPROVEMENT PROPOSAL — `D-0564`, **saved, not offered**

Anchor the event ledger's head digest outside the file — signed with the owner key `server.mjs`
already writes — and report the last signed head beside `chainValid`. Today the only defence
against a wholesale rewrite is that somebody wrote the real head down somewhere, and nothing in the
product does that. **Rejected alternative:** keying the chain with an HMAC, which would make the
ledger verifiable only where the key is and break third-party verification of an exported ledger.
**Funding fit: Restack · traits 5 and 3** — verifiable provenance that works offline, on the
installation's own key, with no external notary.

## OPEN BLOCKERS

`B-002` stale-premise (the secret-scan premise is false as written) and `B-011` low-deferred
(history rewrite, Owner-authorised, bundle backup taken). Neither blocks the next action.
