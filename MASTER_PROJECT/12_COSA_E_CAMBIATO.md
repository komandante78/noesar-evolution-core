# 12 · Dal progetto consegnato a questo — cosa è cambiato

Confronto onesto fra il **progetto V4 che ti hanno consegnato** (64 documenti +
`NOESAR_EVOLUTION_MASTER_PROJECT_V4.zip`) e **questa riscrittura**.

**La cosa più importante da dire subito: il V4 non era sbagliato.** Era una specifica seria e
la maggior parte è rimasta intatta. Quello che è cambiato è che **adesso ha un centro**, e che
alcune promesse che non potevano reggere sono state riformulate in modo che reggano.

---

## 1. In una tabella

| | V4 consegnato | Questa riscrittura |
|---|---|---|
| **Il centro** | ATOM citato in 5 documenti, contratto **mai scritto** | Il contratto è **il primo pezzo da costruire**, con dieci superfici definite e i numeri di 38 esperimenti che ne dimostrano i meccanismi |
| **Cos'è ATOM** | *"un provider di ragionamento proprietario"* — una categoria | **Come funziona**: scompone finché verificare è ricalcolare, non giudicare |
| **Il Security Kernel** | Dodici componenti da costruire | **Un meccanismo** — i capability token — che li assorbe tutti e dodici |
| **La sicurezza** | Una catena in sei passi, mai scritta in codice | La stessa catena, **più la regola che la rende strutturale**: il modello non ha superficie d'azione |
| **La memoria** | Record autoritativi separati dagli indici | **Tre semantiche** con muri applicati dallo schema, non dalla buona condotta |
| **La privacy** | Sette stati, derivati da un broker | Gli stessi — **più** cosa succede quando i dati di lavoro incontrano un modello remoto |
| **CodeN** | *"workspace staccabile"*, dieci stadi | **Sedici stadi**, due shell sulla stessa sessione, percorso proporzionato al rischio |
| **La WebUI** | Riferimento vincolante | Lo stesso — con **26 → 11 destinazioni** |
| **L'autonomia** | Non trattata | **Persistenza per progetto**: scala a otto gradini, budget sulla novità |
| **La posizione commerciale** | Self-hosted, local-first, estensibile — *come tutti* | **La Prova di Sessione** — dimostrare invece di affermare |
| **Il "domani"** | Technology Radar, un documento | Lo stesso — **più** la conseguenza: crescere per **numero** di esperti, non per taglia |
| **Cosa è già costruito** | Non misurato | **Misurato**: 24.563 righe JS, 1.145 Rust, e le assenze contate una per una |

---

## 2. Cosa è rimasto identico

Perché il V4 aveva ragione, e cambiarlo sarebbe stato solo rumore.

- Un solo container OCI, niente Docker annidato, niente socket Docker montato.
- **PostgreSQL autoritativo, pgvector di default.** (Il tuo elenco di capacità suggeriva
  SQLite: rifiutato, vedi §4.)
- Core pubblico indipendentemente costruibile · AGPL-3.0 **oppure** licenza commerciale ·
  Apache-2.0 per SDK e contratti · CC BY-SA per la documentazione.
- ATOM privato dietro contratto pubblico · il lavoro finanziato non può dipendere da
  repository privati.
- Owner Bypass delimitato, a scadenza, auditato · invarianti non aggirabili · nessun segreto
  universale, nessuna backdoor.
- Nessuna installazione silenziosa di driver, runtime, modelli o pacchetti.
- Aggiornamenti firmati con anti-rollback e rollback conservato.
- Il framework dei moduli di settore va nel core; i moduli regolati no.
- I confini di uso previsto per medico, aerospaziale, finanziario, industriale, scientifico.
- Accessibilità WCAG 2.2 AA, UTC + fusi IANA, inglese canonico.
- I cinque archivi di consegna (`09 §4a`) · SBOM · provenienza · firme.

**In pratica: tutta la parte legale, di licenza, di conformità e di confine è rimasta com'era.**
Era la parte fatta meglio.

---

## 3. Cosa è cambiato davvero — le sette differenze che contano

### 3.1 · ATOM è passato da categoria a meccanismo

**Prima:** *"ATOM è un provider di ragionamento e orchestrazione proprietario"*. Vero, ma non
dice **cosa fa**, quindi non si può costruire e non si può vendere.

**Adesso:** ATOM ha una definizione operativa, misurata in laboratorio — non più solo un nome.
Il dettaglio (la definizione operativa, i numeri dei 38 esperimenti) sta nel blueprint privato
(`NOESAR-ATOM-PRIVATE/`), non qui, per la stessa ragione per cui `02_ATOM.md` e
`13_IL_VERIFICATORE.md` sono stati svuotati.

> **Questa è la differenza più grande di tutte.** Il V4 aveva ATOM come nome. Adesso ha ATOM
> come macchina, misurata — solo non qui il come.

### 3.2 · Dodici componenti di sicurezza sono diventati uno

**Prima:** Policy Decision Point, Capability Token Broker, Path Broker, Egress Broker, Secret
Broker, Model Trust Registry, Update Verifier, Sandbox Manager, Resource Governor, Audit
Ledger, Identity Guard, Emergency Stop. Dodici cose da costruire, ognuna con la sua interfaccia.

**Adesso:** un solo meccanismo — **il capability token** — e gli altri undici diventano *tipi*
di token o *luoghi* dove i token si emettono, si spendono o si registrano.

Non è solo eleganza. Ha tre conseguenze concrete: si costruisce una cosa invece di dodici; c'è
**una sola abitudine di consenso** invece di quattro finestre diverse che insegnano riflessi
diversi; e la revoca è globale per costruzione invece di dover essere implementata dodici volte.

### 3.3 · La sicurezza è diventata strutturale invece che difensiva

**Prima:** una catena — AI propone, policy decide, sandbox esegue, verificatore controlla,
audit registra — che nel codice **non esisteva** e che comunque descrive un flusso, non un
divieto.

**Adesso:** una regola che rende la catena inevitabile.

> Il modello **non ha superficie d'azione**. L'esecutore **non ha superficie di proposta**. Fra
> i due c'è solo un Piano che una persona ha firmato.

Un file con prompt injection può chiedere qualunque cosa: al massimo fa entrare un'*ipotesi*.
**Metà del capitolo sulla prompt injection smette di essere un elenco di difese e diventa una
proprietà.**

### 3.4 · La memoria ha guadagnato un muro che prima era una buona intenzione

**Prima:** *"i contenuti non fidati non possono diventare direttamente memoria autoritativa"*.
Giusto, ma è una regola che qualcuno deve ricordarsi di rispettare a ogni chiamata.

**Adesso:** tre semantiche — prodotto, lavoro, compito — **separate dallo schema e
dall'isolamento a livello di riga**, che è già costruito e verificato. Più il caso concreto che
il V4 non trattava: **cosa succede quando i dati di lavoro incontrano un modello remoto**
(vengono trattenuti, e la domanda viene risposta senza).

### 3.5 · È comparsa una posizione commerciale che prima non c'era

**Prima:** self-hosted, local-first, controllato dal cliente, estensibile, consapevole
dell'hardware. **Tutte vere, e tutte dicibili da almeno dieci concorrenti.**

**Adesso:** la **Prova di Sessione** — il prodotto dimostra meccanicamente ciò che afferma,
mentre gli altri possono solo affermarlo. Non è marketing appiccicato sopra: sono sei cose che
il V4 pretendeva già separatamente e che **nessuno aveva mai collegato**.

E risolve un problema commerciale che il V4 aveva senza saperlo: **come si vende un componente
proprietario dentro un prodotto aperto senza mutilare l'aperto.** Risposta: ATOM smette di
essere *il pezzo che devi comprare* e diventa *il pezzo che rende l'evidenza degna di essere
letta*.

### 3.6 · Il ciclo di CodeN è passato da dieci a sedici stadi

**Prima:** ispeziona, capisci, proponi piano, identifica file e dipendenze, chiedi autorità,
backup, implementa, testa, rivedi il diff, accetta o annulla.

**Adesso:** gli stessi dieci, **più sei che erano nascosti dentro gli altri**:

| Nuovo stadio | Perché era nascosto, e perché va separato |
|---|---|
| **Chiarimento** | Una richiesta ambigua produce lavoro sicuro di sé sul bersaglio sbagliato. Il momento più economico per accorgersene è **prima che il piano esista**. |
| **Recupero dell'evidenza** | "Capisci" accorpava leggere il codice e capirlo. Sono cose diverse e falliscono diversamente. |
| **Ipotesi** | Il V4 saltava dal capire al piano. Ma **quale** piano dipende da quale causa si crede, e le cause vanno messe in ordine con le prove contrarie. |
| **Decomposizione** | È il cuore ATOM. Senza, un passo resta troppo grosso per essere verificato. |
| **Attesa dichiarata** | Senza, "sorpresa" non è definibile e non c'è autocorrezione. |
| **Simulazione** | Trasforma *"proviamo e vediamo"* in *"ha già provato, ecco cos'è successo"*. |

Più una cosa che il V4 non aveva affatto: **il percorso è proporzionato al rischio**. Sedici
stadi per correggere un refuso sarebbe assurdo, e un prodotto assurdo sulle cose piccole viene
aggirato sulle grandi.

### 3.7 · È comparsa una risposta al "domani"

**Prima:** un Technology Radar con anelli e metadati firmati. Buono, ma è un processo.

**Adesso:** il processo più **la conseguenza strategica**, che viene dai numeri del laboratorio:

> **Crescere per numero di esperti, non per taglia di un blocco unico.**

Comporre esperti piccoli e verificati batte del **46%** un monolite della stessa dimensione
totale. La scommessa opposta — un modello sempre più grande — dipende da hardware che non hai e
che invecchia. Questa dipende dal **numero di pezzi verificati accumulati**, che cresce col
tempo di lavoro invece che col budget.

**È l'unica forma di crescita che va nella direzione giusta per un prodotto self-hosted** — ed
è anche perché la parola "Evolution" nel nome smette di voler dire "versione più nuova".

---

## 4. Cosa ho rifiutato del materiale che mi hai dato

L'elenco di 38 sezioni che mi hai passato descriveva un IDE agentico generico. Ne ho tenuto
tutta l'ambizione e ho rifiutato sei cose, **dichiarandole invece di ometterle in silenzio**.

| Rifiutato | Perché |
|---|---|
| **SQLite per la prima versione** | Il prodotto **ha già** PostgreSQL con isolamento a livello di riga, ed è quello che rende applicabili i muri fra le tre semantiche. Andrebbe disfatto subito. |
| **App desktop Tauri** | Il prodotto è un server raggiunto in loopback o LAN, e la tua richiesta è **una shell SSH e una WebUI**. Un guscio desktop è una decisione di packaging successiva **sopra lo stesso protocollo**, non l'architettura. |
| **Una finestra di autorizzazione per sottosistema** | Collassate nei capability token. Quattro abitudini di consenso sono quattro occasioni di formare il riflesso sbagliato. |
| **"L'agente aggiorna le dipendenze"** | Resta un obiettivo, ma è un'azione **con token e checkpoint**, mai un'iniziativa: la mutazione dell'host è vietata dalla specifica. |
| **Esecuzione cloud e app mobile** | Non rifiutate — **rinviate**. Sono superfici di uscita e vanno progettate *attraverso* l'impegno di privacy, non accanto. |
| **Conferma con un tasto solo** | In un terminale `y` è a un incollaggio di distanza dall'essere digitato da qualcosa che non sei tu. |

---

## 5. Cosa ho aggiunto che non c'era da nessuna parte

Né nel V4, né nel tuo elenco.

| Aggiunta | Perché |
|---|---|
| **Modalità Recupero** | Quando un compito è andato male l'istinto è continuare. Una modalità in cui **il progresso in avanti è impossibile** è come una brutta sessione non diventa una brutta giornata. |
| **Budget sulla novità, non sullo sforzo** | *Un approccio ripetuto non conta come tentativo.* È l'unico controllo che funziona sui modelli piccoli, che non falliscono fermandosi ma **ripetendosi con sicurezza**. |
| **Normalizzazione obbligatoria delle firme d'errore** | Uno stack trace contiene percorsi e **valori**. Senza normalizzazione, "la query non contiene mai i tuoi dati" era falso. |
| **Replay del livello delle decisioni** | I modelli non sono deterministici. Rieseguire *le decisioni* contro gli output registrati è **vero** e più forte — e permette di rieseguire una vecchia sessione contro una policy nuova. |
| **Categoria "schema morto"** | Una colonna che esiste e che nessuno usa è **peggio** di una funzione assente: sembra una funzione che c'è. |
| **Percorso proporzionato al rischio** | Perché un prodotto assurdo sulle cose piccole viene aggirato sulle grandi. |

---

## 6. La differenza in una frase

> **Il V4 descriveva un prodotto corretto. Questa riscrittura descrive un prodotto
> costruibile, con un centro che regge, una cosa da vendere che nessun altro ha, e le promesse
> che non potevano reggere riformulate in modo che reggano.**

E la misura di quanto sia cambiato poco: **tutta la parte legale, di licenza, di conformità e
di confine è rimasta com'era.** Non ho toccato ciò che era già giusto.
