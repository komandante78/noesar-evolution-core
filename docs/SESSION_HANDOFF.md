# SESSION HANDOFF — 2026-08-17 (`D-0503`: `F-E2E-001` CLOSED, harness only)

## ➜ LA PROSSIMA AZIONE

**`F-E2E-001` è chiuso.** Era l'ultimo finding che il handoff precedente raccomandava, e la
riparazione non ha toccato il prodotto: la causa non era nel prodotto.

**Prossima — scelta dell'Owner:**

1. **`F-E2EDISK-001`** — consigliato. È l'item aperto più economico, ed è cresciuto proprio in
   questa fase: 149 → **151** directory, 7,2 → **7,3 GB**. Due riparazioni candidate sono già
   nominate nel finding; nessuna costruita.
2. **`D-0504`** — le **55** attese a tempo fisso del driver, la stessa classe a cui apparteneva
   `F-E2E-001`. Registrata, non costruita.
3. Uno dei **6 gap e2e page-level** rimasti: `#/research`, theme/accent, log-search/debug-mode,
   skills, modules, remote-targets.
4. `F-TOOLS2-001` / `F-RUST-001` / `F-CAP4-001` (da `D-0497`).

Nessuna modifica di codice e nessun deployment senza autorizzazione esplicita dell'Owner.

## Che cosa è vero adesso che prima non lo era

`tools/browser-e2e.mjs`, check `s327/4b`, non legge più la lista dei run senza chat subito dopo il
badge «pending approval»: **aspetta la lista stessa** (`#unattachedRunCount === '1'` più il testo
dell'obiettivo del run).

**La causa, letta sui due file, non inseguita come flake.** `submitPlanForm()` scrive i due fatti in
**due await diversi**: `renderWorkspaceRun()` mette il badge (`app.js:3044`), e la lista viene
aggiornata quattro righe più sotto, dopo un secondo giro di rete (`app.js:3058`). Aspettare il badge
era aspettare un segnale scritto **prima** della prova: verde quando quella fetch era veloce, rosso
quando non lo era. Due osservazioni a quattro giorni di distanza, stesso sintomo.

**Il controllo positivo è permanente**, nella forma stabilita da `D-0499`: la prossima risposta a
`?scope=unattached` viene ritardata **una volta di 2,5 s**, quindi la finestra stale è garantita e il
check afferma che la **vecchia** lettura ci cade dentro. Un'attesa che nessuno può vedere fallire è
indistinguibile dal non avere attesa: adesso, se un domani la lista si aggiornasse prima del badge,
questo controllo fallisce e lo dice.

**Il prodotto non è stato toccato, e non doveva esserlo**: la lista la aggiorna davvero.

## Verificato IN QUESTA SESSIONE

| Misura | Risultato |
|---|---|
| Sonda e2e, **due run consecutive** del codice finale | **500/501** entrambe |
| Unico FAIL | `F-I18N-002`, gap **dichiarato** (643 closable su 905-906, baseline 607) — non una regressione |
| Controllo `F-E2E-001` | **PASS** in entrambe: `fired:true`, `count:""`, empty state all-attached al vecchio punto di lettura |
| `s327/4b` | **PASS** in entrambe: `unattachedWaited:true`, `count:"1"`, il run reale elencato |
| `tools/run-eslint.sh` | 411 file, 0 errori, 0 warning |
| `node tools/verify-source.mjs` | `SOURCE_VERIFY=PASS migrations=19 baseline=12/12 intact` |
| Base della sonda | `noesar-evolution:d0493-…` con **conteggio migrazioni verificato 19 = albero** (la trappola dello schema vecchio che lo script documenta) |
| Secret scan | **euristico** — `gitleaks` assente su questo host, dichiarato (regola 45) |
| Container dopo entrambe le run | esattamente i due che §5a permette; **0** tag immagine e2e; solo le reti stabili |

Confronto onesto: prima 498/500 con **due** FAIL (`F-I18N-002` + `F-E2E-001`); adesso 500/501 con
**uno** — il check in più è il controllo positivo.

## Cosa NON è stato fatto

- **`F-E2EDISK-001` non è riparato**, e questa fase lo ha **peggiorato di due directory**: entrambe
  le run escono non-zero per il gap I18N dichiarato, quindi il ramo «preserva su fallimento» scatta
  sempre. 151 directory, 7,3 GB, in `/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/e2e` — **fuori da
  `PROJECT_ROOT`**, quindi in sola lettura per questo progetto e deliberatamente non cancellate.
  Misurato, non presunto: `/mnt/cachec` 50% usato, 238G liberi. Tendenza, non emergenza.
- **`D-0504` è registrato, non costruito** — 55 attese a tempo fisso contro 73 attese reali nel
  driver. Il sito gemello `tools/browser-e2e.mjs:2753` (`await 800 ms` poi legge la colonna Work) è
  della stessa famiglia: **nessuna run lo ha mai visto fallire**, quindi è prevenzione, non una
  riparazione dovuta in questa fase.
- **Nessuna installazione.** La modifica è solo dell'harness, quindi `CLAUDE10.md` §3a non si applica
  e **nessuna voce è stata scritta in `docs/INSTALLATION_LEDGER.md`** — dichiarato, non saltato.
- **Nessun codice di prodotto modificato.**
- **`F-I18N-002` non è stato ri-baselinato** (la sua regola vuole che il diff completo sia letto
  prima), e nessuno degli altri finding aperti in tabella è stato toccato.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-E2E-001` | **CLOSED `D-0503`** — con controllo positivo permanente. |
| `F-E2EDISK-001` | **OPEN** — 151 workspace, 7,3 GB. Il più economico da chiudere. |
| `D-0504` | **PROPOSTA, non costruita** — 55 attese a tempo fisso nel driver e2e. |
| 6 remaining "backend proven, not e2e-driven" | **OPEN** — `#/research`, theme/accent, log-search/debug-mode, skills, modules, remote-targets. |
| `F-TOOLS2-001` | **OPEN, recorded** — 3/17 slash command non testati al livello di dispatch. `D-0497`. |
| `F-RUST-001` | **OPEN, recorded** — 8/20 crate Rust senza test; `noesar-auth` (Argon2/TOTP reali) compilata e mai chiamata. `D-0497`. |
| `F-CAP4-001` | **OPEN, recorded** — `capabilities/sandbox/` + `templates/` non letti da alcun codice. `D-0497`. |
| 7 API groups senza test dedicato | **RECORDED** — `artifacts`, `chat`, `closures`, `conversations`, `knowledge`, `search`, `sources`. `D-0494`. |
| `F7-001` | **OPEN, fuori scope** — `capabilities/reference/*.py`, 23 CRITICAL/9 HIGH dal sweep `D-0204`. |
| `F-MODEL-001` | **OPEN**, attende scelta Owner — `#/models` `servedBy` non dichiarato. `D-0395`. |
| `#/coden/bench/documentation` copy | **OPEN, `D-0489`** — testo proposto, serve approvazione. |
| ATOM licence | **APPLICATO** — aperto, AGPL, repository separato invariato. `D-0468`. |
| Product access control | **DECISO** — registrazione, mai licenza a codice. `D-0467`/`D-0468`. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` da terminale vero. |
| `F-I18N-002` | **OPEN**, not re-baselined — 643 closable su 905-906 (baseline 607). |
| `F-MANIFEST-001` | **OPEN**, pre-esistente — `MANIFEST.sha256` 5898 vs 6568 file tracciati. |
| `F-ROT-001` | **OPEN** — `NOESAR_ALLOWED_HOSTS` nomina ancora l'IP pre-rotazione. |
| Independent pentest (beta criterio 4) | **OPEN, non pianificato** — scope pronto, serve l'Owner per ingaggiare un tester esterno. |

Tutti gli altri: **FIXED/DEPLOYED/CLOSED** in `docs/DECISION_LOG.md`.

## Proposta di miglioramento

**`D-0504`**: le **55** attese a tempo fisso di `tools/browser-e2e.mjs` (contro 73 attese reali)
appartengono alla stessa classe che ha tenuto `F-E2E-001` verde per quattro giorni fra le sue due
osservazioni — un'attesa passa perché è passato il tempo, mai perché il prodotto ha risposto. Costo:
una manciata di righe per sito, ma **due run di sonda (~7 min ciascuna) per provarne ognuno**;
beneficio: la classe sparisce invece di essere riscoperta un flake alla volta, e la suite si accorcia
dove l'attesa è oggi imbottita. Registrata, non costruita.

**Precedenti (`D-0503`-`D-0460`)**: vedi `docs/DECISION_LOG.md`.
