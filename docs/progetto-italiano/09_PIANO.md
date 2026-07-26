# 09 · Piano di realizzazione

## 1. Dove siamo davvero

Misurato il 26 luglio 2026, non ricordato.

**Costruito e verificato:** installazione che gira, PostgreSQL 18 con pgvector nel container,
isolamento a livello di riga provato contro un avversario nello stesso progetto, multi-utente
a sei ruoli con inviti e MFA, 507 test unitari, backup e ripristino con checksum, WebUI
raggiungibile, contenimento del prompt injection con zero bypass, sandbox del container
verificata dall'interno.

**Non costruito, e sono i pezzi centrali:**

| Manca | Peso |
|---|---|
| `ReasoningProvider` — zero file | **critico** — è la cucitura di ATOM |
| Kernel di sicurezza reale — 37 righe, cinque componenti a zero | **critico** |
| Capability token — zero file | **critico** — è il meccanismo che unifica dodici componenti |
| Esecuzione in ombra | alto — senza, non c'è autocorrezione |
| MEVCM e stato di contaminazione — zero file | alto |
| Isolamento per capacità (Landlock, seccomp per profilo, WASM) | alto |
| Framework moduli di settore e pacchetti di conformità | alto |
| Technology Radar | è il meccanismo del "domani" |
| OIDC / SAML / SCIM | medio |
| Verificatore post-esecuzione | medio |

## 2. Come si costruisce, in ordine, e perché quest'ordine

L'ordine non è per importanza: è per **dipendenza**. Ogni passo rende possibile il successivo.

### Fase 1 — La spina dorsale

> Obiettivo: esiste un Piano come oggetto, e nulla cambia senza uno.

1. **Il contratto `ReasoningProvider`**, pubblico e versionato. Prima riga di codice del
   progetto nuovo.
2. **Il provider di riferimento** a L3-L5: `interpret`, `hypothesize`, `plan`, `decompose`,
   `expect`, `constrain`, `classify`, `confidence`, `evidence`, `cancel`, `fixtures`.
3. **I capability token** e il motore che li conia da un Piano autorizzato.
4. **L'esecuzione in ombra**: copia copy-on-write del workspace, test mirati, confronto
   atteso/reale.
5. **L'esecutore che non accetta altro che token**, e la sandbox che li spende.
6. **Il registro degli eventi** con correlazione, causazione e digest.

Alla fine della fase 1 **la regola sola è vera**: il motore non può cambiare nulla se non
eseguendo un Piano autorizzato. Da qui in poi ogni cosa che si aggiunge nasce già dentro quella
regola, invece di doverci essere infilata dopo.

### Fase 2 — Il workspace

> Obiettivo: CodeN Evolution funziona, in una shell.

7. Il ciclo a sedici stadi, con il binario visibile.
8. Mappa del repository, indice dei simboli, indice semantico nella semantica di lavoro.
9. Editor, diff, terminale, checkpoint, rollback, git.
10. La scala di persistenza a otto gradini e il registro delle firme di fallimento.
11. Il rapporto finale in forma fissa, con `NON FATTO` obbligatorio.

### Fase 3 — Le due shell, e la Prova di Sessione

> Obiettivo: un solo programma con due shell, e il primo pacchetto firmato.

12. Il protocollo di sessione su socket unix, pubblico e versionato.
13. La shell da terminale, con forma da tastiera per **ogni** capacità.
14. Il supervisore a tre figli pari.
15. **La Prova di Sessione**: a questo punto è *assemblaggio*, non invenzione — ogni campo ha
    già la sua fonte.

### Fase 4 — Memoria e privacy, per intero

16. Le tre semantiche con i muri applicati dallo schema.
17. MEVCM: stato di contaminazione, canary, pipeline di promozione, legami causali.
18. Il broker di egress a sette stati, e i dati di lavoro vincolati all'esecuzione locale.
19. La ricerca su fonti verificate, con la query costruita dal motore.

### Fase 5 — Isolamento vero

20. cgroups per figlio, Landlock, seccomp per profilo, WASM per i moduli portabili.
21. Governatore di risorse: i tetti scritti nel token diventano veri.
22. Emergency Stop: revoca globale, immediata.

### Fase 6 — ATOM

23. Simulazione predittiva, ricerca causale multi-passo, valutazione di piani alternativi.
24. Libreria di esperti che si accumula, un esperto per scheda.
25. Sotto-agenti in parallelo con revisore indipendente.

### Fase 7 — Il mondo esterno

26. Framework moduli di settore e livelli di fiducia.
27. Pacchetti di conformità firmati e datati.
28. Technology Radar.
29. OIDC, SAML, SCIM.
30. SBOM, ML-BOM, CBOM, build riproducibili, firme.

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
