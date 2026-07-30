# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0249`). Stato completo in `PROJECT_STATE.json`, storia in
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

**Domanda all'Owner, non decisa qui — `ARCH-008` resta ⚠ parziale per questa ragione sola:**
`noesar-sandbox` è ora **costruito, misurato E SPEDITO in produzione** (`D-0248`+`D-0249`,
deploy live verificato). L'unica cosa che manca è che **nessuna superficie del prodotto spende
un token attraverso di esso** — perché l'unica che potrebbe (`EXECUTE`) è **rifiutata per
progetto, identicamente sui due lati linguistici**, con la stringa di motivo che fa parte
dell'oracolo di conformità condiviso (`conformance/executor-vectors.json`, caso `EXEC-007`,
`noesar-executor` **e** `executor.mjs` la citano parola per parola).

**Scoperta a metà fase, non ignorata**: la mia stessa proposta approvata («cablarlo a
executor.mjs, sblocca EXECUTE») dava per scontato che fosse un cablaggio. Non lo è — è
**riscrivere un contratto di sicurezza cross-linguaggio**. Ho proceduto con tutto ciò che non
dipendeva da quella scelta (binario nell'immagine, runner Node reale e testato, deploy live) e
**non ho toccato `executor.mjs`**.

**La domanda vera**: `EXECUTE` deve mai essere concedibile attraverso questo sandbox? Se sì:
quale superficie potrà richiederlo (oggi **nessuna** — il pianificatore di `workspace-actions.mjs`
non emette mai un passo `EXECUTE`), e serve un cambio coordinato a `conformance/
executor-vectors.json` **più** entrambe le implementazioni. Se no: `noesar-sandbox` resta
infrastruttura reale, testata, spedita — con un solo scopo onesto, provare che il criterio di
isolamento di `ARCH-008` è soddisfatto — e questo **è già** uno stato finale legittimo, non un
abbozzo.

**Non rifare** il probe di `D-0246` né le misure di `D-0248`/`D-0249`: tutte registrate.

---

## ➜ AZIONE PRECEDENTE (chiusa in `D-0247`, superata da `D-0248`/`D-0249`)

La domanda di `D-0246` su `ARCH-008` era mal posta (chiedeva di cambiare l'host) e l'Owner l'ha
rifiutata; il ladder adattivo che ne è seguito è ora costruito e misurato — vedi `D-0247` e
`D-0248` in `docs/DECISION_LOG.md`, che è il file che possiede la storia.

## ➜ Stato dell'installazione

- **Prodotto**: `noesar-evolution:phase4-sandbox-binary` · `Up (healthy)` ·
  `192.168.178.100:8100→8088` · hardening intatto · `migrations:16 rls_tables:15` (0 rieseguite)
  · byte immagine provati identici all'albero prima del deploy.
  Rollback preservato: `noesar-evolution.rollback-sandbox-binary-20260730T100439Z`
  (`:phase4-arch005-adapter-gate`).
- **`docker exec … noesar-sandbox --detect` sul container VIVO**: `tier:1 SECCOMP_FILTER`,
  `containerCeiling.memoryBytes:8589934592` — il binario è reale nel container di produzione.
- **atomd**: `atom-evolution:atomd`, `noesar-evolution-net`. Serve **Phi-4-14B Q4_K_M**.
- **Due container per progetto** (installazione + 1 rollback) — §5a rispettato.
- **`D-0247` non ha richiesto redeploy** (skill/autorità/digest non importati a runtime);
  **`D-0249` sì** (nuovo binario nell'immagine, `D-0143`) — deployato e verificato dal vivo.

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
