# 09 · Piano di realizzazione

## 1. Dove siamo davvero

Misurato il 26 luglio 2026, non ricordato.

**Costruito e verificato:** installazione che gira, PostgreSQL 18 con pgvector nel container,
isolamento a livello di riga provato contro un avversario nello stesso progetto, multi-utente
a sei ruoli con inviti e MFA, 507 test unitari, backup e ripristino con checksum, WebUI
raggiungibile, contenimento del prompt injection con zero bypass, sandbox del container
verificata dall'interno.

**Non costruito, e sono i pezzi centrali:**

*Tabella corretta dopo la revisione: tre delle mie dichiarazioni "zero file" erano sbagliate,
perché avevo cercato per nome nel codice senza mai cercare nello schema. Vedi documento 11, A1.*

| Manca | Stato reale misurato | Peso |
|---|---|---|
| `ReasoningProvider` | **zero file** — confermato | **critico** — è la cucitura di ATOM |
| Capability token | **zero file** — confermato | **critico** — unifica dodici componenti in uno |
| Emergency Stop | **zero file** — confermato | critico |
| Policy Decision Point e la pipeline `AI_PROPOSES→…` | **assenti dal codice** — confermato | **critico** |
| Kernel di sicurezza | 37 righe che controllano stringhe di percorso | **critico** |
| Esecuzione in ombra | assente | alto — senza, non c'è autocorrezione |
| Stato di contaminazione, canary, promozione | assenti — ma `memory_items.provenance` **esiste già ed è usato** | alto, **e si estende invece di partire da zero** |
| Model Trust Registry | **schema morto**: `model_descriptors.trust_state` esiste con gli stati giusti, **nessun codice lo legge o lo scrive** | alto — vedi A3: è peggio dell'assenza |
| Secret Broker | **parziale** — 13 file, un vault esiste e il tool executor lo usa | medio, da consolidare |
| Resource Governor | **parziale** — 4 file con quota/rlimit | medio |
| Isolamento per capacità (Landlock, seccomp per profilo, WASM) | assente | alto |
| Framework moduli di settore e pacchetti di conformità | assenti | alto |
| Technology Radar | assente | è il meccanismo del "domani" |
| OIDC / SAML / SCIM | zero file | medio |
| Verificatore post-esecuzione | assente | medio |

**La categoria che avevo mancato — schema morto.** Una colonna che esiste e che nessun codice
legge o scrive è **peggio** di una funzione assente: chi legge lo schema conclude che la
funzione c'è. Regola che ne discende: *una colonna che nessuno usa va rimossa oppure cablata.
Lasciarla è fabbricare evidenza falsa per il prossimo che guarda.*

## 2. Come si costruisce, in ordine, e perché quest'ordine

L'ordine non è per importanza: è per **dipendenza**. Ogni passo rende possibile il successivo.

### Fase 1 — La spina dorsale

> Obiettivo: esiste un Piano come oggetto, e nulla cambia senza uno.

1. **Il contratto `ReasoningProvider`**, pubblico e versionato. Prima riga di codice del
   progetto nuovo.
2. **Il provider di riferimento** — le undici superfici obbligatorie del contratto (vedi `02`):
   `interpret`, `hypothesize`, `plan`, `decompose`,
   `expect`, `constrain`, `classify`, `confidence`, `evidence`, `cancel`, `fixtures`.
   *(Diceva «a L3-L5». Tolto: `L0-L8` ora indica una cosa sola — i nove livelli
   architetturali del blueprint privato — e usarlo anche per la maturità del provider era la
   collisione che ha reso quella riga leggibile in due modi opposti.)*
3. **I capability token** e il motore che li conia da un Piano autorizzato.
4. **L'esecuzione in ombra**: copia copy-on-write del workspace, test mirati, confronto
   atteso/reale.
5. **L'esecutore che non accetta altro che token**, e la sandbox che li spende.
6. **Il registro degli eventi** con correlazione, causazione e digest.
7. **Comprensione minima del repository** — rilevamento linguaggi, punti d'ingresso, indice dei
   simboli, ricerca letterale, mappa delle dipendenze. *(Spostata qui dalla fase 2: pianificare
   la richiede comunque, e senza di essa la fase 1 non poteva superare il proprio criterio di
   "fatto" — vedi documento 11, P5.)*

Alla fine della fase 1 **la regola sola è vera**: il motore non può cambiare nulla se non
eseguendo un Piano autorizzato. Da qui in poi ogni cosa che si aggiunge nasce già dentro quella
regola, invece di doverci essere infilata dopo.

### Fase 2 — Il workspace

> Obiettivo: CodeN Evolution funziona, in una shell.

8. Il ciclo a sedici stadi, con il binario visibile, e il **percorso proporzionato al rischio**.
9. **Segnali di secondo livello** sulla mappa: proprietà, fragilità, criticità, copertura per
   modulo, ambiguità dichiarata. Più l'indice semantico nella semantica di lavoro.
10. Editor, diff, terminale, checkpoint, rollback, git.
11. La scala di persistenza a otto gradini e il registro delle firme di fallimento.
12. Il rapporto finale in forma fissa, con `NON FATTO` obbligatorio.

### Fase 3 — Le due shell, e la Prova di Sessione

> Obiettivo: un solo programma con due shell, e il primo pacchetto firmato.

13. Il protocollo di sessione su socket unix, pubblico e versionato.
14. La shell da terminale, con forma da tastiera per **ogni** capacità.
15. Il supervisore a tre figli pari.
16. **La Prova di Sessione**: a questo punto è *assemblaggio*, non invenzione — ogni campo ha
    già la sua fonte.

### Fase 4 — Memoria e privacy, per intero

17. Le tre semantiche con i muri applicati dallo schema.
18. MEVCM: stato di contaminazione, canary, pipeline di promozione, legami causali.
19. Il broker di egress a sette stati, e i dati di lavoro vincolati all'esecuzione locale.
20. La ricerca su fonti verificate, con la query costruita dal motore.

### Fase 5 — Isolamento vero

21. cgroups per figlio, Landlock, seccomp per profilo, WASM per i moduli portabili.
22. Governatore di risorse: i tetti scritti nel token diventano veri.
23. Emergency Stop: la sequenza in sei passi (congela, revoca, uccide, smonta, registra, Recupero).

### Fase 6 — ATOM

24. Simulazione predittiva, ricerca causale multi-passo, valutazione di piani alternativi.
25. Libreria di esperti che si accumula, un esperto per scheda.
26. Sotto-agenti in parallelo con revisore indipendente.

### Fase 7 — Il mondo esterno

27. Framework moduli di settore e livelli di fiducia.
28. Pacchetti di conformità firmati e datati.
29. Technology Radar.
30. OIDC, SAML, SCIM.
31. SBOM, ML-BOM, CBOM, build riproducibili, firme.

## 3. Quando si può dire "fatto" per la fase 1

Non "il codice compila". Questo:

> Apre un repository vero, ne capisce la struttura, riceve una richiesta, produce un piano,
> ottiene un'autorizzazione, cambia diversi file, mostra il diff, esegue i test, corregge un
> errore, produce un risultato verificabile, ripristina lo stato precedente su richiesta,
> registra ogni operazione — e **non esce mai nemmeno una volta dall'autorità che gli è stata
> data**, con quest'ultima clausola provata da una suite di test **il cui unico lavoro è
> provare a farglielo fare**.

L'ultima clausola è la differenza fra dire di essere sicuri e esserlo.

## 4. Quando si può dire "fatto" per il prodotto

Quello che la specifica chiede già, e che oggi non è vicino:

- La WebUI approvata è funzionante.
- **Il core pubblico funziona senza codice privato** — e quindi senza ATOM.
- L'edizione commerciale si integra attraverso contratti congelati.
- Sicurezza, privacy, licenze, backup, aggiornamenti, runtime multipiattaforma e
  accessibilità passano.
- SBOM, ML-BOM, provenienza e firme esistono.
- Cinque archivi finali passano un audit indipendente.

Oggi il prodotto dichiara di sé stesso, nel proprio file di stato: binario non incluso,
provenienza non firmata, **pronto per la produzione: falso**. È una dichiarazione onesta e va
tenuta finché non è falsa.

## 5. Cosa NON costruire, e perché

Registrato come decisione, non dimenticato.

| Cosa | Perché no |
|---|---|
| Una finestra di dialogo di autorizzazione per ogni sottosistema | Collassano nei capability token. Quattro abitudini di consenso sono quattro occasioni di formare il riflesso sbagliato. |
| Installazione automatica delle dipendenze | Resta un obiettivo, ma è un'azione con token e checkpoint, mai un'iniziativa. La mutazione dell'host è vietata dalla specifica. |
| Esecuzione cloud e app mobile | Non rifiutate, **rinviate**: sono superfici di uscita, e vanno progettate *attraverso* l'impegno di privacy, non accanto. È una conversazione, non un punto elenco. |
| Telemetria di default | Spenta, e resta spenta. |
| Conferma con un tasto solo, ovunque | Rimossa apposta. |
| Un modello sempre più grande | La strada è comporre esperti piccoli e verificati: +46% misurato a parità di dimensione totale, e cresce col tempo di lavoro invece che col budget. |

## 6. I rischi che questo piano si porta dietro

| Rischio | Come lo si tiene sotto |
|---|---|
| La fase 1 è lunga e non produce niente di visibile | Vero. Ma ogni cosa costruita prima di essa andrà rifatta dentro di essa. È il costo di aver saltato il centro la prima volta. |
| Il provider di riferimento resta debole e ATOM diventa obbligatorio di fatto | Il criterio di "fatto" della fase 1 si misura **con il solo provider di riferimento**. Se non passa, non è finita. |
| Le due shell divergono per comodità | Ogni capacità nasce con la forma da tastiera. Una funzione senza non entra. |
| I default della scala di persistenza sono sbagliati | Lo saranno. Sono tutti osservabili nel registro: si tarano leggendo, non indovinando. |
| Si riparte da zero buttando il buono | Non si butta niente: database, isolamento a livello di riga, multi-utente, MFA, backup, contenimento injection restano. Cambia il centro, non le fondamenta. |
