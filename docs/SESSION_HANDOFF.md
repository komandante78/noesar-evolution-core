# SESSION HANDOFF

**Phase:** the deployment + `G-01` slice 3 — `D-0565` (install), `D-0566` (three criteria),
`D-0568` (a defect in this session's own instrument), `D-0567` (proposal, saved not executed).
**Commit:** `e6057f6`, pushed to `origin/main`.
**Live installation:** **CHANGED** — now `noesar-evolution:d0559-provenance-20260819T084001Z`,
`running`/`healthy`, `RestartCount=0`. Predecessor `noesar-evolution-pre-20260819T084122Z` kept.

## ➜ LA PROSSIMA AZIONE

**Six of the fifteen critical criteria are closed. Eight still carry no verdict:**

```text
CE-002  CE-003  CE-007  CE-013  CE-014  CE-015  CE-025  CE-029
```

Plus **`CE-008`, which now has a verdict and it is a `❌`** — the register's first. It is not in
the list above because it is measured, not unknown; closing it is `D-0567`, an Owner decision.

`CE-003`, `CE-013` and `CE-014` are **absence-shaped** — `D-0562` proposes the shared closure
helper for exactly that class. `node tools/verify-acceptance-matrix.mjs` prints the list and holds
the ratchet (**29 / 8**).

Owner instruction, 2026-08-19: proceed toward FINISHED **without asking** which improvement to
build. Proposals are saved, not executed.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

### 1. The installation is a tree state, not an accumulation (`D-0565`)

The first image in this project's history built from `oci/Dockerfile` rather than from an 88th
`Dockerfile.phase4-*` overlay is **deployed**. Measured **on the running container**, not inferred:

| Measured live | Result |
|---|---|
| `find /opt/noesar -perm -o+w` inside the running container | **0** — every previous image shipped the application **world-writable**, with only the read-only rootfs in the way |
| `schemas/model-descriptor.schema.json` | **present** — the recipe had never copied it |
| byte-equal tree↔image, preflight **and** after | **439 / 439** both times |
| health | `running`/`healthy`, `RestartCount=0`, 4 children, **0** auth-failure lines, `/livez` + `/readyz` **200** on HTTP and HTTPS |

**`F-IMAGE-STALE-001` is closed.** Rollback: restart `noesar-evolution-pre-20260819T084122Z`; its
image is on disk; no migration, no schema change, no configuration key.

### 2. Three more criteria, and the first honest `❌` (`D-0566`)

- **`CE-026` MET** — what lands in the workspace is the **shadow's** bytes, the shadow does not
  survive the call (0 directories left behind), and a run whose verification was **contradicted**
  promotes nothing: the real file keeps its previous bytes.
- **`CE-022` MET, in a harder form than it asks for** — the whole battery **15/15, exit 0**, with
  ATOM not merely uninstalled but **selected and unreachable**. The product carries on with the
  reference provider and **declares** the degradation (`D-0312`).
- **`CE-008` NOT MET, recorded `❌`** — its own method was executed and the attempt it says must be
  refused **succeeds**: `approve()` promotes a run nobody simulated. Read off the **ledger**, not
  the source, the order is `approved` → `executor.ran` → `shadow.compared`. The shadow protects the
  **promotion**, not the **dialogue**, and `simulate()` is optional and answers `supported: false`
  on the reference provider — so on that installation there is no measured result to approve
  against at all. The test is green and *characterises* the gap: change the order and it fails, so
  the verdict must be re-written rather than inherited.

**That `CE-022` run was RED first — 13/15 — and neither failure was the product.** Three places
read the ambient environment and broke when it differed: the `workspace-actions` fixture and its
HTTP adversarial twin gained a `workspace_action.degraded` event that is correct behaviour, and
`tools/auth-http-smoke.mjs` spawned the server with `process.env` and then asserted
`mode === 'reference-node'` — measuring the shell it was launched from. All three now **pin** the
four keys the router reads. Without that repair `CE-022` was not repeatably measurable.

### 3. The session's own instrument was blind in one direction (`D-0568`)

`tools/verify-image-provenance.sh` walked the **image** and asked the tree about it — so a file the
recipe never copies was **invisible to it**, which is precisely the defect `D-0559` repaired. That
one was caught only because a second image happened to carry the file; the deploy gate performs a
**one-image** run and would have said `PASS`. Section `4b` now derives what every directory `COPY`
promises and checks it is there. **Oracle seen to fire on real data**; on a fresh build:
**440/440** byte-equal, **422** expected from directory COPYs, **0** missing.

**Verification produced this session:** battery **15/15 exit 0** (twice: default, and under
ATOM-selected-but-absent); unit **2721 pass / 0 fail / 1 skipped**; ESLint **437 files, 0 errors**;
redeploy fixture **73/73**; matrix **PASS** — 66 criteria, 37 with a verdict (32 met), 29 without,
8 critical. Ratchet **32 → 29** and **11 → 8**, seen to fail one notch tighter.

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **The running image is byte-equal to the commit it was built from, not to HEAD.** The tree has
  advanced since by **test-only** changes (2 files differ, 1 absent). The gate therefore **refuses**
  a redeploy of that tag — correct behaviour, not a defect. No product code changed after the
  deploy, so §3a asks for no second deployment.
- **`CE-008` is an open gap with a recorded verdict.** Closing it is `D-0567` and it is not small:
  `plan()` would become stateful and the shadow's lifetime has to be designed.
- **8 critical criteria still have no verdict.** `production_ready` stays **false**, correctly.
- **`[UNVERIFIED]`: nothing exercised a signed-in browser session against the new installation.**
  Live verification used health, byte-equality and unauthenticated surfaces only, because §3a 11e
  forbids running the mutating suites against the installation.
- **The secret scan was HEURISTIC**, declared: the `gitleaks` image is absent and rule 45 forbids
  installing tooling to satisfy the rule. No key, token, password, archive, binary or `.env`.
- **Dismissed with evidence:** `SC1007` on `CDPATH= cd` in the provenance tool — the idiom every
  shipped script here uses, already recorded as a known false positive.

## SESSION CLOSE — `CLAUDE10.md` §5a

Inventory: `EVIDENCE/docker_inventory_pre_cleanup_D0559_20260819T084001Z.txt`. Removed: the older
rollback `noesar-evolution-pre-20260818T160230Z` (`Exited`, confirmed first — its image stays on
disk) and the throwaway build tag `g02check-20260819T084001Z`. Survivors are exactly the two §21b
permits. **Containers 53 → 52 · volumes 65 → 65 · networks 10 → 10 · non-project containers
50 → 50.** No `prune` of any kind. Product proven healthy afterwards.

## THE IMPROVEMENT PROPOSAL — `D-0567`, **saved, not offered**

Move the execution-into-shadow to `plan()` time, so the approval dialogue is offered **against a
measured result** and `approve()` promotes an outcome the approver has already seen — closing
`CE-008` for real. **Rejected alternative:** making `simulate()` mandatory, which would make the
core unusable without an external provider and break `CE-022` and `FOSS_CORE_DEPENDS_ON_ATOM =
false` with it. **Funding fit: Restack · trait 5** — an authorisation shown its measured
consequence is the difference between an audit trail and an informed decision.

## OPEN BLOCKERS

`B-002` stale-premise and `B-011` low-deferred. Neither blocks the next action.
