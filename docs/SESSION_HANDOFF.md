# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0263`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008 + pulizia matrice) → B (SESS-001..003) →
> C (CUBE-001..009) → pausa 1 → decisione WebUI → pausa 2 → E+F (debito+packaging) →
> pausa 3 → G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A e B COMPLETI. Blocco C — C1-C4 fatti (`CUBE-001/002/003/004/005(schema)/006/007`
> chiusi), nessuna decisione dell'Owner pendente. Restano `CUBE-008` (cambio modello) e
> `CUBE-009` (superficie WebUI).**

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

**Unica eccezione documentata (`D-0232`)**: il peso `phi-4-Q4_K_M.gguf` è stato **letto**
(copia read-only) su istruzione diretta dell'Owner che l'ha nominato.

## ⚠️ QUATTRO REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
2. **`ATOM_EVOLUTION` non copia MAI nulla dal vecchio.** Vedi `D-0212`.
3. **LEGGE DI PIATTAFORMA (`CLAUDE10.md` §16, `D-0247`)**: self-hosted, mai una modifica
   all'host come rimedio.
4. **DOVERE DI AVANZAMENTO (`CLAUDE10.md` §17, `D-0247`)**: ogni fase produce una proposta di
   miglioramento; eseguirla è decisione dell'Owner.
5. **`EXECUTE` è una decisione del CLIENTE** (`D-0250`): già risolto come config.

## ➜ LA PROSSIMA AZIONE — CUBE-008 poi CUBE-009, nessuna decisione dell'Owner pendente

**Block C2-C4 fatti (`D-0263`)**: `memory-service.mjs` (write/recall/promote/ensureWorkspace) +
`memory-compaction.mjs` (estrazione fail-closed da `EventLedger`, tabella `ACTION_RULES`
chiusa) + `approval-queue.mjs` con una quarta fonte `memory-candidate`. `CUBE-003` e `CUBE-006`
chiusi e verificati dal vivo. Canary di contaminazione: un record derivato non può dichiararsi
meno contaminato delle fonti che cita (il valore dichiarato viene sovrascritto, non solo
validato). Promozione: `project-candidate`/`global-candidate` passano dalla stessa coda di
approvazione a 4 fonti che già serviva workflow/agent/update.

**⚠️ Bug reale trovato verificando questo dal vivo, riparato prima del deploy**:
`listCandidates()`/`promote()` interrogavano `all_memories`/le viste tipate sotto una
connessione admin — ragionamento sbagliato: la RLS di una vista normale segue l'identità del
suo PROPRIETARIO (`noesar_migrator`), non quella del ruolo connesso, quindi una connessione
admin (che non imposta mai `noesar.actor_id`) vedeva zero righe indipendentemente da cosa
esistesse davvero. Riprodotto dal vivo (0 candidati trovati nonostante uno esistesse), riparato
interrogando `memory_records` direttamente per questi due metodi già privilegiati (mai
raggiungibili da `noesar_app`) — `cube` resta un filtro `WHERE` in più, non eliminato: un
chiamante che sbaglia cubo per una segnatura reale viene rifiutato invece di agire per sbaglio.

**Prossima azione reale**: `CUBE-008` (procedura di cambio modello di embedding, §9.3, misurata
end-to-end: inserisci il nuovo modello non-corrente, riempimento incrementale, switch atomico
di `is_current` al 100% di copertura, cancellazione del vecchio indice) poi `CUBE-009`
(destinazione `Memoria` nella WebUI, tre gesti, parole normali). Nessuna decisione dell'Owner
pendente per nessuna delle due.

**Non rifare**: le 24 verifiche `MEM-01..24` dal vivo (`D-0263`), le 8 `CUBE04-01..08`
(`D-0262`), la verifica trigger/constraint di `0017` (`D-0261`), il motore di replay di
`D-0259`.

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-memory-application-layer` (`D-0263`) ·
  `Up (healthy)` · `192.168.178.100:8100→8088` · hardening intatto ·
  `migrations:19 rls_tables:18` · workspace canonico proiettato all'avvio con l'owner reale ·
  byte immagine identici · stop pulito.
  Rollback preservato: `noesar-evolution.rollback-memory-application-layer-20260730T165253Z`
  (`:phase4-cube-typed-views`).
- **La memoria a cubi è ora scrivibile e interrogabile da codice reale** (`write`/`recall`/
  `compactRun`/`promote`), ma **nessuna route ancora la espone al di fuori di
  `GET /api/v1/memory/recall` e della coda di approvazione** — non c'è ancora una superficie
  WebUI (`CUBE-009`).
- **Due container per progetto** — §5a rispettato.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`CUBE-001`/`002`/`003`/`004`/`006`/`007` sono ✔ COSTRUITI E VERIFICATI DAL VIVO**.
- **`CUBE-005` è ✔ risolto SOLO a livello di schema** — il difetto che lo rende vero OGGI
  (`vector_entries` senza identità di modello) resta aperto e **indipendente** dai cubi.
- **`CUBE-008`/`009` restano non costruiti**.
- **`B-009` non ha richiesto una migrazione dati**: `memory_items`, `state.memories` (JSON) e
  `noesar_core.conversations`/`conversation_messages` sono confermati a **0 righe** in
  produzione — non c'è nulla da cui migrare. La chat live resta su JSON (`ContextGraph`); solo
  la NUOVA memoria a cubi è Postgres-nativa fin dal primo scrittore.
- **Nessun concetto di workspace nel percorso live del prodotto** — un solo workspace
  canonico (`CANONICAL_WORKSPACE_ID`, costante letterale) è proiettato all'avvio, stesso
  pattern "proiezione, non migrazione" già usato per l'identità.
- **Le cinque domande aperte di `14 §7`** chiuse con i default del documento (`D-0260`).
- **`INST-002`**: nessun token di installazione. **Bug menu "Ramo"** (`D-0235`): mai riprodotto.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata a
fine progetto per scelta dell'Owner. Nessun altro.

## ➜ Verificato in `D-0263`

| Verifica | Risultato |
|---|---|
| `npm test` + `npm run lint` + `scripts/test.sh` | **PASS** (1271/1272 — 1 skip pre-esistente, 253 file lint 0 errori, 19 migrazioni) |
| Unit `memory-service`/`memory-compaction` (mock) | **27/27** |
| Dal vivo contro Postgres reale usa-e-getta (`tools/acceptance/memory-integration.mjs`) | **24/24** — canary confermato su righe reali, bug RLS-su-vista riprodotto E riparato, compattazione scarta l'evento sconosciuto |
| deploy live | stop pulito, backup, §5a rispettato, `Up (healthy)`, `migrations:19 rls_tables:18` |

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna.**
