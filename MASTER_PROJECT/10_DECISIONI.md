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
| D-11 | **La posizione originale è la Prova di Sessione**: il prodotto dimostra meccanicamente ciò che afferma, invece di affermarlo — con il replay **al livello delle decisioni**, non dei modelli. | **decisa** su tua autorizzazione |
| D-12 | **Lo stack: opzione B.** Rust per ciò che decide e confina (supervisore, kernel di sicurezza, enforcement, token, indicizzazione); JavaScript per ciò che propone e presenta. `V4-D001` e `V4-D002` vanno emendati; `apps/webui-react` va rimossa. | **decisa** su tua autorizzazione |
| D-13 | **Il percorso è proporzionato al rischio classificato**, e governa le mutazioni non le conversazioni. Non si salta mai: Piano, attesa, token, esecuzione in ombra, audit. | **decisa** su tua autorizzazione |
| D-14 | **Il token di lettura dentro il workspace è concesso dalla modalità**, non da un piano — altrimenti il prodotto non si avvia. Ogni mutazione resta legata a un Piano autorizzato. | **decisa** su tua autorizzazione |
| D-15 | **Il gradino 6 della scala è "modello locale più forte".** Passare a un modello remoto è una decisione separata, con concessione esplicita, e i dati di lavoro restano trattenuti. | **decisa** su tua autorizzazione |

**Decisioni aperte: nessuna.**

## 2. Ereditate dal V4 e confermate

Restano valide senza modifiche: PostgreSQL autoritativo, pgvector di default, core pubblico
indipendentemente costruibile, AGPL-3.0-or-later oppure licenza commerciale, Apache-2.0 per
SDK e contratti, ATOM privato dietro contratto pubblico, il lavoro finanziato non può dipendere
da repository privati, il testo sulla privacy è legato allo stato di uscita verificato, Owner
Bypass delimitato e a scadenza, invarianti di sicurezza non aggirabili, nessuna installazione
silenziosa, aggiornamenti firmati con rollback, un solo container come default, i cinque archivi
di consegna (le cinque posizioni sono enumerate in `09 §4a`), il framework dei moduli di settore
va nel core.

## 3. Da decidere

**Nessuna.** L'unica che era rimasta aperta — lo stack — è stata decisa su tua
autorizzazione ed è registrata come **D-12** qui sopra. Il ragionamento completo sta nel
documento 03, §6, e nel documento 11, parte C.

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
| Avevo promesso un **replay deterministico** che i modelli linguistici non possono garantire: si sarebbe rotto alla prima verifica di un revisore. | Il replay riesegue **il livello delle decisioni** contro gli output registrati. Vero, e più forte. |
| Avevo scritto che senza token non si può **nemmeno leggere** — ma un Piano si produce leggendo, e un token nasce da un Piano. Il prodotto non si avviava. | Il token di lettura nel workspace lo concede la **modalità**. |
| Avevo dichiarato **zero file** per tre componenti che esistono, avendo cercato per nome nel codice senza mai guardare lo schema. | Tabella corretta nel documento 09, e la categoria **schema morto** aggiunta. |

## 6. Cosa questo progetto NON ha ancora deciso, e va bene così

- Quali nove temi esattamente, e come si chiamano.
- Se il TUI abbia anche una forma "vera CLI" distribuita come binario, oltre alla shell che si
  aggancia via SSH.
- Il modello commerciale nel dettaglio (edizioni, prezzi, entitlement) — la specifica V4 ha
  una struttura, ma non è materia di questa riscrittura.
- Quali moduli di settore per primi, se mai.

Sono decisioni che si prendono meglio dopo aver visto la fase 1 funzionare, non prima.
