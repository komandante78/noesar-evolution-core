# SESSION HANDOFF — 2026-08-15 (`D-0468`: ATOM open, governance session — closing)

## ➜ LA PROSSIMA AZIONE

**Session closing on two governance amendments, `D-0467`/`D-0468` — no product code in
either.** `D-0467` added a "path to final delivery" section to `noesar-evolution-
engineering-depth` (audit-once → frozen checklist → complete implementation → five delivery
ZIPs vs. checklist) and settled product access control as **registration only, never a
licence key**. `D-0468`: **ATOM is no longer proprietary** — open, AGPL-3.0-or-later,
matching the core — but stays **architecturally separate** in its own repository
(`ATOM_EVOLUTION`, still empty; repository split ≠ licence, only the licence moved).
`noesar-evolution-funding-fit` was named explicitly out of scope by the Owner and is
untouched — confirmed by `git status` both times it was checked.

**The top of the next action list is still `D-0466`, unfinished**: `/model` is fixed in
SOURCE ONLY.

1. **Run the disposable e2e probe** (`tools/run-browser-e2e.sh`) — a `/model` check was added
   to `tools/browser-e2e.mjs` but never executed (Owner stopped the run as too costly). Until
   it runs, the browser/terminal path for this fix is `[UNVERIFIED]`.
2. **Deploy**, if the Owner authorizes it — the running container still has the old `/model`.

Earlier this session: crash fix (`D-0460`) → F-PANEL-001 (`D-0461`) → F-TERM-002 (`D-0462`) →
F-SLASH-001 investigated (`D-0463`) → F-TMP-001 (`D-0464`) → F-TMP-002 (`D-0465`) →
`/model` fix (`D-0466`) → engineering-depth + access-control (`D-0467`) → ATOM open (`D-0468`).

Also still open, untouched:

- **F-SLASH-001's actual fix** — pick design (A) drive the terminal, or (B) declare-and-skip
  when the terminal has claimed the surface. See `D-0463`.
- **`cargo publish`** — serve `CARGO_REGISTRY_TOKEN` in `secrets/crates_io_token`, da
  terminale vero.
- oppure **Fase D**.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-CRASH-001` | **FIXED** — 8.3 GB / 3,553 leaked `/tmp` dirs removed, both leaking test files patched, rootfs 82%→29% full. See `D-0460`. |
| `F-TMP-001` | **FIXED** — shared `freshTempDir()` helper, 58 files migrated, 75,114 leaked dirs removed, rootfs 30%→20% full. `D-0464`. |
| `F-TMP-002` | **FIXED** — 5 plain-script `tools/*.mjs` files now sweep via `process.on('exit', ...)`. `D-0465`. 4/5 verified live; `a3-security.mjs` verified by pattern only (needs a disposable server+mock). |
| `F-MODEL-002` | **FIXED IN SOURCE, NOT DEPLOYED, NOT VERIFIED LIVE** — `/model` now lists what is loadable instead of demanding an id nobody could discover. `D-0466`. Unit-tested; e2e check added but never run. |
| `F-COMMAND-001` | **RIPARATO E DEPLOYATO** — `noesar-evolution:d0457-legacy-shell-hide-20260815T060429Z`, live e sano. |
| `F-PANEL-001` | **FIXED** — direct hash jump (`jump('agent/plan','plan','agent')`) replaces composer-driving at the plan-restore site. `D-0461`. Test-harness only, nothing to deploy. |
| `F-SLASH-001` | **ROOT CAUSE CONFIRMED, not fixed** — steady state (terminal already live), not a race, proven over 2 driven runs. Fix needs a test-strategy choice, deferred as its own phase. `D-0463`. |
| `F-TERM-002` | **FIXED** — `coden-terminal.js` `draw()` now erases (`SCREEN.clear`) instead of only repositioning (`SCREEN.home`). `D-0462`. Verified live, not yet deployed (no live-install authorization this session). |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| ATOM↔CodeN Evolution | **NON VERIFICATO** — serve una sessione autenticata (l'Owner ce l'ha già). |
| `D-0433` | **APERTO.** Stessa condizione già accettata. |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` in `secrets/crates_io_token`, da terminale vero. |
| ATOM licence | **APPLICATO** — aperto, AGPL-3.0-or-later, repository separato invariato (`ATOM_EVOLUTION`, ancora vuoto). `D-0468`. Follow-on: impostare il file `LICENSE` lì quando parte il lavoro. |
| Product access control | **DECISO** — registrazione, mai chiave/licenza a codice. `D-0467`/`D-0468`/`LICENSE_STRATEGY.md` §3a. |

## Verificato IN QUESTA SESSIONE

| Strumento | Risultato |
|---|---|
| `node --test` on the two `F-CRASH-001` files | 36/36 pass, 0 new `/tmp` dirs (was leaking every run) |
| `tools/run-browser-e2e.sh` (disposable probe, ×5) | run 1: 477 checks, 474 pass. Run 2 (F-TERM-002 diagnostic): proof of 5 stale prompt snapshots. Run 3 (F-TERM-002 fix): 475/477, that check now PASSES. Run 4/5 (F-SLASH-001 diagnostics): proved steady state, not a race |
| `node --test services/reference-control-plane/test/coden-terminal-client.test.mjs` | 21/21 pass (2 new/updated, F-TERM-002) |
| `node --test` on `workspace.mjs`'s own suite | 3/3 pass, confirmed self-cleaning (`/tmp` count 0→0) |
| `node --test` on all 58 `F-TMP-001`-migrated files together | 706/706 pass |
| `node tools/http-smoke.mjs`, `tools/tls-smoke.mjs` | both PASS, 0 leaked dirs; `tls-smoke`'s 12 pre-existing leaks also removed |
| `node tools/test-installer-hardening.mjs` | 100/100 checks, 0 leaked dirs |
| `node tools/test-cross-platform-installers.mjs` | 87 checks, 0 failures, 0 leaked dirs |
| `node --test services/reference-control-plane/test/model-catalog.test.mjs` (`D-0466`) | 36/36 pass, 4 new `loadableModels` tests |
| `node --test services/reference-control-plane/test/*.test.mjs` (final, after everything) | 2559/2560 pass, 1 pre-existing skip |
| `tools/run-eslint.sh` (final) | 411 files, 0 errors |
| Full-suite leak check, ×2 consecutive runs | `noesar-*` count in `/tmp` flat: 26→26 |
| `df -h /` across the whole session | rootfs 82%→29% (`F-CRASH-001`) →20% (`F-TMP-001`'s backlog removal) |
| §5a cleanup after each e2e probe | probe/runner/image removed every time; only the stable `noesar-e2e-net` network survives |

## Cosa NON è stato fatto

- **Nessuna verifica che richieda una sessione autenticata** — regola §3a 11e: la verifica
  live non usa una suite che muta dati; provato solo salute + uguaglianza dei byte + risposta
  delle superfici.
- **Deploy of `D-0462`'s fix** — verified live via the disposable probe only; not installed to
  the running container (no deployment authorization this session, same as `D-0461`).
- **`cargo publish`** e le altre domande di `docs/LICENSE_STRATEGY.md` §5 — invariate.
- **`D-0466`'s live verification and deploy** — the `/model` fix is source-only. Its e2e check
  exists in `tools/browser-e2e.mjs` but has never been executed, and the running container
  still serves the old behaviour. This is the top of the next action list above.
- **`a3-security.mjs`'s live run** — needs a disposable server + mock, out of scope to stand up
  just to verify a leak fix; verified by the identical, already-proven `process.on('exit')`
  pattern used (and live-confirmed) in the other 4 files instead.
- **F-SLASH-001's actual fix** — root cause is confirmed (not a guess: 2 driven runs), but the
  fix itself needs a test-strategy decision between two named designs before any code is
  written. Deliberately not picked unilaterally, same discipline `D-0456` used for `F-PANEL-001`.
- **`ATOM_EVOLUTION`'s own `LICENSE` file** — `D-0468` settled that it will be
  AGPL-3.0-or-later, but the repository is still empty; nothing was written into it this
  session (governance only, in `NOESAR_EVOLUTION`).
- **`MASTER_PROJECT/02_ATOM.md`** — checked, not edited: it declares only the technical
  `ReasoningProvider` contract, never a licence posture, so `D-0468` needed no supersession
  note there.

## Proposta di miglioramento

**Nuova, da questo giro (`D-0468`, non eseguita)**: now that `ATOM_EVOLUTION` is meant to be
open, it has no repository yet with a `LICENSE`, `NOTICE`, or a first commit — it is still
the empty repository from `2026-07-28`. Beneficio: the FIRST commit into it should carry the
AGPL text and the `ReasoningProvider` contract's own copy (or a pointer to this repo's), so the
licence is never an afterthought bolted on after code already exists — matching how `D-0453`
did the root `LICENSE`/`NOTICE` for this repository. Costo: near zero, and it is the natural
first step whenever `ATOM_EVOLUTION` work is actually authorized.

**Precedente (`D-0466`, non eseguita)**: `/model` was broken in a way NO test could
have caught, because nothing asserts that a command's declared argument is *discoverable*. Nine
commands take `<required>` arguments; `panelOwning()` gives eight of them a panel that shows the
possible values, and `/model` was the one with no panel and no listing — a fact visible only by
reading. Beneficio: one test walking `AGENT_COMMANDS` and asserting every `<required>` argument
has EITHER an owning panel OR a no-argument listing branch would have failed the day `/model`
shipped, and would fail again for the next command added without one. Costo: low, one test, no
product change — and it is the "criterio che nessuna riga misura" rule 5 of the phase skill
already names. **This is the strongest candidate for the next phase.**

**Precedente (`D-0465`, non eseguita)**: none of the 5 `tools/*.mjs` scripts assert their own
cleanup the way `workspace-support.test.mjs` does. A tiny shared assertion (run, snapshot `/tmp`
before/after, assert flat) would catch a regression of the leak class automatically.

**Precedente (`D-0463`, non eseguita)**: hoist `typeIntoTerminal`/`terminalFrame`/`screenText`
out of the `coden-terminal` step's block scope — the FIRST thing `F-SLASH-001`'s own fix will
need. See `D-0463` in `docs/DECISION_LOG.md`.

**Precedenti (`D-0461`/`D-0460`, non eseguite)**: see `docs/DECISION_LOG.md`.
