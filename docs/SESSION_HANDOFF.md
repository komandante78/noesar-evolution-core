# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0261`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008 + pulizia matrice) → B (SESS-001..003) →
> C (CUBE-001..009) → pausa 1 → decisione WebUI → pausa 2 → E+F (debito+packaging) →
> pausa 3 → G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A e B COMPLETI. Blocco C — fase C1 fatta e deployata, ⚠️ BLOCCATA su una
> decisione dell'Owner prima di andare avanti** (`CUBE-004`, vedi sotto).

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

## ➜ LA PROSSIMA AZIONE — ⚠️ decisione dell'Owner necessaria

**Blocco C, fase C1 fatta**: `database/postgres/0017_memory_cubes.sql` — `embedding_models`,
`memory_records` (segnatura immutabile, nove categorie chiuse, `derived_must_cite`), `memory_vectors`.
Verificato **dal vivo contro un PostgreSQL reale usa-e-getta** (8 test SQL diretti, non solo
match testuale) e **deployato in produzione** (`migrations:17 rls_tables:18`).

**⚠️ Trovata una tensione architetturale reale nello spec stesso, non risolta**: `CUBE-004`
(Critica) chiede che i quattro cubi siano separati **per tabella/tipo**, così che nessun errore
di programmazione possa confonderli. Lo schema concreto proposto da `14 §9.2` — implementato
qui quasi verbatim — mette **tutti e quattro i cubi in un'unica tabella** `memory_records` con
una colonna ENUM. Una query che dimentica `WHERE cube = 'library'` restituisce silenziosamente
anche righe Corpus: esattamente ciò che `CUBE-004` dichiara impossibile. **Due correzioni
proposte, nessuna applicata**: (a) quattro viste tipate `WITH CHECK OPTION`, con l'accesso
diretto alla tabella base revocato — ogni lettura/scrittura passa per forza da una vista che non
può restituire/accettare il cubo sbagliato; (b) quattro tabelle davvero separate (più fedele al
testo letterale di `CUBE-004`, più duplicazione delle colonne comuni). **Serve la scelta
dell'Owner prima di costruire C2 sopra questa base** — vedi `docs/DECISION_LOG.md` `D-0261` per
il dettaglio completo.

**Non rifare**: la verifica dei trigger/constraint di `0017` (8 test già provati dal vivo), il
motore di replay di `D-0259`, l'assemblaggio dei dieci campi di `D-0255`.

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-cube-c1-schema` (`D-0261`) · `Up (healthy)` ·
  `192.168.178.100:8100→8088` · hardening intatto · `migrations:17 rls_tables:18` ·
  byte immagine identici · stop pulito.
  Rollback preservato: `noesar-evolution.rollback-cube-c1-schema-20260730T144721Z`
  (`:phase4-sess002-003-replay`).
- **`memory_records`/`memory_vectors`/`embedding_models`**: schema presente, **nessun codice
  applicativo le legge o le scrive ancora** — la memoria viva resta `ai-workspace.json`.
- **Due container per progetto** — §5a rispettato.
- ⚠️ **Bug di processo trovato e corretto in questa fase**: l'immagine `:phase4-sess002-003-replay`
  (e tutte le precedenti di questa sessione) non copiavano MAI `database/postgres/` — corretto
  per quelle fasi (non toccavano lo schema), ma avrebbe fatto fallire silenziosamente qualunque
  test dal vivo su una migrazione nuova se non me ne fossi accorto costruendo il test C1.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`CUBE-001`/`CUBE-002`/`CUBE-007` sono ✔ COSTRUITI E VERIFICATI DAL VIVO** — non solo scritti,
  provati con `INSERT`/`UPDATE` reali contro un Postgres reale che li rifiuta come previsto.
- **`CUBE-005` è ✔ risolto SOLO a livello di schema** — il difetto che lo rende vero OGGI
  (`vector_entries` senza identità di modello) resta aperto e **indipendente** dai cubi.
- **`CUBE-004` NON è soddisfatto**, nonostante lo schema esista — vedi sopra.
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

## ➜ Verificato in `D-0261`

| Verifica | Risultato |
|---|---|
| `scripts/test.sh` pg-migrations+pg-contract | **PASS** (17 migrazioni) |
| Test dal vivo contro Postgres reale usa-e-getta | **8/8** (trigger segnatura, `derived_must_cite`, categoria chiusa, `is_current` unico, `memory_vectors` insert, `counters_only_for_experience`) |
| deploy live | stop pulito, backup, §5a rispettato, `Up (healthy)`, `migrations:17 rls_tables:18` |

## ➜ Le domande all'Owner ancora senza risposta

**Una, bloccante per il resto del Blocco C**: `CUBE-004` — vista tipata con permessi
revocati, tabelle separate, o si accetta il gap? Vedi `D-0261` sopra.
