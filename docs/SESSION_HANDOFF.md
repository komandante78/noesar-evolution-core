# SESSION HANDOFF

**Phase:** `D-0577` — revocation becomes an act. `F-REVOKE-001` **closed**. `D-0578` proposed.
**Live installation:** **`noesar-evolution:d0577-revocation-20260819T152649Z`**, deployed 15:28Z,
`running`/`healthy`, byte-equal to the tree **449/449**. Predecessor kept as
`noesar-evolution-pre-20260819T152817Z`.

## ➜ LA PROSSIMA AZIONE

**The next action is the Owner's to choose. The candidates, honestly unequal:**

1. **`F-AUTH-UI-001`** — the strongest remaining product gap. `CE-029` proves the API response
   carries `authoring.reason`, and **no file under `apps/` reads it**: the reason a change was
   authored never reaches either shell. The precedent for the repair is `reasoningSummary()` in
   `apps/webui-static/coden-view-model.js`. Product work; it will need a build and a deployment.
2. **The 21 HIGH/MEDIUM acceptance rows.** `node tools/verify-acceptance-matrix.mjs` prints them;
   the ratchet is held at **21 unstated / 0 critical-unstated**. Cheap and mechanical.
3. **`D-0564`** — still the most valuable unbuilt idea: anchor the event ledger's head, signed
   with the owner key. Every run records several grants and a measurement, and the chain
   protecting all of it is a hash with no key — it detects an edit, not a rewrite.

**Not a candidate yet, and the reason matters:** `F-TOOLSCOPE-001` (`scopeRequestToTool()` has no
caller). `D-0574` argues **against** wiring it until a route can mint for catalog tools — a call
site with nothing to exercise it is how an unexercised path rots. That is a design decision to
take before it becomes work, not a repair waiting to be done.

**`production_ready` stays `false`.** A closed finding and a green CRITICAL matrix are not a
finished product.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**A capability grant can be withdrawn by a person.** Before this phase `TokenMinter#revoke` had
zero product callers: the only way to stop a live token was to wait out its own expiry, and
nothing anywhere could list which grants were outstanding.

| Layer | What landed |
|---|---|
| engine | `grant()` / `grants()` describe a live grant — step, plan digest, paths, operations, uses, expiry — and **never** the MAC. `revoke()` keeps its boolean signature so `rust/crates/noesar-capability` stays a mirror, not a fork. |
| HTTP | `POST /api/v1/capability/revoke` (session + `workspace.write` + CSRF); the grant list on `GET /api/v1/capability` gated on `workspace.read`, withheld **with the permission named** otherwise. |
| protocol | `capability.grants` (`workspace.read`) and `capability.revoke` (`workspace.write`), both `bridged: true` so neither shell has an act the other lacks. |
| shells | `/grants` and `/revoke <token>` in the one command table both shells render; the Authority panel lists what is outstanding and names the verb that withdraws it. |
| audit | every withdrawal is a `capability.revoked` ledger line naming the **paths and operations** it covered — the grant is described before it is deleted, because afterwards the engine cannot say what it was. |

**`CE-002`'s closure changed claim rather than losing one** — from "nobody may call `revoke()`" to
"only a **declared revocation surface** may", checked in both directions. Its HTTP *revoked* case
now reaches the state the way a person does; the foreign-engine variant is kept beside it because
it proves the MAC gate, one gate earlier. `docs/acceptance-matrix.json` records the change.

### Verification — all produced this session

```text
capability-revocation.test.mjs      18/18   (engine · protocol · panel · shells)
oracle proven to fire                       loosening capability.revoke to workspace.read -> 3 red
npm test                          2840 tests / 2839 pass / 0 fail / 1 pre-existing skip  (+21)
tools/run-eslint.sh                446 files / 0 errors / 0 warnings
scripts/test.sh                    15/15 steps, 0 unavailable
tools/seeded-defect-proof.mjs      19/19 caught
tools/run-browser-e2e.sh           506 checks / 505 pass / 1 declared gap / 0 undeclared
live                               /livez /readyz /healthz = 200 on :8100 and :8443
live                               POST /api/v1/capability/revoke -> 401 (the gate, not a 404)
```

### Defects found and fixed inside this phase

- the Authority panel threw a `TypeError` on an engine that answers without a grant list — found
  by `coden-shell-parity`, whose transport answers `{}` to a method it has not been taught. An
  unrecognised answer is now a stated refusal and is **never** rendered as "none outstanding".
- the two new commands had no Italian catalogue entry (`ui-language-coverage`);
- the browser view model offered them with **no engine call** (`coden-view-model`);
- two documentation defects: `docs/acceptance-matrix.json`'s `CE-002` verdict and
  `docs/security/INDEPENDENT_PENTEST_SCOPE.md` both still said no route revokes.

## WHAT WAS **NOT** DONE

- **`D-0578`, this phase's proposal, is not executed.** `spend()` still refuses a **revoked**
  token with the wording it uses for one this engine never issued. The audit trail distinguishes
  them; the refusal message does not. Fixing it needs the JS engine, the Rust mirror and a
  conformance vector **together**, which is why it is proposed rather than slipped in.
- **`F-AUTH-UI-001` and `F-TOOLSCOPE-001` are untouched.** Only one of the three findings was
  closed.
- **`tools/accessibility-audit.mjs` was not run**, and this is a declaration, not an omission:
  this phase changed no markup, no DOM structure and no CSS token — the two change-map rows that
  reach it. The three catalogue strings it added are covered by `ui-language-coverage`.
- **`F-UNIT-FLAKE-001` did not reproduce.** The full `scripts/test.sh` output was preserved this
  run, as that finding asks; the unit step passed.
- **`F-I18N-002` remains red at 647 closable** — a declared gap, and **unchanged** by this phase.

## OPEN BLOCKERS

`B-002` (stale premise: gitleaks/trufflehog — **re-measured this session, both absent from
`PATH`**, so the secret scan was heuristic and is declared as such) and `B-011` (low, deferred:
history rewritten on the Owner's explicit authorisation, 2026-07-30). Neither blocks work.
