# SESSION HANDOFF

**Phase:** `D-0569` deployed, `D-0570` (the deploy guard, repaired because it fired wrongly).
**Commit:** `7d00c48`, pushed to `origin/main`.
**Live installation:** **`noesar-evolution:d0569-measure-first-20260819T104500Z`**,
`running`/`healthy`, `RestartCount=0`. Predecessor `noesar-evolution-pre-20260819T094812Z` kept.
**`CE-008` now holds on the running box**, not only in the repository.

## ➜ LA PROSSIMA AZIONE

**The 8 CRITICAL criteria that still carry no verdict:**

```text
CE-002  CE-003  CE-007  CE-013  CE-014  CE-015  CE-025  CE-029
```

`CE-003`, `CE-013` and `CE-014` are **absence-shaped** — `D-0562` proposes the shared closure
helper for that class. `node tools/verify-acceptance-matrix.mjs` prints the list and holds the
ratchet (**29 / 8**).

Owner instruction, 2026-08-19: proceed toward FINISHED **without asking** which improvement to
build. Proposals are saved, not executed.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

### 1. The deployment (`D-0569`)

| Verified on the running box | Result |
|---|---|
| state | `running`/`healthy`, `RestartCount=0`, 4 children, **0** auth-failure lines |
| health endpoints | `/livez` + `/readyz` **200** on **both** HTTP `:8100` and HTTPS `:8443` |
| deployed bytes ↔ tree | **440 / 440**, and **0** files missing from the directory `COPY`s |
| the new route, live | `POST /api/v1/workspace-actions/:id/measure` → **401** — the gate answering, not a 404 |

Before `--apply`, against a **disposable probe** and never the installation (§3a 11e): browser
suite **505 pass / 1 declared gap / 0 undeclared**, accessibility **27/27**, unit **2725**,
battery **15/15**.

### 2. The browser found two things the unit tests could not

- The first e2e run **failed** with `#planApproveBtn: element is disabled`. That is `CE-008`
  working — a real Chromium could not click Approve on an unmeasured plan — and it is the
  strongest evidence in this phase. The suite now clicks **Measure**, waits for Approve to become
  enabled, and asserts that transition by name.
- The menu-count assertion was a literal **17**, already corrected once (`D-0448`), and `measure`
  broke it again. A number that describes another file now **comes from** that file
  (`AGENT_COMMANDS.length`).

### 3. The deploy guard rolled back a healthy deployment (`D-0570`)

The first `--apply` exited 4 and rolled back automatically: the replacement was healthy with all
four children, and the guard counted **2 auth-failure lines** — which were **correlation ids**,
`cb401d04-…` and `…-4401-…`. Measured on the running installation immediately after: the old
pattern matched **3** lines of which exactly **one** was a real 401. Every request this product
logs carries a UUID, so the guard was a coin toss with a rollback attached, and it had passed
until now by luck.

Repaired to read the **structured field** (`"status": ?(401|403)`), which an identifier cannot
produce. Two new fixture checks **execute** the pattern rather than describe it; the `|| true`
around the counting grep was omitted at first and failed for exactly the reason the same file
documents two checks above. Fixture **76/76**, oracle seen to fire on the pre-repair file. The
retry deployed with **0** auth-failure lines.

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **8 critical criteria still have no verdict.** `production_ready` stays **false**.
- **`[UNVERIFIED]`: no signed-in session was driven against the *installation*.** §3a 11e forbids
  running the mutating suites there; what was proven live is health, byte-equality and that the
  surfaces answer. The two-step flow itself was proven in a real browser **against the probe**.
- **The browser suite's one failure is `F-I18N-002`**, the pre-existing declared i18n gap. It is
  declared, not new, and unrelated to this change.
- **The shadow is held in memory between `measure()` and `approve()`.** A restart loses it:
  `approve()` refuses `MEASUREMENT_LOST` and `measure()` runs again.
- **`D-0564` is not built.** It is now the most valuable unbuilt idea: this phase **doubled** the
  authority events per run, and every one rests on a chain that is a hash, not a signature.

## SESSION CLOSE — `CLAUDE10.md` §5a

Inventory: `EVIDENCE/docker_inventory_pre_cleanup_D0569_20260819T104500Z.txt`. Removed: the older
rollback `noesar-evolution-pre-20260819T084122Z` (`Exited`, confirmed first — its image stays on
disk) and the superseded build tag `d0569-measure-first-20260819T092743Z`. The two probe runs
left **no** container, image or stamped network; only the stable `noesar-e2e-net` survives, as
§21c requires. **Containers 53 → 52 · volumes 65 → 65 · networks 10 → 10 · non-project
containers 50 → 50.** No `prune` of any kind. Health proven again after cleanup.

## THE IMPROVEMENT PROPOSAL — `D-0564`, carried and now stronger

Anchor the event ledger's head outside the file, signed with the owner key `server.mjs` already
writes. Every run now records **two** grants, two mints and a measurement, and the chain
protecting all of it is `createHash` with no key: it detects an edit, not a rewrite.
**Funding fit: Restack · traits 5 and 3** — verifiable provenance, offline, on the installation's
own key, with no external notary.

## OPEN BLOCKERS

`B-002` stale-premise and `B-011` low-deferred. Neither blocks the next action.
