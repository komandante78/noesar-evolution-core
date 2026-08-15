# SESSION HANDOFF — 2026-08-15 (`D-0462`: F-TERM-002 fixed, driven not guessed)

## ➜ LA PROSSIMA AZIONE

**Continuation of the same out-of-sequence session.** Third piece of authorized work in a row:
crash fix (`D-0460`) → F-PANEL-001 (`D-0461`) → Owner picked "F-TERM-002" next. Root cause
found and fixed: `coden-terminal.js`'s `draw()` repainted with `SCREEN.home` (reposition only,
no erase) instead of `SCREEN.clear` — with no alternate screen buffer entered, nothing
guaranteed a new frame landed on the same physical rows as the last. A diagnostic added to the
e2e check proved it on a real run: five stale prompt-box snapshots, one per keystroke, still on
screen after the prompt was already cleared in the data model. Fixed, verified live: the exact
failing check now passes, suite 475/477 (up from 474/477). Detail: `D-0462`.

Two items are still open, untouched by this session:

- **`F-SLASH-001`** — new, unmasked by `D-0461`'s fix, one-run hypothesis only, needs its own
  driven investigation before any fix is attempted.
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
| `F-SLASH-001` | **OPEN, recorded, NOT chased** — new, unmasked by `F-PANEL-001`'s fix. `#codenPrompt` click fails in `coden-slash-feedback`; one-run hypothesis only, needs its own driven investigation. |
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
| `tools/run-browser-e2e.sh` (disposable probe, ×3 this session) | run 1: 477 checks, 474 pass (`F-TERM-002`, `F-I18N-002`, `F-SLASH-001` new). Run 2 (F-TERM-002 diagnostic): same 3 fails, plus proof of 5 stale prompt snapshots. Run 3 (after the fix): 475/477 pass — `F-TERM-002`'s check now PASSES, only `F-SLASH-001`/`F-I18N-002` remain |
| `node --test services/reference-control-plane/test/coden-terminal-client.test.mjs` | 21/21 pass (2 new/updated) |
| §5a cleanup after each e2e probe | probe/runner/image removed every time; only the stable `noesar-e2e-net` network survives |
| `docker build -f oci/Dockerfile` | build offline (rete solo per apt/postgres, come tutti i build precedenti), quasi interamente da cache — solo il layer `apps/webui-static/` differiva |
| byte-equal tree↔immagine | `sha256sum apps/webui-static/app.js` identico prima del deploy |
| `tools/deploy/redeploy.sh --check` poi `--apply` | PREFLIGHT PASS, DEPLOYED, 4 figli (`postgres`/`api`/`codev`/`atom`) sani, 0 righe di auth-failure |
| live | `running`/`healthy`, `/livez` 200, `/readyz` 200, `app.js` byte-equal tree↔container dopo il deploy |
| pulizia §5a | rollback precedente (`…pre-20260814T112620Z`) rimosso; non-project container 50, volumi 64, reti invariate — prima/dopo in `EVIDENCE/docker_inventory_{pre,post}_cleanup_20260815T060*.txt` |

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
- **`F-SLASH-001`** — deliberately not chased: only one disposable e2e run has seen it, and a
  single-run hypothesis is a guess, not a finding, per this project's own precedent (two
  failed guesses on `F-COMMAND-001` before the real cause was found). Needs its own driven
  investigation — repeat runs, ancestor-chain dump on failure — same method D-0456 used.

## Proposta di miglioramento

**Nuova, da questo giro (`D-0462`, non eseguita)**: `SCREEN.home`-only repaint is a general
hazard, not unique to the prompt box — any future frame content in `coden-terminal.js` inherits
the same "only correct if nothing ever wraps a row further than expected" fragility that just
cost a driven investigation to find. Beneficio: a unit test asserting `renderFrame`'s output
never exceeds `width` columns per row for every glyph this file actually uses (box-drawing,
`▍`, `▸`) would catch a row that silently wraps BEFORE it drifts the whole terminal — cheaper
than the diagnostic-and-two-more-runs this defect needed. Costo: low, one test file, no product
change.

**Precedente (`D-0461`, non eseguita)**: `submitCodenAddress` and `jump()` are two parallel ways
this suite reaches a CodeN panel, chosen ad hoc per call site with no documented rule. See
`D-0461` in `docs/DECISION_LOG.md` for the full proposal.

**Precedente (`D-0460`, non eseguita)**: `F-TMP-001` (55 files, same mkdtemp-leak pattern) needs
a shared `withWorkspace()` test helper. See `D-0460` in `docs/DECISION_LOG.md`.
