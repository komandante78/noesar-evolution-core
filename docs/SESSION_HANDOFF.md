# SESSION HANDOFF

**Phase:** `D-0569` — the Owner authorised `D-0567` and it was executed whole.
**Commit:** `02b06a0`, pushed to `origin/main`.
**Live installation:** `noesar-evolution:d0559-provenance-20260819T084001Z`, `running`/`healthy`
— **and it still serves the one-call flow.** This change is **not deployed**.

## ➜ LA PROSSIMA AZIONE

**One decision for the Owner, then the work.**

1. **Deploy `D-0569`.** It changes a user-visible flow (a second button, an Approve that is
   disabled until the plan is measured), so §77 stops here rather than deciding for you. Until
   it is deployed, **`CE-008` holds in the repository and not on the live box** — the register
   records the code, and that distinction is exactly the one `D-0565` was opened to end. The
   browser E2E and the accessibility audit should run with it: both need puppeteer, which lives
   only in the e2e container, so neither has run against this markup yet.
2. **Then the 8 CRITICAL criteria with no verdict:**

```text
CE-002  CE-003  CE-007  CE-013  CE-014  CE-015  CE-025  CE-029
```

`CE-003`, `CE-013` and `CE-014` are **absence-shaped** — `D-0562` proposes the shared closure
helper for that class.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`CE-008` was `❌` this morning and is `✅` now.** It is the only row in the register that has
been both, and that is the register working rather than a register being edited.

**The naive fix is circular, which is why the shape is what it is.** "Execute at `plan()` time"
cannot work: `execute()` refuses without a token, a token comes only from an authorised plan, and
an authorisation needs a human. So there are now **two authorisations of two different things**:

| Call | Authorises | Can it reach the workspace? |
|---|---|---|
| `measure()` | a run **in a shadow** — mints its own token, executes, compares, recomputes the declared claims | **no** |
| `approve()` | **the change**, answered against that result — mints the second token | yes, and it never re-executes: what is promoted is what was shown |

**Read off the ledger rather than the source**, which is where the criterion is actually
checkable: `measuring → executor.ran → shadow.compared → claims_verified → measured → approved →
promoted`, with **two** `capability.minted`.

**A side effect that was not the goal: `CE-001` is stronger than it was this morning.** The
workspace mutation now spends **its own token**, one use per file inside `#promote`, *before*
each write — the same spend-before-effect order the executor keeps — instead of inheriting the
token spent to write into the shadow.

**Both shells, and the graphics.** `measure` is declared **once**, in the command registry the
browser and the terminal share, so neither could get it without the other. The WebUI keeps
**Approve disabled** until a measurement exists, and its title says why. Four new strings are in
the translation catalogue; the one written at runtime is declared in `RUNTIME_ONLY` — the guard
that noticed it was a stale catalogue entry, not a missing one.

**Verification produced this session:** unit **2725 pass / 0 fail**; battery `scripts/test.sh`
**15/15, exit 0**; ESLint **437 files, 0 errors**; matrix **PASS** — 66 criteria, 37 with a
verdict, **33 met**, 29 without, **8 critical**.

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **Not deployed.** On the live installation `CE-008` does **not** hold yet. Stated plainly
  because the opposite reading — "the criterion is closed" — is the one the register invites.
- **`[UNVERIFIED]`: no browser has opened this markup.** The DOM change is one new button and a
  `disabled` attribute; the i18n coverage, shell-parity and view-model suites cover the registry,
  the strings and the call map, but `tools/browser-e2e.mjs` and `tools/accessibility-audit.mjs`
  both need puppeteer and were not run. Named, not skipped quietly.
- **The shadow is held in memory between `measure()` and `approve()`.** A restart loses it:
  `approve()` refuses `MEASUREMENT_LOST` and `measure()` runs again. Proven with two
  orchestrators over one run store — a real restart, not a simulated one.
- **Reversal cost is real for once**: the HTTP surface gained a route, the run gained a state and
  both shells changed. Reverting means reverting all three together.
- **8 critical criteria still have no verdict.** `production_ready` stays **false**.

## FILES THIS PHASE CHANGED

```text
services/reference-control-plane/src/workspace-actions.mjs   measure(), approve(), #promote spends
services/reference-control-plane/src/server.mjs              POST /workspace-actions/:id/measure
services/reference-control-plane/src/session-protocol.mjs    workspace.measure + its permission policy
apps/shared/coden/agent-commands.js                          the command, declared once for both shells
apps/webui-static/{app.js,index.html,coden-view-model.js}    the flow, the button, the call map
apps/webui-static/i18n-catalog.js                            4 strings + 1 RUNTIME_ONLY entry
MASTER_PROJECT/15_…md                                        CE-008 ❌ → ✅
+ 9 test files updated to the two-step flow, 1 rewritten from characterising the gap to proving
  it closed (ce-008-shadow-precedes-authorization.test.mjs, 9/9)
```

## THE IMPROVEMENT PROPOSAL — carried, not new

`D-0564` (anchor the ledger head outside the file, so a wholesale rewrite is detectable) remains
the best unbuilt idea and is now the most valuable one: this phase doubled the number of
authority events per run, and every one of them rests on a chain that is a hash, not a signature.
**Funding fit: Restack · traits 5 and 3.**

## OPEN BLOCKERS

`B-002` stale-premise and `B-011` low-deferred. Neither blocks the next action.
