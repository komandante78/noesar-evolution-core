# NOESAR EVOLUTION — Session Handoff

**Riscritto alla fine di ogni fase. Una sessione fredda deve poter ripartire da questo file e
da `PROJECT_STATE.json` soltanto.**

---

## 🛑 REGOLA ZERO — un solo progetto esiste

**Ordine esplicito dell'Owner, 2026-07-26.** Lavorando qui, l'unico progetto che esiste è
**NOESAR EVOLUTION**. Nessun altro sistema di questo host si nomina, si cita, si confronta o si
tocca — non come riferimento, non come esempio, nemmeno "solo per contesto". Scritta in
`CLAUDE10.md` §1 e in cima alla skill, perché veniva letta e poi aggirata.

**CodeN Evolution è un prodotto nuovo** e non eredita nome, codice, architettura o convenzioni da
nessun altro.

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
2. **`docs/WEBUI_DESIGN_V3.md`** — il progetto dell'interfaccia, completo e autorizzato, **più
   `§22-24`, che dicono cosa di esso è ora costruito.** §1-9 la v3 · §10-17 la v4 · §18-21 la v5
   (destinazione Ricerca e il suo gate) · **§22-24 la struttura costruita**. Criteri
   `UI-001…UI-096`
3. `MASTER_PROJECT/07_INTERFACCIA.md` — il riferimento normativo dell'interfaccia
4. `MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` (matrice `CE-001…CE-024`) ·
   `MASTER_PROJECT/09_PIANO.md` §1 e §3 · `docs/WORK_PLAN_V5_REWRITE.md`
5. `docs/DECISION_LOG.md` (ultime: **`D-0137…D-0142`**), `docs/INSTALLATION_LEDGER.md`

---

## ➜ LA PROSSIMA AZIONE

> **Grafica, passo 2: il LAYER DI TOKEN.**

L'ordine dentro la grafica è vincolato (`D-0118`) e **il passo 1 è fatto**: struttura, 23 → 12
destinazioni. Restano il passo 2 e il passo 3, in quest'ordine:

2. **Layer di token** — oggi non esiste: i colori sono letterali sparsi in ~24 KB di
   `apps/webui-static/styles.css`. **Senza questo passo i nove temi e il selettore libero non sono
   implementabili**, ed è esattamente il motivo per cui la sezione *Impostazioni → Aspetto* è
   dichiarata e non costruita.
3. **Palette e temi** — nove temi come rimappature di token, tema chiaro e alto contrasto,
   selettore di colore libero con contrasto **misurato mentre si sceglie** e variante testuale
   derivata (`UI-020…UI-026`).

**Tre cose da sapere prima di cominciare.**

- **I contrasti di `WEBUI_DESIGN_V3.md` §5 sono ancora calcolati, mai misurati.** Il passo 3 li
  deve far passare da `tools/accessibility-audit.mjs`, che ora gira su **venticinque** superfici.
- **`npm run test:accessibility` e `tools/run-browser-e2e.sh` vanno lanciati con
  `NOESAR_E2E_BASE_IMAGE=noesar-evolution:phase4-wp2`.** Il default dello script punta a
  un'immagine più vecchia; entrambi creano e **rimuovono da soli** sonda, runner e overlay.
- **Non iniziare la fase 1.** Della fase 0 restano aperti i punti 5 e 6 — traduzione canonica in
  inglese e emendamenti a `V4-D001` / `V4-D002`.

---

## ➜ Cosa è stato fatto in questa sessione

**Il passo 1 della grafica, sul codice.** Prima riga di prodotto toccata dopo la progettazione:
tre file dell'interfaccia, due suite di verifica, una guardia di struttura.

### 1 · Ventitré destinazioni diventano dodici, e niente si perde

I tredici blocchi di pagina demossi sono stati **spostati verbatim** da uno script che estrae e
riassembla (`D-0137`): `#view-users`, `#view-logs`, `#view-providers` e gli altri esistono ancora
con i loro id, dentro l'unica pagina Impostazioni, che ora ha **menu dentro il menu** — tre gruppi,
tredici sezioni, indirizzabili come `#/settings/<sezione>`. *Compiti* è entrato in Home,
*Strumenti* in CodeN Evolution, *Memoria* in Conoscenza.

**Ogni indirizzo che rispondeva risponde ancora** (`D-0138`): `#/logs` inoltra a
`#/settings/health`, e la barra dell'indirizzo viene riscritta, perché un inoltro invisibile non è
verificabile. **I gate di ruolo sono scesi di livello con le pagine che proteggono** (`D-0139`):
erano rotte protette, ora sono sezioni protette, e le voci di menu non consentite sono rimosse.

### 2 · Due destinazioni sono dichiarate e non costruite, e lo dicono

*CodeN Evolution TUI* e *Ricerca* stanno nella barra con l'etichetta **not built** e una pagina che
dice cosa manca (`D-0141`). Nasconderle per far tornare il conto sarebbe stato mentire sul numero.

**La Ricerca non ha alcun campo che possa emettere una query** (`D-0142`), ed è deliberato: il gate
`UI-090…UI-096` viene **prima** della superficie. Costruire prima la superficie significherebbe
consegnare una via d'uscita verso la rete senza nulla che la classifichi.

### 3 · Quattro difetti trovati, tutti eseguendo — e due erano miei

1. **Mio, serio.** Una sezione che l'account non può aprire **faceva comunque partire il suo
   loader**: quattro richieste `403` (`/logs`, `/debug/status`, `/watchdog`, `/database/status`)
   emesse per una pagina che la persona si stava vedendo rifiutare. Il gate era applicato sullo
   schermo e abbandonato sul filo. L'ha trovato la suite in browser; riparato alla causa.
2. **Mio.** La guardia «ogni sezione sta dentro Impostazioni» che avevo **appena scritto**
   confrontava la **posizione nel file**, non l'annidamento: una sezione spostata fuori ma lasciata
   fra `#view-settings` e `#view-not-found` passava. Scoperto **seminando quel difetto** e vedendo
   la guardia restare verde. Ora cammina la profondità dei tag.
3. **Preesistente.** `.nav span{display:none}` sotto gli 850px toglieva l'etichetta anche
   dall'**albero di accessibilità**: su schermo stretto ogni voce era annunciata come un glifo
   nudo. Sostituita con il ritaglio, che nasconde senza togliere il nome.
4. **Mia misura sbagliata.** Il giro delle rotte misurava il testo dell'intera pagina Impostazioni,
   comprese le dodici sezioni nascoste: il «Loading…» di una sezione che nessuno guarda faceva
   fallire una pagina che aveva finito.

### 4 · Le guardie sono state provate, non date per buone

Quattro difetti **seminati** — una destinazione tolta dalla barra, una pagina demossa cancellata
invece che spostata, un vecchio indirizzo lasciato senza inoltro, una sezione fatta uscire da
Impostazioni. **Al primo giro due non furono catturati**: uno perché il seme non aveva mutato
nulla, l'altro perché la guardia era debole. Dopo la correzione **4 su 4**, ognuno catturato da
esattamente una guardia, e ogni file ripristinato **byte-identico**.

## ➜ Verifiche prodotte in sessione

```text
unit                     635/635   0 falliti · 44 suite       (erano 631)
guardia di struttura      17/17    0 falliti                  (erano 13)
accettazione in browser  265/265   0 falliti · browser reale   (erano 233)
accessibilita WCAG 2.2    26/26    0 falliti · 25 superfici    (erano 26 su 23 rotte)
eslint                   158 file · 0 errori · 0 warning · 0 no-undef
MANIFEST                5721/5721  0 falliti
difetti seminati           4/4     ognuno catturato da esattamente una guardia
```

**La copertura è cresciuta, non calata.** L'audit misura ora **venticinque** superfici — dodici
destinazioni più le tredici sezioni — con 630 controlli di focus e 944 misure di contrasto.
Auditare le sole destinazioni avrebbe fatto sparire tredici superfici dalla misura lasciando il
numero `26/26` identico: è così che una ristrutturazione trasforma un audit verde in un audit più
piccolo.

**Non eseguito, dichiarato:** nessuno screen reader reale (l'audit stampa il proprio blocco
`NOT_TESTED` a ogni giro) · `forced-colors` non emulabile su questo Chromium · i quattro passi
Python di `scripts/test.sh` (`python3` assente, regola 45).

**Osservazione registrata e non riparata:** il browser **scarta** l'intestazione
`Cross-Origin-Opener-Policy` che il server invia, perché si è serviti in HTTP semplice su un nome
che non è `localhost`. Vale anche per l'installazione viva in LAN. Richiede TLS — decisione di host
e di fase d'installazione.

## ➜ L'installazione — intoccata

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-wp2
bind        192.168.178.100:8100 -> 8088   (LAN, NON loopback — vedi nota)
endpoint    livez 200 · readyz 200 · metrics 401 (hardening LAN intatto)
igiene      nessun container di prodotto creato, avviato o fermato
            reti e volumi invariati · inventario in EVIDENCE/
            due soli container noesar-evolution* a fine fase, come impone §5a
            noesar-debuglab avviato per la caccia e RIFERMATO nella stessa fase
```

**Nota verificata di nuovo qui:** l'installazione **non** ascolta su `127.0.0.1`. Un controllo di
salute contro il loopback restituisce `000` e sembra un servizio morto mentre il servizio è sano.
Usare l'indirizzo di bind reale, che si ricava con `docker port noesar-evolution`.

**La struttura a dodici destinazioni esiste SOLO nel sorgente.** Il box vivo serve ancora
l'interfaccia a ventitré. Il deploy è una fase di installazione e **richiede autorizzazione
esplicita dell'Owner**; prima va letta la nota sul costo di rollback dello schema (`D-0082`).

## ➜ Blocker aperti

`B-001` nessun remote GitHub (nessun commit è mai stato pushato) · `B-002` secret scan euristico
(`detect-secrets` restituisce 0 finding su una chiave AWS letterale) · `B-008` due store di
identità.

**Aperto e non risolvibile qui:** la **conformità** della conservazione dei dati delle richieste
rifiutate. L'Owner ha autorizzato il **disegno** (`D-0136`); la verifica rispetto agli obblighi
applicabili non è stata fatta e non è accertabile su questo host.

**Aperto e non pianificato:** la **voce** (`D-0123`) e i **pannelli staccabili** su secondo monitor
(`07` §5).

**Non toccato dal passo 1, e da non confondere con «fatto»:** il **banco di lavoro**
(`UI-030…UI-037`), la **casella `NON FATTO`** (`UI-036`, Critica), la **metrica del prodotto**
(`UI-070…UI-072`), la **gestione delle sessioni** (`UI-001…UI-012`) e le otto voci di accessibilità
`UI-040…UI-047` che non sono strutturali.

## ➜ Rollback

```text
container    noesar-evolution.rollback-webui-20260726T155330Z     immagine :phase4-webui
runtime      BACKUPS/runtime_pre_wp2_deploy_20260726T155330Z/     copia completa 75 MB
questa       BACKUPS/webui_struttura_20260727T082357Z/            i 5 file dell'interfaccia,
sessione                                                          le 2 suite e il MANIFEST,
                                                                  copiati prima di ogni modifica
```

Per tornare indietro sul **sorgente** di questa fase basta ricopiare da quella cartella: nessuna
migrazione, nessuno schema, nulla di installato. Per tornare indietro sull'**installazione**:
`docker stop -t 60 noesar-evolution`, rinominarlo da parte, poi
`docker start noesar-evolution.rollback-webui-20260726T155330Z`. **Se nel frattempo la build
attuale ha scritto** `state/ai-workspace.json` — controlla se legge ancora `"schemaVersion": 1` —
va ripristinato anche quello dal backup, o `:phase4-webui` rifiuterà di caricare il workspace AI.
