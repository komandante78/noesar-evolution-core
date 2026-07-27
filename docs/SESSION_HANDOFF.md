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
nuova decisione dell'Owner** — e se mai lo si facesse, va reintrodotta **già emendata** (`D-0169`).

## ➜ Leggi in quest'ordine

1. `PROJECT_STATE.json` e questo file
2. **`docs/WEBUI_DESIGN_V3.md`** — il progetto dell'interfaccia, completo e autorizzato, **più
   `§22-36`, che dicono cosa di esso è ora costruito.** Criteri `UI-001…UI-096`
3. `MASTER_PROJECT/07_INTERFACCIA.md` — il riferimento normativo dell'interfaccia
4. `MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` (matrice `CE-001…CE-024`) ·
   `MASTER_PROJECT/09_PIANO.md` §1 e §3 · `docs/WORK_PLAN_V5_REWRITE.md`
5. `docs/DECISION_LOG.md` (ultime: **`D-0169…D-0171`**), `docs/INSTALLATION_LEDGER.md`

---

## ➜ LA PROSSIMA AZIONE

> **Il debito aperto è stato ripagato. Non resta lavoro arretrato da recuperare.**

Questa fase non ha costruito una superficie nuova: ha **chiuso ciò che era stato lasciato
indietro**, su istruzione esplicita dell'Owner (*"prima ripara i problemi, non lasciare nulla
indietro"*). `B-010` è riparato **e installato**; il punto 6 della fase 0 è **fatto**; tre
controlli che nessuno eseguiva sono riparati e cablati.

Restano aperte tre cose, in ordine di dipendenza. **Nessuna è iniziata.**

**(a) Fase 0, punto 5** — traduzione canonica in inglese di `MASTER_PROJECT/` (regola 49).
Dipende dal punto **4**, le domande dell'Owner sui contenuti, che risulta ancora *in attesa*:
tradurre prima significa tradurre due volte. **Il punto 6 non è più aperto** — vedi `D-0169`.

**(b) Ciò che dell'interfaccia resta scoperto**, ora poco:

- la **superficie della Ricerca** (`UI-080…UI-089`), che richiede **prima** il suo gate
  (`UI-090…UI-096`, cinque criteri Critici): costruire la superficie per prima significherebbe
  consegnare una via d'uscita verso la rete senza nulla che la classifichi. **Da decidere prima di
  cominciarla:** il gate classifica *intento ed effetto richiesto* e non può essere una denylist
  testuale (`UI-090`), ma classificare senza `ReasoningProvider` significa costruirlo su qualcosa
  che il progetto non ha — è una domanda per l'Owner, non un dettaglio implementativo
- `UI-050` **lato shell** — ogni azione delle sessioni ha una forma da tastiera, il comando nel
  terminale no, perché il TUI è dichiarato-e-non-costruito. **`CE-020` resta non soddisfatto**
- **tre delle sei azioni d'ingresso** non possono agire finché non esiste l'esecutore, e **nove
  campi su dodici** della riga di stato del banco non hanno una fonte. Entrambe le superfici lo
  dichiarano a ogni giro invece di lasciarlo dedurre

**(c) La fase 1, la spina dorsale** — `ReasoningProvider`, capability token, esecuzione in ombra,
esecutore che accetta solo token, registro eventi, comprensione del repository. Rust dalla prima
riga, su un host senza toolchain Rust (esiste però l'immagine `rust:1-bookworm` in locale, quindi
la prima cosa da provare è che una build **offline** contro i crate già vendorizzati funzioni
davvero, prima di scrivere il contratto). **È il lavoro grande.** `D-0169` ne ha appena reso
esigibile il confine: Rust **dove decide e confina**, non ovunque.

**Regola in vigore** (`D-0143`, `CLAUDE10.md` §3a): **si costruisce, si installa e si verifica nella
stessa fase.** Le suite vanno lanciate con `NOESAR_E2E_BASE_IMAGE=noesar-evolution:phase4-healthz`.

---

## ➜ Cosa è stato fatto in questa sessione

### 1 · `B-010` — `/healthz` diceva tutto a tutta la sottorete (`D-0170`)

Rispondeva **200 senza sessione** e su questo bind LAN era leggibile da ogni host della rete:
versione esatta del prodotto, postura di autorità, versioni di PostgreSQL e pgvector, inventario
dei componenti, canale di aggiornamento, scope di debug attivi.

La fase precedente lo aveva **registrato e lasciato**, motivando che la riparazione tocca tre
installer e il polling dell'update manager. **Li tocca; non li rompe** — e nessuno era andato a
leggere *cosa* quei consumatori leggono davvero. Sono **tre cose**: `status`, `local`, il codice
HTTP. Nessuno legge il dettaglio. Di più: il **healthcheck del container interroga `/livez`**, non
`/healthz`, cosa emersa **rileggendo la configurazione del container** durante il deploy.

Quindi la rotta è **spaccata**, non autenticata — un `401` lì si legge come servizio morto:

- **aperto a chiunque**: `status`, `local`, `checkedAt`, e il codice HTTP, che resta calcolato
  dalla salute **piena**, così un'installazione malata risponde `503` a una sonda a cui non si
  dirà perché
- **dietro il cancello**: tutto il resto, e un corpo ridotto **dichiara di esserlo** col ruolo e il
  permesso che servirebbero — vuoto e vietato si somigliano, e solo uno dei due è un fatto

**Il dettaglio che decide la correttezza del fix:** il cancello è **ruolo Owner *e* `audit.read`**,
non `audit.read` da solo. `admin` porta `audit.read`, quindi un test sul solo permesso avrebbe
consegnato agli admin esattamente ciò che la schermata iniziale nega loro — costruendo la
scorciatoia attorno al cancello **mentre si crede di chiuderne una**. La condizione ora è **una
sola**, `auth.mjs::mayReadHealthDetail`, pura ed esportata per essere verificabile senza avviare un
listener; `/api/v1/home` usa quella invece della propria copia.

Stessa forma per la scoperta: **una** regola di esposizione con due viste nominate. Il secondo
endpoint che ne aveva bisogno è rimasto scoperto per quattro fasi **perché non la aveva affatto**.

### 2 · Punto 6 della fase 0 — l'atto di governo (`D-0169`)

`GAP-F`: il registro diceva **Approvato** su due voci che il prodotto non rispetta, e **nulla
registrava quale dei due dovesse muoversi**. Non era la scelta a essere sbagliata: era il silenzio.
`V4-D001` e `V4-D002` sono ora **emendati** — Rust obbligatorio **dove decide e confina**, WebUI in
JavaScript semplice. L'emendamento **non allenta** `V4-D001`: lo **restringe a dove è vero**, e lo
rende esigibile.

`apps/webui-react` **non è stata rimossa**: `03_ARCHITETTURA` §6 lo chiede, ma la regola 12 vieta la
cancellazione e l'unico precedente passò da un **emendamento esplicito dell'Owner**. Il suo `README`
è stato invece corretto — annunciava un lavoro che non si farà, e una directory che mente è peggio
di una vuota. **La rimozione resta aperta e richiede una parola dell'Owner.**

### 3 · Tre controlli esistevano, funzionavano, e non li eseguiva nessuno (`D-0171`)

Trovati **inseguendo un fallimento**, non da uno scanner — nessuno dei tre è visibile a semgrep.

1. **`tools/http-smoke.mjs` era in crash da fasi.** Affermava che `/api/v1/privacy` e
   `/api/v1/bootstrap` rispondono a un anonimo; entrambi sono stati **correttamente** messi dietro
   autenticazione più tardi. **Non lo eseguiva nulla.** Il suo gemello fu rotto dalla stessa classe
   di cambiamento e riparato quando accadde; questo fu **mancato da quella stessa passata**.
2. **`tools/test-packaging-filters.mjs`** — il test di regressione che `.gitignore` **cita per
   nome** — non era invocato da nessun runner.
3. **`.workspace/` non era ignorata da git.** È il workspace di default: avviare il servizio dalla
   radice del repository vi materializza stato, ledger, log e due chiavi. Chiavi e log erano già
   coperti da `*.key`/`*.log`; **lo stato no**, ed era a un `git add -A` dall'essere committato.
   **Storia git verificata pulita.** Ignorata **ancorata alla radice**, con controllo negativo.

**Corretta la regola, non l'istanza:** entrambi gli strumenti sono ora step di `scripts/test.sh`, e
`test.sh` ha imparato lo stato che gli mancava — `PARTIAL`, contato a parte e **mai** come passato,
perché un rosso atteso è un rosso che si impara a saltare. Applicato **solo** agli strumenti che
dichiarano quella convenzione. Più un difetto in `test.sh` stesso (`SC2164`): `cd "$ROOT"` non era
guardato, e il file **non usa `set -e`** di proposito — quindi ogni step sarebbe girato contro la
directory sbagliata. Togliere `set -e` chiuse un fallimento silenzioso e ne aprì un altro.

## ➜ Verifiche prodotte in sessione

```text
unit                       745/745   0 falliti · 64 suite        (erano 734)
accettazione in browser    315/315   0 falliti · browser reale    (erano 312)
accessibilita WCAG 2.2      27/27    0 falliti · 729 controlli    (invariata: nessun markup toccato)
eslint                     170 file · 0 errori · 0 warning · 0 no-undef
MANIFEST                  5738/5738  0 falliti · 0 duplicati · 0 righe vuote
scripts/test.sh            pass=4 fail=0 partial=1 unavailable=4   (tutti dichiarati)
packaging filters          17/17 casi (filtro python NON verificato: manca python3)
```

**Entrambe le metà del fix viste FALLIRE prima di essere credute**: reintrodurre la divulgazione
incondizionata fa fallire il test di comportamento LAN; reintrodurre il cancello sul solo permesso
fa fallire il test sull'admin **e solo quello**.

**Caccia con gli strumenti reali** (`noesar-debuglab`, avviato e **rifermato nella stessa fase**):
`services/…/src` **0** · `test/` **0** · `scripts/` **0** · `oci/` **0** · `ai-workspace/` **0** ·
`apps/webui-static` **1** (l'`Object.assign` su un `Error` appena costruito, riletto sulla riga e
scartato: nessun oggetto di risposta, nessun redirect) · `tools/` **12** e `capabilities/` **45**,
tutti in file **Python non toccati da questa fase** e non eseguibili qui, nelle classi già
triagiate (`B603`/`B607`/`S603`/`S607` subprocess con argv letterale, `F401` deferral registrato in
`D-0039`, e un `B105` su una canary di test **letteralmente chiamata `must-not-leak`**).
Shellcheck: `SC2164` **riparato**; restano 2 `SC1007` sull'idioma corretto `CDPATH= cd`.

**Non eseguito, dichiarato:** nessuno screen reader reale · `forced-colors` non emulabile su questo
Chromium · i quattro passi Python di `scripts/test.sh` e il filtro python del packaging test
(`python3` assente, regola 45) · i comandi TUI di `UI-050`, che non esistono · i `.ps1` degli
installer, non eseguibili qui.

## ➜ L'installazione — SOSTITUITA E VERIFICATA

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-healthz
bind        192.168.178.100:8100 -> 8088   (LAN, NON loopback — vedi nota)
endpoint    livez 200 · readyz 200 · metrics 401 · home 401 · diagnostics 401
            rotta inesistente 404 → i 401 sono cancelli veri, non un catch-all
/healthz    200 SENZA sessione, e il corpo non contiene piu nessuno dei sette marcatori
            (versione · reference-node · postgresql · pgvector · releaseChannel · components · 18.4)
contratto   status=healthy AND local=true → Test-Noesar.ps1 e verify-runtime.sh passano ancora
sorgente    i quattro file del control plane nell'immagine byte IDENTICI al repository
interfaccia app.js · index.html · styles.css · schedule.js byte IDENTICI al repository
igiene      due soli container noesar-evolution* · reti e volumi IDENTICI all'inventario
            37 container non del progetto prima e dopo · nessun prune
```

**Nota verificata di nuovo qui:** l'installazione **non** ascolta su `127.0.0.1`. Un controllo di
salute contro il loopback restituisce `000` e sembra un servizio morto mentre il servizio è sano.
Usare l'indirizzo di bind reale, che si ricava con `docker port noesar-evolution`.

**Cosa NON è stato verificato dal vivo, e va detto.** Il *comportamento* dell'interfaccia non è
esercitato su questa installazione (§3a `11e`): le suite creano un Owner e mutano dati, quindi
girano contro una sonda usa-e-getta. Dal vivo è provato che i byte serviti sono identici all'albero
che quelle suite hanno esercitato, che il servizio è sano, che la ridazione è **realmente attiva su
questo bind**, e che il contratto dei consumatori regge.

## ➜ Rollback — nessun costo nuovo, ma reintroduce la divulgazione

`AI_STATE_VERSION` **non si muove**: resta 3. Nessun record cambia forma — la riparazione è
interamente nel modo in cui una risposta viene composta. **Tornare indietro riapre `B-010`.**

```text
docker stop -t 60 noesar-evolution && docker rename noesar-evolution <da-parte>
docker start noesar-evolution.rollback-home-20260727T130604Z
```

Finché `state/ai-workspace.json` legge `1` — verificato in chiusura — restano aperti anche i
percorsi più vecchi. Per tornare indietro sul **sorgente**:
`BACKUPS/healthz_disclosure_20260727T123850Z/` e `BACKUPS/governance_amendment_20260727T125353Z/`.
Backup runtime a servizio fermo: `BACKUPS/runtime_pre_healthz_deploy_20260727T130604Z/` (75 MB).

## ➜ Blocker aperti

`B-001` nessun remote GitHub (nessun commit è mai stato pushato) · `B-002` secret scan euristico
(`detect-secrets` restituisce 0 finding su una chiave AWS letterale) · `B-008` due store di
identità. **`B-010` è CHIUSO.** Nessuno dei tre restanti è riparabile su questo host: i primi due
richiederebbero di installare strumenti (regola 45), il terzo è una migrazione su dati vivi che
merita una fase propria e una decisione dell'Owner sul modello d'identità di destinazione.

**Aperto e non risolvibile qui:** la **conformità** della conservazione dei dati delle richieste
rifiutate. L'Owner ha autorizzato il **disegno** (`D-0136`); la verifica rispetto agli obblighi
applicabili non è accertabile su questo host.

**Aperto e non pianificato:** la **voce** (`D-0123`) e i **pannelli staccabili** su secondo monitor
(`07` §5). **Aperto e in attesa dell'Owner:** la rimozione di `apps/webui-react` (`D-0169`).

**Osservazione registrata e non riparata:** il browser **scarta** l'intestazione
`Cross-Origin-Opener-Policy` che il server invia, perché si è serviti in HTTP semplice su un nome
che non è `localhost`. Vale anche per l'installazione viva in LAN. Richiede TLS — decisione di host
e di fase d'installazione.

**Nessuna deviazione da dichiarare in questa fase.** `docker exec` non è stato usato: la
configurazione del container è stata riletta con `docker inspect`, che non entra nel container, e il
confronto fra immagine e albero è stato fatto con `docker create` + `docker cp` su un
container-sonda rimosso nello stesso passo.
