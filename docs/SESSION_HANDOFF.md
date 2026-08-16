# SESSION HANDOFF — 2026-08-16 (`D-0470`: native tooling audited and scoped, governance only)

## ➜ LA PROSSIMA AZIONE

**`D-0469`'s deploy from 2026-08-15 is still what is live and healthy.** This session added
one governance rule, no product code: `CLAUDE10.md` §19 (rules 81-85) audits the Claude Code
tools actually available (measured: no `.mcp.json`, no `plugins` key — zero third-party
integrations exist) and authorizes the internal-use ones (subagents, search, `Task*`,
`Monitor`, worktrees) without a further ask, while keeping per-instance confirmation for
anything that publishes outside the repo (`DesignSync`, `Artifact`, `claude-in-chrome`).
Cron/scheduled autonomy declined as incompatible with "one phase per invocation" (rule 9).
See `D-0470`.

The real open items are unchanged from yesterday, still the Owner's call:

- **F-SLASH-001's actual fix** — pick design (A) drive the terminal, or (B) declare-and-skip
  when the terminal has claimed the surface. See `D-0463`.
- **`cargo publish`** — serve `CARGO_REGISTRY_TOKEN` in `secrets/crates_io_token`, da
  terminale vero.
- oppure **Fase D**.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-CRASH-001` | **FIXED** — 8.3 GB / 3,553 leaked `/tmp` dirs removed. `D-0460`. |
| `F-TMP-001` | **FIXED** — shared `freshTempDir()` helper, 58 files, 75,114 leaked dirs removed. `D-0464`. |
| `F-TMP-002` | **FIXED** — 5 plain-script `tools/*.mjs` files sweep via `process.on('exit', ...)`. `D-0465`. |
| `F-MODEL-002` | **FIXED, DEPLOYED, VERIFIED LIVE** — `/model` lists what is loadable. `D-0466`. |
| `F-TERM-003` | **FIXED, DEPLOYED, VERIFIED LIVE** — the browser terminal's call results now truncate (`detailLines`), matching the other two shells. `D-0469`. |
| `F-COMMAND-001` | **DEPLOYATO** — live e sano. |
| `F-PANEL-001` | **FIXED** — direct hash jump, test-harness only. `D-0461`. |
| `F-TERM-002` | **FIXED, DEPLOYED** — `SCREEN.clear` instead of `SCREEN.home`. `D-0462`. |
| `F-SLASH-001` | **ROOT CAUSE CONFIRMED, not fixed** — needs a test-strategy choice. `D-0463`. |
| ATOM licence | **APPLICATO** — aperto, AGPL, repository separato invariato (ancora vuoto). `D-0468`. |
| Product access control | **DECISO** — registrazione, mai licenza a codice. `D-0467`/`D-0468`. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| `D-0433` | **APERTO.** Stessa condizione già accettata. |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` da terminale vero. |

## Verificato IN QUESTA SESSIONE (deploy finale)

| Strumento | Risultato |
|---|---|
| `docker build` + byte-equal, 6 file cambiati | tutti MATCH, tree↔immagine, prima del deploy |
| `tools/deploy/redeploy.sh --check` poi `--apply --authorized-by-owner --image ...` | PREFLIGHT PASS, DEPLOYED, 4 figli sani, 0 righe di auth-failure |
| byte-equal live | tutti e 6 i file MATCH, tree↔container in esecuzione, dopo il deploy |
| `/livez` `/readyz` (host, porta pubblicata) | 200, 200 |
| `node --test` suite completa (finale) | 2560/2561, 1 skip preesistente |
| `tools/run-eslint.sh` (finale) | 411 file, 0 errori |
| `tools/run-browser-e2e.sh` (disposable, ×2 in questo giro) | run 1: trovato F-TERM-003 (476→477 fallimenti attesi diventano 478 totali, 3 fail). Run 2, dopo il fix: 476/478, solo i 2 già tracciati restano |
| pulizia §5a | rollback più vecchio rimosso; esattamente 2 container del progetto sopravvivono |

Cronologia completa dei numeri intermedi (58 file migrati, 75.114 directory rimosse, ecc.):
`docs/DECISION_LOG.md`, non ripetuta qui.

## Cosa NON è stato fatto

- **Nessun tool di rule 83 è stato usato** — `DesignSync`/`Artifact`/`claude-in-chrome` sono
  solo stati portati a un'autorizzazione esplicita "a conferma per uso", non invocati.
- **Nessuna skill dedicata scritta per §19** — dichiarato in `CLAUDE10.md`: nascerà se questo
  toolset diventa pratica ricorrente, come le altre tre skill di economia.
- **Nessuna verifica che richieda una sessione autenticata** — regola §3a 11e (non applicabile
  a questa fase, solo documentazione toccata).
- **F-SLASH-001's actual fix** — decisione di design non ancora presa, deliberatamente.
- **`cargo publish`** e le altre domande di `docs/LICENSE_STRATEGY.md` §5 — invariate.
- **`ATOM_EVOLUTION`'s own `LICENSE` file** — settled (AGPL), not written; repository still
  empty, no product work happened there this session (governance only, in this repository).
- **`a3-security.mjs`'s live run** — verified by pattern only (needs a disposable server+mock).

## Proposta di miglioramento

**Nuova, da questo giro (`D-0470`, non eseguita)**: nulla oggi impedisce un futuro `.mcp.json`
di introdurre un server MCP non verificato in silenzio — `noesar-evolution-verify`'s HUNT AND
FIX non ha una riga che controlli la presenza/assenza di `.mcp.json` o della chiave `plugins`
contro quanto dichiarato in `CLAUDE10.md` §19. Beneficio: una riga di digest (`state-digest.sh`)
che fallisce rumorosamente se compare un'integrazione non ancora nominata in §19, sullo stesso
schema del `hme_check_settings()` che `D-0455` ha già costruito per gli hook. Costo: basso, uno
script POSIX più una riga nel digest.

**Precedente (`D-0469`, non eseguita)**: `coden-terminal.js` had a defect (`F-TERM-003`) that
no test caught because nothing in this suite asserts the terminal's generic `call` path stays
bounded. A unit test asserting `detailLines()` is always the shape used (not just present, but
that no other path bypasses it) would catch the next oversized command result. Costo: basso.

**Precedenti (`D-0468`–`D-0460`, non eseguite)**: see `docs/DECISION_LOG.md`.
