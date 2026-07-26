# 10 · Decisioni

## 1. Prese in questa riscrittura (25-26 luglio 2026)

| # | Decisione | Chi |
|---|---|---|
| D-01 | Il nome è **CodeN Evolution**. CodeN Ultra e il suo TUI diventano quello, costruiti col meccanismo di NOESAR Evolution. Nulla portato da un altro prodotto. | Alessandro |
| D-02 | **Un solo programma, due shell** (WebUI e SSH), agganciate alla **stessa sessione viva**. **Non divergono in nessun punto.** | concordata |
| D-03 | **Un solo container**, come da progetto. Dentro: un supervisore come PID 1 con **tre figli pari** — postgres, api, codev. | Alessandro + raccomandazione mia |
| D-04 | **I dati di lavoro non raggiungono mai internet e non entrano mai nella semantica del prodotto.** Tre semantiche separate, muri applicati dallo schema, autorizzazione a ogni contatto. | Alessandro |
| D-05 | **La simulazione deve esserci**, altrimenti non c'è autocorrezione. Divisa in tre livelli: esecuzione in ombra (motore, sempre), attesa dichiarata (ogni provider, obbligatoria), simulazione predittiva (ATOM). | Alessandro |
| D-06 | **Il provider di riferimento arriva a L5 onestamente** e il core pubblico lavora anche senza presidio. ATOM compra portata, mai il permesso di controllare il proprio lavoro. | mia, su delega |
| D-07 | **L'autonomia è persistenza, non blocco.** Una sorpresa è un bivio; il budget è sulla **novità**, non sullo sforzo; scala a otto gradini fino a "chiedi". | Alessandro (correzione a una mia proposta sbagliata) |
| D-08 | **Rinominare** `47_CODEN_ULTRA_PRODUCT_SPEC` nella master reference, non annotarlo. | Alessandro |
| D-09 | **Architettura dell'informazione: 11 destinazioni**, non 26. Quindici cose tornano sezioni dentro l'unica pagina Impostazioni. | concordata |
| D-10 | **Igiene dei container**: chi crea container, tag e reti temporanee li rimuove. Sopravvivono due container. `prune` host-wide vietato senza eccezioni. | Alessandro |
| D-11 | **La posizione originale è la Prova di Sessione**: il prodotto dimostra meccanicamente ciò che afferma, invece di affermarlo. | mia proposta, da approvare |

## 2. Ereditate dal V4 e confermate

Restano valide senza modifiche: PostgreSQL autoritativo, pgvector di default, core pubblico
indipendentemente costruibile, AGPL-3.0-or-later oppure licenza commerciale, Apache-2.0 per
SDK e contratti, ATOM privato dietro contratto pubblico, il lavoro finanziato non può dipendere
da repository privati, il testo sulla privacy è legato allo stato di uscita verificato, Owner
Bypass delimitato e a scadenza, invarianti di sicurezza non aggirabili, nessuna installazione
silenziosa, aggiornamenti firmati con rollback, un solo container come default, cinque archivi
finali, il framework dei moduli di settore va nel core.

## 3. Da decidere — la sola aperta con conseguenze grosse

### D-A · Lo stack: il codice si muove verso la decisione, o la decisione verso il codice?

Il registro V4 approva Rust per i servizi privilegiati e TypeScript/React per la WebUI. Il
prodotto è 24.563 righe di JavaScript, 1.145 di Rust, e una WebUI in JavaScript semplice.

| Opzione | Cosa comporta |
|---|---|
| **A** — riscrivere il piano di controllo in Rust | Onesta rispetto alla specifica. Cara. Rischia di rifare cose che oggi funzionano e sono testate. |
| **B** — emendare `V4-D001`/`V4-D002` con un confine preciso | **Raccomandata.** Rust per ciò che *decide* e *confina*: supervisore, kernel di sicurezza, enforcement filesystem, token, indicizzazione. JavaScript per ciò che *propone e presenta*. |

La ragione della raccomandazione: la parte che deve reggere quando tutto il resto è
compromesso deve essere **piccola, tipizzata e separata** — e oggi non è nessuna delle tre. Non
serve riscrivere tutto per ottenerlo; serve riscrivere il poco che decide.

**Ciò che non è accettabile è lasciarli in contraddizione.** Un registro che dice "Approvato"
mentre il codice fa altro è il modo in cui un progetto smette di sapere cosa ha deciso.

## 4. Domande minori, da chiudere quando capita

1. **Fino a dove arriva l'autonomia non presidiata prima di chiedere comunque?** I default
   sono nel documento 02, §10. Si tarano dai test.
2. **Chi ha l'autorità di promuovere qualcosa in semantica del prodotto?** Oggi: l'Owner.
   Serve un ruolo dedicato quando ci sono più persone?
3. **La Prova di Sessione è esportabile in un formato standard** (attestazione in-toto,
   SLSA) o resta un formato proprio firmato? La prima aiuta con i revisori esterni.
4. **Il backup del workspace va cifrato**, o resta un dovere dichiarato dell'operatore?

## 5. Errori riconosciuti in questa riscrittura

Registrati perché ripetuti sono più cari.

| Errore | Correzione |
|---|---|
| Avevo messo **tutta la simulazione dietro il provider**, concludendo che il lavoro non presidiato richiedeva ATOM. Trasformava il ciclo di sicurezza in un pedaggio e lasciava il core pubblico a correggersi alla cieca. | Tre livelli: l'esecuzione in ombra è del **motore** e c'è sempre. |
| Avevo fatto della **sorpresa un capolinea**. Un modello piccolo che si ferma al primo intoppo restituisce il problema a te: un pregio diventato limite. | La sorpresa è un **bivio**. Il budget è sulla novità. |
| Avevo aperto il progetto **elencando i vincoli** che avrebbero ristretto l'ambizione, invece di progettare. | I vincoli danno lo **stile**, non il tetto. Dove confliggono davvero, si progetta la riconciliazione e la si dichiara come decisione. |
| Nella prima proposta di interfaccia avevo promosso **undici voci amministrative** a destinazioni: lo stesso errore dell'interfaccia consegnata, solo ordinato meglio. | Una destinazione è dove **decidi di andare**. Il resto è una sezione. |

## 6. Cosa questo progetto NON ha ancora deciso, e va bene così

- Quali nove temi esattamente, e come si chiamano.
- Se il TUI abbia anche una forma "vera CLI" distribuita come binario, oltre alla shell che si
  aggancia via SSH.
- Il modello commerciale nel dettaglio (edizioni, prezzi, entitlement) — la specifica V4 ha
  una struttura, ma non è materia di questa riscrittura.
- Quali moduli di settore per primi, se mai.

Sono decisioni che si prendono meglio dopo aver visto la fase 1 funzionare, non prima.
