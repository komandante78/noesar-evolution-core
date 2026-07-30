# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0259`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008 + pulizia matrice) → B (SESS-001..003) →
> C (CUBE-001..009) → pausa 1 → decisione WebUI → pausa 2 → E+F (debito+packaging) →
> pausa 3 → G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A COMPLETO. Blocco B COMPLETO** (`D-0255` SESS-001, `D-0259` SESS-002+003).
> Prossimo: **Blocco C — `CUBE-001..009`**, sottosistema intero mai iniziato.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

**Unica eccezione documentata (`D-0232`)**: il peso `phi-4-Q4_K_M.gguf` è stato **letto**
(copia read-only) su istruzione diretta dell'Owner che l'ha nominato.

## ⚠️ QUATTRO REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
   Prima di dichiarare un gap non risolvibile: `find docs/ MASTER_PROJECT/ -newer <ultimo letto>`.
2. **`ATOM_EVOLUTION` non copia MAI nulla dal vecchio.** Vedi `D-0212`.
3. **LEGGE DI PIATTAFORMA (`CLAUDE10.md` §16, `D-0247`)**: self-hosted su qualunque
   PC/server/OS. Una modifica all'host non è mai un rimedio.
4. **DOVERE DI AVANZAMENTO (`CLAUDE10.md` §17, `D-0247`)**: ogni fase produce una proposta di
   miglioramento; eseguirla nella stessa fase è decisione dell'Owner.
5. **`EXECUTE` è una decisione del CLIENTE** (`D-0250`): `NOESAR_EXECUTE_SANDBOX`, default
   `disabled`, per installazione. Già risolto come config, non riproporre.

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità.
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — il digest, non i file interi.
3. `find docs/ MASTER_PROJECT/ -newer docs/SESSION_HANDOFF.md`.
4. Questo file, «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**Blocco B COMPLETO (`D-0259`)**: `replay(runId)` (SESS-002) e `replayHistoricalFixture()`
(SESS-003) costruiti, testati (17 nuovi test, inclusa una divergenza **provocata** per provare
che il rilevatore scatta davvero), deployati live. Nuove route:
`POST /api/v1/workspace-actions/:id/replay`, `POST /api/v1/session-proof/replay`.

**Prossimo: Blocco C — `CUBE-001..009`** (`MASTER_PROJECT/14_MEMORIA_A_CUBI.md`), 0/9, un
sottosistema intero mai iniziato — memoria a quattro cubi, con le tre semantiche del doc `05`,
il contratto `recall()` (§9.4), nove categorie chiuse, immutabilità delle firme, compattazione
fail-closed. **Prima azione: leggere lo spec per intero** e proporre una scomposizione in fasi
prima di scrivere codice — è il pezzo più grande rimasto nel piano dell'Owner.

**Non rifare**: il probe di `D-0246`, le misure di `D-0248`/`D-0249`/`D-0250`, l'audit dei tre
adapter di `D-0252`, i vettori/test live di `D-0253`, l'assemblaggio dei dieci campi di
`D-0255`, il motore di replay di `D-0259` (tutti già provati con test reali).

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-sess002-003-replay` (`D-0259`) ·
  `Up (healthy)` · `192.168.178.100:8100→8088` · hardening intatto ·
  `migrations:16 rls_tables:15` invariate · byte immagine identici · stop pulito, **nessun
  crash recovery** al riavvio (a differenza del deploy precedente).
  Rollback preservato: `noesar-evolution.rollback-sess002-003-replay-20260730T142926Z`
  (`:phase4-sess001-session-proof`).
- **`NOESAR_EXECUTE_SANDBOX=disabled`**, `NOESAR_LOCAL_MODEL_RUNTIME=disabled`, invariati.
- **atomd**: `atom-evolution:atomd`, `noesar-evolution-net`. Live in produzione
  `NOESAR_REASONING_MODE=rust-external` — `plan()` ora passa `runId` come `sessionId` del
  router, quindi ogni run futuro ha un pack di fixture reale da rigiocare (prima di `D-0259`
  `fixtures()` non aveva mai nulla da restituire per nessun run).
- **Due container per progetto** — §5a rispettato.
- ⚠️ **Lezione `D-0257` applicata con successo**: `NOESAR_ALLOWED_HOSTS`/
  `NOESAR_EXTERNAL_SURFACES` riletti dal container vivo e verificati con `cat -A`
  (separati da virgola, non newline) PRIMA di scriverli nel nuovo `-e` — deploy pulito al
  primo tentativo, zero incidenti questa volta.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`SESS-002`/`SESS-003` sono ✔ COSTRUITI (`D-0259`)**: non solo assemblati — deployati live,
  route verificate (401 non autenticate, non 404).
- **Bug reale trovato costruendo**: `usedExternal` (LOCAL vs EXTERNAL_PACK) contava QUALSIASI
  risposta `atom`, `fixtures` incluso — un run che instrada solo `fixtures` esternamente
  (decisione interamente locale) avrebbe preso il percorso sbagliato. Fissato con
  `DECISION_SURFACES` (esclude `fixtures`), condiviso da `session-proof.mjs` che aveva lo
  stesso difetto.
- **`fixture.replayable`** in `session-proof.mjs` ora ha tre valori reali:
  `DECISION_LAYER_ONLY` (solo riferimento), `MODEL_FIXTURE_CAPTURED` (pack catturato),
  `NOT_REPLAYABLE` (routing esterno ma cattura fallita) — mai più un valore fisso.
- **`provenienza`** dichiara ogni fonte `UNTRACKED`: `CUBE-001..009` non esiste ancora.
- **`INST-002`**: nessun token di installazione — nessuna superficie lo richiede.
- **`CUBE-001..009`**: sottosistema intero mai costruito, prossimo blocco.
- **`MANIFEST.sha256` non copre `.claude/` né `CLAUDE10.md`** — proposta registrata in
  `D-0247`, non riparata.
- **Bug menu "Ramo"** (`D-0235`): mai riprodotto, resta aperto.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred, `D-0258`): storia git ripulita,
rotazione del token rimandata a fine progetto per scelta esplicita dell'Owner. Nessun altro.

## ➜ Verificato in `D-0259`

| Verifica | Risultato |
|---|---|
| unit Node | **1246 pass, 1 skip onesto, 0 fail** (+18 su `D-0255`) |
| ESLint | **248 file**, 0 errori |
| `scripts/test.sh` | **10/10** |
| Browser E2E | **327/327** |
| Accessibilità | **27/27** |
| Seeded-defect | **19/19** |
| `MANIFEST.sha256` | **5863/5863** |
| deploy live | stop pulito, backup, §5a rispettato, `Up (healthy)`, hardening+`migrations:16 rls_tables:15` invariati, entrambe le nuove route rispondono 401 |

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna.**
