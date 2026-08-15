# SESSION HANDOFF — 2026-08-15 (`D-0458`: la riparazione `F-COMMAND-001` deployata)

## ➜ LA PROSSIMA AZIONE

**Owner ha scelto "Deploy della riparazione F-COMMAND-001" fra le opzioni aperte dal giro
precedente. Fatto: build offline, byte-equal tree↔immagine, `redeploy.sh --apply`, verifica
live, pulizia — tutto in questo giro (`D-0458`).**

Restano aperte le stesse tre decisioni di prima, nessuna presa in questo giro:

- **`F-PANEL-001`, terza occorrenza** — decisione di strategia di test tua: il TEST deve
  raggiungere il pannello plan-restore guidando il menu `/` del terminale live oppure con un
  hash jump diretto, quando il terminale è stabilmente live (non è una corsa, è una collisione
  di design a stato stabile — vedi `D-0456`).
- **`F-TERM-002`** — regressione osservata 5/5 su "Enter svuota il prompt", non indagata,
  fuori scope della fase precedente.
- **`cargo publish`** — serve `CARGO_REGISTRY_TOKEN` in `secrets/crates_io_token`, da
  terminale vero.
- oppure **Fase D**.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-COMMAND-001` | **RIPARATO E DEPLOYATO** — `noesar-evolution:d0457-legacy-shell-hide-20260815T060429Z`, live e sano. |
| `F-PANEL-001` | 2/3 occorrenze pulite e deployate. La terza resta una collisione di design a stato stabile — decisione di strategia di test aperta. |
| `F-TERM-002` | **APERTO, non indagato** — regressione osservata 5/5, fuori scope. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| ATOM↔CodeN Evolution | **NON VERIFICATO** — serve una sessione autenticata (l'Owner ce l'ha già). |
| `D-0433` | **APERTO.** Stessa condizione già accettata. |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` in `secrets/crates_io_token`, da terminale vero. |

## Verificato IN QUESTA SESSIONE

| Strumento | Risultato |
|---|---|
| `docker build -f oci/Dockerfile` | build offline (rete solo per apt/postgres, come tutti i build precedenti), quasi interamente da cache — solo il layer `apps/webui-static/` differiva |
| byte-equal tree↔immagine | `sha256sum apps/webui-static/app.js` identico prima del deploy |
| `tools/deploy/redeploy.sh --check` poi `--apply` | PREFLIGHT PASS, DEPLOYED, 4 figli (`postgres`/`api`/`codev`/`atom`) sani, 0 righe di auth-failure |
| live | `running`/`healthy`, `/livez` 200, `/readyz` 200, `app.js` byte-equal tree↔container dopo il deploy |
| pulizia §5a | rollback precedente (`…pre-20260814T112620Z`) rimosso; non-project container 50, volumi 64, reti invariate — prima/dopo in `EVIDENCE/docker_inventory_{pre,post}_cleanup_20260815T060*.txt` |

## Cosa NON è stato fatto

- **Nessuna verifica che richieda una sessione autenticata** — regola §3a 11e: la verifica
  live non usa una suite che muta dati; provato solo salute + uguaglianza dei byte + risposta
  delle superfici.
- **La terza occorrenza di `F-PANEL-001`** — decisione di strategia di test tua, non presa.
- **`F-TERM-002`** — non indagato, fuori scope.
- **`cargo publish`** e le altre domande di `docs/LICENSE_STRATEGY.md` §5 — invariate.

## Proposta di miglioramento

**Nuova, da questo giro (`D-0459`, non eseguita)**: la prova byte-equal tree↔immagine che
`CLAUDE10.md` §3a impone prima di ogni deploy è rifatta a mano ogni volta (`docker create` +
`docker cp` + `sha256sum`, ad hoc, di nuovo in questo giro) — nessuno strumento la porta nel
repository, a differenza della sequenza di deploy stessa (`tools/deploy/redeploy.sh`, nata
proprio da `D-0390` per la stessa ragione: prosa ripetuta a mano è come si è persa una prova
prima). Beneficio: uno script `tools/deploy/verify-image-tree.sh <tag> <file...>` (o
`--changed-since <commit>`) rende la prova ripetibile e testabile invece che una sequenza di
comandi ricordata a memoria; costo: basso, stesso schema del container disposable già usato
qui. Ancora la proposta viva di `D-0456`/`D-0457` (guardia simmetrica sul ramo `show` di
`codenTerminalState()`), non eseguita.
