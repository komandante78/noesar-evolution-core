# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0255`/`D-0256`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase in corso su richiesta Owner** ("finisci tutto il progetto,
> massimo 4 pause"): A (debito ARCH-005/008 + pulizia matrice) → B (SESS-001..003) →
> C (CUBE-001..009) → pausa 1 → decisione WebUI → pausa 2 → E+F (debito+packaging) →
> pausa 3 → G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A COMPLETO** (`D-0252`/`D-0253`/`D-0254`). **Blocco B, 1/3 fatto**: `D-0255`
> (SESS-001, costruito e deployato). Prossimo: **SESS-002** (motore di replay).

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

**SESS-001 costruito e deployato (`D-0255`)**: `session-proof.mjs` assembla i dieci campi
(`01_VISIONE_E_POSIZIONE.md`) da un run reale `plan()`→`approve()` — nessun campo inventato.
`GET /api/v1/workspace-actions/:id/session-proof`, stesso livello di fiducia di `GET :id`.

**Prossimo: `SESS-002`** — il motore di replay. `run.request`/`run.hypotheses`/
`run.projectRules`/`run.constraints`/`run.mode`/`run.policy`/`run.files` sono già salvati sul
run (aggiunti da `D-0255` per il campo `fixture`) — quello che manca è la funzione che
riesegue `plan()` con questi stessi input e confronta il risultato con quello registrato,
byte per byte, sul **livello delle decisioni** (correzione `P1`, doc `11`: mai rigenerare
l'output di un provider esterno, solo quello del provider di riferimento è deterministico).
Poi `SESS-003` (replay di una sessione storica contro un binario più recente).

**Non rifare**: il probe di `D-0246`, le misure di `D-0248`/`D-0249`/`D-0250`, l'audit dei tre
adapter di `D-0252`, i vettori/test live di `D-0253`, l'assemblaggio dei dieci campi di
`D-0255` (già provato su un run reale in `test/session-proof.test.mjs`).

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-sess001-session-proof` (`D-0255`) ·
  `Up (healthy)` · `192.168.178.100:8100→8088` · hardening intatto ·
  `migrations:16 rls_tables:15` invariate · byte immagine identici.
  Rollback preservato: `noesar-evolution.rollback-sess001-session-proof-20260730T130533Z`
  (`:phase4-arch008-execute-rust-mirror`).
- **`NOESAR_EXECUTE_SANDBOX=disabled`**, `NOESAR_LOCAL_MODEL_RUNTIME=disabled`, entrambi
  invariati — nessuna superficie ancora li attraversa in produzione.
- **atomd**: `atom-evolution:atomd`, `noesar-evolution-net`. Live in produzione
  `NOESAR_REASONING_MODE=rust-external` — il provider esterno risponde a
  interpret/hypothesize/plan/... e session-proof lo dichiara onestamente (`fixture` è
  `DECISION_LAYER_ONLY`: gli output di **questo** provider non sono fissati come fixture,
  solo quelli del provider di riferimento lo sono).
- **Due container per progetto** — §5a rispettato.
- ⚠️ **Due errori auto-causati in questo deploy, disclosurati per intero in
  `docs/INSTALLATION_LEDGER.md`, non da ripetere**: (1) un `docker inspect | tr ',' '\n'`
  fatto per leggibilità è stato incollato per sbaglio in un `-e` al posto del valore reale
  separato da virgole (`NOESAR_ALLOWED_HOSTS`/`NOESAR_EXTERNAL_SURFACES`) — 421 su ogni
  richiesta, preso subito perché l'health non diventava mai verde; (2) per rimediare è stato
  usato `docker rm -f` invece di un secondo `docker stop -t 60` pulito — PostgreSQL ha fatto
  da solo un WAL crash recovery pulito (nessun dato perso, verificato), ma la sequenza
  corretta era un secondo stop pulito, non una rimozione forzata di un container vivo.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`SESS-001` è ✔ COSTRUITO (`D-0255`)**: non solo assemblato — deployato live e verificato
  (`/livez`/`/readyz`/`/healthz` 200, route risponde 401 non autenticata, non 404).
- **`provenienza`** dichiara ogni fonte `UNTRACKED`: `CUBE-001..009` non esiste, quindi non
  c'è nessuno stato di contaminazione da riportare — dichiarato, non inventato.
- **`fixture`** dichiara `replayable:'DECISION_LAYER_ONLY'`: sul provider di riferimento
  rieseguire gli stessi input riproduce le stesse decisioni (funzione pura); su un provider
  esterno (quello live oggi) non c'è ancora nessuna fixture di output di modello registrata —
  quello è esattamente `SESS-002`, non ancora costruito.
- **`autorità`** include ora `capability.denied` (aggiunto da `D-0255`): prima un mint
  rifiutato non lasciava traccia nella correlazione eventi del run.
- **`egress`** è campionato solo se `privacyStateFor` è passato all'orchestratore — lo è, in
  produzione (`server.mjs` passa `currentPrivacy`), quindi non è mai vuoto sul prodotto vivo.
- **`INST-002`**: nessun token di installazione — nessuna superficie lo richiede.
- **`SESS-002..003` e `CUBE-001..009`**: sottosistemi ancora mai costruiti.
- **`MANIFEST.sha256` non copre `.claude/` né `CLAUDE10.md`**, nessun tool lo verifica —
  proposta di miglioramento registrata in `D-0247`, non riparata.
- **Bug menu "Ramo"** (`D-0235`): mai riprodotto, resta aperto.

## ➜ Blocker aperti

`B-011` (low, `D-0257`→`D-0258` **RISOLTO IN PARTE**): `tools/run-secret-scan.sh` aveva trovato
`NOESAR_RUST_REASONING_TOKEN` in chiaro in due `EVIDENCE/*.json` già pushati. Su autorizzazione
esplicita dell'Owner ("riscrivi git", rotazione rimandata a fine progetto): storia riscritta
(`git filter-branch` sui 2 file, backup bundle preservato in `BACKUPS/` — gitignored, non
pushato — `gc --prune=now`, force-push, verificato pulito su un clone fresco da `origin/main`).
**Resta aperto solo**: la rotazione del token stesso, per scelta dell'Owner a fine progetto —
non un'azione dimenticata. `B-002` era basato su una premessa falsa (lo scanner reale esiste
già) — corretto, superseded da `B-011`.

## ➜ Verificato in `D-0255`/`D-0256`

| Verifica | Risultato |
|---|---|
| unit Node | **1229 pass, 1 skip onesto, 0 fail** (+6 su `D-0255`) |
| ESLint | **246 file**, 0 errori |
| `scripts/test.sh` | **10/10** |
| Browser E2E | **327/327** (probe riparato da `D-0256`, crash-loop dal `D-0242`) |
| Accessibilità | **27/27** |
| Seeded-defect | **19/19** |
| `MANIFEST.sha256` | **5861/5861** |
| deploy live (`D-0255`) | stop pulito, backup, §5a rispettato, `Up (healthy)`, hardening+`migrations:16 rls_tables:15` invariati, route risponde 401 non autenticata |

## ➜ Le domande all'Owner ancora senza risposta

**Nessuna.**
