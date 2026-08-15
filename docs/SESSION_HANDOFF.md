# SESSION HANDOFF — 2026-08-15 (`D-0463`: F-SLASH-001 root cause confirmed, fix deferred)

## ➜ LA PROSSIMA AZIONE

**Continuation of the same out-of-sequence session — Owner authorized up to 3 phases in a row,
one at a time, each closing with its own report.** Fourth piece: crash fix (`D-0460`) →
F-PANEL-001 (`D-0461`) → F-TERM-002 (`D-0462`) → F-SLASH-001 investigated (`D-0463`, this one).

**F-SLASH-001 is NOT fixed — its root cause is CONFIRMED, and the fix is deliberately deferred
as its own next phase.** Two driven e2e runs (retry did not help — proved STEADY STATE, not a
race: composer state unchanged across 5 attempts over 1 full second) confirm the same defect
class as `F-PANEL-001`, but at a check that specifically tests the composer GESTURE — so
`F-PANEL-001`'s `jump()`-bypass does not transfer here. A real fix needs the terminal-driving
helpers hoisted out of their current block scope and new assertions built for a code path never
exercised before. Two competing designs are named in `D-0463`, neither self-evidently right —
this needs a decision, not a guess, exactly like `F-PANEL-001` did before `D-0461`.

Two items are still open:

- **F-SLASH-001's actual fix** — pick design (A) drive the terminal, or (B) declare-and-skip
  when the terminal has claimed the surface. See `D-0463`.
- **`cargo publish`** — serve `CARGO_REGISTRY_TOKEN` in `secrets/crates_io_token`, da
  terminale vero.
- oppure **Fase D**.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-CRASH-001` | **FIXED** — 8.3 GB / 3,553 leaked `/tmp` dirs removed, both leaking test files patched, rootfs 82%→29% full. See `D-0460`. |
| `F-TMP-001` | **OPEN, recorded** — same mkdtemp-without-cleanup pattern in ~55 other files, small leak each, not today's cause, not fixed. |
| `F-COMMAND-001` | **RIPARATO E DEPLOYATO** — `noesar-evolution:d0457-legacy-shell-hide-20260815T060429Z`, live e sano. |
| `F-PANEL-001` | **FIXED** — direct hash jump (`jump('agent/plan','plan','agent')`) replaces composer-driving at the plan-restore site. `D-0461`. Test-harness only, nothing to deploy. |
| `F-SLASH-001` | **ROOT CAUSE CONFIRMED, not fixed** — steady state (terminal already live), not a race, proven over 2 driven runs. Fix needs a test-strategy choice, deferred as its own phase. `D-0463`. |
| `F-TERM-002` | **FIXED** — `coden-terminal.js` `draw()` now erases (`SCREEN.clear`) instead of only repositioning (`SCREEN.home`). `D-0462`. Verified live, not yet deployed (no live-install authorization this session). |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| ATOM↔CodeN Evolution | **NON VERIFICATO** — serve una sessione autenticata (l'Owner ce l'ha già). |
| `D-0433` | **APERTO.** Stessa condizione già accettata. |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` in `secrets/crates_io_token`, da terminale vero. |

## Verificato IN QUESTA SESSIONE

| Strumento | Risultato |
|---|---|
| `node --test` on the two fixed files | 36/36 pass, 0 new `/tmp` dirs (was leaking every run) |
| `node --test services/reference-control-plane/test/*.test.mjs` | 2550/2551 pass, 1 pre-existing skip, unchanged |
| `tools/run-eslint.sh` | 409 files, 0 errors |
| `df -h /`, `free -h` before/after removing leaked dirs | rootfs 82%→29% (2.9G→12G free); available memory 1.9Gi→10Gi |
| `tools/run-browser-e2e.sh` (disposable probe, ×5 this session) | run 1: 477 checks, 474 pass. Run 2 (F-TERM-002 diagnostic): proof of 5 stale prompt snapshots. Run 3 (F-TERM-002 fix): 475/477, that check now PASSES. Run 4 (F-SLASH-001 one-shot diagnostic): fired never, generic error persisted. Run 5 (F-SLASH-001 retry diagnostic): proved steady state — identical composer/terminal state across 5 attempts over 1s |
| `node --test services/reference-control-plane/test/coden-terminal-client.test.mjs` | 21/21 pass (2 new/updated) |
| `node --test services/reference-control-plane/test/*.test.mjs` (final regression) | 2551/2552 pass, 1 pre-existing skip, unchanged |
| §5a cleanup after each e2e probe | probe/runner/image removed every time; only the stable `noesar-e2e-net` network survives |

## Cosa NON è stato fatto

- **Nessuna verifica che richieda una sessione autenticata** — regola §3a 11e: la verifica
  live non usa una suite che muta dati; provato solo salute + uguaglianza dei byte + risposta
  delle superfici.
- **Deploy of `D-0462`'s fix** — verified live via the disposable probe only; not installed to
  the running container (no deployment authorization this session, same as `D-0461`).
- **`cargo publish`** e le altre domande di `docs/LICENSE_STRATEGY.md` §5 — invariate.
- **`F-TMP-001`** — the same leak pattern in ~55 other files was found, not fixed: real fix
  needs a shared test helper (a single `withWorkspace()`/registered-temp-dir utility) so the
  cleanup lives in one place instead of being re-added file by file.
- **`F-SLASH-001`'s actual fix** — root cause is confirmed (not a guess: 2 driven runs), but the
  fix itself needs a test-strategy decision between two named designs before any code is
  written. Deliberately not picked unilaterally, same discipline `D-0456` used for `F-PANEL-001`.

## Proposta di miglioramento

**Nuova, da questo giro (`D-0463`, non eseguita)**: `typeIntoTerminal`/`terminalFrame`/
`screenText` (the proven, hard-won terminal-driving primitives from the `coden-terminal` step)
are block-scoped to that one step and unusable anywhere else in this 3900+ line file — which is
exactly what blocked a same-phase fix for `F-SLASH-001`. Beneficio: hoisting them to file scope
(a mechanical, low-risk move — they close over `page`/`terminalFrame` already, not over
anything step-local) turns "drive the live terminal" into a reusable capability for every check
downstream, not just the one step that happened to need it first. Costo: low, pure refactor; it
is also the FIRST thing `D-0463`'s own fix will need, so this is not speculative.

**Precedente (`D-0462`, non eseguita)**: `renderFrame`'s output has no unit test bounding a
row's rendered width to the terminal's actual column count. See `D-0462` in
`docs/DECISION_LOG.md`.

**Precedente (`D-0461`/`D-0460`, non eseguite)**: see `docs/DECISION_LOG.md` for both.
