# SESSION HANDOFF — 2026-08-17 (`D-0505`: `F-E2EDISK-001` CLOSED, harness only)

## ➜ LA PROSSIMA AZIONE

**Serve una decisione dell'Owner, e una sola.** I 151 workspace già accumulati (**7,3 GB**) **non
sono stati cancellati**: stanno in `/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/e2e`, **fuori da
`PROJECT_ROOT`**, che la regola 12 rende sola lettura per questo progetto. Estendere la
cancellazione da «la directory di questa run» (che lo script ha sempre fatto) a «le directory
lasciate dalle run precedenti» è **autorità nuova**: la si chiede, non la si aggira.

Il comando, se l'Owner autorizza — da eseguire da terminale, non da questa sessione:

```sh
ls -d /mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/e2e/*/ | wc -l   # 151, conferma prima
rm -rf /mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/e2e/*/          # irreversibile
```

**La crescita è già ferma**: misurata, non dedotta. La run di sonda di questa fase ha creato la sua
directory e l'ha cancellata da sola — 151 prima, **151 dopo**, dove ogni run precedente lasciava 152.

**Altre scelte aperte:**

1. **`D-0506`** — oltre allo smaltimento sopra, il cap opzionale `NOESAR_E2E_RETAIN=N`, perché
   nemmeno le run *davvero* fallite si accumulino all'infinito.
2. **`D-0504`** — le **55** attese a tempo fisso del driver e2e, la classe di `F-E2E-001`.
3. I **6 gap e2e page-level**: `#/research`, theme/accent, log-search/debug-mode, skills, modules,
   remote-targets.
4. `F-TOOLS2-001` / `F-RUST-001` / `F-CAP4-001` (da `D-0497`).

Nessuna modifica di codice e nessun deployment senza autorizzazione esplicita dell'Owner.

## Che cosa è vero adesso che prima non lo era

Il difetto stava **nel trigger, non nella pulizia** — esattamente dove il finding diceva. La suite
esce non-zero se **un qualsiasi** check fallisce, e `F-I18N-002` è un gap **dichiarato e
permanentemente rosso**: quindi il ramo «preserva» scattava ad ogni run e il ramo «cancella» non
scattava mai. Una regola la cui condizione non si verifica mai non è una regola.

Un booleano rispondeva a **due domande diverse**: «la suite deve andare in rosso?» e «c'è qualcosa,
qui, che valga la pena diagnosticare?». Adesso sono separate:

| Pezzo | Cosa fa |
|---|---|
| `tools/browser-e2e.mjs` | marca un check come **declared gap** quando un finding già lo possiede (`F-I18N-002`, dichiarato **sul suo call site**, non pescato da una lista in un altro file che invecchia in silenzio) e stampa `BROWSER_E2E_FAIL_DECLARED` / `_UNDECLARED` |
| `tools/e2e-retention-policy.sh` *(nuovo)* | funzione pura, sourceable, senza effetti: da `(exit code, log del driver)` a `delete` o `preserve` |
| `tools/run-browser-e2e.sh` | **chiede** alla policy invece di guardare `rc`; fa `tee` dell'output, così una run preservata tiene anche la sua trascrizione — cosa che prima non faceva |
| `tools/test-e2e-retention.sh` *(nuovo)* | 17 casi, **senza Docker**: la decisione è una funzione, e una funzione si prova in millisecondi invece che in 7 minuti di sonda |

**L'exit code NON è cambiato, deliberatamente**: un check rosso lascia la suite non-zero. Nessun
contratto di chiamante si muove e **nessun falso PASS** viene creato. Questo esenta il **disco**, mai
il verdetto.

**Ogni ambiguità preserva.** Driver sconosciuto (l'audit di accessibilità condivide questo runner e
non stampa quei contatori), log assente, contatore duplicato o non numerico, abort prima del
sommario: tutti **preserve**. Cancellare richiede una prova positiva. Un workspace preservato costa
disco; uno cancellato costa l'unica copia forense di un fallimento vero.

## Verificato IN QUESTA SESSIONE

| Misura | Risultato |
|---|---|
| `npm run test:e2e-retention` | **17/17**, e **visto ROSSO prima** — 3 invarianti statiche rosse contro l'albero non ancora modificato |
| Oracolo dei rilevatori | tutti e 3 provati a **discriminare** contro copie deliberatamente rotte (`NOESAR_E2E_RETENTION_RUNNER`/`_DRIVER`) |
| Sonda live | `RETENTION=delete only-declared-gaps-failed` · `FAIL_DECLARED=1 FAIL_UNDECLARED=0` · **500/501** |
| Effetto misurato sul disco | la directory della run (`20260817T112435Z`) **rimossa**; totale **151 → 151** (prima: +1 ogni run) |
| Le 151 preesistenti | **intatte** — la policy tocca solo la directory della run in corso |
| `tools/run-eslint.sh` · `verify-source` | 411 file 0 errori · `PASS migrations=19 baseline=12/12` |
| ShellCheck (container usa e getta, offline, sola lettura) | 3 hit, **tutte triageate come falsi positivi**: `SC1007` sull'idioma corretto `CDPATH= cd` (già nominato come falso positivo dalla skill, e copiato da `redeploy-fixture.sh`), 2 × `SC2016` su virgolette singole **volute** attorno al testo letterale cercato, `SC2329` su `cleanup()` che è invocata da `trap` |
| Secret scan | **euristico** — `gitleaks` assente su questo host, dichiarato (regola 45) |
| Container dopo la run | esattamente i due che §5a permette; **0** tag immagine e2e; **0** reti stampate |

**Un difetto trovato e riparato dentro la fase**, guidandolo e non leggendolo: la prima versione
dell'invariante statica cercava `if [ "${rc}" -ne 0 ]` in **tutto** il file ed è andata **rossa sul
codice corretto** — `rc` è ancora letto, legittimamente, in cima a `cleanup()` per stampare i log
della sonda su fallimento, che con la retention non c'entra. Un rilevatore che non distingue i due
avrebbe forzato uno script peggiore per far passare un test: un falso positivo «riparato» è una
regressione vera introdotta per niente (§40b). L'asserzione ora è ristretta al **ramo** di retention.

## Cosa NON è stato fatto

- **Le 151 directory preesistenti (7,3 GB) non sono state rimosse** — vedi LA PROSSIMA AZIONE.
  Trovate, misurate, dichiarate, **non toccate**.
- **Il cap opzionale `NOESAR_E2E_RETAIN=N` non è stato costruito** (`D-0506`): anche le run davvero
  fallite si accumulerebbero, e oggi nulla le limita.
- **L'audit di accessibilità non è stato eseguito.** Condivide questo runner; il suo comportamento è
  **invariato per costruzione** (senza il marcatore la policy restituisce esattamente la vecchia
  regola: `rc==0` cancella, altrimenti preserva) ed è coperto da due casi del fixture — ma questo è
  `INFERRED` più fixture, **non** una run misurata di quel driver. Dichiarato, non spacciato per PASS.
- **Nessun codice di prodotto modificato. Nessuna installazione**, quindi §3a non si applica e
  **nessuna voce nel ledger** — dichiarato, non saltato.
- `MANIFEST.sha256` non aggiornato per i 2 file nuovi: già coperto da `F-MANIFEST-001` (5898 voci
  contro 6568 file tracciati), che resta aperto e non è stato affrontato qui.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-E2EDISK-001` | **CLOSED `D-0505`** — trigger riparato, crescita ferma. Backlog **aperto**, `D-0506`. |
| `F-E2E-001` | **CLOSED `D-0503`** — con controllo positivo permanente. |
| `D-0506` | **PROPOSTA** — smaltimento del backlog (serve l'Owner) + cap opzionale. |
| `D-0504` | **PROPOSTA** — 55 attese a tempo fisso nel driver e2e. |
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
| `F-I18N-002` | **OPEN**, not re-baselined — 643 closable su 905-906 (baseline 607). Ora è il **declared gap** dichiarato al suo call site. |
| `F-MANIFEST-001` | **OPEN**, pre-esistente — `MANIFEST.sha256` 5898 vs 6568 file tracciati. |
| `F-ROT-001` | **OPEN** — `NOESAR_ALLOWED_HOSTS` nomina ancora l'IP pre-rotazione. |
| Independent pentest (beta criterio 4) | **OPEN, non pianificato** — scope pronto, serve l'Owner per ingaggiare un tester esterno. |

Tutti gli altri: **FIXED/DEPLOYED/CLOSED** in `docs/DECISION_LOG.md`.

## Proposta di miglioramento

**`D-0506`**, ed è la metà mancante di questa fase: `NOESAR_E2E_RETAIN=N` — anche una run *davvero*
fallita oggi resta per sempre, e nulla la limita. Costo: ~15 righe nella policy e 2 casi nel fixture;
beneficio: il disco diventa **limitato per costruzione** invece che per abitudine di chi guarda.
Non costruito qui perché comporta cancellare directory di **run precedenti**, cioè autorità nuova
oltre «la propria», e quella la concede l'Owner emendando `CLAUDE10.md`, non una sessione.

**Precedenti (`D-0505`-`D-0460`)**: vedi `docs/DECISION_LOG.md`.
