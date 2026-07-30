# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0264`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008 + pulizia matrice) → B (SESS-001..003) →
> C (CUBE-001..009) → pausa 1 → decisione WebUI → pausa 2 → E+F (debito+packaging) →
> pausa 3 → G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A e B COMPLETI. Blocco C — C1-C5 fatti (`CUBE-001/002/003/004/005(schema)/006/
> 007/008` chiusi), nessuna decisione dell'Owner pendente. Resta SOLO `CUBE-009`
> (superficie WebUI) — ultimo item del Blocco C.**

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

## ➜ LA PROSSIMA AZIONE — CUBE-009, ultimo item del Blocco C, nessuna decisione pendente

**Block C5 fatto (`D-0264`)**: `memory-model-swap.mjs` (`ModelSwapService`) — i quattro passi
di `§9.3` come quattro metodi: `registerModel` (`is_current:false`), `backfillBatch`
(incrementale), `activate` (rifiuta sotto il 100%, cutover atomico in un `BEGIN`/`COMMIT`),
`purgeSuperseded` (rifiuta di cancellare l'indice CORRENTE). Nessun modello di embedding reale
è collegato a questo prodotto (verificato, come già per `recall()`) — `embed` è una funzione
iniettata dal chiamante, mai un default silenzioso: il criterio `CUBE-008` riguarda il
MECCANISMO dello scambio, non vettori semantici reali, ed è provato con un corpus reale di
record reali indipendentemente da dove vengano i numeri.

**⚠️ Bug reale trovato verificando questo dal vivo, riparato prima del deploy**:
`purgeSuperseded()` riportava sempre `deleted:0` contro una cancellazione reale di 7 righe — il
client Postgres scritto a mano di questo progetto calcola `rowCount` dal numero di righe
RESTITUITE, non dal tag `CommandComplete` di Postgres, quindi una `DELETE` senza `RETURNING`
riporta sempre zero. Stessa convenzione già in uso in `postgres-integration.mjs` (`DB-17`),
applicata qui.

**Prossima azione reale**: `CUBE-009` — una sola destinazione `Memoria` nella WebUI
(`apps/webui-static/`), tre gesti (*cerca* · *sfoglia* · *approva*), parole normali (mai
`promotion_state`/`contamination`/`cube` fuori da una vista di dettaglio esplicitamente
richiesta). Backend già pronto: `GET /api/v1/memory/recall` per cerca/sfoglia, la coda di
approvazione a 4 fonti (`memory-candidate`) già esistente per approva/scarta. Nessuna decisione
dell'Owner pendente. **Verificare con screenshot Puppeteer reali, non solo il DOM** — regola
permanente di questo progetto.

**Non rifare**: le 35 verifiche `MEM-01..36` dal vivo (`D-0263`/`D-0264`), le 8 `CUBE04-01..08`
(`D-0262`), la verifica trigger/constraint di `0017` (`D-0261`).

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-memory-model-swap` (`D-0264`) · `Up (healthy)` ·
  `192.168.178.100:8100→8088` · hardening intatto · `migrations:19 rls_tables:18` ·
  workspace canonico proiettato all'avvio · byte immagine identici · stop pulito.
  Rollback preservato: `noesar-evolution.rollback-memory-model-swap-20260730T170329Z`
  (`:phase4-memory-application-layer`).
- **`embedding_models` è vuota in produzione** — la procedura di scambio è provata dal vivo
  contro un'istanza usa-e-getta, mai eseguita sul prodotto reale (nessun modello da scambiare
  esiste ancora lì).
- **La memoria a cubi è scrivibile/interrogabile/promuovibile/reindicizzabile da codice reale**
  ma **nessuna superficie WebUI la espone** ancora — solo `GET /api/v1/memory/recall` e la coda
  di approvazione. `CUBE-009` è l'ultimo pezzo mancante.
- **Due container per progetto** — §5a rispettato.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`CUBE-001`/`002`/`003`/`004`/`006`/`007`/`008` sono ✔ COSTRUITI E VERIFICATI DAL VIVO**.
- **`CUBE-005` è ✔ risolto SOLO a livello di schema** — il difetto che lo rende vero OGGI
  (`vector_entries` senza identità di modello) resta aperto e **indipendente** dai cubi.
- **`CUBE-009` è l'UNICO item ancora non costruito nella matrice di accettazione del Blocco C.**
- **`B-009` non ha richiesto una migrazione dati**: `memory_items`, `state.memories` (JSON) e
  le tabelle Postgres delle conversazioni sono confermate a **0 righe** in produzione.
- **Nessun concetto di workspace nel percorso live del prodotto** — un solo workspace
  canonico (`CANONICAL_WORKSPACE_ID`) proiettato all'avvio, stesso pattern usato per l'identità.
- **`INST-002`**: nessun token di installazione. **Bug menu "Ramo"** (`D-0235`): mai riprodotto.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata a
fine progetto per scelta dell'Owner. Nessun altro.

## ➜ Verificato in `D-0263`/`D-0264`

| Verifica | Risultato |
|---|---|
| `npm test` + `npm run lint` + `scripts/test.sh` | **PASS** (1284/1285 — 1 skip pre-esistente, 255 file lint 0 errori, 19 migrazioni) |
| Unit `memory-service`/`memory-compaction`/`memory-model-swap` (mock) | **38/38** |
| Dal vivo contro Postgres reale usa-e-getta (`tools/acceptance/memory-integration.mjs`) | **35/35** — canary, bug RLS-su-vista riparato, compattazione fail-closed, scambio modello con cutover atomico, bug `rowCount` riparato |
| deploy live | stop pulito, backup, §5a rispettato, `Up (healthy)`, `migrations:19 rls_tables:18` |

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna.**
