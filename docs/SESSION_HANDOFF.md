# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0262`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008 + pulizia matrice) → B (SESS-001..003) →
> C (CUBE-001..009) → pausa 1 → decisione WebUI → pausa 2 → E+F (debito+packaging) →
> pausa 3 → G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A e B COMPLETI. Blocco C — fase C1 fatta, `CUBE-004` chiuso (`D-0262`),
> nessuna decisione dell'Owner pendente. Prossimo: C2, il livello applicativo.**

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

## ➜ LA PROSSIMA AZIONE — Block C2, nessuna decisione dell'Owner pendente

**`CUBE-004` chiuso (`D-0262`)**: l'Owner ha scelto viste tipate + `REVOKE` (non tabelle
separate). `database/postgres/0018_memory_cube_typed_views.sql` — quattro viste
(`library_memories`/`workshop_memories`/`corpus_memories`/`experience_memories`), ciascuna
`WHERE cube = '<x>' WITH CHECK OPTION`, possedute da `noesar_migrator` (non dal superuser che
esegue la migrazione — un owner superuser avrebbe fatto bypassare la RLS del tutto, evitato di
proposito). `noesar_app` non raggiunge più `memory_records` direttamente. Verificato **dal vivo**
estendendo l'harness permanente `tools/acceptance/postgres-integration.mjs` (`CUBE04-01..08`,
**57/57 PASS**, zero regressioni sui `DB-*` preesistenti) e **deployato in produzione**
(`migrations:18 rls_tables:18`).

**⚠️ Secondo difetto indipendente trovato verificando questo dal vivo, e riparato nella stessa
migrazione**: le tre policy di `0017` (`memory_records`/`memory_vectors`/`embedding_models`)
erano ciascuna l'UNICA policy sulla propria tabella e dichiarate `RESTRICTIVE` — senza una
`PERMISSIVE` da restringere, Postgres nega sempre, per chiunque. `memory_records` non è mai
stata scrivibile da `noesar_app` da quando `0017` è stata deployata, silenzioso perché nessun
codice applicativo la usava ancora. Riprodotto dal vivo sullo schema `0017` non modificato prima
di scrivere la correzione. Impossibile riparare editando `0017` (già applicata al prodotto vivo,
le migrazioni sono immutabili una volta applicate) — riparato dentro `0018` invece, togliendo il
marcatore `RESTRICTIVE` dalle tre policy (diventano `PERMISSIVE`, lo stesso schema auto-
sufficiente che `0015` già usa per `vector_entries`/`conversations`/`agents`/`tools`). Dettaglio
completo in `docs/DECISION_LOG.md` `D-0262`.

**Prossima azione reale: Block C2**, il livello applicativo che finalmente legge/scrive
attraverso le quattro viste — contratto `recall()` (`CUBE-006`), compattazione estrattiva
(`CUBE-003`, la parte più delicata), canary di contaminazione + promozione, superficie WebUI
(`CUBE-009`), livelli di consolidamento (`CUBE-008`, ultimo). Nessuna decisione dell'Owner
pendente per iniziare.

**Non rifare**: la verifica dei trigger/constraint di `0017` (8 test dal vivo, `D-0261`), le 8
verifiche `CUBE04-01..08` su viste/RESTRICTIVE (`D-0262`), il motore di replay di `D-0259`,
l'assemblaggio dei dieci campi di `D-0255`.

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-cube-typed-views` (`D-0262`) · `Up (healthy)` ·
  `192.168.178.100:8100→8088` · hardening intatto · `migrations:18 rls_tables:18` ·
  byte immagine identici · stop pulito.
  Rollback preservato: `noesar-evolution.rollback-cube-typed-views-20260730T152454Z`
  (`:phase4-cube-c1-schema`) — **tornare a questo rollback reintroduce sia il gap `CUBE-004`
  sia il difetto `RESTRICTIVE`-senza-`PERMISSIVE`**.
- **Le quattro viste tipate**: presenti e verificate, **nessun codice applicativo le legge o
  le scrive ancora** — la memoria viva resta `ai-workspace.json`. C2 è dove questo inizia.
- **Due container per progetto** — §5a rispettato.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`CUBE-001`/`CUBE-002`/`CUBE-004`/`CUBE-007` sono ✔ COSTRUITI E VERIFICATI DAL VIVO** — non
  solo scritti, provati con `INSERT`/`UPDATE` reali contro un Postgres reale che li rifiuta
  come previsto.
- **`CUBE-005` è ✔ risolto SOLO a livello di schema** — il difetto che lo rende vero OGGI
  (`vector_entries` senza identità di modello) resta aperto e **indipendente** dai cubi.
- **`CUBE-003`/`006`/`008`/`009` restano interamente non costruiti** — richiedono il livello
  applicativo (compattazione, `recall()`, WebUI), non solo lo schema.
- **Le cinque domande aperte di `14 §7`** sono state chiuse adottando i default già proposti
  dallo stesso documento (`D-0260`), non inventati da zero — nomi, soglia di promozione,
  ritenzione, identità del Cubo 3.
- **`INST-002`**: nessun token di installazione — nessuna superficie lo richiede.
- **Bug menu "Ramo"** (`D-0235`): mai riprodotto, resta aperto.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): storia git ripulita, rotazione
token rimandata a fine progetto per scelta dell'Owner. Nessun altro.

## ➜ Verificato in `D-0262`

| Verifica | Risultato |
|---|---|
| `scripts/test.sh` (10 STEP) + `npm test` + `npm run lint` | **PASS** (18 migrazioni, 1246/1247 unit — 1 skip pre-esistente non correlato, 248 file lint 0 errori) |
| Test dal vivo contro Postgres reale usa-e-getta (`CUBE04-01..08`) | **57/57** (accesso diretto negato, default cubo per vista, `CHECK OPTION` respinge sia `INSERT` sia `UPDATE` fuori cubo, `memory_vectors` funziona ancora per l'owner e nega ancora cross-workspace) |
| Ipotesi `RESTRICTIVE`-senza-`PERMISSIVE` confermata isolatamente sullo schema `0017` non modificato, poi riparata | **confermato** |
| deploy live | stop pulito, backup, §5a rispettato, `Up (healthy)`, `migrations:18 rls_tables:18` |

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna.** `CUBE-004` era l'unica bloccante per il resto del Blocco C.
