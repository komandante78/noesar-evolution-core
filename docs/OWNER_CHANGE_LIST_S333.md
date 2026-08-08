# LISTA MODIFICHE OWNER — s333

**Aperta il 2026-08-07.** L'Owner detta, io registro. **Nessuna riga di codice viene scritta
finché l'Owner non autorizza esplicitamente.**

**Stato di partenza (misurato a inizio s333):** repo `6f09d06` = `origin/main`, immagine
`noesar-evolution:d0347-declared-gaps-closed`, 5/5 container healthy.
Contesto di cosa manca: `docs/COSA_MANCA.md`.

**Scope:** NOESAR EVOLUTION (ATOM EVOLUTION incluso, da repo separato). Debug Evolution è un
prodotto separato e non entra qui.

---

## 🛑 REGOLA DELL'OWNER — vale su TUTTA questa lista

> *«non devi vedere questo hardware. È un self-hosted, quindi può andare anche su hardware più
> grande, anche datacenter. Se ti dico di metterlo devi metterlo e basta, non cambiare il
> progetto sulle tue supposizioni»* — Owner, s333

**Cosa significa operativamente:**

1. **Questa macchina non è il metro del prodotto.** Che qui non esista un modello di
   trascrizione, che manchi `python3`, che il kernel non faccia swap accounting, che le voci del
   browser siano assenti: sono **fatti di questa installazione**, si registrano come tali, e
   **non riducono un requisito**.
2. **Un requisito dell'Owner non si riscala, non si rinvia e non si dichiara «prerequisito di
   un altro» di mia iniziativa.** Se manca un pezzo, il pezzo si costruisce o si rende
   configurabile — la risposta non è restringere la richiesta.
3. **I limiti misurati restano scritti**, perché servono a chi installa (dimensionamento,
   modelli da fornire, capacità richieste). Ma sono **note di esercizio**, non confini di
   progetto, e vanno scritti in quella forma.

*(Coerente con la regola permanente s290: NOESAR EVOLUTION è self-hosted per qualsiasi
PC/server/OS — mai progettare per l'hardware che si ha sotto mano.)*

---

## Punti

| # | Punto (parole dell'Owner) | Stato |
|---|---|---|
| **1** | «**1 solo comando per accedere su CodeN Evolution TUI**. Esempio: apro ssh e digito solo `coden_evolution` e si apre» | ✅ **chiuso e deployato** (`D-0348`) |
| **2** | Su `http://192.168.178.100:8100/#/coden`: «**allarga la chat** così non si capisce che è una chat; inoltre **i comandi `/` non so se funzionano**, non vedo cambiamenti e non si capisce» | ✅ **chiuso e deployato** (`D-0350`) |
| **3** | «**Controllare tutte le pagine della WebUI**, capire cosa fanno e come funzionano, ed eventualmente **migliorarle in modo avanzato** — come da nome *Evolution* — perché **mi sembrano tutte pagine statiche**. Inoltre vanno messi i **tasti `i` di informazione** che cliccando danno suggerimenti. **Tutto in inglese principale con traduzione multilingua**» | ✅ **chiuso e deployato** — `D-0352` (censimento + pagine vive), `D-0353` (tasti `i`), `D-0349` (lingua) |
| **4** | «**Controllare se tutto il sistema è in lingua inglese** e se **in tutte le pagine funziona la traduzione**». Precisazione: «**ho visto un mix** — quando clicco sulla traduzione **rimane in inglese o viceversa**, quindi va fatto un **controllo approfondito**» | ✅ **chiuso e deployato** (`D-0349`). Markup **793/793**; divario runtime **dichiarato e misurato**, non nascosto |
| **5** | «Avevo detto **alcune sessioni fa** che su `http://192.168.178.100:8100/#/models` **deve esserci un menu con i modelli**, e i **modelli scaricati e installati devono sempre visualizzarsi per primi**» | ✅ **chiuso e deployato** (`D-0351`) — era a verbale dalla s318 e non era mai stato implementato |
| **6** | «Nella **barra in alto** c'è il pulsante **Voice** che **non deve esserci**, va **spostato**, e va messo **sulla chat accanto alla barra del prompt**. E **ancora non funziona** — penso non ci siano **voci**, penso che **vada costruito da 0**» | registrato, non autorizzato |
| **7** | In chat (`#/chat`) deve esserci il **multimodale**: **trascino il file** e in base al tipo **lo elabora**, come fanno **claude.ai e ChatGPT**; **anche audio e video** devono essere elaborati e letti. I **documenti dei clienti o personali**, quando si inseriscono, **devono essere anonimizzati**; e se chiedo la **modifica del documento** posso **scegliere di riscriverlo con i dati che avevo nascosto prima** — esempio: **riscrivere una lettera, una mail, una fattura** | registrato, non autorizzato |

### Punto 1 — un solo comando

> **Parole dell'Owner:** *«per primo devi mettere 1 solo comando per accedere su CodeN
> Evolution TUI. Esempio: apro ssh e digito solo `coden_evolution` e si apre ok?»*

**Nota mia (interpretazione, da confermare quando l'Owner vuole — non blocca la registrazione):**
oggi la parola `coden_evolution` esiste ed è una parola sola (`D-0340`, s331; installatore
portabile `D-0344`, s332), ma la sequenza dichiarata in `docs/COSA_MANCA.md` §0.1 passo 4 è:
`attaching via …` → `Connected — protocol noesar-tui/1` → **chiede il codice di aggancio**.
Quindi restano **due gesti**: il comando e il codice. Leggo il punto 1 come *«dopo `ssh`, un
comando e sono dentro — niente altro da digitare»*, cioè il codice di aggancio deve sparire o
essere assolto dall'autenticazione già fatta dall'`ssh`. Da verificare dal vivo prima di
proporre come.

#### ✅ Fatto — `D-0348`, il terminale ricordato

**Come funziona adesso.** Il **primo** ingresso su una macchina chiede come prima (codice di
aggancio, oppure credenziali) e poi il terminale riceve un **gettone che si conserva da sé**, a
`0600`. Da lì in avanti `coden_evolution` apre la sessione **senza digitare nulla**.

**Perché il primo ingresso non si può togliere, e non è una scelta di comodo.** L'idea ovvia —
che sia il sistema operativo a dire chi chiama — era già stata **misurata impossibile** in
s330: un socket `0600` risponde *«questo uid può bussare»*, mai *«chi sei»*, e Node non espone
`SO_PEERCRED`. Quindi qualcosa va presentato, e l'unica cosa onesta è un segreto che la
macchina dell'operatore già possiede. È la forma di `ssh` e di `gh auth login`.

**Cosa il gettone NON è:** non porta permessi propri, apre la sessione **solo** dell'account che
l'ha iscritto, **non eredita l'elevazione** (un'azione sensibile chiede comunque il secondo
fattore), vive **90 giorni scorrevoli** (usato ogni giorno non scade mai, abbandonato muore da
solo) e si annulla da entrambe le parti con `coden_evolution --forget` — che uccide **sia** la
copia locale **sia** il gettone nel deposito.

**Due difetti veri trovati ESEGUENDO, non leggendo:**
1. l'immagine **non avrebbe spedito** il modulo nuovo — l'ha intercettato la guardia costruita
   dopo `D-0301`, prima che si costruisse alcunché;
2. il client **si piantava** quando lo stdin finiva: `LineReader` non gestiva la chiusura, e
   qualunque richiesta fatta dopo l'ultima riga aspettava **per sempre**, in silenzio. Un umano
   al terminale non lo vede mai (lo stdin di un terminale non finisce) — lo vedono solo le
   sessioni con lo stdin in pipe, cioè **tutti i banchi di prova**. Preesistente, riparato qui.

**Provato eseguendo il gesto:** `tools/acceptance/ce-037-one-word.mjs` — **15 controlli, 0
fallimenti** — avvia il prodotto dai sorgenti e guida **l'avviatore vero** cinque volte: entra e
viene ricordato, apre con **nulla digitato**, `--forget`, torna a chiedere, e il gettone
dimenticato non apre più nemmeno se ne sopravvive una copia.

**Verifiche:** unit **2073** (0 fail), ESLint 0/0, e2e browser **413/413**.

---

### Punto 2 — la chat su `#/coden`, e i comandi `/`

> **Parole dell'Owner:** *«`http://192.168.178.100:8100/#/coden` allarga la chat così non si
> capisce che è una chat; inoltre i comandi `/` non so se funzionano, non vedo cambiamenti e
> non si capisce»*

**Nota mia (scomposizione, marcata come mia — le parole sopra restano quelle dell'Owner):**
ci sono **due lamentele distinte**, e la seconda ne contiene due.

- **2a — ⚠️ LA MIA PRIMA LETTURA ERA SBAGLIATA, corretta dall'Owner.**
  Avevo registrato: *«la chat è larga quanto la pagina e perde la forma di conversazione»*,
  cioè letto la frase come una **lamentela** e dedotto che andasse **ristretta**. Chiesto
  esplicitamente all'Owner, la risposta è l'**opposto**: *«allargala ANCORA: deve sembrare un
  terminale»*. La frase italiana regge entrambe le letture — «allarga … così non si capisce che
  è una chat» è un **imperativo**, non una descrizione — e le due producono lavoro contrario.
  La lettura giusta **conferma ed estende** s328 (`D-0336`), non lo annulla.
  **Regola che ne esce:** quando una frase dell'Owner ha due letture che portano a lavori
  opposti, si **chiede**. Costruire sulla lettura sbagliata qui avrebbe distrutto `D-0336`,
  che era stato chiesto dall'Owner con le parole *«non sembra neanche una chat»*.
- **2b — i comandi `/` non si capisce se funzionano.** *«Non vedo cambiamenti»* qui è
  **diverso** da s316 e s329 (là era un deploy mancante; oggi i tre livelli sono allineati,
  `6f09d06`): quindi è **assenza di riscontro visibile**, non codice non deployato. Da capire
  se il `/` progressivo di `D-0335` (s328) sia raggiungibile da `#/coden` o solo dalla shell
  terminale, e se batta un riscontro quando si esegue.

**⚠️ Da NON assumere:** che sia solo CSS. Il precedente misurato in s328 è che una voce del
menu poteva non avere **alcun indirizzo** (`Strumenti` era irraggiungibile dal terminale pur
avendo bottone e sezione). Prima di ridisegnare, misurare se il `/` su `#/coden` **instrada**.

---

### Punto 3 — tutte le pagine della WebUI: capirle, renderle vive, spiegarle, tradurle

> **Parole dell'Owner:** *«devi controllare tutte le pagine della webui capire cosa fanno come
> funzionano ed eventualmente migliorarle in modo avanzata nel senso come da nome evolution,
> perche mi sembrano tutte pagine statiche. Inoltre vanno messo i tasti `i` di informazione che
> cliccando ci sono suggerimenti (tutto in inglese principale con traduzione multi lingua)»*

**Nota mia (scomposizione, marcata come mia):** questo punto contiene **quattro lavori di
natura diversa**, e conviene tenerli distinti perché uno è misura e tre sono costruzione.

- **3a — censimento.** Aprire **ogni** pagina/pannello, dichiarare cosa fa, con quale rotta
  parla, e se ha uno stato vivo o disegna e basta. È **misura, non codice**: produce una
  tabella. È anche il prerequisito onesto di 3b — senza, «migliorare» è indovinare.
- **3b — «non sono statiche».** Dove una pagina mostra un valore fermo che dovrebbe respirare
  (stato reale, aggiornamento, azione che produce un effetto visibile), renderla viva. Il
  criterio dell'Owner è *«come da nome Evolution»*.
- **3c — i tasti `i`.** Su ogni superficie, un bottone informazione che al click spiega cosa
  fa quella cosa e cosa conviene farci. È **contenuto** oltre che UI: qualcuno deve scrivere i
  testi, e devono essere veri.
- **3d — lingua.** **Inglese come lingua principale**, più **traduzione multilingua**. Questo
  **non è decorazione**: è infrastruttura (catalogo di stringhe, selettore, fallback) e tocca
  ogni testo del prodotto, compresi quelli di 3c. Va deciso **prima** di scrivere i testi di
  3c, altrimenti si scrivono due volte.

**⚠️ Trappola annunciata:** 3a è la parte che rende il resto onesto, ed è anche quella che
qualcuno sarebbe tentato di saltare. La regola di questo progetto (s319) è: **i documenti
canonici si leggono prima di scrivere codice** — qui l'equivalente è che le pagine si misurano
prima di dichiararle statiche. «Mi sembrano statiche» è un'impressione legittima dell'Owner e
va verificata voce per voce: alcune potrebbero essere vive e non dirlo, che è **lo stesso
difetto visto da un altro lato**.

---

### Punto 4 — il sistema è davvero in inglese? la traduzione funziona davvero?

> **Parole dell'Owner:** *«controllare se tutto il sistema è in lingua inglese e se in tutte le
> pagine funziona la traduzione»*

**Nota mia:** questo punto è **la metà di verifica di 3d** ed è utile tenerlo separato, perché
si può eseguire **subito** (è misura) mentre 3d è costruzione.

**Misurato ora, prima di scrivere questa voce** (non ricordato — `apps/webui-static/`):

| Fatto | Misura |
|---|---|
| Un meccanismo di traduzione **esiste** | `apps/webui-static/i18n.js`, **17 righe**, importato da `app.js` (`import { initI18n, applyTranslations }`) — quindi **non è codice morto** |
| Lingue | **due**: `en` (dizionario **vuoto** = testo sorgente) e `it`. `dictionaries={en:{},it:IT}` |
| Voci tradotte | **~120 stringhe**, tutte in una costante `IT` scritta a mano |
| Come traduce | cammina i nodi di testo del DOM e fa **match esatto sulla stringa** (`dict[trimmed]`), più `placeholder`/`title`/`aria-label` |
| Selezione | `localStorage['noesar-language']` + `#languageSelect`, default `auto` (guarda `navigator.language`) |

**Tre conseguenze che mi aspetto di trovare vere, e che il punto 4 serve proprio a misurare —
`[UNVERIFIED]` finché non le controllo pagina per pagina:**

1. **La copertura è quasi certamente minuscola.** ~120 stringhe contro un `index.html` da
   **113 KB** e un `app.js` da **299 KB**. Il dizionario nomina la navigazione *vecchia*
   (`Home`, `Ask · Create · Act`, `Projects`…) e cita `D-0123`: è **precedente** a CodeN
   Evolution, al terminale, a `/skills`, ai pannelli di banco. Tutto ciò che è nato dopo è
   presumibilmente **non tradotto**.
2. **Una chiave mancante fallisce in silenzio.** Se la stringa non è nel dizionario, resta in
   inglese senza alcun segnale: la traduzione «funziona» e intanto non traduce. Non esiste una
   misura di copertura.
3. **Il contenuto ridisegnato dopo il caricamento** viene tradotto solo se qualcuno richiama
   `applyTranslations()` a ogni render. Con una WebUI che ridipinge pannelli, è il punto dove
   una pagina può tornare inglese da sola.

**Da questo discende una domanda per l'Owner, che NON blocca nulla:** «tutto in inglese
principale» significa (a) che l'inglese è la **lingua sorgente** e le altre sono traduzioni —
che è già l'architettura di oggi — oppure (b) che **anche l'italiano deve sparire** dalle parti
del prodotto dove è rimasto? Registro entrambe le letture; nel dubbio assumo (a).

#### Precisazione dell'Owner (stessa sessione)

> *«voglio dire che ho visto un mix che quando clicco sulla traduzione rimane in inglese o
> viceversa quindi va fatto un controllo approfondito»*

**Questa precisazione conferma dal vivo l'aspettativa 1+2 qui sopra e la promuove da
`[UNVERIFIED]` a sintomo osservato dall'Owner.** «Un mix» è **esattamente la forma** di un
dizionario a match esatto e parziale: le stringhe presenti nel dizionario cambiano lingua, le
altre no, **sulla stessa schermata**. Non è un guasto dell'interruttore — è **copertura
mancante che fallisce in silenzio**.

Il *«o viceversa»* dell'Owner aggiunge un secondo sintomo, di natura **diversa** e da non
confondere col primo: **testo che resta in italiano quando si è scelto l'inglese**. Quello non
può essere copertura mancante — con `en` il dizionario è **vuoto** e la pagina mostra la
stringa **sorgente**. Quindi significa che **da qualche parte la stringa sorgente è scritta in
italiano nel markup o nel codice**, e nessuna scelta di lingua potrà mai renderla inglese.
Sono **due difetti distinti con due riparazioni distinte**:

| Sintomo | Causa | Riparazione |
|---|---|---|
| Scelgo italiano → **pezzi restano inglesi** | stringa assente dal dizionario `IT` | estendere la copertura **e** renderla misurabile, così che un buco si veda invece di tacere |
| Scelgo inglese → **pezzi restano italiani** | **sorgente in italiano** nel markup/codice | riportare la sorgente all'inglese e spostare l'italiano nel dizionario — è il punto in cui 3d e 4 si toccano |

**«Controllo approfondito» = requisito esplicito dell'Owner.** Non un campione: **ogni pagina,
in entrambe le lingue**, con l'elenco delle stringhe che non seguono la scelta. La misura utile
non è «funziona sì/no», è **la lista dei buchi** — e va prodotta in modo che non possa restare
verde mentre manca qualcosa (vale la regola s330: *un test che asserisce il valore che un
sistema ha, invece della proprietà che deve tenere, trasforma il difetto in requisito*).

---

### Punto 5 — `#/models`: un menu dei modelli, con gli installati per primi

> **Parole dell'Owner:** *«avevo detto nel progetto di alcune sessioni fa che
> `http://192.168.178.100:8100/#/models` deve esserci un menu con i modelli e i modelli
> scaricati e installati devono sempre visualizzarsi per primi»*

**Verificato ora, non ricordato — l'Owner ha ragione e la richiesta è a verbale.**
`docs/MODEL_CATALOG_DESIGN.md` (137 righe, 4 agosto 2026) la contiene alla lettera:

> riga 15: *«**Scaricati e in uso sempre in primo piano.** Con *Usa*; quelli non ancora
> scaricati con *Scarica e avvia*.»*
> riga 52: *«Le prime due corsie sono in primo piano e **non si impaginano mai**: sono la
> risposta a "cosa ho".»*

Il documento definisce già le **corsie** (in uso → scaricati → disponibili), l'ordine, le
azioni per corsia (*Usa* / *Scarica e avvia*), il costo dichiarato di ciascuna (rete, disco,
tempo), la tassonomia per tipo e funzione, e il percorso di autorità del download (consenso di
egress, verifica dell'impronta prima dell'uso: `MC-001`…`MC-004`).

**Quello che manca è il codice.** Misurato in s332 e riportato in `docs/COSA_MANCA.md` §2.3:
il design esiste, **i moduli sorgente corrispondenti sono zero**. Quindi questa non è una
modifica a una pagina esistente: è **la costruzione del catalogo modelli**, cioè uno dei due
pezzi grossi rimasti del progetto (l'altro è `F4W-006`, i due archivi di identità).

**Nota mia, e conta:** questo punto **cambia la priorità** scritta in `COSA_MANCA.md` §6, dove
la scelta fra `F4W-006` e il catalogo modelli era lasciata aperta *«se ne sceglie uno»*.
L'Owner ha appena scelto: **il catalogo modelli**. Da trattare come tale quando si autorizza.

**Da misurare prima di costruire (non ancora fatto):** cosa mostra **oggi** `#/models` sulla
pagina viva. Il requisito dice «deve esserci un menu»: se oggi la pagina esiste ma è una delle
«pagine statiche» del punto 3, allora 5 e 3b sono **lo stesso lavoro su quella pagina** e vanno
fatti in un colpo, non due volte.

---

### Punto 6 — il pulsante Voice: via dalla barra in alto, accanto al prompt, e funzionante

> **Parole dell'Owner:** *«nella barra in alto c'è pulsante Voice che non deve esserci, va
> spostata e va messa sia su chat accanto alla barra del prompt, e ancora non funziona e penso
> ancora non ci siano voci, penso che va costruito da 0»*

**Misurato ora — `apps/webui-static/voice-control.js`, 158 righe:**

| Fatto | Misura |
|---|---|
| Il codice **esiste** | 158 righe, `D-0123`, con test unitari sulle parti pure |
| Cosa fa **davvero** | è una **torre di controllo per approvare/rifiutare un piano in attesa** |
| Vocabolario | **5 parole fisse**: `approve`, `reject`, `cancel`, `repeat`, `status` (`VOICE_VOCABULARY`, congelato) |
| Motore | **nessuno**: usa `SpeechRecognition`/`speechSynthesis` **del browser**. `initVoiceControl` restituisce `{available:false}` se il browser non li ha |
| Lingua | `recognition.lang = 'en-US'` **scritto nel codice**, non legato alla scelta di lingua del punto 4 |
| Commento nel sorgente (riga 16) | dichiara che **nessun motore vocale reale è disponibile in questo ambiente** |

**Nota mia — e questa è la parte che conta più della posizione del bottone.** L'Owner chiede di
spostarlo **accanto alla barra del prompt della chat**. Quella posizione ha un significato
preciso per chiunque la guardi: *«parlo e la mia voce diventa testo nel prompt»* — cioè
**dettatura**. Ma ciò che il bottone comanda oggi **non è dettatura**: è un telecomando a
cinque parole per dire *approva* / *rifiuta* a un piano già calcolato. Sono **due funzioni
diverse**. Spostarlo soltanto produrrebbe un bottone che sta nel posto della dettatura e non
detta: **peggio di dov'è adesso**, perché la posizione prometterebbe una cosa falsa.

Quindi l'istinto dell'Owner — *«penso che vada costruito da 0»* — **è corretto**, e per una
ragione più precisa di «non funziona»: la funzione che serve in quel punto della pagina **non è
mai stata costruita**. Quella che esiste è un'altra, e va **decisa**: se tenerla (ha senso su
una superficie di approvazione, non sul prompt), se fonderla con la dettatura, o se ritirarla.

**Sul «non ci sono voci»:** oggi la voce dipende **interamente dal browser** —
`speechSynthesis.getVoices()` per parlare, `SpeechRecognition` (solo Chromium, e in genere
manda l'audio a un servizio remoto) per ascoltare. È **questa dipendenza** il difetto di
progetto, non il dispositivo dell'Owner: un prodotto self-hosted che vuole la voce dovrebbe
poterla servire **da sé** — motore di riconoscimento e di sintesi lato server, come qualunque
altro modello che l'installazione fornisce. Da misurare comunque cosa fa oggi sul dispositivo
dell'Owner, ma **come diagnosi, non come confine**.

**Tre lavori distinti dentro questo punto:**
- **6a** togliere Voice dalla barra in alto;
- **6b** metterlo accanto al prompt della chat — che implica **dettatura**, funzione oggi
  inesistente;
- **6c** decidere che fine fa la **torre di controllo a 5 parole** già costruita e testata.

---

### Punto 7 — chat multimodale, con anonimizzazione **reversibile a scelta dell'Owner**

> **Parole dell'Owner:** *«in chat `http://192.168.178.100:8100/#/chat` deve esserci ul
> multimodale, devo trascinare il file e in base al file lo elabora come fa sia claude.ai che
> chat gpt, anche audio e vidio devono essere elaborate letti. Invece documenti dei clienti o
> documenti personali quando si inseriscono devono essere anonimizzarli, e se chiedo la modifica
> del documento posso scequere di scrivere il documento con i dati che avevo nascosto in
> precedeza — esempio devo riscrivere una lettere, una mail, una fattura, deve esserci questo
> sistema»*

**Nota mia (scomposizione):** questo è **il punto più grosso della lista** e contiene una cosa
che gli altri prodotti citati **non fanno** — vale la pena dirlo subito perché è l'idea
originale qui dentro.

- **7a — trascina e elabora.** Drag & drop nel prompt, e il trattamento **dipende dal tipo**:
  testo/PDF/immagine ciascuno per la sua strada.
- **7b — audio e video** «elaborati e letti»: trascrizione, e per il video anche il visivo.
- **7c — anonimizzazione all'ingresso.** Un documento di un cliente o personale entra
  **già mascherato**: nomi, indirizzi, IBAN, partite IVA, importi sostituiti da segnaposti.
- **7d — riscrittura con i dati veri, a scelta.** Chiedo di riscrivere la lettera / la mail /
  la fattura e posso **decidere** che il documento finale esca con i dati reali rimessi al
  loro posto.

**7c+7d insieme non sono «anonimizzazione»: sono pseudonimizzazione reversibile.** La
differenza è tutta tecnica e decide il progetto. Anonimizzare significa **buttare via**
l'informazione; qui invece va **conservata da qualche parte**, altrimenti 7d è impossibile.
Quindi servono, e vanno decisi dall'Owner, tre punti:

1. **Dove vive la mappa** segnaposto → dato reale (`«CLIENTE_1»` → *nome vero*). È il file più
   sensibile che il prodotto abbia mai avuto: chi lo legge ha in mano i dati dei clienti
   dell'Owner in chiaro.
2. **Chi non deve vederla mai.** Il senso del punto è che **il modello** lavori sul testo
   mascherato. Se la ricomposizione avviene **dopo** la risposta, il modello non vede mai un
   dato vero — ed è l'unico modo perché 7c significhi qualcosa quando il modello è remoto.
3. **Cosa succede al documento riscritto.** Se esce con i dati veri, quel file **non è più
   anonimo**: dove viene salvato, chi può riaprirlo, e resta nella cronologia della chat?

**Ancoraggi misurati (stato di oggi, non promesse):**

| Cosa | Stato reale |
|---|---|
| Estrazione da file | esiste, ma `F4-011`: instrada per **estensione e MIME dichiarato**, **senza content sniffing** — un file rinominato prende la strada sbagliata. Accettato quando l'unico rischio era la correttezza; con documenti di clienti va **riconsiderato** |
| Limite di dimensione | `F4-012`: 48 MiB dichiarati, non raggiungibili via API JSON (base64 gonfia fino al cap da 64 MiB). **Un video li supera senza sforzo** |
| Modelli su **questa** installazione | ATOM serve **Qwen2.5-Coder 7B**, testo; qui non girano modelli di trascrizione, visione o embedding (s304: `501 "does not support embeddings"`). **Nota di esercizio, NON un limite del prodotto** — vedi la regola dell'Owner in testa: il prodotto deve saperli usare, l'installazione li fornisce |
| Backup | `F4-013`: il backup completo **non è cifrato** e contiene la chiave master. Con la mappa di 7c dentro, questo smette di essere una nota di documentazione |

**Legame col punto 5 — corretto dopo la regola dell'Owner.** 7a/7b usano modelli di
trascrizione e di visione, che è **esattamente ciò che il catalogo del punto 5 deve saper
accettare** (requisito Owner s318: *qualsiasi* modello). Quindi i due punti **si toccano per
costruzione**, e conviene che il catalogo non nasca cieco alle modalità non testuali. Ma
**non è un prerequisito bloccante**: 7 si costruisce quando l'Owner lo dice, con i modelli che
l'installazione fornisce.

**⚠️ Correzione registrata.** Nella prima stesura di questa voce avevo scritto che «7a/7b non
sono realizzabili senza modelli nuovi» e che il punto 5 era **prerequisito tecnico** del punto
7. Era una **mia supposizione** costruita sull'hardware di *questa* macchina, e ha l'effetto di
riscalare una richiesta dell'Owner. Ritirata.

**Nota di merito, senza sconti:** 7c+7d è la parte che **claude.ai e ChatGPT non fanno**. Il
paragone dell'Owner regge per 7a/7b — trascina e elabora — ma si ferma lì: quei prodotti
mandano il documento **così com'è**. Un prodotto self-hosted che maschera prima e ricompone
dopo è una ragione d'esistere, non una funzione in più.

---

## Note

- Le voci sono registrate **come le dice l'Owner**, non riformulate. Se una richiede una mia
  interpretazione, la interpretazione è scritta sotto la voce e marcata come mia, così resta
  distinguibile dalla richiesta.
- Nessun punto passa da «registrato» a «in lavorazione» senza autorizzazione esplicita.


---

## Stato a fine s333 — misurato, non ricordato

**Repo `f2e70c3` = `origin/main`. Immagine `noesar-evolution:d0353-owner-list-s333`.
Deploy: 339 ms di downtime. Tre livelli identici** (repo, container, corpo servito sulla LAN:
`app.js` = `3152366a…`). `/api/v1/models/catalog` risponde **401**, non 404 — la rotta è viva.
5/5 container healthy. Un solo rollback conservato: `noesar-evolution-old-d0353`.

> ⚠️ **Superato in s335, e non da uno di questi sette punti.** Quel che gira ora è
> **`noesar-evolution:d0354-tui-input-flow`** (repo **`abfef5b`** = `origin/main`), rollback unico
> `noesar-evolution-old-d0354`. Il corpo servito è **invariato** (`app.js` = `3152366a…`): il
> deploy di s335 non cambia una riga della WebUI. Cambia il terminale — `D-0354`, che **non
> accettava un solo tasto** su un terminale vero da quando esiste. Questa tabella dei sette punti
> resta valida com'è.

| Punto | Esito | Decisione |
|---|---|---|
| 1 un solo comando | chiuso, ora **deployato** | `D-0348` |
| 2 chat e comandi `/` | chiuso | `D-0350` |
| 3a censimento | chiuso | `D-0352` |
| 3b pagine vive | chiuso — 19→29 vive, 7→0 stantie | `D-0352` |
| 3c tasti `i` | chiuso — 34 pagine, 73 stringhe tradotte | `D-0353` |
| 3d + 4 lingua | chiuso sul markup (793/793); divario runtime **dichiarato** a 607 | `D-0349` |
| 5 catalogo modelli | chiuso — `MC-001`…`MC-006` come test | `D-0351` |
| 6 Voice | **non iniziato** |  |
| 7 multimodale + anonimizzazione | **non iniziato** |  |

**Verifiche finali:** unit **2143** (0 fail), ESLint 362 file **0/0/0**, browser e2e **460/460**,
copertura lingua statica exit 0.

### L'unica cosa che resta aperta dentro i punti 2-5, e non è nascosta

Il divario di traduzione **a runtime**: 607 stringhe che un catalogo può chiudere, dipinte da
JavaScript. Non è silenzioso — è **misurato a ogni esecuzione della suite** (`I18N-RUNTIME`) e
un ratchet impedisce che cresca. Il markup statico è invece **completo, 793 su 793**, e il
controllo fallisce su una sola lacuna.

⚠️ **Scritto nel controllo stesso:** un ratchet **non sa distinguere «il prodotto è peggiorato»
da «la misura si è allargata»**. Durante s333 il numero è salito 598 → 607 per il *secondo*
motivo (le pagine rese vive ridisegnano dentro la finestra misurata, rendendo visibili 42
stringhe da sempre non tradotte, di cui 33 poi tradotte). Perciò la soglia si può ritoccare
**solo dopo aver letto il diff** dell'insieme non tradotto.
