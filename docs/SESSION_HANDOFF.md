# NOESAR EVOLUTION — Session Handoff

**Riscritto alla fine di ogni fase. Una sessione fredda deve poter ripartire da questo file e
da `PROJECT_STATE.json` soltanto.**

---

## ⚠️ IL PROGETTO DI RIFERIMENTO È CAMBIATO — 2026-07-26

**Deciso dall'Owner.** Il metro non è più il master V4: è la **riscrittura**, in
`MASTER_PROJECT/` (14 documenti italiani, importati con checksum di provenienza e verificati
byte-identici all'originale in `/mnt/user/downloads/NOESAR_EVOLUTION/`).

`MASTER_REFERENCE/` **è stata rimossa dall'albero di lavoro** — 119 file. È un'eccezione
nominata alla regola 12, registrata in `CLAUDE10.md` §1a e in `D-0097`, **non** un
aggiramento. È recuperabile su tre percorsi, con le prove registrate *prima* della rimozione
in `EVIDENCE/v4_removal_recovery_20260726T163433Z.txt`: il commit `c28d8a2`, i cinque archivi
sigillati con i loro SHA-256, e un manifest sha256 dei 119 file così che il recupero sia
verificabile file per file. **Non reintrodurre il V4 come metro senza una nuova decisione
dell'Owner.**

## ➜ Leggi in quest'ordine

1. `PROJECT_STATE.json` e questo file
2. **`docs/WORK_PLAN_V5_REWRITE.md`** — cosa è fatto, cosa cambia, cosa va modificato, il piano
3. **`MASTER_PROJECT/09_PIANO.md`** — §1 dice *dove siamo davvero, misurato*; §3 dice *quando
   la fase 1 è finita*. Quei due paragrafi valgono più di qualsiasi riassunto.
4. `MASTER_PROJECT/00_LEGGIMI.md` → poi `01` e `02`, che reggono tutto il resto
5. `docs/DECISION_LOG.md`, `docs/INSTALLATION_LEDGER.md`

## ➜ LA PROSSIMA AZIONE È UNA CONVERSAZIONE, NON DEL CODICE

L'Owner ha annunciato che **porrà domande per verificare che il progetto coincida con il suo
pensiero**. Il piano in `docs/WORK_PLAN_V5_REWRITE.md` è **proposto, non approvato**.

**Non iniziare la fase 1.** Della fase 0 (governo) sono fatti i punti 1-3; i punti 4-6 —
domande dell'Owner, traduzione canonica in inglese, emendamenti a `V4-D001`/`V4-D002` — sono
in attesa, e il primo blocca gli altri due.

## ➜ Cosa è stato fatto in questa sessione, in ordine

1. **WP-2 · i sette stati di privacy** — l'ultimo lavoro fatto col metro V4. Misurato prima di
   cambiare: **18 check falliti su 25** contro il codice non corretto. Il difetto più grave non
   era uno stato mancante: l'indicatore dichiarava `REMOTE_MODEL_ACTIVE` per un invio che il
   server aveva **rifiutato**, perché lo stato era una variabile scritta dal piano di egress
   dell'ultimo chiamante, e partiva asserendo "verified" prima di aver verificato alcunché.
   Ora è **derivato** dalla configurazione. `D-0087` → `D-0093`.
2. **Deploy autorizzato dall'Owner** dei quattro fix accumulati → `:phase4-wp2`, vivo e sano.
3. **`docs/REMAINING_WORK.md`** — e nel produrlo, due miei errori di misura corretti.
4. **Il cambio di progetto di riferimento** (questo), con piano di lavoro e skill aggiornati.

## ➜ L'installazione, verificata dopo il deploy

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-wp2
endpoint    livez 200 · readyz 200 · / 200 · /metrics 401 (hardening LAN intatto)
rotte       workflows 401 · approvals 401 · privacy/revoke 401 · rotta inesistente 404
dati        PostgreSQL 18.4 + pgvector 0.8.5, 16 migrazioni, 15 tabelle RLS, Owner intatto
errori      0 dall'avvio
schema      ai-workspace.json ancora "schemaVersion": 1 — vedi rollback
```

**Non verificato dal vivo, e serve l'Owner:** il comportamento di tre dei quattro fix
(authorize ricalcolato, `DENY` rifiutato, indicatore non ripitturabile) richiede una sessione
Owner autenticata, e queste sessioni non hanno le credenziali. Provato sul box: le rotte
esistono e sono protette, e i byte installati sono identici all'albero che ha passato le suite.

## ➜ Verifiche prodotte in sessione

```text
unit test              631/631   600 prima; +31 in una suite nuova
  stati di privacy      31/31    18 di 25 falliti contro il codice non corretto
eslint                 158 file, 0 errori, 0 warning, 0 no-undef
accettazione browser  233/233   213 prima; +20 check, browser vero, box vero
accessibilità          26/26    invariata con il markup nuovo
MANIFEST             5719/5719  0 falliti, 0 duplicati (include MASTER_PROJECT/)
```

Sei difetti seminati uno alla volta, ognuno catturato da esattamente un test, file ripristinati
**byte-identici** dopo ogni giro.

## ➜ Due errori di misura miei, corretti e registrati

1. **Un solo strumento scambiato per il tutto.** Il primo elenco di "cosa manca" era ricavato
   dalla sola matrice a 11 item e presentato come il progetto intero. Ora `REMAINING_WORK.md`
   tiene separati i tre livelli.
2. **Cercare identificatori invece dello schema.** Quattro componenti riportati come "0 file"
   grepando nomi come `SecretBroker`, che questo codice non usa. Riverificato: Secret Broker e
   Resource Governor sono **parziali**; il Model Trust Registry è **peggio che assente** —
   `model_descriptors.trust_state` esiste con i quattro stati giusti e **nessun codice lo legge
   o lo scrive**. **Schema morto**: una colonna che nessuno usa dice al prossimo che la funzione
   c'è. È la stessa categoria che la riscrittura aveva già documentato a luglio.

## ➜ Blocker aperti

`B-001` nessun remote GitHub · `B-002` secret scan euristico (`detect-secrets` restituisce 0
finding su una chiave AWS letterale) · `B-008` due store di identità.

## ➜ I rischi che il cambio di progetto si porta dietro

1. **Nessun toolchain Rust sull'host** e la regola 45 vieta di installarlo. La fase 1 è Rust
   dalla prima riga: si costruisce in container `rust:1-bookworm` effimeri.
2. **La fase 1 è quattro sottosistemi a zero file**, in un linguaggio dove il prodotto ha
   ~1.100 righe contro ~24.500 di JavaScript.
3. **Il supervisore a tre figli tocca l'avvio dell'installazione viva** — va fatto blue/green
   con rollback preservato, come il deploy di oggi.
4. **La riscrittura non ha apparato di accettazione**: zero matrici con ID e severità, zero
   tracciabilità. Il V4 li aveva e non sono più nell'albero. Vanno ricostruiti dentro la
   riscrittura, o si perde il modo controllabile di dire "fatto".
5. **La parte legale, licenze, conformità e confini d'uso** che la riscrittura dichiara di
   conservare è conservata **per decisione, non per contenuto**: era nei documenti V4 `50-57`,
   `60-66`, `70-77`, `09_LEGAL_TEMPLATES`. La fase 7 ne avrà bisogno.
6. **Nessuno dei due progetti ha avuto una revisione indipendente.**

## ➜ Rollback

```text
container    noesar-evolution.rollback-webui-20260726T155330Z     immagine :phase4-webui
runtime      BACKUPS/runtime_pre_wp2_deploy_20260726T155330Z/     copia completa 75 MB,
                                                                  presa a servizio fermo
progetto V4  git c28d8a2 · archivi sigillati ·
             EVIDENCE/v4_removal_recovery_20260726T163433Z.txt
```

Per tornare indietro sull'installazione: `docker stop -t 60 noesar-evolution`, rinominarlo da
parte, poi `docker start noesar-evolution.rollback-webui-20260726T155330Z`. **Se nel frattempo
la build attuale ha scritto** `state/ai-workspace.json` — controlla se legge ancora
`"schemaVersion": 1` — serve anche ripristinarlo dal backup, o `:phase4-webui` rifiuterà di
caricare il workspace AI.

## ➜ Igiene

Due container sopravvivono alla fase, ed è quello che esiste: l'installazione e un solo
rollback. Il rollback più vecchio è stato rimosso (solo il container; l'immagine
`:phase4-complete-lan` resta su disco). Reti e volumi diffati contro
`EVIDENCE/docker_inventory_pre_cleanup_20260726T155449Z.txt`: invariati. Container non-progetto
37 prima e 37 dopo. `noesar-debuglab` avviato per la caccia e **rifermato nella stessa fase**.
Nessun `prune`, in nessuna forma.
