# NOESAR EVOLUTION — Session Handoff

**Riscritto alla fine di ogni fase. Una sessione fredda deve poter ripartire da questo file e
da `PROJECT_STATE.json` soltanto.**

---

## 🛑 REGOLA ZERO — un solo progetto esiste

**Ordine esplicito dell'Owner, 2026-07-26.** Lavorando qui, l'unico progetto che esiste è
**NOESAR EVOLUTION**. Nessun altro sistema di questo host si nomina, si cita, si confronta o si
tocca — non come riferimento, non come esempio, nemmeno "solo per contesto". Scritta in
`CLAUDE10.md` §1 e ora anche in cima alla skill, perché veniva letta e poi aggirata.

**CodeN Evolution è un prodotto nuovo** e non eredita nome, codice, architettura o convenzioni da
nessun altro. Il nome sbagliato che stava nel prodotto è stato rimosso oggi (vedi sotto).

**Tutto ciò che sta fuori da `PROJECT_ROOT` è in sola lettura.** Una richiesta di cancellare
artefatti di altri progetti è un **blocker**, non un compito.

## ➜ IL PROGETTO DI RIFERIMENTO È `MASTER_PROJECT/`

Deciso dall'Owner il 2026-07-26. Il metro non è il master V4: è la **riscrittura**.
`MASTER_REFERENCE/` è stata rimossa dall'albero — eccezione nominata, registrata in
`CLAUDE10.md` §1a e `D-0097`, recuperabile su tre percorsi con le prove in
`EVIDENCE/v4_removal_recovery_20260726T163433Z.txt`. **Non reintrodurla come metro senza una
nuova decisione dell'Owner.**

## ➜ Leggi in quest'ordine

1. `PROJECT_STATE.json` e questo file
2. **`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md`** — **il progetto di CodeN Evolution**: le
   tre malattie misurate, le sei invenzioni, gli oggetti, la memoria, la rete, la sandbox,
   l'ordine di costruzione e la **matrice di accettazione CE-001…CE-024**
3. `MASTER_PROJECT/09_PIANO.md` — §1 *dove siamo davvero, misurato*; §3 *quando la fase 1 è finita*
4. `docs/WORK_PLAN_V5_REWRITE.md`
5. `MASTER_PROJECT/00_LEGGIMI.md` → poi `01` e `02`
6. `docs/DECISION_LOG.md`, `docs/INSTALLATION_LEDGER.md`

---

## ➜ LA PROSSIMA AZIONE — deciso dall'Owner

> **All'apertura della prossima sessione si parla della GRAFICA DELLA WEBUI, che va cambiata.**

È una conversazione, non un compito già scopato. Materiale utile prima di iniziare:
`MASTER_PROJECT/07_INTERFACCIA.md` (il riferimento vincolante, la palette estratta dai pixel,
**undici destinazioni contro le ventitré di oggi**, il banco di lavoro, la striscia di
approvazione) e `15_…DA_ZERO.md` §12 (la metrica: il revisore deve leggere evidenza, non prosa).

**Non iniziare la fase 1.** Della fase 0 restano aperti i punti 5 e 6 — traduzione canonica in
inglese e emendamenti a `V4-D001`/`V4-D002`.

---

## ➜ Cosa è stato fatto in questa sessione

### 1 · Il prodotto dichiarava di contenere un altro prodotto — rimosso

Non era un'etichetta: il nome sbagliato stava nella **feature list di `/api/v1/bootstrap`**,
quindi il prodotto lo *dichiarava di sé stesso*, con un test che certificava la dichiarazione.
Rinominate insieme la dichiarazione, la sua prova e lo smoke test — 5 occorrenze, 4 file, zero
residui. **Nessuna dipendenza da un altro prodotto è mai esistita**: nessuna chiamata di rete,
nessun import, solo il nome. Seminato il nome vecchio → il test fallisce 2/19; ripristinato →
19/19.

### 2 · Ricerca, poi il progetto di CodeN Evolution da zero

Su richiesta dell'Owner: **prima cercare**, poi progettare, senza copiare nessuno. Il dato che
decide la strategia — **lo scaffold sposta il punteggio di 10–20 punti a modello invariato** —
significa che *il prodotto è lo scaffold*. Le tre malattie misurate e le **sei invenzioni** sono
in `15_CODEN_EVOLUTION_DA_ZERO.md`, con le fonti. In sintesi:

| | Invenzione |
|---|---|
| I | il contesto è una **proiezione ricostruita da stato**, mai un accumulo → il context rot diventa impossibile, l'attribuzione esatta |
| II | le convenzioni si **inducono dalla storia git** → **profilo di divergenza**, mai un punteggio |
| III | **l'ombra precede l'autorizzazione**: si promuove un risultato misurato, non si approva un'intenzione |
| IV | verifica **per ricalcolo**, con la **copertura di proiezione** dichiarata: ciò che non è misurato è detto |
| V | **a riposo zero strumenti**; effetti dichiarati invece di denylist; installare è un passo autorizzato |
| VI | **ATOM entra dal contratto** `ReasoningProvider`, e la copertura di proiezione ne **misura** il valore |

Più le quattro richieste dell'Owner recepite: **ATOM deve funzionare** (dal contratto, misurato,
e il criterio di "fatto" passa comunque senza — CE-022); **la rete entra come ipotesi da
falsificare in sandbox**, mai come risposta; **la sandbox è il luogo primario** dell'esecuzione,
non il recinto; **la memoria è ciò da cui la proiezione attinge**, quindi qualità della memoria =
qualità del lavoro.

E la **matrice di accettazione CE-001…CE-024** con ID e severità, che **colma il rischio 4**: la
riscrittura non aveva matrici né tracciabilità, quindi non esisteva un modo controllabile di dire
"fatto". `D-0107` → `D-0116`.

### 3 · Tre difetti trovati ESEGUENDO, e la regola che li produceva

**`verify-source.mjs` falliva a ogni giro** e nessuna lettura l'avrebbe visto: il codice è
corretto e l'intenzione è giusta. Leggeva `migrations.length !== 12` — il conteggio della release
V0.6.0, **congelato**. Da quando `0013` è atterrata lanciava sempre.

**La conseguenza è più grave della causa:** `scripts/test.sh` gira sotto `set -eu` con questo come
**secondo di sette passi**, quindi i **cinque successivi non sono mai stati eseguiti**. Fra questi
`auth-http-smoke`, che era **rotto a sua volta** — usava lo stesso codice TOTP per login e
ri-autenticazione, e la difesa contro il replay (corretta) lo rifiutava — e nessuno poteva
accorgersene.

Riparata **l'intenzione** (le dodici della V0.6.0 presenti, non riordinate, non rimosse; il totale
libero di crescere) e riparata **la regola**: `scripts/test.sh` nomina ogni passo e chiude con un
riepilogo, e **un passo che non può girare è DICHIARATO, mai contato come passato**.

## ➜ Verifiche prodotte in sessione

```text
unit                    631/631   0 falliti
scripts/test.sh         3 PASS · 0 FAIL · 4 UNAVAILABLE dichiarati (prima moriva al 2º passo)
eslint                  158 file · 0 errori · 0 warning · 0 no-undef
MANIFEST              5721/5721   0 falliti · 0 duplicati
difetti seminati        5 — ognuno catturato, ogni file ripristinato byte-identico
```

**Non eseguibile su questo host, dichiarato e non contato come passato:** i quattro passi Python
di `scripts/test.sh` (`pg-migrations`, `pg-contract`, `rust-source`, `rust-provenance`).
`python3` non è installato e la **regola 45 vieta di installarlo**.

## ➜ L'installazione — intoccata

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-wp2
endpoint    livez 200 · readyz 200 · metrics 401 (hardening LAN intatto)
schema      state/ai-workspace.json ancora "schemaVersion": 1 — vedi rollback
```

**Nessun container di prodotto è stato creato, avviato o fermato.** Le due riparazioni al
prodotto (`§1` sopra) sono **nel sorgente e NON installate**: il box vivo dichiara ancora il nome
sbagliato in `/api/v1/bootstrap`. Il deploy è una fase di installazione e **richiede
autorizzazione esplicita dell'Owner**.

## ➜ Igiene

Questa fase **non ha creato container transitori**: nessun tag stampato, nessuna rete per-run,
nessuna rimozione necessaria. Sopravvivono esattamente i due ammessi da §5a — l'installazione e
**un solo** rollback. Container totali **39 all'apertura e 39 in chiusura**. Reti: solo le due
stabili (`noesar-evolution-net`, `noesar-e2e-net`); `noesar-local` non è di questo progetto e non
è stata toccata. Nessun `prune`, in nessuna forma. Inventario in
`EVIDENCE/docker_inventory_pre_cleanup_20260726T191041Z.txt`.

## ➜ Blocker aperti

`B-001` nessun remote GitHub (nessun commit è mai stato pushato) · `B-002` secret scan euristico
(`detect-secrets` restituisce 0 finding su una chiave AWS letterale) · `B-008` due store di
identità. **`B-009` chiuso** (PostgreSQL autoritativo per la memoria; la migrazione tocca dati
vivi e non è ancora eseguita).

**Non un blocker ma va detto:** l'Owner ha chiesto di cancellare i file di memoria di altri
progetti e di conservare credenziali VPS/git in un file. Entrambe **non eseguite**, con la
ragione data: `/mnt/cachec/NOESAR` non è un repository git, quindi quella cancellazione sarebbe
**irreversibile**; e la regola 25 vieta qualunque segreto in un artefatto tracciato. Alternativa
proposta e non ancora autorizzata: archiviare invece di cancellare, e un `.env.example` che
**nomina** le variabili senza valori.

## ➜ Rollback

```text
container    noesar-evolution.rollback-webui-20260726T155330Z     immagine :phase4-webui
runtime      BACKUPS/runtime_pre_wp2_deploy_20260726T155330Z/     copia completa 75 MB
sorgente     BACKUPS/coden_rename_20260726T181132Z/               i 4 file del rename
             BACKUPS/verify_source_fix_20260726T190515Z/          verify-source, auth-smoke,
                                                                  test.sh, MANIFEST
progetto V4  git c28d8a2 · archivi sigillati ·
             EVIDENCE/v4_removal_recovery_20260726T163433Z.txt
```

Per tornare indietro sull'installazione: `docker stop -t 60 noesar-evolution`, rinominarlo da
parte, poi `docker start noesar-evolution.rollback-webui-20260726T155330Z`. **Se nel frattempo la
build attuale ha scritto** `state/ai-workspace.json` — controlla se legge ancora
`"schemaVersion": 1` — va ripristinato anche quello dal backup, o `:phase4-webui` rifiuterà di
caricare il workspace AI.

## ➜ Commit

`254ed06` il nome · `3cc295b` il progetto da zero e i tre difetti. **Nessuno pushato** (`B-001`).
