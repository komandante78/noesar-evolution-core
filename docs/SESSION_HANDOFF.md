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
   `§22-36`, che dicono cosa di esso è ora costruito.** §1-9 la v3 · §10-17 la v4 · §18-21 la v5
   (destinazione Ricerca e il suo gate) · §22-24 la struttura · §25-27 i token · §28-30 i nove
   temi · §31-33 le parti oltre la grafica · **§34-36 la schermata iniziale**. Criteri
   `UI-001…UI-096`
3. `MASTER_PROJECT/07_INTERFACCIA.md` — il riferimento normativo dell'interfaccia
4. `MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` (matrice `CE-001…CE-024`) ·
   `MASTER_PROJECT/09_PIANO.md` §1 e §3 · `docs/WORK_PLAN_V5_REWRITE.md`
5. `docs/DECISION_LOG.md` (ultime: **`D-0161…D-0168`**), `docs/INSTALLATION_LEDGER.md`

---

## ➜ LA PROSSIMA AZIONE

> **L'interfaccia è ora quasi tutta costruita. Il motore non esiste ancora.**

Restano aperte tre cose, in ordine di dipendenza. **Nessuna è iniziata.**

**(a) Fase 0, punti 5 e 6** — traduzione canonica in inglese di `MASTER_PROJECT/` (regola 49) ed
emendamenti registrati a `V4-D001` / `V4-D002` (`GAP-F`: il prodotto e i documenti che lo governano
dicono cose diverse e nulla registra quale dei due debba muoversi). Il punto 5 dipende dal punto
**4** — le domande dell'Owner sui contenuti — che risulta ancora *in attesa*: tradurre prima
significa tradurre due volte. **Il punto 6 è un atto di governo, fattibile subito.**

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
davvero, prima di scrivere il contratto). **È il lavoro grande**, ed è quello che riempirebbe metà
delle caselle vuote di questa interfaccia.

**Regola in vigore** (`D-0143`, `CLAUDE10.md` §3a): **si costruisce, si installa e si verifica nella
stessa fase.** Le suite vanno lanciate con `NOESAR_E2E_BASE_IMAGE=noesar-evolution:phase4-home`.

---

## ➜ Cosa è stato fatto in questa sessione

**La schermata iniziale** (`UI-060…UI-063`), costruita, **installata e verificata
sull'installazione viva**. La Home offriva tre card di modalità e due liste; ora è la schermata
che il riferimento normativo descrive.

### 1 · Sei azioni d'ingresso, e tre dicono di non poter agire

Tre agiscono: riprendi l'ultima sessione, apri un progetto, comincia un progetto nuovo. Tre no —
clonare, importare un archivio, connettere un remoto **scrivono un albero di lavoro**, e nulla in
questo layer può scrivere su disco. Sono comunque **elencate**, ognuna dichiara cosa aspetta, e la
schermata dice **quante delle sei possono agire** invece di lasciarlo contare (`D-0161`).

Sono **`aria-disabled`, non `disabled`**: un pulsante disabilitato esce dall'ordine di tabulazione,
e questi esistono *per portare la frase che spiega cosa manca* — disabilitarli l'avrebbe nascosta
proprio a chi non vede lo stile attenuato.

### 2 · Dieci obiettivi che non spediscono niente

Formulati **come obiettivi** perché l'Intent Frame parte da un obiettivo: la formulazione *è* il
criterio. Vivono nel codice e non nel markup, così «dieci» è verificabile — una lista scritta a mano
nell'HTML è una lista di cui nessuno si accorge che è diventata nove. L'obiettivo finisce **nel
campo di scrittura**, con il fuoco, e **non parte niente**: una schermata che spedisce al primo
click decide al posto della persona cosa intendeva (`D-0162`).

### 3 · Il difetto vero della fase: un quadrante senza fuso

`<input type="datetime-local">` restituisce **un quadrante senza fuso**. L'interfaccia lo spediva
così com'era e il control plane lo risolveva con `new Date(value)`, che per una forma senza
scostamento significa «ora locale del processo che interpreta» — il container, che gira in UTC.
Una persona in `Europe/Rome` che chiedeva le 09:30 memorizzava le 09:30Z e si vedeva rimostrare le
11:30: **l'interfaccia contraddiceva la persona sull'ora che la persona aveva appena scritto**
(`D-0163`).

Ora il quadrante si risolve **nel browser**, contro il fuso efficace, e viaggia un **istante**. Il
modulo nuovo `apps/webui-static/schedule.js` è puro e provato senza browser, contro **otto vettori
calcolati a mano** dalle regole dei fusi — due dei quali a mezz'ora e a tre quarti d'ora
(`Australia/Lord_Howe`, `Pacific/Chatham`), perché un errore che vede solo ore intere passa ogni
test scritto in Europa. I due confini della doppia ora sono **misurati e scritti**, non assunti: la
prima stesura del commento affermava il **contrario** di quel che il caso di sovrapposizione fa
davvero.

**Il campo dichiara il fuso in cui viene letto**, perché altrimenti l'accordo resta invisibile alla
persona. **Nessun record è stato riscritto**: l'installazione non ha compiti (`tasks: 0`, letto
dalla copia di backup dello stato), e un valore memorizzato senza fuso non si recupera indovinando —
se ne comparisse uno, l'interfaccia lo **marca**.

### 4 · Attivi e programmati partizionano, e la regola è stampata sul pannello

Un compito elencato due volte è un compito contato due volte. La regola — finito in nessuno dei
due, una ricorrenza o un inizio futuro è programmato, `running` batte una regola — sta **sul
pannello**, perché un raggruppamento il cui criterio vive in un file sorgente non è controllabile da
chi lo guarda. La regola di ricorrenza è mostrata **alla lettera**: renderla come «ogni lunedì»
sarebbe inventare la lettura di una stringa che il prodotto non ha mai analizzato (`D-0164`).

### 5 · Salute, strumenti e modelli — al rango che il ruolo consente

La sezione che mostra la salute per esteso è **solo dell'Owner**, quindi mettere quei numeri su una
pagina che ogni ruolo raggiunge sarebbe stato costruire la scorciatoia attorno a quel cancello.
**Il server assembla la schermata** (`GET /api/v1/home`), e ogni blocco è costruito contro i permessi
di chi chiama: un Owner vede i componenti, chiunque altro la parola aggregata, il **numero** dei
componenti e la dichiarazione che il dettaglio esiste e a chi spetta. La modalità sicura raggiunge
**ogni** ruolo. Un blocco negato torna **negato con il permesso che servirebbe**, mai vuoto
(`D-0165`).

**Provenienza è da dove viene, non chi l'ha aggiunto** (`D-0166`): trasporto, endpoint, se quell'host
è su questa macchina — e tre valori, non due, perché «ignoto» è ciò che un record senza endpoint
onestamente è. Il registrante **non è sul record**: sta nel registro di audit, e la superficie lo
dice invece di inventarlo. **Lo stato di fiducia dei modelli NON si mostra**: `trust_state` esiste
nello schema e nessun codice lo scrive, quindi ogni riga leggerebbe la stessa costante.

### 6 · Difetti trovati — e i due più istruttivi sono nella misura

1. **Lo strumento di misura escludeva controlli raggiungibili** (`D-0167`). L'audit trattava
   `aria-disabled` come `disabled` e saltava entrambi, motivando che un controllo disabilitato «non
   è nell'ordine di tabulazione». Per `aria-disabled` **è falso**. Trovato perché il conteggio
   **non si è mosso** quando quattro pulsanti sono passati da una forma all'altra — possibile solo
   se lo strumento non sapeva distinguerli. Copertura **725 → 729** controlli, saltati **18 → 14**.
2. **Il mio oracolo era sbagliato, non il prodotto.** Il controllo del fuso confrontava con il fuso
   *del browser* della sonda (UTC) mentre l'interfaccia risolve contro il **fuso efficace** (lì
   UTC+9): un `09:30` correttamente risolto tornava `00:30Z` e il controllo lo chiamava difetto.
3. **Un `console.warn` con testo dell'utente in posizione di stringa di formato** — trovato da
   semgrep (`unsafe-formatstring`), vero, e riparato: un input contenente `%s` avrebbe consumato
   l'argomento successivo.
4. **Backtick dentro un commento che vive in un template literal**: il mio commento nell'audit ha
   troncato la stringa iniettata nella pagina. `node --check` l'ha preso subito.
5. **Un mio test verificava l'unicità *attraverso* il conteggio**, quindi un elemento rimosso
   produceva **due** obiezioni e nessuno dei due test parlava più di una cosa sola. Corretto il
   test, non il difetto seminato.
6. **Una riga vuota lasciata in mezzo al MANIFEST** dal mio script di aggiornamento, che toglieva le
   righe vuote in coda *dopo* aver aggiunto le nuove voci.

## ➜ Verifiche prodotte in sessione

```text
unit                       734/734   0 falliti · 50 suite        (erano 677)
guardia di struttura        35/35    0 falliti                   (erano 28)
accettazione in browser    312/312   0 falliti · browser reale    (erano 291)
accessibilita WCAG 2.2      27/27    0 falliti · 729 controlli    (erano 725 — D-0167)
eslint                     170 file · 0 errori · 0 warning · 0 no-undef
MANIFEST                  5738/5738  0 falliti · 0 duplicati
difetti seminati            19/19    ognuno catturato da esattamente una guardia
```

**Caccia con gli strumenti reali** (`noesar-debuglab`, avviato e **rifermato nella stessa fase**):
`services/…/src` **0 finding**, `test/` **0 finding**, `apps/webui-static` **due** — uno preesistente
(`Object.assign` su un `Error` appena costruito, scartato con la riga alla mano) e uno **mio**,
vero e riparato. `tools/` riporta gli stessi 12 finding di prima in due strumenti Python non toccati
da questa fase e non eseguibili su questo host (nessun `python3`).

**Non eseguito, dichiarato:** nessuno screen reader reale (l'audit stampa il proprio blocco
`NOT_TESTED` a ogni giro) · `forced-colors` non emulabile su questo Chromium · i quattro passi
Python di `scripts/test.sh` (`python3` assente, regola 45) · i comandi TUI di `UI-050`, che non
esistono.

## ➜ L'installazione — SOSTITUITA E VERIFICATA

```text
container   running · healthy · restarts=0 · noesar-evolution:phase4-home
bind        192.168.178.100:8100 -> 8088   (LAN, NON loopback — vedi nota)
endpoint    livez 200 · readyz 200
rotta nuova /api/v1/home → 401 senza sessione, contro 404 di una rotta inesistente
modulo nuovo /schedule.js → 200
interfaccia app.js · index.html · styles.css · schedule.js byte IDENTICI al repository
igiene      due soli container noesar-evolution* · reti e volumi invariati
            37 container non del progetto prima e dopo · nessun prune
```

**Nota verificata di nuovo qui:** l'installazione **non** ascolta su `127.0.0.1`. Un controllo di
salute contro il loopback restituisce `000` e sembra un servizio morto mentre il servizio è sano.
Usare l'indirizzo di bind reale, che si ricava con `docker port noesar-evolution`.

**Cosa NON è stato verificato dal vivo, e va detto.** Il *comportamento* dell'interfaccia non è
esercitato su questa installazione (§3a, `11e`): le suite creano un Owner, compiti e sessioni, quindi
girano contro una sonda usa-e-getta. Dal vivo è provato che i byte serviti sono **identici**
all'albero che quelle suite hanno esercitato, che il servizio è sano e che la rotta nuova esiste ed
è protetta.

## ➜ Rollback — questa volta NESSUN costo nuovo

`AI_STATE_VERSION` **non si muove**: resta 3. Nulla in questa fase aggiunge una collezione o un
campo a un record — la provenienza mostrata è **derivata** da ciò che i record già portano.

```text
docker stop -t 60 noesar-evolution && docker rename noesar-evolution <da-parte>
docker start noesar-evolution.rollback-parts-20260727T121125Z
```

Il costo dichiarato da `:phase4-parts` resta valido per conto suo — un'immagine **più vecchia** di
quella rifiuta un workspace scritto a versione 3 — e questa build non lo cambia. Finché
`state/ai-workspace.json` legge `1` (verificato in chiusura) anche quel percorso resta aperto,
altrimenti va ripristinato `state/` da `BACKUPS/runtime_pre_home_deploy_20260727T121114Z/` (75 MB,
preso a servizio fermo).

Per tornare indietro sul **sorgente**: `BACKUPS/home_screen_20260727T113422Z/`.

## ➜ Blocker aperti

`B-001` nessun remote GitHub (nessun commit è mai stato pushato) · `B-002` secret scan euristico
(`detect-secrets` restituisce 0 finding su una chiave AWS letterale) · `B-008` due store di
identità.

**Registrato e non riparato, con la ragione** (regola 40a): **`/healthz` risponde 200 senza
autenticazione** e su questo bind LAN è leggibile da tutta la sottorete — espone versione del
prodotto, postura di autorità, elenco dei componenti, canale di aggiornamento e scope di debug. È la
stessa classe che `/metrics` ha già chiuso con `allowsUnauthenticatedMetrics`, ma la riparazione
esce dallo scope di questa fase: `/healthz` è consumato dagli installer, dal polling di salute
dell'update manager e da procedure documentate su tre piattaforme, e i `.ps1` non sono eseguibili su
questo host (regola 45). **La schermata iniziale non lo usa**: legge la rotta autenticata
`/api/v1/home`, così la superficie nuova non allarga nulla.

**Aperto e non risolvibile qui:** la **conformità** della conservazione dei dati delle richieste
rifiutate. L'Owner ha autorizzato il **disegno** (`D-0136`); la verifica rispetto agli obblighi
applicabili non è stata fatta e non è accertabile su questo host.

**Aperto e non pianificato:** la **voce** (`D-0123`) e i **pannelli staccabili** su secondo monitor
(`07` §5).

**Osservazione registrata e non riparata:** il browser **scarta** l'intestazione
`Cross-Origin-Opener-Policy` che il server invia, perché si è serviti in HTTP semplice su un nome
che non è `localhost`. Vale anche per l'installazione viva in LAN. Richiede TLS — decisione di host
e di fase d'installazione.

**Deviazione mia, registrata (`D-0168`):** ho eseguito `docker exec noesar-evolution sh -c 'echo skip'`
mentre verificavo il fuso del container. Non ha letto né scritto nulla, ma §5 regola 16 non prevede
eccezioni di sola lettura per il container di prodotto. Il dato è stato poi ottenuto dalla copia di
backup dello stato, che sta dentro `PROJECT_ROOT`.
