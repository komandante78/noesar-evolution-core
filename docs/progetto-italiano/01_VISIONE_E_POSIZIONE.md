# 01 · Visione e posizione originale

## Cos'è

NOESAR Evolution è un **ambiente operativo AI self-hosted**: modelli, hardware, documenti,
progetti, agenti, flussi di lavoro, memoria, ricerca e un workspace di sviluppo, sotto il
controllo di chi lo installa. Nessun servizio cloud obbligatorio. I prompt, i documenti, il
codice, la memoria, lo stato degli agenti e i segreti restano dove sono.

Questo è ciò che diceva già il V4, ed è giusto. Ma descrive una categoria, non un prodotto:
ci sono almeno dieci progetti che dicono la stessa frase.

## Il problema vero della categoria

Ho guardato cosa condividono davvero i prodotti di questa categoria — wrapper di chat locali,
IDE agentici, costruttori di flussi, RAG privati, assistenti aziendali. Sopra sono diversi.
Sotto sono la stessa cosa:

1. **Il modello guida.** Emette chiamate a strumenti, e una guardia prova a intercettare
   quelle pericolose. Ogni fuga è un buco nella guardia.
2. **La privacy è affermata.** "Gira in locale" è testo statico che niente verifica mentre il
   programma lavora.
3. **La memoria è un pozzo solo.** I tuoi documenti, gli appunti dell'assistente e ciò che
   arriva dal web finiscono nello stesso indice con la stessa fiducia.
4. **L'audit è una trascrizione.** Registra che qualcosa è successo. Mai perché, sotto quale
   autorità, né se rifarebbe lo stesso.
5. **Le estensioni ereditano l'autorità dell'applicazione.**
6. **La conformità è una pagina di marketing.**

Sono tutte **affermazioni**. Nessuna è **dimostrabile dalla macchina che la fa**.

## La posizione originale

> **NOESAR Evolution può dimostrare meccanicamente le affermazioni che fa su sé stesso.
> Tutti gli altri possono solo affermarle.**

Non è uno slogan: è una proprietà che discende da sei cose che la specifica V4 pretende già
*separatamente*, e che nessuno aveva mai collegato fra loro.

| Ingrediente | Dove la specifica lo chiede | Cosa permette di dimostrare |
|---|---|---|
| Stato di privacy derivato da un broker che media l'egress reale | `12`, rischio `R-003` | *Nulla è uscito*, e non perché lo dico io |
| Stato di contaminazione come campo della memoria | `44` MEVCM | *Cosa ha letto, e quanto era affidabile in quel momento* |
| Eventi tipizzati con correlazione, causazione, digest | `25` | *Perché quel passo è avvenuto* |
| Capability token | `30` | *Cosa gli era permesso fare, esattamente* |
| Invarianti che nemmeno l'Owner può spegnere | `33` | *Cosa non poteva succedere in nessun caso* |
| Fixture di replay deterministico | contratto ATOM | *Rifallo, e ottieni le stesse decisioni* |

## Il prodotto della posizione: la Prova di Sessione

Ogni lavoro emette un pacchetto firmato e autoconsistente:

```text
  intento         cosa è stato chiesto, e come è stato interpretato
  ipotesi         cosa è stato considerato, in ordine, con le prove contrarie
  piano           l'oggetto che è stato autorizzato — non una trascrizione
  attesa          cosa il piano diceva che sarebbe successo
  realtà          cosa è successo davvero, dal run in ombra e da quello reale
  autorità        ogni capability token emesso, speso, negato, revocato
  egress          lo stato di privacy campionato lungo tutto il lavoro
  provenienza     ogni fonte letta, col suo stato di contaminazione in quel momento
  esito           il diff, i test, cosa NON è stato fatto, il rischio residuo
  fixture         quanto basta per rieseguire la sessione in modo deterministico
```

Lo consegni a un revisore, a un cliente, a un regolatore — o a te stesso fra sei mesi.

### Cosa significa esattamente "rieseguibile" *(corretto — vedi documento 11, P1)*

**Il replay non rigenera: riesegue il livello delle decisioni contro gli output di modello
registrati.** I modelli linguistici non sono deterministici — nemmeno a temperatura zero, per
via dell'aritmetica in virgola mobile su GPU — quindi promettere di riprodurre le loro risposte
sarebbe una promessa che si rompe alla prima verifica.

| Livello | Nel replay |
|---|---|
| Output dei modelli | **riprodotti dalle fixture registrate** |
| Interpretazione, ipotesi, piano, attesa, classificazione | **rieseguiti, e devono coincidere** |
| Policy, autorizzazioni, emissione dei token | **rieseguiti, e devono coincidere** |
| Esecuzione in ombra e verifica | **rieseguite sui file registrati** |

Così il replay è **deterministico al 100%** e non dipende dalla riproducibilità dei modelli.
Risponde alla domanda che conta: *«dato quello che il modello ha detto, la macchina avrebbe
deciso la stessa cosa?»* — cioè verifica **la parte di cui il prodotto è responsabile**.

E se ne guadagna una in più: si può **rieseguire una vecchia sessione contro una versione più
recente del prodotto**, e vedere se una policy nuova avrebbe rifiutato ciò che allora era stato
permesso. Con la rigenerazione sarebbe stato impossibile.

### Perché i concorrenti non lo copiano in fretta

Non perché sia furbo, ma perché **sta a valle dell'architettura**:

- Chi ha il piano come stringa in un prompt non ha niente da mettere nel campo `piano`.
- Chi non ha un broker di egress può riempire `egress` solo con una promessa.
- Chi ha un pozzo di memoria solo non ha nessuno stato di contaminazione da registrare.
- Chi lascia che il modello emetta chiamate a strumenti non ha una traccia di `autorità`,
  perché non sono mai esistiti dei token.

Non è una funzione da aggiungere. È ciò che **cade fuori** dall'aver costruito le sei cose
sotto — e ognuna di quelle, per loro, è una riscrittura.

### Perché ATOM ne è il centro e non un accessorio

Senza un provider di ragionamento che produce un **oggetto piano**, non c'è niente da
dimostrare. Il valore del pacchetto è esattamente la qualità del ragionamento che registra.

Questo rovescia l'imbarazzo tipico di un pezzo proprietario dentro un prodotto aperto:
**ATOM smette di essere "il pezzo che devi comprare" e diventa "il pezzo che rende l'evidenza
degna di essere letta"** — sopra un core pubblico che l'evidenza la produce già da solo, più
semplice ma valida e completa.

### Perché vale di più col passare del tempo

I modelli diventano più piccoli, più economici e più numerosi, e sempre più lavoro verrà
fatto senza nessuno che guarda. Quando succede, la cosa scarsa smette di essere *generare
lavoro* e diventa **fidarsi di lavoro che nessuno ha guardato**.

Una interfaccia di chat vale meno ogni anno. Un registro verificabile di lavoro autonomo vale
di più ogni anno. Ed è esattamente l'oggetto che i settori regolati descritti nei documenti
70-77 devono avere prima di poter adottare qualunque cosa.

**Questo è il significato della parola "Evolution" nel nome**: non "una versione più nuova",
ma un prodotto la cui utilità cresce man mano che il mondo attorno cambia, invece di
consumarsi.

## L'estensione futura, per non invecchiare

Oggi il broker di egress dimostra che **nulla è uscito dalla macchina**.

Domani, con il *confidential computing* — già citato nel Technology Radar della specifica,
assente dal codice — lo stesso meccanismo potrà dimostrare una cosa più difficile: **è
uscito, e la macchina che l'ha ricevuto non poteva leggerlo**.

Non è un altro prodotto. È la stessa frase con un verbo più forte. Ed è il test che ogni
funzione "di domani" deve superare per entrare:

> **Estende la spina dorsale, oppure si appoggia di fianco?** Se si appoggia di fianco, non entra.

## Per chi è

| Utente | Cosa ci trova |
|---|---|
| **Professionista singolo** | Un assistente che lavora sui suoi documenti senza che escano, e un workspace di sviluppo che chiede prima di toccare |
| **Studio o piccola azienda** | Isolamento reale fra progetti e persone, con un registro di chi ha autorizzato cosa |
| **Settore regolato** | La Prova di Sessione, che è l'unica cosa che un revisore può effettivamente esaminare |
| **Ente pubblico / finanziatore** | Un core interamente costruibile, libero, senza dipendenze private — che funziona sul serio, non come dimostrazione |
| **Chi sviluppa moduli** | Contratti congelati e versionati, e un sandbox che non può auto-concedersi permessi |

## Cosa NON è, dichiarato per non doverlo smentire dopo

- Non è un dispositivo medico, un controllore chirurgico, un sistema avionico certificato,
  una piattaforma di trading dal vivo né un controllore di sicurezza industriale. Quelle sono
  **moduli separati**, con validazione propria.
- Non è conformità. Self-hosting riduce la divulgazione, non gli obblighi di legge.
- Non è "a prova di hacker" e non promette egress zero in assoluto: promette di **dirti** lo
  stato reale, verificato, in ogni momento.
