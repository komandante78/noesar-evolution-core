# SESSION HANDOFF — 2026-08-15 (`D-0465`: F-TMP-002 fixed — 3-phase batch complete)

## ➜ LA PROSSIMA AZIONE

**This was phase 3 of 3 — the Owner-authorized batch ("procedi per 3 fasi") is now complete.**
Six pieces in one session: crash fix (`D-0460`) → F-PANEL-001 (`D-0461`) → F-TERM-002 (`D-0462`)
→ F-SLASH-001 investigated (`D-0463`) → F-TMP-001 fixed (`D-0464`) → F-TMP-002 fixed (`D-0465`,
this one, closing the whole mkdtemp-leak class `F-CRASH-001` started). **The next action needs
fresh Owner instruction — this is not a "procedi" situation any more.**

Every `tools/*.mjs` script that leaked a workspace now tracks and sweeps it via
`process.on('exit', ...)`, the process-level sibling of `D-0464`'s `after()`-based helper.
4 of 5 verified live and green; the 5th (`a3-security.mjs`) needs a disposable server+mock this
fix's scope didn't warrant standing up, so it is verified by the identical, already-proven
pattern instead of an independent run — declared as such, not claimed equal.

Three items are still open, none touched this session's final phase:

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
| `node --test` on the two `F-CRASH-001` files | 36/36 pass, 0 new `/tmp` dirs (was leaking every run) |
| `tools/run-browser-e2e.sh` (disposable probe, ×5) | run 1: 477 checks, 474 pass. Run 2 (F-TERM-002 diagnostic): proof of 5 stale prompt snapshots. Run 3 (F-TERM-002 fix): 475/477, that check now PASSES. Run 4/5 (F-SLASH-001 diagnostics): proved steady state, not a race |
| `node --test services/reference-control-plane/test/coden-terminal-client.test.mjs` | 21/21 pass (2 new/updated, F-TERM-002) |
| `node --test` on `workspace.mjs`'s own suite | 3/3 pass, confirmed self-cleaning (`/tmp` count 0→0) |
| `node --test` on all 58 `F-TMP-001`-migrated files together | 706/706 pass |
| `node tools/http-smoke.mjs`, `tools/tls-smoke.mjs` | both PASS, 0 leaked dirs; `tls-smoke`'s 12 pre-existing leaks also removed |
| `node tools/test-installer-hardening.mjs` | 100/100 checks, 0 leaked dirs |
| `node tools/test-cross-platform-installers.mjs` | 87 checks, 0 failures, 0 leaked dirs |
| `node --test services/reference-control-plane/test/*.test.mjs` (final, after everything) | 2554/2555 pass, 1 pre-existing skip |
| `tools/run-eslint.sh` (final, ×2) | 411 files, 0 errors both times |
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
- **`a3-security.mjs`'s live run** — needs a disposable server + mock, out of scope to stand up
  just to verify a leak fix; verified by the identical, already-proven `process.on('exit')`
  pattern used (and live-confirmed) in the other 4 files instead.
- **F-SLASH-001's actual fix** — root cause is confirmed (not a guess: 2 driven runs), but the
  fix itself needs a test-strategy decision between two named designs before any code is
  written. Deliberately not picked unilaterally, same discipline `D-0456` used for `F-PANEL-001`.

## Proposta di miglioramento

**Nuova, da questo giro (`D-0465`, non eseguita)**: none of the 5 `tools/*.mjs` scripts assert
their own cleanup the way `test/support/workspace.mjs`'s own test does (`workspace-support.test.mjs`
proves `freshTempDir()` self-cleans). Beneficio: a tiny shared assertion — run the script,
snapshot `/tmp` before and after, assert flat — added once to `scripts/test.sh` (or a new small
tool) would catch a REGRESSION of this exact defect class automatically, instead of needing a
person to notice `/tmp` filling up again the way this whole session started. Costo: low, one
small script; directly closes the loop this session opened with `F-CRASH-001`.

**Precedente (`D-0463`, non eseguita)**: hoist `typeIntoTerminal`/`terminalFrame`/`screenText`
out of the `coden-terminal` step's block scope — the FIRST thing `F-SLASH-001`'s own fix will
need. See `D-0463` in `docs/DECISION_LOG.md`.

**Precedenti (`D-0461`/`D-0460`, non eseguite)**: see `docs/DECISION_LOG.md`.
