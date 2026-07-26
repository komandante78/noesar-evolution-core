# 11 · Revisione critica e correzioni

Revisione del mio stesso lavoro — l'analisi dei difetti e il progetto riscritto — su tua
richiesta, con le decisioni prese da me su tua autorizzazione.

Ho trovato **tre errori nella mia analisi** e **sette difetti di progetto**. Tutti corretti
qui, e le correzioni sono già applicate agli altri documenti.

---

# Parte A — Errori nella mia analisi

## A1 · Ho dichiarato "zero file" per tre cose che esistono

**Causa:** ho cercato per nome specifico nel codice e **non ho mai cercato nello schema del
database**. Un grep che sotto-riporta è pericoloso quanto uno che grida al lupo: nel primo caso
si costruisce due volte, nel secondo si smette di leggerlo.

| Avevo detto | Realtà misurata | Correzione |
|---|---|---|
| Model Trust Registry — **0 file** | `model_descriptors.trust_state` esiste già nello schema, con gli stati giusti: `quarantined / verified / active / revoked` | **Sbagliato.** Ma il seguito è peggio, vedi A3 |
| Secret Broker — **0 file** | **13 file** contengono un vault, e il tool executor lo usa davvero (`this.vault.resolve(...)`) | **Sbagliato.** Esiste in forma parziale |
| Resource Governor — **0 file** | **4 file** con quota/rlimit | **Sbagliato.** Esiste in forma parziale |

**Confermati corretti:** Capability Token **0 file**, Emergency Stop **0 file**,
`ReasoningProvider` **0 file**, Policy Decision Point assente, pipeline
`AI_PROPOSES→…→AUDIT_RECORDS` assente dal codice. I due critici reggono.

## A2 · "MEVCM zero file" confondeva l'acronimo col concetto

`memory_items.provenance` **esiste ed è scritto e letto davvero** dal repository PostgreSQL. È
il concetto giusto, già vivo.

**Non esistono:** stato di contaminazione, canary, pipeline di promozione, legami causali,
salienza. Quindi la conclusione — *la memoria non ha ciò che rende affidabile il recupero* —
resta valida, ma la partenza non è da zero. Si estende una tabella che c'è.

## A3 · Ho mancato una categoria, ed è peggiore di "assente"

**Schema morto.** `model_descriptors.trust_state` esiste, ha gli stati giusti, ed è **letto e
scritto da nessuno**. Zero riferimenti nel codice.

È più pericoloso di una funzione assente, per una ragione precisa: **una colonna che c'è
sembra una funzione che c'è.** Chi legge lo schema conclude che i modelli hanno un ciclo di
fiducia. Non ce l'hanno: hanno una colonna che nessuno guarda.

**Decisione:** lo schema morto diventa una categoria propria nella tabella dei difetti, con
severità **superiore** all'assenza pura, e la regola che ne discende è:

> **Una colonna che nessun codice legge o scrive va rimossa oppure cablata. Lasciarla è
> creare una falsa evidenza per il prossimo che guarda.**

---

# Parte B — Difetti nel progetto che ho riscritto

## P1 · Il replay deterministico era una promessa che non potevo mantenere ⚠ il più grave

**Il problema:** ho scritto che chiunque abbia il pacchetto e la stessa release può
«rieseguire la sessione e ottenere le stesse decisioni». **Non è vero e non può esserlo.** I
modelli linguistici non sono deterministici: anche a temperatura zero, la stessa versione e lo
stesso runtime, l'aritmetica in virgola mobile su GPU non garantisce lo stesso output. Una
promessa del genere si rompe la prima volta che un revisore la mette alla prova, e con essa la
credibilità di tutto il resto del pacchetto.

**La correzione, che è più forte di quello che avevo scritto:**

> **Il replay non rigenera. Riesegue il livello delle decisioni contro gli output di modello
> registrati.**

| Livello | Nel replay |
|---|---|
| Output dei modelli | **riprodotti dalle fixture registrate**, non richiesti di nuovo |
| Interpretazione, ipotesi, piano, attesa, classificazione | **rieseguiti davvero**, e devono coincidere |
| Policy, autorizzazioni, emissione dei token | **rieseguiti davvero**, e devono coincidere |
| Esecuzione in ombra e verifica | **rieseguite davvero** sui file registrati |

Così il replay è **deterministico al 100%**, non dipende dalla riproducibilità dei modelli, e
risponde alla domanda che conta davvero: *«dato quello che il modello ha detto, la macchina
avrebbe deciso la stessa cosa?»* Cioè verifica **la parte di cui il prodotto è responsabile**.

E si guadagna una proprietà che non avevo: **si può rieseguire una sessione contro una
versione più recente del prodotto** e vedere se una policy nuova avrebbe rifiutato ciò che
allora era stato permesso. Con la rigenerazione questo sarebbe stato impossibile.

## P2 · Dipendenza circolare sui token di lettura

**Il problema:** ho scritto «senza token l'esecutore non può fare nulla, nemmeno leggere». Ma
un Piano si produce **leggendo** il repository — e un token nasce **da un Piano autorizzato**.
Non si può leggere senza un piano e non si può pianificare senza leggere. Il prodotto, come
l'avevo descritto, **non si avvia**.

**La correzione:**

| Tipo di accesso | Da dove nasce l'autorità |
|---|---|
| **Lettura dentro il workspace** | **token permanente concesso dalla modalità**, all'apertura del progetto — non serve un piano |
| Lettura fuori dal workspace | serve un piano |
| Qualunque mutazione | serve un piano autorizzato |
| Esecuzione di comandi | serve un piano autorizzato |
| Rete, segreti, database | serve un piano autorizzato |

Il token di lettura è comunque **un token**: ha ambito (questo workspace), scadenza (la
sessione), è nel registro, ed è revocabile. La regola resta vera nella sua forma corretta:
**nulla cambia senza un Piano autorizzato.** La lettura non cambia niente.

## P3 · Il gradino 6 rompeva la promessa local-first

**Il problema:** la scala di persistenza ha un gradino *"instrada su un modello più forte"*.
Se quel modello è remoto, il codice esce dalla macchina — e contraddice frontalmente la
decisione D-04, in un momento (l'agente è bloccato, sta lavorando da solo) in cui nessuno
guarda.

**La correzione:** il gradino 6 diventa **"modello locale più forte"**. Se non esiste un
modello locale più capace, il gradino **si salta**. Passare a un modello remoto non è un
gradino della scala: è una decisione separata, che richiede una concessione esplicita, cambia
lo stato di privacy in modo visibile, e comunque **i dati di lavoro restano trattenuti** — il
modello remoto riceve la descrizione del problema, mai il tuo codice.

## P4 · La firma di un errore può contenere i tuoi dati

**Il problema:** ho scritto che la query di ricerca è costruita dalla firma dell'errore e che
«non contiene mai il tuo sorgente». **Falso.** Uno stack trace contiene percorsi di file, nomi
di variabili, e spesso **valori** — un messaggio di errore di validazione può contenere dati di
un cliente. Avevo escluso l'ovvio e lasciato passare la via principale.

**La correzione:** fra la firma e la query c'è una **normalizzazione obbligatoria**:

```text
  firma grezza    TypeError: cannot read 'iban' of undefined
                    at /workspace/src/billing/customer-4471.mjs:82:14
                    valore: { nome: "Mario Rossi", iban: "IT60X054..." }
       │
       ▼  normalizzazione
  firma normalizzata   TypeError: cannot read property of undefined
                       modulo: <first-party>  ·  libreria: node:22.18
       │
       ▼  la stringa esatta è mostrata e registrata PRIMA di partire
  query            "TypeError cannot read property of undefined" node 22
```

Se una firma **non può essere normalizzata in sicurezza** (formato sconosciuto, contenuto non
classificabile), il gradino della ricerca **è bloccato** e si sale. Meglio saltare un gradino
che esportare un IBAN.

## P5 · La fase 1 non poteva superare il proprio criterio di "fatto"

**Il problema:** il criterio dice *"apre un repository vero, **ne capisce la struttura**,
riceve una richiesta, produce un piano…"* — ma avevo messo la mappa del repository nella
**fase 2**. La fase 1, così com'era scritta, non poteva superare il proprio esame.

**La correzione:** la comprensione minima del repository **entra nella fase 1**, perché
pianificare la richiede comunque: rilevamento dei linguaggi, punti d'ingresso, indice dei
simboli, ricerca letterale, mappa delle dipendenze. Restano in fase 2 i segnali di secondo
livello — proprietà, fragilità, criticità, copertura per modulo.

## P6 · Il percorso completo su una modifica banale è inutilizzabile

**Il problema:** sedici stadi con sei chiamate al modello prima che succeda qualcosa. Per
*"correggi questo refuso"* è assurdo — e un prodotto che è assurdo sulle cose piccole viene
aggirato sulle cose grandi, che è esattamente il fallimento che vuole evitare.

**La correzione: il percorso è proporzionato al rischio classificato.**

| Rischio | Percorso | Cosa resta sempre |
|---|---|---|
| **Banale** — un file, nessun comando, nessuna dipendenza | `interpret → plan → expect → autorizza → esegui → verifica` | Piano, attesa, token, esecuzione in ombra, Prova di Sessione |
| **Normale** | + ipotesi in competizione, decomposizione, raggio d'azione | tutto |
| **Alto o distruttivo** | tutti e sedici, simulazione obbligatoria | tutto |

**Ciò che non si salta mai, a nessun livello di rischio:** il Piano come oggetto, l'attesa
dichiarata, il token, l'esecuzione in ombra, l'audit. Quindi **la Prova di Sessione è completa
anche sul percorso breve** — ha solo meno ipotesi da mostrare.

Chi decide qual è il percorso è `classify`, cioè il provider. E un percorso breve che incontra
una **sorpresa** viene promosso automaticamente a quello completo: è il momento in cui si
scopre che banale non lo era.

## P7 · L'arresto d'emergenza non fermava niente

**Il problema:** avevo scritto che revoca tutti i token vivi. Ma revocare un token **non
interrompe un processo già in esecuzione**: un `rm -rf` partito continua a girare.

**La correzione:** l'arresto d'emergenza è una sequenza, in quest'ordine:

```text
  1  congela l'emissione di nuovi token          (nessun lavoro nuovo può iniziare)
  2  revoca tutti i token vivi                   (nessuna nuova azione autorizzata)
  3  uccide l'albero dei processi di ogni sandbox (ciò che gira si ferma davvero)
  4  smonta i mount scrivibili delle sandbox      (niente scritture in coda)
  5  registra tutto e conserva i checkpoint       (si può capire cosa stava succedendo)
  6  entra in modalità Recupero                   (progresso in avanti impossibile)
```

Si esce solo con un'azione umana esplicita.

---

# Parte C — Le due decisioni che erano rimaste aperte

Prese da me, su tua autorizzazione.

## D-A · Lo stack — **decisa: opzione B, con un confine preciso**

Il registro V4 approva Rust per i servizi privilegiati e React per la WebUI. Il prodotto è
24.563 righe di JavaScript.

**Decisione: si emenda il registro, non si riscrive tutto.** Con questo confine:

| In Rust — ciò che **decide** e ciò che **confina** | In JavaScript — ciò che **propone** e **presenta** |
|---|---|
| Supervisore (PID 1) | Piano applicativo: chat, documenti, agenti, flussi |
| Kernel di sicurezza: policy, token, audit | Provider di ragionamento di riferimento |
| Applicazione dei percorsi, sandbox, Landlock/seccomp | Gateway modelli, recupero, orchestrazione |
| Verifica degli aggiornamenti e delle firme | WebUI |
| Indicizzazione pesante del repository | Shell da terminale |

**Perché:** la parte che deve reggere quando tutto il resto è compromesso dev'essere
**piccola, tipizzata e separata**. Oggi non è nessuna delle tre. Non serve riscrivere tutto per
ottenerlo: serve riscrivere **il poco che decide** — che è anche il poco che oggi non esiste,
quindi si scrive in Rust dalla prima riga invece di essere portato.

**La WebUI resta JavaScript semplice.** `V4-D002` va emendato: React non aggiunge nulla a
un'interfaccia che è già costruita e funziona, e la cartella `apps/webui-react` con tre file e
nessun componente va **rimossa**, perché è schema morto applicato al codice (vedi A3).

## D-11 · La Prova di Sessione — **decisa: è la posizione del prodotto**

Confermata come tesi centrale, con la correzione P1 applicata: il replay è deterministico **sul
livello delle decisioni**, e questa formulazione è sia vera sia più forte.

**Motivo della decisione:** è l'unica proprietà trovata che (a) discende dall'architettura
invece che dal marketing, (b) si rafforza col tempo invece di consumarsi, (c) rende ATOM
desiderabile senza renderlo obbligatorio, e (d) è ciò che i settori regolati devono avere prima
di poter adottare qualunque cosa. Nessuna delle altre candidate ha tutti e quattro.

---

# Parte D — Igiene documentale

## Due fonti di verità sarebbero derivate

Esistono i dieci documenti italiani (questa cartella) e `docs/CODEN_EVOLUTION_DESIGN_V1.md` in
inglese, che si sovrappongono. Due fonti divergono sempre.

**Decisione:**

- **Questa cartella è canonica per i contenuti** finché non approvi.
- `CODEN_EVOLUTION_DESIGN_V1.md` è marcato **superato** per le parti duplicate, e resta come
  traccia della conversazione di progettazione.
- Alla tua approvazione si produce **una sola** versione canonica in inglese, e l'italiano
  diventa la traduzione di lettura.

---

# Riepilogo delle correzioni

| # | Problema | Stato |
|---|---|---|
| A1 | Tre "zero file" sbagliati (trust registry, secret broker, resource governor) | corretto |
| A2 | MEVCM: acronimo confuso col concetto, `provenance` esiste già | corretto |
| A3 | Categoria mancante: **schema morto**, peggiore dell'assenza | aggiunta |
| P1 | **Replay deterministico impossibile come promesso** | riformulato, più forte |
| P2 | Dipendenza circolare sui token di lettura — il prodotto non si avviava | corretto |
| P3 | Gradino 6 rompeva il local-first | corretto |
| P4 | Le firme d'errore possono contenere dati del cliente | normalizzazione obbligatoria |
| P5 | La fase 1 non superava il proprio criterio | scope corretto |
| P6 | Percorso completo inutilizzabile sulle modifiche banali | percorso proporzionato al rischio |
| P7 | L'arresto d'emergenza non fermava i processi | sequenza in sei passi |
| D-A | Lo stack | **decisa** — Rust per ciò che decide, JS per il resto |
| D-11 | La Prova di Sessione | **decisa** — è la posizione del prodotto |

**Decisioni aperte rimaste: zero.**
