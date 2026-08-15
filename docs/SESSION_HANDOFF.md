# SESSION HANDOFF — 2026-08-15 (`D-0461`: F-PANEL-001 resolved, direct hash jump)

## ➜ LA PROSSIMA AZIONE

**Continuation of the same out-of-sequence session.** After fixing the reported crash
(`D-0460`), Owner picked "F-PANEL-001 strategia test" as the work to proceed with. Resolved:
`tools/browser-e2e.mjs`'s `jump()` helper (already proven for bench panels) generalized with a
panel-kind param and reused at the plan-restore site instead of composer-driving — see
`D-0461`, finding `F-PANEL-001` now FIXED. Verified live via disposable e2e probe: 477 checks
(391 before — this fix unmasked ~86 more), `Restore reverts a promoted run` PASS. That same
unmasking surfaced a NEW, different occurrence of the same defect class, recorded (not
chased, single-run hypothesis only) as `F-SLASH-001`.

Two other standing decisions from `D-0458`/`D-0459` are still open, untouched by this session:

- **`F-TERM-002`** — regressione osservata 5/5 su "Enter svuota il prompt", non indagata,
  fuori scope della fase precedente.
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
| `F-TERM-002` | **APERTO, non indagato** — regressione osservata 5/5, fuori scope. |
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
| `tools/run-browser-e2e.sh` (disposable probe) | 477/477 checks run, 474 pass, 3 fail (`F-TERM-002`, `F-I18N-002` — both already tracked; `F-SLASH-001` — new). `Restore reverts a promoted run`: PASS |
| §5a cleanup after the e2e probe | probe/runner/image removed; only the stable `noesar-e2e-net` network survives, as intended |
| `docker build -f oci/Dockerfile` | build offline (rete solo per apt/postgres, come tutti i build precedenti), quasi interamente da cache — solo il layer `apps/webui-static/` differiva |
| byte-equal tree↔immagine | `sha256sum apps/webui-static/app.js` identico prima del deploy |
| `tools/deploy/redeploy.sh --check` poi `--apply` | PREFLIGHT PASS, DEPLOYED, 4 figli (`postgres`/`api`/`codev`/`atom`) sani, 0 righe di auth-failure |
| live | `running`/`healthy`, `/livez` 200, `/readyz` 200, `app.js` byte-equal tree↔container dopo il deploy |
| pulizia §5a | rollback precedente (`…pre-20260814T112620Z`) rimosso; non-project container 50, volumi 64, reti invariate — prima/dopo in `EVIDENCE/docker_inventory_{pre,post}_cleanup_20260815T060*.txt` |

## Cosa NON è stato fatto

- **Nessuna verifica che richieda una sessione autenticata** — regola §3a 11e: la verifica
  live non usa una suite che muta dati; provato solo salute + uguaglianza dei byte + risposta
  delle superfici.
- **`F-TERM-002`** — non indagato, fuori scope.
- **`cargo publish`** e le altre domande di `docs/LICENSE_STRATEGY.md` §5 — invariate.
- **`F-TMP-001`** — the same leak pattern in ~55 other files was found, not fixed: real fix
  needs a shared test helper (a single `withWorkspace()`/registered-temp-dir utility) so the
  cleanup lives in one place instead of being re-added file by file.
- **`F-SLASH-001`** — deliberately not chased: only one disposable e2e run has seen it, and a
  single-run hypothesis is a guess, not a finding, per this project's own precedent (two
  failed guesses on `F-COMMAND-001` before the real cause was found). Needs its own driven
  investigation — repeat runs, ancestor-chain dump on failure — same method D-0456 used.

## Proposta di miglioramento

**Nuova, da questo giro (`D-0461`, non eseguita)**: `submitCodenAddress` and `jump()` are two
parallel ways this suite reaches a CodeN panel, chosen ad hoc per call site with no documented
rule for which one a new check should use. Beneficio: a short comment block (or a `README` in
`tools/`) stating the actual rule found here — "does this check test the composer/terminal
gesture itself? Drive it. Does it only need to REACH a panel? `jump()`, always." — would have
made this session's investigation faster and prevents the next new check from picking the
wrong one by habit. Costo: near zero, documentation only; directly reduces the odds of a 5th
`F-PANEL-001`-class occurrence.

**Precedente (`D-0460`, non eseguita)**: `F-TMP-001` is the same defect repeated
55 times because this test tree has no shared temp-workspace helper — every file reinvents
`mkdtempSync(join(tmpdir(), 'noesar-<x>-'))` and either remembers cleanup or (usually)
doesn't. Beneficio: one `test/support/workspace.mjs` exporting `withWorkspace(fn)` (creates,
runs, `finally` removes, works for both sync and promise-returning bodies) removes the whole
defect class at the root instead of the instance — the same "fix the rule, not just the
instance" duty `CLAUDE10.md` §40c already names. Costo: low, ~55 files to migrate, mechanical
once the helper exists; NLnet-relevant only indirectly (test-suite reliability, not a shipped
capability), so it stays a proposal, not an execution, per `noesar-evolution-budget` §5.

**Precedente (`D-0459`, non eseguita)**: la prova byte-equal tree↔immagine che
`CLAUDE10.md` §3a impone prima di ogni deploy è rifatta a mano ogni volta (`docker create` +
`docker cp` + `sha256sum`, ad hoc, di nuovo in questo giro) — nessuno strumento la porta nel
repository, a differenza della sequenza di deploy stessa (`tools/deploy/redeploy.sh`, nata
proprio da `D-0390` per la stessa ragione: prosa ripetuta a mano è come si è persa una prova
prima). Beneficio: uno script `tools/deploy/verify-image-tree.sh <tag> <file...>` (o
`--changed-since <commit>`) rende la prova ripetibile e testabile invece che una sequenza di
comandi ricordata a memoria; costo: basso, stesso schema del container disposable già usato
qui. Ancora la proposta viva di `D-0456`/`D-0457` (guardia simmetrica sul ramo `show` di
`codenTerminalState()`), non eseguita.
