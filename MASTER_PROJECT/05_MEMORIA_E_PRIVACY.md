# 05 · Memoria e privacy

## 1. Tre semantiche, e muri che li applica lo schema

Decisione tua, 26 luglio 2026: **i dati di lavoro non raggiungono mai internet e non entrano
mai nella semantica del programma.** Da lì discende una separazione in tre, non in due.

| | **Semantica del prodotto** | **Semantica di lavoro** | **Semantica del compito** |
|---|---|---|---|
| Contiene | come funziona il prodotto, le tue convenzioni, le procedure, la memoria dell'Owner | i tuoi documenti, il grafo di conoscenza, l'indice del repository, gli embedding, le citazioni | i file letti in questo compito, l'output dei comandi, il piano, gli errori, i risultati dei test |
| Durata | permanente | quanto il progetto | il compito, poi sparisce |
| Fiducia | autoritativa | **dato non fidato, sempre** | non fidato |
| Isolamento | per installazione | **per progetto, riga per riga** | per compito e per agente |
| Esce dalla macchina | mai senza una concessione | **mai senza una concessione esplicita, su un singolo elemento, registrata** | mai |

**I muri non sono buona condotta al momento della chiamata: sono lo schema.** L'isolamento a
livello di riga è già costruito e verificato nel caso difficile — un utente nello stesso
workspace e nello stesso progetto di un altro non vede il privato altrui, e la ricerca
vettoriale non restituisce mai il privato di qualcun altro.

## 2. La valvola a senso unico

```text
   semantica di lavoro                     semantica del prodotto
   ┌──────────────────┐                    ┌──────────────────┐
   │ documenti        │  ── lettura ──▶    │ come lavori tu   │
   │ grafo            │    su concessione  │ procedure        │
   │ indice repo      │                    │ memoria Owner    │
   │ embedding        │  ⊘ MAI in auto ─▶  │                  │
   └──────────────────┘                    └──────────────────┘
```

**Nulla viene promosso automaticamente.** La promozione richiede validazione, policy,
rilevamento di conflitti, un **canary di contaminazione**, approvazione umana e audit. Leggere
un file non è promozione. Nemmeno esserne stati informati da un file.

## 3. Lo stato di contaminazione

Questo è il pezzo che oggi **non esiste affatto** (zero file) ed è quello che rende il recupero
degno di fiducia invece che soltanto veloce.

Ogni record di memoria porta: provenienza, attore, classe della fonte, tempo, confidenza,
ritenzione, tenant, blocco legale, **stato di contaminazione** e legami causali.

| Stato | Significato |
|---|---|
| `pulito` | verificato, promosso, ha superato il canary |
| `non fidato` | letto ma mai promosso — è la condizione normale dei tuoi documenti |
| `sospetto` | il canary ha rilevato un'anomalia in questa fonte |
| `in quarantena` | isolato, non partecipa più al recupero |
| `revocato` | rimosso, con la traccia di quando e perché |

**Il canary di contaminazione** è un elemento noto piantato nell'indice: se compare dove non
dovrebbe, o se sparisce dove dovrebbe essere, l'avvelenamento è avvenuto e si sa **quando**.
Senza, un indice avvelenato è indistinguibile da uno sano.

Ed è anche il **pacchetto di lavoro #8** dei finanziamenti: costruirlo serve al prodotto e
alla candidatura insieme.

## 4. Il repository è dato non fidato

Codice sorgente, commenti, README, messaggi di commit, testo delle issue, metadati delle
dipendenze: tutto non fidato. **Un repository può chiedere. Non può mai istruire.**

L'unica eccezione è `PROJECT_RULES`, perché l'hai scritto tu (vedi documento 04).

## 5. Lo stato di privacy: sette stati, verificati

Il testo *"NOESAR gira in locale, nessun dato viene inviato a server esterni"* compare **solo
mentre il broker di egress verifica lo stato locale**. Non è una scritta: è una funzione di
un'autorità che sta in mezzo al traffico.

| Stato | Cosa significa |
|---|---|
| `LOCALE_VERIFICATO` | nulla esce, e il broker lo sta verificando adesso |
| `SOLO_METADATI_ESTERNI` | esce solo metadato (es. controllo aggiornamenti), mai contenuto |
| `CONNETTORE_IN_ATTESA` | un connettore è configurato ma non ha ancora trasferito nulla |
| `CONNETTORE_ATTIVO` | un connettore sta trasferendo — con destinazione e categoria di dati mostrate |
| `MODELLO_REMOTO_ATTIVO` | il modello non è su questa macchina |
| `BLOCCATO_DA_POLICY` | un trasferimento è stato tentato e rifiutato |
| `SCONOSCIUTO` | **il broker non può verificare — e lo dice** |

L'ultimo stato è il più importante e il più raro nei prodotti concorrenti: **il prodotto
preferisce dichiarare di non sapere piuttosto che tenere in piedi una rassicurazione che non
può confermare.** È già successo qui: la fascia della privacy inghiottiva ogni errore in un
`catch` vuoto, quindi un controllo irraggiungibile lasciava sullo schermo un "LOCALE
VERIFICATO" che sembrava confermato. Corretto.

## 6. Quando i dati di lavoro incontrano un modello remoto

È il caso che rende vera la frase "mai su internet" invece che aspirazionale.

```text
  ⊘ DATI DI LAVORO TRATTENUTI — il modello non è su questa macchina

    destinazione   api.esempio-provider.com
    invierebbe     14 pagine di Revisione Logistica Q3.pdf

    La domanda è stata risposta senza. Passa a un modello locale per usare i tuoi documenti.

    [ Usa un modello locale ]  [ Rispondi senza documenti ]  [ Invia comunque — una volta, questo documento ]
```

Il corpus viene **trattenuto** e la domanda risposta senza. Scegliere un modello remoto non
cambia in silenzio dove vanno i tuoi documenti.

**Il terzo bottone esiste di proposito, contro l'istinto:** rifiutare del tutto ti spingerebbe
a incollare il file a mano, che è la stessa esposizione **senza alcuna traccia**. Così costa
una decisione esplicita, su un singolo documento, registrata — e l'indicatore di privacy
cambia stato dove lo vedi.

## 7. La ricerca sul web dell'agente

Quando il motore è bloccato può cercare (gradino 4 della scala di persistenza), e la privacy
non viene barattata:

- **La query la costruisce il motore, non il modello**: firma dell'errore, nome **e versione**
  della dipendenza dal manifest, nome del simbolo. Mai il tuo sorgente, mai i percorsi, mai il
  contenuto dei documenti. La stringa esatta va nel registro **prima** di partire.
- **Le "fonti verificate" sono una allowlist derivata dalle tue dipendenze**: documentazione
  ufficiale di ciò che il progetto dichiara, riferimento del linguaggio, docs presenti nel
  repository. Un livello generico esiste ed è spento di default.
- **Ciò che torna è evidenza non fidata**, con il suo stato di contaminazione, e finisce
  citato nel piano e nel rapporto finale — così un cambio di approccio si riconduce a cosa lo
  ha causato.

## 8. Gestione del contesto

Stima dei token prima di inviare. Recupero della sezione rilevante invece del file intero.
Riassunto dei turni vecchi **conservando gli originali indirizzabili**. E soprattutto:

- **Isolamento del contesto per agente.** Un sotto-agente che revisiona non deve ereditare il
  contesto di chi ha implementato, o concorderà con lui invece di revisionarlo.
- **Il motore dichiara cosa ha inviato.** Così "perché non lo sapeva?" ha una risposta invece
  di un'alzata di spalle.
- **Nessuna contaminazione fra progetti**, garantita dallo schema e non dalla policy.

## 9. Backup, ritenzione, cancellazione

- Backup con checksum che **rifiuta un archivio manomesso** (già costruito e verificato).
- **Il backup del workspace non è cifrato e contiene la chiave master di autenticazione.**
  Non è più implicito: la pagina Backups della WebUI lo dichiara in chiaro, ed è protetto da
  un test che verifica il testo stesso, non solo l'esistenza della sezione (`INST-006`,
  doc `08 §11`, `D-0223`). Resta comunque un dovere dell'operatore trattarlo come un segreto —
  il testo lo dice, non lo impedisce.
- Cancellazione che si propaga agli indici derivati: gli indici vettoriali sono **viste
  derivate**, i record autoritativi stanno nell'archivio primario. Cancellare il record deve
  invalidare la vista, non lasciarla viva.
- Blocco legale, ritenzione per classe di dato, ed export completo.
