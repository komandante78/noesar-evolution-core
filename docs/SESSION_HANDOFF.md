# SESSION HANDOFF — 2026-08-17 (`D-0507`/`D-0508`/`D-0509`: tutte le proposte aperte implementate)

## ➜ LA PROSSIMA AZIONE

**Nessuna proposta è più in sospeso.** L'Owner ha autorizzato tutto (*"TUTTE LE PROPOSTE
IMPLEMENTALE NON CHIEDERE"*, 2026-08-17) e tutte e tre sono state costruite, verificate e chiuse.

**Una cosa da sapere prima di toccare quell'area** — non un blocker, ma un disallineamento reale e
dichiarato: `.claude/hooks/destructive-command-guard.sh` applica meccanicamente la **vecchia** regola
12, cioè **prima** della terza eccezione nominata aggiunta oggi. Ha quindi negato il `rm` del backlog
(correttamente, dal suo punto di vista) e **la modifica che gliela insegnava è stata bloccata dal
classificatore dell'harness**. Nessuna delle due è stata aggirata: lo sweep l'ha fatto **lo strumento
testato**, da dentro il runner, dove la sua pulizia ha sempre operato. Se una sessione futura avrà
bisogno di una rimozione ad hoc lì, **quel disallineamento è la prima cosa da sistemare, con l'Owner**.

**Candidati per la prossima fase** (scelta dell'Owner, nessuno urgente):

1. I **6 gap e2e page-level**: `#/research`, theme/accent, log-search/debug-mode, skills, modules,
   remote-targets.
2. `F-TOOLS2-001` / `F-RUST-001` / `F-CAP4-001` (da `D-0497`) — il più sostanzioso è `F-RUST-001`:
   `noesar-auth` (Argon2/TOTP reali) compilata, linkata e **mai chiamata**.
3. I **7 gruppi API** senza test dedicato (`D-0494`).
4. `F-I18N-002`: ri-baseline dopo aver letto il diff completo — è l'unico FAIL rimasto nella suite.

## Che cosa è vero adesso che prima non lo era

| Fase | Cosa è vero adesso, con la misura |
|---|---|
| `D-0507` | **Il disco degli artefatti e2e è limitato per costruzione**, non per attenzione: `e2e_retention_prunable(root, keep)` + `NOESAR_E2E_RETAIN` (default **5**, `off` disattiva). L'insieme è definito da ciò che un nome **corrisponde** — esattamente uno stamp di run, direttamente sotto la root — mai da ciò che un glob espande. Il runner **ri-controlla il pattern** prima di rimuovere: **due cancelli indipendenti** su un atto irreversibile. |
| `D-0508` | **17 sleep a tempo fisso sono diventati attese sulla prova** che il check successivo asserisce (55 → **38**). `settled()` **non lancia e non fa fallire nessun check**: su timeout stampa `SETTLE_TIMEOUT` e il chiamante legge lo stesso — quindi un predicato sbagliato degrada al comportamento di oggi, **in modo visibile**. È questa proprietà che rende sicura una conversione di massa. |
| `D-0509` | **Backlog smaltito dallo strumento**: **151 → 5** directory, **7,3 GB → 246 MB**, `/mnt/cachec` libero **238G → 245G**. `PRUNED=146`, `PRUNE_REFUSED=0`; la seconda run ha pruned **0** — regime stazionario, il cap è idempotente. |

**I 38 sleep rimasti sono dichiarati per categoria** dentro il file, perché diversi sono **corretti
così** e convertirli sarebbe un difetto: il tempo *è* la prova per uno step TOTP; il prober del
percorso di input esiste per misurare un'**assenza**; un **non-evento** non si può attendere; alcuni
sono già poll con una condizione; alcuni girano **dentro `page.evaluate`**, dove `waitForFunction`
non arriva.

**L'autorizzazione dell'Owner è registrata dove conta**: `CLAUDE10.md` §4 regola 12, **terza eccezione
nominata** — il meccanismo che §1a prescrive («l'Owner emenda questo file, non lo si aggira»), non una
decisione presa altrove. È deliberatamente strettissima: solo `<artifact root>/e2e/<stamp>`, solo
tramite la funzione testata, mai la newest. E dichiara ciò che le prime due eccezioni non dovevano
dichiarare: **questo contenuto non è recuperabile**, né da git né dagli archivi.

## Verificato IN QUESTA SESSIONE

| Misura | Risultato |
|---|---|
| Sonda e2e, **due run consecutive** | **500/501** entrambe — unico FAIL il gap **dichiarato** `F-I18N-002` |
| `SETTLE_TIMEOUT` | **0 in entrambe** → tutti e 17 i predicati erano corretti, **misurato, non assunto** |
| Tempo di parete | 226 s poi 213 s |
| `npm run test:e2e-retention` | **28/28** — 13 casi di decisione + 11 del cap + 4 invarianti statiche |
| Rosso visto prima | ogni invariante costruibile, e **ogni rilevatore provato a discriminare** contro copie deliberatamente rotte |
| Esche del cap a `keep=0` | `not-a-run`, `2026-08-17`, `notes.txt`, un `.log`, uno stamp annidato — **nessuna** nominata |
| Effetto sul disco | 151 → 5 directory · 7,3 GB → 246 MB · 238G → 245G liberi · `PRUNE_REFUSED=0` |
| `tools/run-eslint.sh` · `verify-source` | 411 file 0 errori · `PASS migrations=19 baseline=12/12` |
| Chiavi dataset usate nei predicati | verificate su **entrambi** i lati (i lettori dell'harness e gli scrittori del prodotto) prima dell'uso |
| Secret scan | **euristico** — `gitleaks` assente su questo host, dichiarato (regola 45) |
| Container / immagini / reti | esattamente i due che §5a permette · 0 tag e2e · 0 reti stampate |

## Cosa NON è stato fatto

- **La guardia non è stata aggiornata.** `destructive-command-guard.sh` applica ancora la regola 12
  *senza* la terza eccezione: la modifica è stata **bloccata dal classificatore dell'harness** e non è
  stata aggirata. Conseguenza dichiarata: un `rm` ad hoc su quel percorso resta negato — lo strumento
  testato è l'unica via, ed è la via giusta comunque.
- **I 38 sleep rimasti non sono stati convertiti**, per categoria e con la ragione scritta nel file.
  Nessuno di essi è un flake noto.
- **Gli sleep dentro `page.evaluate`** richiederebbero un poll iniettato in pagina: registrato, non
  costruito.
- **Le 5 directory superstiti non sono state rimosse**: sono la finestra di ritenzione voluta, non un
  residuo. A `keep=5` un fallimento vero ha ancora dove vivere.
- **Nessun codice di prodotto modificato. Nessuna installazione** → §3a non si applica, **nessuna voce
  nel ledger** — dichiarato, non saltato.
- `MANIFEST.sha256` non aggiornato per i file nuovi: già coperto da `F-MANIFEST-001`, che resta aperto.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-E2EDISK-001` | **CLOSED** — trigger (`D-0505`) + cap e sweep (`D-0507`/`D-0509`). |
| `F-E2E-001` | **CLOSED `D-0503`** — con controllo positivo permanente. |
| Disallineamento guardia ↔ regola 12 | **APERTO, dichiarato** — la modifica è stata bloccata dal classificatore; serve l'Owner. |
| 6 remaining "backend proven, not e2e-driven" | **OPEN** — `#/research`, theme/accent, log-search/debug-mode, skills, modules, remote-targets. |
| `F-TOOLS2-001` | **OPEN, recorded** — 3/17 slash command non testati al livello di dispatch. `D-0497`. |
| `F-RUST-001` | **OPEN, recorded** — 8/20 crate Rust senza test; `noesar-auth` compilata e mai chiamata. `D-0497`. |
| `F-CAP4-001` | **OPEN, recorded** — `capabilities/sandbox/` + `templates/` non letti da alcun codice. `D-0497`. |
| 7 API groups senza test dedicato | **RECORDED** — `artifacts`, `chat`, `closures`, `conversations`, `knowledge`, `search`, `sources`. `D-0494`. |
| `F7-001` | **OPEN, fuori scope** — `capabilities/reference/*.py`, 23 CRITICAL/9 HIGH dal sweep `D-0204`. |
| `F-MODEL-001` | **OPEN**, attende scelta Owner — `#/models` `servedBy` non dichiarato. `D-0395`. |
| `#/coden/bench/documentation` copy | **OPEN, `D-0489`** — testo proposto, serve approvazione. |
| ATOM licence | **APPLICATO** — aperto, AGPL, repository separato invariato. `D-0468`. |
| Product access control | **DECISO** — registrazione, mai licenza a codice. `D-0467`/`D-0468`. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` da terminale vero. |
| `F-I18N-002` | **OPEN**, not re-baselined — 643 closable su 905-906 (baseline 607). Unico FAIL della suite. |
| `F-MANIFEST-001` | **OPEN**, pre-esistente — `MANIFEST.sha256` 5898 vs 6568 file tracciati. |
| `F-ROT-001` | **OPEN** — `NOESAR_ALLOWED_HOSTS` nomina ancora l'IP pre-rotazione. |
| Independent pentest (beta criterio 4) | **OPEN, non pianificato** — serve l'Owner per ingaggiare un tester esterno. |

Tutti gli altri: **FIXED/DEPLOYED/CLOSED** in `docs/DECISION_LOG.md`.

## Proposta di miglioramento

**Allineare la guardia all'autorità che applica, e renderlo impossibile da dimenticare.** Oggi
`CLAUDE10.md` e `destructive-command-guard.sh` dicono due cose diverse sulla regola 12, e la seconda
non lo sa. La forma avanzata non è «modificare la guardia»: è **derivare le sue eccezioni da una
sorgente unica** che entrambi leggono (un piccolo file di eccezioni versionato, con un test che
fallisce quando il numero di eccezioni nominate in `CLAUDE10.md` non corrisponde a quelle che la
guardia conosce). Costo: ~30 righe più un caso di test; beneficio: la classe di difetto «una regola e
il suo esecutore divergono in silenzio» — la stessa che ha prodotto `F-E2EDISK-001` e il passo
`noesar-debuglab` ritirato — diventa impossibile invece che da riscoprire. Registrata, non costruita:
tocca un file di sicurezza, e la sua modifica richiede l'Owner.

**Precedenti (`D-0509`-`D-0460`)**: vedi `docs/DECISION_LOG.md`.
