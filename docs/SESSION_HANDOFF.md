# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0248`). Stato completo in `PROJECT_STATE.json`, storia in
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

**`ARCH-008` è ⚠ parziale (`D-0248`): il meccanismo è costruito e MISURATO, ma nessuna
superficie del prodotto lo usa ancora.** Il prossimo passo è una **fase dedicata al Sandbox
Manager**: includere `noesar-sandbox` nell'immagine OCI, spendere ogni token `EXECUTE`
attraverso di esso, e a quel punto la superficie `EXECUTE` può esistere — la ragione dichiarata
del rifiuto in `executor.mjs` («non c'è una sandbox che possa contenere un processo») **non è
più vera**. Portata paragonabile al supervisore di `ARCH-001`.

**Non rifare** il probe di `D-0246` né la misura di `D-0248`: entrambe sono registrate.

Cosa esiste già, misurato dal vivo sotto il profilo di hardening di produzione:
figlio tenuto a **64 MiB dentro un container da 8 GiB** (`ulimit -v` letto *da dentro* il
figlio = 65536 KiB, il container è unlimited), 512 MiB rifiutati e 16 MiB riusciti, limite
**hard** abbassato quindi il figlio non può rialzarlo, `cpuSeconds=1` uccide un ciclo infinito,
`ptrace` → **EPERM** da 18 syscall filtrate, ampliamento oltre il ceiling rifiutato **nominando
la dimensione**. Livello su questo host: **tier 1 `SECCOMP_FILTER`** — Landlock e cgroup
confermati assenti e **gestiti**, non subiti. I limiti viaggiano **dentro il token, sotto il suo
MAC**, con lo stesso `canonical_limits` nei due minter.

---

## ➜ AZIONE PRECEDENTE (chiusa in `D-0247`, superata da `D-0248`)

La domanda di `D-0246` su `ARCH-008` era mal posta (chiedeva di cambiare l'host) e l'Owner l'ha
rifiutata; il ladder adattivo che ne è seguito è ora costruito e misurato — vedi `D-0247` e
`D-0248` in `docs/DECISION_LOG.md`, che è il file che possiede la storia.

## ➜ Stato dell'installazione

- **Prodotto**: `noesar-evolution:phase4-arch005-adapter-gate` · `Up (healthy)` ·
  `192.168.178.100:8100→8088` · hardening `INST-004` intatto · `migrations:16` (0 rieseguite).
  Rollback preservato: `noesar-evolution.rollback-arch005-adapter-gate-20260730T074008Z`
  (`:phase4-codev-peer`).
- **atomd**: `atom-evolution:atomd`, `noesar-evolution-net`. Serve **Phi-4-14B Q4_K_M**.
- **Due container per progetto** (installazione + 1 rollback) — §5a rispettato.
- **Né `D-0247` né `D-0248` hanno richiesto redeploy**: skill, autorità, digest e il nuovo
  binario del sandbox non sono importati da
  `server.mjs` a runtime.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Nessun `exec`** in nessuna delle due shell — solo le operazioni già guardiane.
- **`ARCH-008` è ⚠ parziale**: il meccanismo è costruito e misurato (`D-0248`) ma **nessuna
  superficie del prodotto spende un token attraverso il sandbox**; `noesar-sandbox` non è
  nemmeno nell'immagine OCI, e `executor.mjs` rifiuta `EXECUTE` per progetto.
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

## ➜ Verificato in `D-0248` (misurato in sessione, non dichiarato)

| Verifica | Risultato |
|---|---|
| unit Node | **1193/1193**, 0 fail (+25: `isolation.test.mjs`) |
| Rust workspace | **47 binari, 133 passati, 0 falliti** (+26; `conformance/` montata a `/conformance`) |
| ESLint | **241 file**, 0 errori, 0 warning, 0 `no-undef` |
| `tools/verify-source.mjs` | `PASS migrations=16 baseline=12/12 intact` |
| `MANIFEST.sha256` | **5853/5853** — contato riga per riga, non fidandosi dell exit code |
| isolamento, dal vivo | figlio a **64 MiB in un container da 8 GiB**; 512 MiB rifiutati, 16 MiB riusciti; hard limit non rialzabile; `cpuSeconds=1` → exit 137; `ptrace` → EPERM; ceiling sfondato → rifiutato nominando la dimensione |
| manomissione del token | alzare `limits.memoryBytes` → `does not verify`; rimuovere `limits` → idem; token pulito → spende |
| scan segreti | euristico sul diff: 0 reperti |

**Due difetti trovati ESEGUENDO.** *Mio, riparato*: una sola relazione usata per due domande —
`within` (scopo concesso, non impostato = illimitato) applicata anche al ceiling del container
(dove non impostato = **ereditato**) rifiutava ogni spec normale; separate in `within`/`exceeds`.
*Preesistente, riparato*: `noesar-supervisor`, **PID 1 dal `D-0240`**, non era in
`MANIFEST.sha256` mentre ogni altro crate di prima parte c era — il componente più privilegiato
era l unico fuori dal controllo di integrità.

**Regola rivista, non aggirata**: «un token `EXECUTE` deve portare i propri limiti» ha rotto 11
test su due design corretti (gate adattatori `D-0244`, contratto dell esecutore). Ora si attiva
solo dove i limiti si applicano davvero: pretenderli prima registrerebbe una cifra che nessun
kernel vede.


## ➜ Le domande all'Owner ancora senza risposta

**Nessuna.** La domanda di `D-0246` su `ARCH-008` è chiusa (vedi LA PROSSIMA AZIONE): la
premessa era sbagliata, non serviva una scelta.
