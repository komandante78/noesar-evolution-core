# 16 · CodeN Evolution — la generazione, e l'accesso

**Deciso dall'Owner il 2026-08-05.** Questo documento chiude due buchi che nessuno dei quindici
precedenti aveva nominato, e che insieme spiegano perché CodeN Evolution è costruito quasi per
intero e non **lavora**.

Precede questo documento e resta valido: `06_CODEN_EVOLUTION.md` (il ciclo a sedici stadi, le
due shell), `15_CODEN_EVOLUTION_DA_ZERO.md` (le sei invenzioni, l'ordine, la matrice),
`02_ATOM.md` (il contratto `ReasoningProvider`), `04_SICUREZZA_E_AUTORIZZAZIONI.md` (i token).
**Nessuna riga di quei documenti è ritirata.** Questo ne aggiunge una che mancava, e la aggiunge
nel posto in cui la loro stessa logica la richiede.

---

## 0. Cosa deve fare — in chiaro

**Un agente di programmazione.** Ci si parla in prosa, e lavora. Questa sezione descrive il
comportamento; tutto ciò che segue è il meccanismo che lo rende possibile e dimostrabile.

**Dove si apre.** Sull'host si scrive `coden`. Da un'altra macchina si scrive
`ssh coden@<installazione>`. Sono lo stesso programma e la stessa sessione: `ssh` è il trasporto,
non una modalità. C'è anche nel browser, ed è ancora la stessa sessione — ci si stacca da una e
il lavoro continua, perché appartiene al motore e non alla finestra.

**Chi risponde.** Sotto c'è un modello, e può essere **qualsiasi** modello. Sopra c'è **ATOM**,
che controlla e rigenera. **Ciò che risponde è sempre ATOM**, in chat, qui e nel terminale.

**Cosa succede quando gli si chiede qualcosa.**

```text
  tu scrivi in prosa            "aggiungi il rate limit alle rotte di login"
    │
    ├─ capisce cosa vuoi        obiettivo, non-obiettivi, criteri — e se è ambiguo CHIEDE
    ├─ trova i file da solo     li cerca nel repository; tu non nomini né incolli niente
    ├─ SCRIVE il cambiamento    è la parte che oggi non esiste — vedi §1
    ├─ lo prova in una copia    i test girano davvero, in una copia usa-e-getta
    │
    └─ ti mostra cosa È GIÀ SUCCESSO, non cosa vorrebbe fare:
         4 file · +112/−38 · 61 test passati · 1 fallito, ed è questo
         divergenza da questo repository: ▲ alto (co-modifica) · ▲ medio (test)
         verificato 6 affermazioni su 9 — le altre 3 sono queste, e perché no
         ripristino: checkpoint ck-4471, misurato in 0,3 s

         [Promuovi]  [Promuovi solo 2 file]  [Scarta]  [Mostra l'evidenza]
```

**Cosa può fare.** Modificare e creare ciò che l'Owner vuole: leggere, creare, modificare,
rinominare, spostare, eliminare con conferma, applicare patch, eseguire comandi e test,
annullare, ripristinare un checkpoint. Non c'è una lista di cose che non sa fare.

**Cosa non fa mai.** Cambiare qualcosa senza che tu l'abbia promosso. Non è un limite a *cosa*
puoi ottenere: è il modo in cui la tua autorità viene esercitata e dimostrata. Tu autorizzi, lui
fa — e siccome ha già eseguito in una copia, quando autorizzi stai guardando un risultato
misurato invece di una promessa.

**Tutto da tastiera.** Ogni cosa che si fa col mouse nel browser si fa coi tasti nel terminale.
Una funzione che richiede il mouse non è finita.

---

## 1. Il fatto, misurato il 2026-08-05

> **Nessuna superficie di CodeN Evolution produce il contenuto di un file.**

Non è una svista di implementazione. È **assente dalla specifica**, e da lì assente dal codice.

**Nel contratto** (`02_ATOM.md`, tabella delle superfici). Dodici superfici — `interpret`,
`hypothesize`, `plan`, `decompose`, `expect`, `constrain`, `classify`, `confidence`, `evidence`,
`cancel`, `simulate`, `fixtures`. Si leggano le due che sembrano avvicinarsi:

| Superficie | Torna indietro | Cosa **non** torna |
|---|---|---|
| `plan` | «passi ordinati, **file**, comandi, dipendenze, raggio d'azione» | i *percorsi*, mai il *contenuto* |
| `simulate` | «diff previsto ed esito previsto **senza eseguire**» | una *previsione*, non il cambiamento — ed è l'unica non obbligatoria |

**Nel codice**, misurato riga per riga:

| Dove | Cosa dice |
|---|---|
| `src/reasoning.mjs:151` | `plan()` costruisce ogni passo con `files: []` e `commands: []` scritti nel codice. Produce **descrizioni** |
| `src/atom-client.mjs` | **zero** occorrenze di `contents`, `generate`, `write` |
| `src/reasoning-router.mjs:36` | ATOM copre `decompose`, `expect`, `simulate`: ragionamento |
| `src/executor.mjs:194` | `mkdirSync` ricorsivo + `writeFileSync` — **sa** creare e scrivere |
| `src/workspace-actions.mjs:537` | `actions = run.files.map((f) => ({kind:'WRITE', path:f.path, contents:f.contents}))` |

L'ultima riga è la conclusione: **l'esecutore scrive esattamente i contenuti che il chiamante gli
ha passato.** Ecco perché il client da terminale, a `tools/tui-client.mjs`, chiede
`Contents of <file>:` e aspetta che tu li incolli. Non è una scortesia dell'interfaccia: è
l'unica fonte di contenuti che il prodotto possieda.

**Cosa significa per il prodotto.** Tutto l'apparato — fondazione della richiesta, Piano,
`expect`, token di capacità, esecuzione in ombra, verifica per ricalcolo, copertura di
proiezione, ledger concatenato — è un impianto di autorizzazione e di prova **costruito attorno a
un cambiamento che nessuno scrive**. È la metà difficile del problema, è costruita bene, e da
sola non fa lavorare nessuno.

**Perché nessuno se n'era accorto.** Il criterio della fase 1 (`09_PIANO.md` §3) dice *«cambia
diversi file»*, e il prodotto **cambia diversi file**: la clausola è vera con i contenuti forniti
da fuori. La matrice `CE-001…024` misura ventiquattro proprietà del cambiamento — autorità,
ombra, copertura, divergenza, ledger — e **nessuna** chiede chi lo ha scritto. Ventiquattro righe
verificabili eseguendo, e il buco passa fra due di esse senza toccarne nessuna.

---

## 2. Il requisito dell'Owner

Detto il 2026-08-05, e qui riportato come regola:

> **CodeN Evolution deve poter modificare ciò che l'Owner vuole e creare ciò che l'Owner vuole,
> raggiungibile sia via `ssh` da un'altra macchina sia sull'host.**

Due chiarimenti dell'Owner, entrambi vincolanti perché correggono un errore già commesso:

**Il primo.** «Deve lavorare come lavora un agente di codice da terminale» descrive **il modo di
lavorare**. Non è un paragone con un altro prodotto, non è un metro esterno, e nessun altro
prodotto entra in questo progetto — vale qui la REGOLA ZERO già in vigore.

**Il secondo, ed è il più importante.** Il cancello di autorizzazione **non limita** ciò che
l'Owner può creare o modificare. Era stato presentato come il motivo per cui il prodotto non
poteva fare ciò che gli si chiedeva, e la domanda «vuoi rimuoverlo?» era un falso dilemma. Il
cancello è **il modo in cui l'autorità dell'Owner viene esercitata e dimostrata**: l'Owner
autorizza, il prodotto fa. La regola sola di `15` §1 resta intatta, e la generazione le
**obbedisce** invece di aggirarla.

Sul secondo punto la specifica era già dalla parte dell'Owner: `06_CODEN_EVOLUTION.md` §1 dice
testualmente **«`ssh` è il trasporto, non una modalità»**. Il requisito d'accesso non è nuovo. È
canonico dal 26 luglio 2026 e non è mai stato costruito.

---

## 3. L'Autore — la componente che mancava

### 3.1 Perché non è una superficie di `ReasoningProvider`

La tentazione è aggiungere una tredicesima superficie al contratto. **È sbagliato**, e la ragione
è già scritta in `01_VISIONE_E_POSIZIONE.md`:

| Livello | Nel replay |
|---|---|
| Output dei modelli | **riprodotti dalle fixture registrate** |
| Interpretazione, ipotesi, piano, attesa, classificazione | **rieseguiti, e devono coincidere** |
| Policy, autorizzazioni, emissione dei token | **rieseguiti, e devono coincidere** |

`ReasoningProvider` è il contratto delle cose che **devono coincidere al replay**. Il contenuto
di un file scritto da un modello è, per costruzione, la cosa che **non coincide** — e il progetto
lo aveva già capito e già risolto: si riproduce dalla fixture. Metterlo nel contratto del
ragionamento significherebbe promettere determinismo su ciò che il documento `01` ha
esplicitamente dichiarato non deterministico, «una promessa che si rompe alla prima verifica».

### 3.1b Chi autora — la catena, decisa dall'Owner

> **Qualsiasi modello sotto. ATOM sopra. ATOM è ciò che risponde.**

```text
   modello (uno qualsiasi)  ──▶  ATOM controlla e rigenera  ──▶  la risposta
```

Vale su **tutte e tre le superfici**, senza eccezioni: Chat, CodeN Evolution, CodeN Evolution TUI
via `ssh`. Non è una scelta per superficie e non è un instradamento: è la catena del prodotto.
ATOM è stato costruito per questa funzione.

**Il modello è intercambiabile, ATOM no.** Il catalogo accetta qualsiasi modello — è il requisito
dell'Owner già registrato in `docs/MODEL_CATALOG_DESIGN.md`. Cambiare il modello sotto non cambia
chi risponde: cambia soltanto la materia prima che ATOM controlla e rigenera. Un'installazione
senza **nessun** modello lo dichiara e rifiuta, come già fa `simulate`; non degrada a un
contenuto vuoto.

**ATOM resta fuori da git.** Vive nel suo repository separato e non entra mai in un repository
pubblico. È un vincolo permanente e non ha eccezioni in questo documento.

### 3.1c Se ATOM si rompe — deciso dall'Owner il 2026-08-05

> **Se ATOM si rompe, il prodotto continua a funzionare sul modello. E ATOM va costruito per
> non rompersi.**

**Cosa succede oggi, misurato.** Tutte e dodici le superfici sono instradate ad ATOM
(`NOESAR_REASONING_MODE=rust-external`, `NOESAR_EXTERNAL_SURFACES` le nomina tutte e dodici) e
`reasoning-router.mjs:132` **rilancia** l'errore: ATOM irraggiungibile ⇒ `503
reasoning_unavailable` ⇒ **CodeN Evolution si ferma**. Non c'è nessun ripiego.

**Perché era stato costruito così, e perché la regola non va buttata.** Il commento del router
lo dice: *«non deve mai ripiegare **in silenzio** … rispondere col provider di riferimento
attaccherebbe una risposta plausibile a una provenienza che è una bugia»*. È giusto, e la parola
che porta il peso è **in silenzio**.

**La correzione: si ripiega, e lo si dichiara.** Il ripiego non è vietato — è vietato *nascosto*.
Quindi:

- ATOM irraggiungibile ⇒ la superficie **risponde col provider di riferimento**, e la
  provenienza registra `reference` **più la ragione e l'istante**: «ATOM irraggiungibile alle
  14:32». Non è mai indistinguibile da una risposta di ATOM.
- Lo stato è **visibile in tutte e due le shell**, non sepolto in un log: chi sta lavorando deve
  sapere che sta lavorando degradato.
- La **Prova di Sessione** porta il degrado come un fatto della sessione, non come una nota.
- **Un lavoro cominciato con ATOM non si conclude senza**: se cade a metà, il passo in corso si
  ferma con un checkpoint riprendibile — è ciò che `cancel` già promette — invece di produrre
  metà ragionamento di una qualità e metà di un'altra.
- **E la parte che non è codice del prodotto**: ATOM va reso robusto — sonda di salute vera,
  ripartenza, tetti di tempo, e la misura di quanto spesso è caduto. Un ripiego che scatta ogni
  giorno non è resilienza: è una diagnosi che nessuno ha letto.

**Questa è la lettura corretta di `CE-022`.** Il criterio serviva esattamente a garantire che
esista un prodotto funzionante sotto ATOM. Non «ATOM è opzionale»: **«se ATOM manca, sotto c'è
ancora un prodotto»** — che è la stessa frase da cui l'Owner è partito.

**Come questo convive con `CE-022`, che non viene toccato.** `CE-022` dice che *il criterio di
«fatto» del nucleo pubblico si misura anche senza ATOM*. È un vincolo sul **nucleo pubblico e
sulla sua suite**: serve a impedire che il core libero sia una dimostrazione che non funziona da
sola. Non dice — e non ha mai detto — che ATOM sia opzionale nel prodotto. Le due frasi
convivono senza attrito:

| Piano | Chi risponde |
|---|---|
| Il prodotto, come l'Owner lo usa e lo consegna | **ATOM, sempre**, sopra un modello qualsiasi |
| La suite del nucleo pubblico, eseguita con ATOM disinstallato | il provider di riferimento, che deve passare da solo |

L'errore da non ripetere è quello che la prima stesura di questo paragrafo aveva commesso:
leggere `CE-022` come se dicesse «l'Autore non è ATOM». Dice che il nucleo pubblico deve reggersi
in piedi da solo, non che ATOM sia un accessorio — e `01_VISIONE_E_POSIZIONE.md` lo aveva già
scritto: *«ATOM smette di essere il pezzo che devi comprare e diventa il pezzo che rende
l'evidenza degna di essere letta»*.

### 3.2 Cosa è l'Autore

> **L'Autore riceve un passo del Piano e i contenuti veri dei file che quel passo nomina, e
> restituisce i contenuti nuovi. Non nomina mai un file.**

Sette regole, ognuna ereditata da una decisione già presa, nessuna nuova:

1. **I percorsi non li sceglie l'Autore.** Arrivano dal Piano, che li ha dal fondamento della
   richiesta, che li ha **dal repository** (`request-grounding.mjs`, `D-0303`). L'Autore riceve un
   elenco chiuso e lavora dentro quello. Un percorso che comparisse nella sua uscita è scartato,
   non normalizzato.
2. **I contenuti attuali li legge il motore, non il modello.** Il modello non ha superficie di
   lettura, come non ha superficie d'azione (`15` §1).
3. **La sua uscita è contenuto non fidato**, esattamente come il repository e come il web
   (`CE-007`). Non altera istruzioni, policy o token, e non entra nel canale delle istruzioni.
4. **La sua uscita non tocca il repository vero.** Va nella copia in ombra, dove i test girano
   davvero (invenzione III). Il cancello di autorizzazione vede **un risultato misurato**, mai una
   proposta.
5. **Ogni chiamata è registrata come fixture** (`CE-006`): la sessione si riesegue, il contenuto
   si riproduce, e le decisioni prese su quel contenuto si **ricalcolano** e devono coincidere.
6. **Il profilo di divergenza entra prima, non dopo** (`CE-010`, `divergence-profile.mjs`).
   L'Autore riceve le convenzioni **indotte dalla storia git di questo repository** — come si
   nominano le cose, quale strato importa quale, il rapporto test-per-modifica che questo
   progetto tiene davvero. È l'invenzione II usata per ciò per cui esisteva: non giudicare un
   diff dopo, ma **scriverne uno che assomigli a quelli che qui sono stati accettati**.
7. **Nessun token, nessuna scrittura.** L'Autore produce byte. Chi li scrive è l'esecutore, che
   spende un token coniato da un Piano autorizzato. La regola sola non ha eccezioni e non ne
   acquista una qui.

### 3.3 Dove si innesta nei sedici stadi

Fra lo stadio **9 (Raggio d'azione)** e lo stadio **11 (Simulazione)**, e mai dopo il 13.

```text
 …  9 Raggio d'azione   cos'altro tocca

    9b AUTORATURA       il passo + i file veri + il profilo di divergenza
                        → i contenuti nuovi          [modello qualsiasi → ATOM → la risposta]

   10 Attesa            cosa deve succedere                                    [ATOM]
   11 Simulazione       i contenuti autorati girano nella copia in ombra       [ATOM opz.]
   12 Classificazione   rischio per passo e per piano                          [ATOM]

        ── 9b, 11 e 12 PRECEDONO 13: si autorizza un risultato misurato ──

   13 Autorizzazione    promozione delimitata, a scadenza, revocabile
   14 Esecuzione        token spesi passo per passo, annullabile
```

**L'ordine è la parte che conta.** L'autoratura precede l'ombra, l'ombra precede
l'autorizzazione. Chi promuove non sta valutando *cosa il modello propone di scrivere*: sta
guardando **cosa è già successo dove non fa danno** — quattro file, +112/−38, 61 test passati, uno
fallito, e il profilo di divergenza da questo repository. L'invenzione III non viene indebolita
dalla generazione: è la generazione che la rende finalmente utile, perché prima non c'era niente
da simulare che il prodotto avesse scritto.

### 3.4 Il budget sulla novità si applica qui

`15` §5: *«un approccio ripetuto non conta come tentativo»*. È scritto per i modelli piccoli, che
non falliscono fermandosi ma **ripetendosi con sicurezza** — ed è esattamente il modo in cui un
Autore fallisce. Due autorature che producono lo stesso diff sono **un** tentativo. Il conteggio
è sulla novità del contenuto, non sulle chiamate.

---

## 4. L'accesso — `coden` come comando

### 4.1 Cosa c'è oggi, misurato

Il socket esiste (`/run/codev-peer.sock`, `srw-------`, uid del prodotto, su tmpfs) e il client è
nell'immagine (`/opt/noesar/tools/tui-client.mjs`, spedito da `D-0301`). Ciò che manca è che per
arrivarci occorre **essere amministratore dell'host**, sapere il nome del contenitore e il
percorso del file dentro di esso. Per una shell che deve soddisfare `CE-020` — *ogni capacità ha
una forma da tastiera completa* — è un ingresso da manutentore, non da utente del prodotto.

`D-0301` aveva provato che il socket funziona e che il client è spedito. Non aveva provato che
qualcuno che non sia amministratore possa raggiungerlo, e nessuna riga della matrice lo chiedeva.

### 4.2 La forma, e il confine con la legge di piattaforma

Il prodotto è self-hosted su **qualsiasi** PC, server e sistema operativo, e **non possiede
l'host**. Quindi la divisione è netta e non negoziabile:

| Livello | Cosa | Di chi è |
|---|---|---|
| **Prodotto** | un avviatore che trova la sessione e vi si aggancia, senza argomenti, su qualunque OS | si costruisce qui |
| **Installazione** | l'utente di sistema dedicato e la regola del demone `ssh` che lo apre | **ricetta documentata**, mai un passo che il prodotto esegue sull'host |

Il prodotto **non modifica mai la configurazione `ssh` dell'host**, non si aggiunge a un gruppo di
sistema e non presume un demone. `08_INSTALLAZIONE.md` guadagna una ricetta per famiglia di
sistema operativo; il codice guadagna un avviatore che funziona anche dove quella ricetta non è
stata applicata.

**La forma dell'ingresso, dal lato dell'utente:**

```text
sull'host          coden
da un'altra        ssh coden@<installazione>
```

Nel secondo caso l'utente di sistema non riceve una shell: riceve **la sessione e basta**, e
all'uscita la connessione finisce. L'autenticazione resta a due livelli — la chiave per arrivare
alla macchina, poi l'accesso del prodotto con il suo secondo fattore sul socket. È **più forte**
dell'ingresso da amministratore di oggi, non più debole.

### 4.2b Il gesto, fissato dall'Owner il 2026-08-05

> **Apri `ssh` dalla stessa rete, scrivi `coden_evolution`, parte la TUI. Nient'altro.**

Il nome del comando è **`coden_evolution`**. Il gesto è **uno**, e ciò che deve sparire è
nominato, perché è esattamente ciò che c'è oggi:

| Oggi | Deve diventare |
|---|---|
| essere amministratore dell'host | un utente normale |
| sapere il nome del contenitore | niente |
| sapere il percorso del client dentro il contenitore | niente |
| tre concetti in una riga di comando | **una parola** |

**L'autorizzazione resta, e sta dentro.** Chi entra si autentica — è l'accesso del prodotto, con
il suo secondo fattore, come nel browser. Ma è **una domanda dopo essere entrati**, non un
ostacolo da superare per arrivare al programma. La semplicità richiesta è nel *gesto d'accesso*,
non nel *controllo*.

### 4.3 Tre trappole, registrate perché sono già state trovate

1. **Il socket non si pubblica sull'host.** È la porta del motore senza alcuno strato HTTP
   davanti; oggi a limitarlo è il permesso `0600` dentro lo spazio dei nomi del contenitore.
   Esporlo su una directory dell'host lo renderebbe raggiungibile da chiunque possa leggerla.
   `15` §13 registra già la classe: le comodità di accesso non si pagano con l'autorità.
2. **L'utente dedicato non entra nel gruppo che controlla il motore di contenitori.** Quel gruppo
   equivale all'amministrazione della macchina: si otterrebbe una shell del prodotto regalando
   l'host. La ricetta usa una singola regola di elevazione per esattamente un comando.
3. **Su alcuni sistemi la configurazione del demone non sopravvive al riavvio.** La ricetta lo
   dice per famiglia, invece di lasciare che l'installazione si scopra rotta al primo riavvio.

---

## 4b. Una sola interfaccia, resa due volte — deciso dall'Owner il 2026-08-05

> **La WebUI è la TUI, resa in un browser. Non è un'altra interfaccia sopra lo stesso motore.**

### 4b.1 Cosa c'è oggi, e perché non soddisfa la regola

`06_CODEN_EVOLUTION.md` §1 diceva già *«le due shell non divergono in nessun punto»*, e lo
chiamava «la scelta più cara del progetto». Misurato il 2026-08-05, **divergono quasi del tutto**:

| | Forma di oggi |
|---|---|
| **TUI** | trascrizione + prompt + riga di stato — un agente di programmazione (s319) |
| **WebUI** | un **banco da lavoro a 25 pannelli** — 20 di banco, 5 di colonna agente |

Non sono due rese della stessa cosa: sono **due prodotti diversi** che parlano allo stesso
motore. La clausola «non divergono in nessun punto» è stata scritta e mai applicata, e nessuna
riga della matrice la misurava — `CE-020` chiede che ogni capacità abbia *una forma da tastiera*,
che è una condizione molto più debole di *essere la stessa interfaccia*.

### 4b.2 La decisione

La forma canonica è **quella del terminale**, e il browser la rende:

```text
  ┌───────────────────────────────────────────────────────────┐
  │ riga di stato   sessione · git · contesto · costo · ATOM  │
  ├───────────────────────────────────────────────────────────┤
  │                                                           │
  │   la trascrizione del lavoro                              │
  │   — cosa hai chiesto, cosa ha fatto, il diff, i test      │
  │                                                           │
  ├───────────────────────────────────────────────────────────┤
  │ ▸ il prompt                                        [/ ]   │
  └───────────────────────────────────────────────────────────┘
```

Una sola forma, due rese: caratteri su un TTY, elementi in una pagina. **La grafica del browser
può essere migliore** — colore, proporzionale dove serve, un diff leggibile, il mouse dove
aiuta — ma la **struttura** è quella, e ciò che si può fare è lo stesso insieme.

### 4b.3 I 25 pannelli non si perdono: erano già indirizzi

Questa è la ragione per cui la decisione **non distrugge lavoro fatto**. Le fasi 1-4 avevano già
trasformato ogni pannello in un **indirizzo**, e la lista vive in un posto solo, derivata dal
markup e servita anche al terminale (`coden.addresses`, `src/coden-address-book.mjs`).

Quindi `diff`, `tests`, `map`, `logs`, `sessions` smettono di essere **riquadri sempre presenti**
e restano **posti dove si va** — con `/diff`, con `panel diff`, con F1…F9 — esattamente come già
funzionano nel terminale. Ciò che si rimuove è **la cornice da cruscotto**, non le funzioni.

È anche il seguito naturale di `D-0299`, che aveva già tolto tre widget di navigazione: il
problema era *quanti riquadri ci sono*, e questa decisione lo chiude invece di ridurlo ancora di
un poco.

### 4b.4 Il menu `/` — una casella, tutto il prodotto

**Deciso dall'Owner il 2026-08-05.** Nella casella dove si scrive il prompt, `/` apre un menu.
Non solo i comandi al lavoro: **tutto ciò che si può aprire o cambiare** — le applicazioni, le
impostazioni, le skill, e l'uscita dalla sessione.

```text
  ▸ /                                                    ┌──────────────────────────┐
                                                         │ LAVORO                   │
                                                         │  /plan      pianifica    │
                                                         │  /diff      il diff      │
                                                         │  /approve   promuovi     │
                                                         │  …                       │
                                                         │ APPLICAZIONI             │
                                                         │  /chat      Chat         │
                                                         │  /memory    Memoria      │
                                                         │  /research  Ricerca      │
                                                         │  …                       │
                                                         │ CONFIGURA                │
                                                         │  /skills    le skill     │
                                                         │  /models    i modelli    │
                                                         │  /modules   i moduli     │
                                                         │  /settings  impostazioni │
                                                         │ SESSIONE                 │
                                                         │  /logout    esci         │
                                                         └──────────────────────────┘
```

**Quattro gruppi, e il criterio che decide dove va una voce:**

| Gruppo | Cosa contiene | Criterio |
|---|---|---|
| **Lavoro** | i comandi che agiscono sulla sessione in corso | cambia lo stato del lavoro |
| **Applicazioni** | le destinazioni del prodotto | è un posto dove si va |
| **Configura** | skill, modelli, moduli, impostazioni | cambia come il prodotto si comporta |
| **Sessione** | uscita, cambio account | cambia chi sei |

**Cinque regole vincolanti, ognuna per un errore già commesso in questo progetto:**

1. **Il menu è UNO.** `D-0299` aveva rimosso tre widget di navigazione perché il problema era
   *quanti sono*. Questo menu non ne aggiunge un quarto: **assorbe** ciò che resta. In
   particolare, quando la WebUI prende la forma del terminale la **barra degli indirizzi in alto
   sparisce** — un terminale non ha una barra degli indirizzi, e tenerla significherebbe di nuovo
   due gesti per la stessa cosa. Fine dell'ambiguità s319 fra «la `/` in alto naviga» e «la `/`
   nel prompt comanda»: **c'è una `/` sola**.
2. **La lista viene da una fonte sola**, come già i comandi (`agent-commands.js`) e gli
   indirizzi (`coden-address-book.mjs`). Una voce scritta a mano in una delle due shell è un
   difetto, non una scorciatoia: è esattamente come `PANEL_NAMES` è arrivato a dire 14 contro 25.
3. **Ogni voce passa dalla tabella dei permessi** (`SESSION_METHOD_POLICY`, `D-0302`). Una voce
   che l'account non può usare **non compare**, e la lista dichiara di essere filtrata — mai una
   voce che appare e poi rifiuta.
4. **Identico nelle due shell.** Stesse voci, stessi nomi, stesso ordine. È `CE-034`.
5. **`/logout` chiede conferma, e la conferma non è un tasto solo.** `15` §13 lo registra già
   come cosa che non si costruisce: *«in un terminale `y` è a un incollaggio di distanza
   dall'essere digitato da qualcosa che non sei tu»*.

**Riga di matrice nuova:**

| ID | Criterio | Sev | Come si verifica | Verdetto |
|---|---|---|---|---|
| CE-036 | `/` apre l'unico menu del prodotto: lavoro, applicazioni, configurazione, sessione — stesse voci nelle due shell, filtrate per permesso e dichiarate tali | **A** | l'insieme delle voci di ciascuna shell, per due account con permessi diversi | ⚠️ **MISURATO 2026-08-19 (`D-0581`), con la clausola di presentazione SUPERATA da `D-0437` — non è un fallimento e non è un ✅ pieno** — `services/reference-control-plane/test/ce-036-one-menu-filtered-by-permission.test.mjs`, **7/7**. **Ciò che il criterio chiede ed è soddisfatto:** `/` apre **l'unico** menu del prodotto (comandi **e** destinazioni, da una fonte sola); le voci sono **filtrate per permesso** — due account con permessi diversi ricevono due menu, e la differenza è **esattamente** l'insieme delle voci il cui requisito l'account stretto non ha, verificata **nelle due direzioni** (un filtro che *aggiunge* è sbagliato quanto uno che nasconde); il filtro è **dichiarato**, con il conteggio e con il requisito nominato **verbatim** (`workspace.write`, non tradotto: un permesso localizzato nomina un permesso che non esiste), e i tre stati della nota — filtrato e completo, filtrato e corto, **non filtrato perché la shell non sa chi chiede** — dicono cose diverse. I **quattro gruppi** che il criterio nomina esistono nei dati (`work · applications · configure · session`), ogni voce offerta cade in uno di essi, e non ce n'è un quinto. **Ciò che il criterio chiede e il prodotto deliberatamente NON fa:** §4b.4 di questo documento **disegna** quei quattro gruppi come intestazioni dentro la casella `/`. Il prodotto dipinge **una lista piatta ordinata per rilevanza**, per `D-0437` (2026-08-14), su istruzione diretta dell'Owner dalla pagina viva — la navigazione a due livelli si leggeva come «menu sotto menu» e la richiesta è stata *«una lista piatta, stile come ha code claude»*; mantenere il menu raggruppato e solo rietichettarlo fu **considerato e respinto** lì. La supersessione è **misurata, non scusata in prosa**: un test guida la shell `ssh` reale e asserisce che **nessuna** intestazione di gruppo viene dipinta (un ritorno alla forma a due livelli diventa rosso), e un secondo test asserisce che i quattro gruppi **sopravvivono dove `D-0437` dice di averli tenuti**, cioè nell'uscita raggruppata di `/help`. **La riga del criterio è più vecchia della decisione dell'Owner che la governa: sanarla è una scelta dell'Owner, non di chi la misura.** |

### 4b.5 Le righe di matrice che mancavano

| ID | Criterio | Sev | Come si verifica | Verdetto |
|---|---|---|---|---|
| CE-033 | Le due shell hanno la **stessa struttura**: trascrizione, prompt, riga di stato — e nessuna delle due ha una regione che l'altra non ha | **A** | ispezione strutturale delle due rese, non delle due implementazioni | ✅ **verificato 2026-08-19 (`D-0581`)** — `services/reference-control-plane/test/ce-033-the-two-shells-have-the-same-regions.test.mjs`, **7/7**. Il metodo del criterio **vieta il test facile**: «ispezione delle due **rese**, non delle due implementazioni», quindi «entrambi i file importano `renderFrame`» non vale. La pretesa è scomposta in due metà che riguardano davvero le rese. **(1) Il fotogramma**: una funzione pura lo produce e ha esattamente **tre** regioni — trascrizione, prompt, riga di stato — più **una condizionale**, il menu `/`, che appare solo mentre si digita `/` e **non sposta** nessuna delle tre; ogni regione è trovata *dentro* un fotogramma dipinto, per ciò che disegna, non per il nome della funzione; l'altezza resa è esattamente quella richiesta a 10, 24 e 60 righe. **(2) Nessuna shell può avere una regione che l'altra non ha**, perché nessuna delle due *compone* un fotogramma: ognuna scrive **una cosa** per ridisegno — il fotogramma, più sequenze di controllo che non disegnano righe. Ricavato dal **sorgente di ciascuna shell a ogni esecuzione**, e l'oracolo è **stato visto scattare**: aggiungendo una `terminal.write("browser-only status bar")` al solo browser il test diventa rosso con quel messaggio. La ragione strutturale è fissata a parte: `renderFrame({width, height, state})` **non ha alcun parametro che nomini una shell**, quindi non può produrre una regione per una e non per l'altra. **Ampiezza dichiarata:** la metà (2) è una chiusura ricavata dal sorgente, non un confronto di pixel; la resa reale del browser è guidata da `tools/browser-e2e.mjs`, e ciò che questo file rimuove è la possibilità che una shell **cresca una regione in silenzio** fra quelle esecuzioni. |
| CE-034 | Ogni cosa che si fa nel browser si fa nel terminale con lo stesso nome, e viceversa | **A** | l'insieme dei comandi e degli indirizzi delle due shell è lo **stesso insieme** | ✅ **verificato 2026-08-19 (`D-0581`)** — `services/reference-control-plane/test/ce-034-the-same-names-in-both-shells.test.mjs`, **4/4**. Il metodo è l'**uguaglianza degli insiemi**, ed è quella che si asserisce. **Tre** shell, non due — `app.js` (la pagina), `coden-terminal.js` (il terminale incorporato) e `tui-fullscreen.mjs` (la shell `ssh`): lasciarne fuori una avrebbe misurato la coppia che si accorda più facilmente. Ognuna costruisce il proprio insieme con **la stessa espressione** (`[...menuFor(account).entries, ...addressEntries(addressBook)]`), quindi l'uguaglianza vale **per costruzione** e ciò che può marcire è la costruzione: un test che confrontasse i tre insiemi calcolati confronterebbe un'espressione con sé stessa e sarebbe sempre d'accordo — l'errore `PANEL_NAMES` che questo progetto ha già pagato due volte. La chiusura è perciò **ricavata dal sorgente a ogni esecuzione**, e l'insieme è poi **esercitato davvero**: la shell `ssh` **in esecuzione**, guidata con flussi iniettati, risolve **ogni** comando dell'insieme, e l'oracolo è **stato visto scattare** — togliendo una sola voce all'insieme offerto dalla shell `ssh` (`.slice(1)`) il test diventa rosso. **Ampiezza dichiarata:** la metà degli **indirizzi** è guidata end-to-end da `coden-shell-parity.test.mjs`, che apre tutti e 25 gli indirizzi CodeN dal prompt della shell reale; questo file asserisce che gli indirizzi sono nell'insieme offerto e nomina dove sono guidati, invece di ripetere quella prova. |
| CE-035 | Aprire `ssh` e scrivere `coden_evolution` avvia la sessione: nessun nome di contenitore, nessun percorso, nessun privilegio di amministratore | **A** | accesso reale da un secondo utente su un'altra macchina della rete |  |

---

## 5. Stato misurato dell'ordine di costruzione

`15` §10, verificato contro il codice il 2026-08-05 — non contro la memoria, non contro il log.

| # | Passo | Stato | Misura |
|---|---|---|---|
| 1 | `ReasoningProvider`, contratto pubblico | ✅ | `reasoning.mjs`, **12 superfici su 12** |
| 2 | **Lo stato e il proiettore di contesto** (inv. I) | ❌ **assente** | nessun `context-projector`; `ai-workspace/context-graph.mjs` è un archivio di messaggi che **accumula** |
| 3 | Provider di riferimento, le undici superfici | ✅ | tutte presenti, `simulate` dichiara `supported:false` invece di fingere |
| 4 | Capability token e il conio da un Piano | ✅ | `capability.mjs`, `mint()` rifiuta ciò che non è un Piano autorizzato |
| 5 | Registro eventi con correlazione, causazione, digest | ✅ | `events.mjs` |
| 6 | Esecutore che accetta solo token | ✅ | `executor.mjs` |
| 7 | Esecuzione in ombra copy-on-write (inv. III) | ✅ | `shadow.mjs` |
| 8 | Repository + profilo di divergenza (inv. II) | ⚠️ **costruito, non collegato** | `repo-map.mjs` ✅; `divergence-profile.mjs` esiste, è provato, e **nessun file lo importa** |
| 9 | Verificatore per ricalcolo + copertura | ✅ | `verification.mjs`, `verifiability.mjs` |
| 10 | Catalogo strumenti a carico zero (inv. V) | ✅ | `tool-catalog.mjs`; `CE-016` **misurato** in `D-0303`, non più asserito |
| 11 | ATOM come secondo provider (inv. VI) | ✅ | `atom-client.mjs`, `reasoning-router.mjs` |
| — | **L'Autore** | ❌ **mai specificato, mai costruito** | §1 di questo documento |

**Dieci passi su undici esistono.** I due che mancano sono il **passo 2** — che `15` §14 dichiara
il più invasivo, *«se lo stato e il proiettore non sono i primi, ogni componente scritto prima va
rifatto»* — e una componente che l'ordine non conteneva.

**Conseguenza sull'ordine, dichiarata.** L'Autore consuma lo stato: i file veri, il passo
corrente, il profilo di divergenza, i tentativi già fatti. Costruirlo su una trascrizione che
accumula significa costruirlo due volte. **L'invenzione I torna a essere il primo lavoro**, non
per fedeltà al documento ma perché l'Autore è il primo componente che ne paga davvero l'assenza:
è quello che chiama il modello ripetutamente sullo stesso compito, cioè il caso in cui il
contesto che cresce diventa il difetto misurato di `15` §2 — «dopo 25–30 chiamate a strumenti la
coerenza si rompe anche con 200K di contesto».

---

## 6. Le righe nuove della matrice

Si aggiungono a `CE-001…024`, con la stessa disciplina: verificabili **eseguendo**, non leggendo.

| ID | Criterio | Sev | Come si verifica | Verdetto |
|---|---|---|---|---|
| CE-025 | L'Autore non nomina mai un percorso: l'insieme dei file che tocca è un sottoinsieme di quelli del passo | **C** | autore sonda che tenta di scrivere fuori elenco; il tentativo è scartato e registrato | ✅ **verificato 2026-08-19 (`D-0573`)** — `services/reference-control-plane/test/ce-025-author-never-names-a-path.test.mjs`, **7/7**, e le **due** metà che il metodo nomina, separate. **Scartato**: la sonda risponde nella voce del modello — un blocco recintato la cui prima riga è una direttiva di percorso, in **ogni** grafia che `PATH_DIRECTIVE` accetta (`path:`, `// file:`, `# filename:`, `<!-- path:`) — e i byte finiscono sotto la chiave che **il Piano** ha passato, con la direttiva rimossa anche dal contenuto: non è ignorata come percorso e lasciata dentro come testo. `../../etc/passwd` e `/etc/shadow` passano dalla stessa riga di `notes.txt`, ed è il punto: non c'è un caso speciale da sbagliare, perché nessuna rivendicazione viene onorata. **Registrato**: `discarded` porta `{path, claimed}` per **ognuna** — una pila di tre direttive produce tre righe, non una — e il conteggio `discardedPaths` è sulla risposta che l'operatore legge. Un provider che dichiara di aver già controllato **non è creduto**: `normaliseAuthored()` ri-applica la regola e la rivendicazione nascosta viene tolta di nuovo, accanto a quella che il provider dice di aver già scartato. **Il sottoinsieme è provato come INSIEME**, non file per file: tre file consegnati, quattro altri rivendicati, e l'asserzione è sulle chiavi di `contents ∪ unchanged` — un controllo per singolo percorso passerebbe mentre l'insieme cresce. **E fino al disco**: `plan → measure → approve` con la sonda attiva cambia **esattamente un file**, quello del Piano; l'elenco della directory prima e dopo è identico, `not-in-the-plan.txt` è intatto, e niente è comparso fuori dal workspace. Controllo negativo: una risposta onesta autora normalmente e scarta zero. |
| CE-026 | Nessun contenuto autorato raggiunge il repository vero senza essere prima esistito in ombra | **C** | test che tenta di promuovere un contenuto mai simulato | ✅ **verificato 2026-08-19 (`D-0566`)** — `ce-008-shadow-precedes-authorization.test.mjs`, 5/5. Ciò che arriva nel workspace sono i **byte dell'ombra**: `#promote` legge da `shadow.root` e non esiste un secondo scrittore (chiusura misurata in `CE-001`). Misurato in entrambe le direzioni: una run promossa registra `executor.ran` → `shadow.compared` → promozione, e l'ombra **non sopravvive** alla chiamata (0 directory residue); una run la cui verifica è **contraddetta** non promuove nulla e il file reale resta ai byte di prima. |
| CE-027 | Ogni autoratura è registrata come fixture e la sessione si riesegue producendo le stesse **decisioni** | **A** | replay di una sessione conclusa, contenuti dalle fixture, decisioni ricalcolate |  |
| CE-028 | Il profilo di divergenza entra nell'autoratura, e due repository con convenzioni opposte producono contenuti diversi a parità di richiesta | **A** | lo stesso compito su due repository con convenzioni opposte |  |
| CE-029 | Un'installazione senza modello **rifiuta di autorare dicendo perché**, e non degrada a un rifiuto muto né a un contenuto vuoto | **C** | installazione senza provider configurato, ispezione della risposta | ✅ **verificato 2026-08-19 (`D-0571`)** — `services/reference-control-plane/test/ce-029-no-model-refuses-to-author.test.mjs`, **12/12**, con il metodo che la riga stessa dichiara: **un listener vero avviato senza `NOESAR_AUTHORING_ENDPOINT`** — l'unica cosa che `buildAuthor()` legge per decidere che sotto non c'è niente — e **l'ispezione della risposta**. `POST /api/v1/workspace-actions/plan` risponde **201**, non un silenzio né un 503: il piano esiste, e la risposta porta `authoring.available:false`, `authored:0` e la ragione **per esteso** (`Author.NO_MODEL_REASON`), che nomina cosa manca, cosa continua a funzionare e la promessa sul contenuto vuoto. Il «contenuto vuoto» è misurato **sui byte**: `plan → measure → approve` sulla stessa installazione promuove esattamente i byte del chiamante, riletti da disco. La seconda via verso il vuoto è chiusa a parte — un modello *configurato* che risponde con un blocco vuoto è rifiutato **per nome** (`EMPTY`), `authored:0`, e il file resta quello del chiamante. Controllo negativo: un modello che risponde davvero autora, `authored:1`, e i byte su disco sono i suoi. **Ampiezza dichiarata:** questo è il metodo della riga — *la risposta*. Come le due shell **rendano** `authoring.reason` non è coperto e non è affermato: misurato in questa sessione, **nessun file sotto `apps/` legge quel campo**, quindi la ragione arriva all'API e si ferma lì — registrato come `F-AUTH-UI-001`. |
| CE-030 | Due autorature che producono lo stesso contenuto contano come **un** tentativo | **M** | compito che induce ripetizione, conteggio del budget di novità |  |
| CE-031 | La sessione è raggiungibile da un utente **non amministratore dell'host**, sull'host e da un'altra macchina | **A** | accesso reale da un secondo utente, senza privilegi sul motore di contenitori |  |
| CE-032 | L'avviatore non presume sistema operativo, demone `ssh`, motore di contenitori o percorso | **A** | avvio su un'installazione da sorgenti e su una in contenitore, senza modificare l'host |  |

**Il criterio della fase 1 si riformula, senza cambiare** — si esplicita ciò che diceva già:

> Apre un repository vero, ne capisce la struttura, riceve una richiesta, produce un piano,
> **scrive lui il cambiamento**, ottiene un'autorizzazione su un risultato già misurato in ombra,
> cambia diversi file, mostra il diff, esegue i test, corregge un errore, produce un risultato
> verificabile, ripristina lo stato precedente su richiesta, registra ogni operazione — e **non
> esce mai nemmeno una volta dall'autorità che gli è stata data**.

Le tre parole aggiunte sono **«scrive lui il cambiamento»**. Senza di esse la frase era vera di un
prodotto in cui il cambiamento lo scrive l'Owner a mano, ed è esattamente ciò che è stato
costruito.

---

## 7. Cosa NON cambia

Registrato per non doverlo ridiscutere.

| Cosa | Perché resta |
|---|---|
| La regola sola: nulla muta il workspace se non eseguendo un Piano autorizzato | L'Autore produce byte, non effetti. Non conia token e non scrive file |
| L'ombra precede l'autorizzazione | La generazione la rende utile, non la scavalca |
| `FOSS_CORE_DEPENDS_ON_ATOM = false` | Vincolo sul **nucleo pubblico e sulla sua suite**, non sul prodotto: nel prodotto risponde ATOM, sempre. `CE-022` è intatto e significa ciò che ha sempre significato |
| ATOM fuori da git | Repository separato, mai in uno pubblico. Nessuna eccezione in questo documento |
| Il contratto `ReasoningProvider`, congelato a dodici superfici | L'Autore ne sta **fuori**, per la ragione di §3.1. Nessuna versione del contratto cambia |
| Il contenuto del repository e del web non altera istruzioni, policy o token | L'uscita dell'Autore entra nella stessa categoria: non fidata |
| Nessuna denylist testuale | Non se ne introduce una sull'uscita del modello: i percorsi ammessi sono un **insieme chiuso**, che è una costruzione, non un filtro |
| Il prodotto non possiede l'host | La ricetta `ssh` è documentazione d'installazione, mai un passo che il prodotto esegue |

---

## 8. Il difetto trovato per strada, da riparare

`tools/tui-client.mjs:180` rifiuta la prosa **lato client**, senza chiamare il motore:

```js
if (!files.length) { console.log('No files named — nothing to plan. The reference
  reasoning has no model and cannot invent a target from prose alone.'); return; }
```

Quel messaggio è stato **superato dal motore** (`workspace-actions.mjs:350`, `D-0303`): `files` è
diventato opzionale e un elenco vuoto è «una richiesta di guardare, non una chiamata malformata».
La shell del browser è stata aggiornata; **quella da terminale no**. Una shell su due, e la
divergenza non è stata dichiarata — contro `06_CODEN_EVOLUTION.md` §1, *«le due shell non
divergono in nessun punto»*, che è la scelta più cara del progetto.

Si ripara prima di costruire l'Autore, perché è il percorso su cui l'Autore atterra.

---

## 9. L'ordine di lavoro

Per dipendenza, come `15` §10.

| # | Cosa | Perché in questa posizione |
|---|---|---|
| 1 | La prosa arriva al motore da **entrambe** le shell | è il percorso su cui tutto il resto atterra, ed è rotto oggi |
| 2 | **La WebUI diventa la TUI resa in un browser** (§4b) | va fatto **prima** dell'Autore: l'Autore consegna trascrizione, diff ed evidenza, e consegnarli a due interfacce diverse è costruirli due volte |
| 3 | **Lo stato e il proiettore di contesto** (inv. I) | l'Autore ci scrive e ci legge; farlo dopo significa rifarlo |
| 4 | **L'Autore**, con l'insieme chiuso dei percorsi e la registrazione a fixture | è ciò che rende il prodotto capace di fare il lavoro |
| 5 | **Il ripiego dichiarato** quando ATOM cade (§3.1c) | prima si costruisce ciò che deve reggere, poi lo si rende resistente |
| 6 | Il **profilo di divergenza** collegato — all'autoratura e al diff | `CE-010` è costruito e non usato; qui trova il suo consumatore |
| 7 | `coden_evolution` — l'avviatore e la ricetta d'accesso | il lavoro esiste: ora dev'essere raggiungibile in un gesto |

**Perché il punto 2 sale così in alto.** Era la voce più facile da rimandare e sarebbe stata
l'errore più caro: l'Autore produce una trascrizione, un diff, un'evidenza e una domanda di
promozione. Se le due shell sono ancora due prodotti diversi quando l'Autore arriva, ognuna di
quelle quattro cose si costruisce due volte — ed è esattamente la classe di spreco che le fasi
1-5 hanno già pagato una volta.

---

## 10. Decisioni registrate qui

| ID | Decisione |
|---|---|
| `D-0304` | Nessuna superficie del prodotto produce il contenuto di un file, e l'assenza è **nella specifica** prima che nel codice. La matrice `CE-001…024` non se ne accorge perché misura ventiquattro proprietà del cambiamento e nessuna chiede chi lo ha scritto |
| `D-0305` | L'**Autore** sta **fuori** dal contratto `ReasoningProvider` — il contratto è ciò che deve coincidere al replay, il contenuto autorato è ciò che il replay riproduce da fixture — e chi autora è **ATOM, sopra un modello qualsiasi**, su tutte e tre le superfici (Chat, CodeN Evolution, TUI via `ssh`). Il modello è intercambiabile, ATOM no, e ATOM resta fuori da git. `CE-022` resta un vincolo sul nucleo pubblico e sulla sua suite, non una dichiarazione che ATOM sia opzionale |
| `D-0306` | L'Autore riceve un **insieme chiuso** di percorsi dal Piano e non ne nomina mai uno. La sua uscita è contenuto non fidato, entra nella copia in ombra e **mai** nel repository vero, e ogni chiamata è una fixture |
| `D-0307` | L'autoratura si innesta allo stadio **9b**, prima dell'ombra e dell'autorizzazione: si promuove un risultato misurato, mai una proposta di scrittura |
| `D-0308` | Il profilo di divergenza (inv. II) entra **prima** dell'autoratura, non solo dopo il diff: serve a scrivere un cambiamento simile a quelli che questo repository ha accettato, non solo a giudicarlo |
| `D-0309` | L'accesso alla sessione si divide: il **prodotto** fornisce un avviatore portabile, l'**installazione** fornisce la ricetta per l'utente di sistema dedicato. Il prodotto non tocca mai la configurazione dell'host |
| `D-0310` | Righe di matrice `CE-025…032`, e il criterio della fase 1 esplicita **«scrive lui il cambiamento»** — clausola che era assente e che rendeva la frase vera di un prodotto in cui il cambiamento lo scrive l'Owner a mano |
| `D-0311` | L'invenzione I torna a essere il primo lavoro, perché l'Autore è il primo componente che paga davvero l'assenza del proiettore: è quello che chiama il modello ripetutamente sullo stesso compito |
| `D-0312` | **Se ATOM cade, il prodotto continua sul modello — e lo dichiara.** Il ripiego non è vietato, è vietato *in silenzio*: la provenienza registra `reference` più la ragione e l'istante, lo stato è visibile in entrambe le shell e nella Prova di Sessione, e un passo in corso si ferma con un checkpoint riprendibile invece di finire a metà qualità. In più ATOM va reso robusto e la frequenza delle cadute va misurata. È la lettura corretta di `CE-022`: non «ATOM è opzionale», ma «se ATOM manca, sotto c'è ancora un prodotto» |
| `D-0313` | **La WebUI è la TUI resa in un browser**, non una seconda interfaccia sopra lo stesso motore. Forma canonica: trascrizione + prompt + riga di stato. Il banco a 25 pannelli perde la cornice da cruscotto, non le funzioni: erano già indirizzi dalle fasi 1-4 (`coden-address-book.mjs`), quindi restano posti dove si va con `/diff`, `panel diff`, F1…F9. Righe nuove `CE-033`/`CE-034` |
| `D-0314` | **Il gesto d'accesso è una parola**: `ssh` dalla stessa rete, `coden_evolution`, e la sessione parte — nessun nome di contenitore, nessun percorso, nessun privilegio di amministratore. L'autenticazione del prodotto resta e sta **dentro**, dopo l'ingresso: la semplicità richiesta è nel gesto, non nel controllo. Riga nuova `CE-035` |
| `D-0315` | **`/` nella casella del prompt apre l'unico menu del prodotto**: Lavoro (i comandi), Applicazioni (le destinazioni), Configura (skill, modelli, moduli, impostazioni), Sessione (`/logout`). Il menu **assorbe** la navigazione invece di aggiungersi: la barra degli indirizzi in alto sparisce, e con essa l'ambiguità s319 delle due `/`. Voci da una fonte sola, filtrate per permesso e **dichiarate filtrate**, identiche nelle due shell. Riga nuova `CE-036` |
| `D-0316` | Il programma è governato da `17_CODEN_EVOLUTION_PIANO_DI_LAVORO.md`: **8 fasi**, ognuna con contratto a sei righe scritto *prima* di toccare un file, misura prima/dopo, e condizione di stop osservabile. La skill obbligatoria `noesar-evolution` vi punta e porta le cinque regole anti-errore, ognuna derivata da un fallimento misurato in questo repository |
