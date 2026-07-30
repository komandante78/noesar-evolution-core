# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0247`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3). Era 382 — la storia per-decisione è
> stata rimossa perché già interamente in `docs/DECISION_LOG.md` (verificato: tutti e 21 i
> `D-0xxx` citati erano presenti prima di tagliare).

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

**Unica eccezione documentata (`D-0232`)**: il peso `phi-4-Q4_K_M.gguf` è stato **letto**
(copia read-only) su istruzione diretta dell'Owner che l'ha nominato. Nessuna dipendenza
runtime: `atom-evolution-model` serve il proprio file dentro `ATOM_EVOLUTION/model_store/`.

## ⚠️ QUATTRO REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
   Prima di dichiarare un gap non risolvibile o iniziare a costruire:
   `find docs/ MASTER_PROJECT/ -newer <ultimo documento letto>`.
2. **`ATOM_EVOLUTION` non copia MAI nulla dal vecchio** — né da `NOESAR-ATOM-PRIVATE`, né dal
   progetto ATOM originale. Vedi `D-0212`.
3. **LEGGE DI PIATTAFORMA (2026-07-30, `CLAUDE10.md` §16, `D-0247`)**: *"NON DEVI FARE NULLA
   CHE SIA COLLEGATO AD UNRAID, È UN PROGETTO SELF HOSTED CHE VA SU TUTTI PC SERVER E OS"*.
   L'host di sviluppo è **una delle installazioni possibili, non il bersaglio**. Una modifica
   all'host non è mai un rimedio e non è una scelta da sottoporre all'Owner. Le capacità si
   **rilevano a runtime**, si degrada a una base che funziona ovunque, si dichiara per
   installazione. Un limite trovato qui è un fatto su una **categoria** di host.
4. **DOVERE DI AVANZAMENTO (2026-07-30, `CLAUDE10.md` §17, `D-0247`)**: *"CERCA SEMPRE UNA
   SOLUZIONE PER MIGLIORARE IL PROGETTO … PENSARE AD UN DOMANI … DEVE ESSERE UNA PIATTAFORMA
   AVANZATA"*. Chiudere un criterio è la soglia, non l'obiettivo. **Ogni fase produce almeno
   una proposta di miglioramento** registrata e nominata nella risposta. Il metro è esterno.
   Generare l'idea è obbligatorio; eseguirla nella stessa fase è decisione dell'Owner.

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità. Impone quattro skill sempre attive.
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — **il digest, non i file interi**
   (10,3 KB dopo `D-0247`; era 18,5 KB).
3. `find docs/ MASTER_PROJECT/ -newer docs/SESSION_HANDOFF.md` — regola 1 sopra.
4. Questo file, la sezione «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**`ARCH-008` — la domanda posta in `D-0246` è CHIUSA dall'Owner, e la risposta non era nessuna
delle due opzioni proposte.** Avevo chiesto di scegliere fra (a) autorizzare cambi all'host
(kernel con Landlock, delega cgroup Docker) e (b) una fase dedicata al sandbox a processo
figlio. **L'Owner ha rifiutato la premessa**: l'opzione (a) è **vietata per sempre** —
NOESAR EVOLUTION è self-hosted e gira su qualunque PC/server/OS, quindi non si tocca l'host
(regola permanente 3 sopra, `CLAUDE10.md` §16). Porre quella domanda era **un errore mio**,
non una scelta legittima.

**Quindi `ARCH-008` si costruisce così, e va progettato prima di scrivere codice:** un
**Sandbox Manager adattivo** che spende ogni capability token in un vero processo figlio a
vita breve, e che:

1. **rileva a runtime** quali primitive l'host offre (Landlock, cgroup v2 scrivibili, seccomp);
2. usa **seccomp come base garantita ovunque** — confermato disponibile anche sotto il profilo
   di hardening di produzione (`D-0246`);
3. aggiunge Landlock e i limiti cgroup **solo dove esistono**, opportunisticamente;
4. **dichiara per installazione** quale livello di isolamento è attivo, mai lasciarlo intendere.

Il probe di `D-0246` **resta prezioso e non va rifatto**: ha misurato il comportamento su un
host *senza* quelle primitive (`CONFIG_SECURITY_LANDLOCK` non compilato, cgroup non delegati),
condizione che si presenterà su Windows, macOS, distro minimali e altri NAS. Vedi la memoria
`project_noesar_evolution_host_lacks_landlock_and_cgroup_delegation_s289`.

**Prerequisito architetturale già nominato in `D-0246`**: oggi né `executor.mjs` né il gate
degli adattatori (`D-0244`) agiscono fuori processo — entrambi in-process, un solo event loop
Node a vita lunga. Un filtro seccomp installato per una capacità resterebbe per sempre
sull'intero processo. **Il processo figlio è il lavoro vero**, di portata paragonabile al
supervisore di `ARCH-001`.

## ➜ Stato dell'installazione

- **Prodotto**: `noesar-evolution:phase4-arch005-adapter-gate` · `Up (healthy)` ·
  `192.168.178.100:8100→8088` · hardening `INST-004` intatto · `migrations:16` (0 rieseguite).
  Rollback preservato: `noesar-evolution.rollback-arch005-adapter-gate-20260730T074008Z`
  (`:phase4-codev-peer`).
- **atomd**: `atom-evolution:atomd`, `noesar-evolution-net`. Serve **Phi-4-14B Q4_K_M**.
- **Due container per progetto** (installazione + 1 rollback) — §5a rispettato.
- **`D-0247` non ha richiesto redeploy**: skill, autorità e digest non sono importati da
  `server.mjs` a runtime.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Nessun `exec`** in nessuna delle due shell — solo le operazioni già guardiane.
- **`ARCH-008` non è costruito** — investigato (`D-0246`), progettato qui, zero codice.
- **`ARCH-005` è parziale**: solo `launch()` è gated. `attach()`/`complete()`/`configure()`
  restano scoperti; gli altri 6 adattatori di `03 §4` non esistono.
- **`INST-002`**: nessun token di installazione esiste — nessuna superficie lo richiede.
- **`INST-008` quasi completo**: firma/digest e diff dei permessi sono **due tool CLI
  separati**, non un'unica pipeline.
- **`SESS-001..003` e `CUBE-001..009`**: due sottosistemi interi **mai costruiti**.
- **Nessuna superficie WebUI consuma `/api/v1/research/gate`** (da `D-0222`) né le route
  `/api/v1/adapters/*` (da `D-0244`).
- **`NOESAR_LOCAL_MODEL_RUNTIME=disabled`** sul container vivo: il gate di `D-0244` è reale e
  provato dai test, ma in produzione `launch()` rifiuta prima di raggiungerlo.
- **`ATOM_PROVIDER_MODEL_BACKED` resta `false`** in `lib.rs` (da `D-0226`).
- **La password del client TUI non è mascherata** — serve la modalità raw, assente su pipe.
- **Bug menu "Ramo"** segnalato in `D-0235`: mai riprodotto, resta aperto.
- **`MANIFEST.sha256` non copre `.claude/` né `CLAUDE10.md`**, e **nessun tool lo verifica** —
  scoperto in `D-0247`, registrato come proposta di miglioramento, non riparato.

## ➜ Blocker aperti

`B-002` (low): né `gitleaks` né `trufflehog` sono installabili (regola 45); scan euristico a
pattern, **dichiarato euristico**. Nessun altro.

## ➜ Verificato in `D-0247` (misurato in sessione, non dichiarato)

| Verifica | Risultato |
|---|---|
| unit | **1168/1168**, 71 suite, 0 fail (7,2 s) |
| `tools/verify-source.mjs` | `PASS migrations=16 baseline=12/12 intact` |
| ESLint | **239 file**, 0 errori, 0 warning, 0 `no-undef` |
| `MANIFEST.sha256` | **5845/5845**, 0 falliti — contato riga per riga, non fidandosi dell'exit code |
| digest riparato | **18.516 → 10.279 byte (−44,5 %)**, stderr vuoto, escape hatch provata |
| pattern container portabile | provato dal vivo: `docker run --rm --network none -v repo:ro python:3-slim` → 4/4 PASS |
| scan segreti | euristico sul diff: 7 hit, tutte la *parola* «token»/«detect-secrets» in prosa, 0 reali |

**Un difetto introdotto da me e catturato rieseguendo, non leggendo**: la prima correzione al
digest annidava apici singoli in un programma jq già fra apici singoli — `sh -n` **accettava**
(shell valida, programma sbagliato) e lo script stampava errori su stderr. Riscritto formattando
con `printf` fuori da jq. Conferma della lezione già in memoria: `sh -n`/`bash -n` non provano
che uno script faccia la cosa giusta.

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna.** La domanda di `D-0246` su `ARCH-008` è chiusa (vedi LA PROSSIMA AZIONE): la
premessa era sbagliata, non serviva una scelta.
