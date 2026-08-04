# 07 · Interfaccia

## 1. Il riferimento vincolante

`APPROVED_WEBUI_REFERENCE.png` è la direzione visiva vincolante: tema scuro professionale,
barra superiore con ricerca/progetto/modello/privacy, navigazione a sinistra, compositore
centrale, azioni rapide, lavoro recente, compiti attivi, pannello contestuale a destra e
striscia di approvazione in basso.

La palette **non è inventata**: è estratta dai pixel di quel riferimento — indigo `#3958c3`
dominante, verde `#44a259`, ambra `#c5882c`, viola `#7c56b7`, ciano `#34aace`, fondi `#081018`
e `#0c1824`.

## 2. Tredici destinazioni, non ventisei

La regola della specifica è *"semplice prima che tecnico, divulgazione progressiva"*, e il
riferimento vincolante porta **una sola** voce Impostazioni. Una prima proposta ne aveva
promosse ventisei, undici delle quali amministrative: lo stesso errore dell'interfaccia
consegnata, solo ordinato meglio.

**Una destinazione è un posto dove decidi di andare. Tutto il resto è una sezione dove arrivi.**

```text
  ⌂  Home
  ◗  Chat                       ← chat AI, stile Claude
  ⌁  CodeN Evolution            ← il workspace
  ▤  CodeN Evolution TUI        ← lo stesso workspace, da tastiera
  ▢  Progetti
  ▤  Documenti
  ◈  Conoscenza
  ▧  Memoria                    ← ciò che il prodotto ha imparato del tuo lavoro
  ⌖  Ricerca                    ← un rapporto commissionato, non una casella di ricerca
  ◍  Agenti
  ⇉  Flussi di lavoro
  ▦  Modelli
  ⚙  Impostazioni               ← UNA sola
```

Dieci di queste tredici sono esattamente il riferimento vincolante. Le aggiunte sono tre: il
TUI, perché le superfici di conversazione devono essere tre e distinte, più Memoria e Ricerca.

**Perché queste due, dopo aver tagliato da ventisei a undici.** Questo elenco diceva *undici* e
la barra ne portava *tredici*; la divergenza è stata trovata misurando, non leggendo. Risolta a
favore della barra, e il motivo non è che il codice vince sul documento — è che la regola scritta
tre righe sopra le ammette entrambe. Memoria è un posto dove **decidi** di andare: cercare cosa
il prodotto ha imparato, e decidere cosa resta, è un'intenzione, non un passaggio dentro
qualcos'altro (documento `14`). Ricerca prende **un obiettivo e dei criteri** e restituisce un
rapporto con i candidati confrontati e ciò che non è stato verificato, dietro due cancelli — è
un lavoro che si commissiona, non una casella (documento `15`, §7). Nessuna delle due è
amministrativa, e nessuna delle due compare fra le quindici sezioni qui sotto: il taglio da
ventisei riguardava pagine di amministrazione travestite da destinazioni, che è un'altra cosa.

Il numero non è mai stato la regola: la regola è la prova, e queste due la passano. Toglierle
per far tornare un conto sarebbe perdere prodotto per far quadrare un documento. Resta vero il
vincolo che il taglio proteggeva — **una destinazione entra qui solo passando quella prova**, e
il conto nel titolo va aggiornato quando succede, invece di lasciare che le due liste divergano
in silenzio una seconda volta.

Quindici cose sono tornate a essere **sezioni dentro Impostazioni**: sicurezza, utenti,
privacy, audit, conformità, salute, log, aggiornamenti, backup, licenza, provider, hardware,
storage, connettori, evidenza.

## 3. Le tre superfici di conversazione

| Superficie | Carattere |
|---|---|
| **Chat** | Chat AI e basta. Chiedi, risponde, cita — e distingue contenuto della fonte, inferenza del modello e fatti tuoi. Nessun piano, nessun gate di autorità, nessun accesso ai file. Il pannello contestuale qui è chiuso di default. |
| **CodeN Evolution** | Il workspace. Il ciclo a sedici stadi disegnato come binario verticale: è lo *stato reale* del lavoro. Il gate di autorità è un'interruzione a cui rispondi, non una riga in una trascrizione che puoi scorrere via. |
| **CodeN Evolution TUI** | Lo stesso workspace da tastiera. Stesso ciclo, stesso gate, stesso audit. Si apre con la barra chiusa e il pannello via. |

Sono **tre destinazioni distinte**, non un interruttore di modalità: sono modelli mentali
diversi.

## 4. Il banco di lavoro

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│ progetto · workspace · branch · modello · provider L5 · modalità · contesto 38%│
│ · locale ✓ · sandbox ● · cpu/gpu · git ↑2 · notifiche · impostazioni           │
├──────────────┬─────────────────────────────────────┬───────────────────────────┤
│ NAVIGATORE   │ BANCO (a schede)                    │ AGENTE                    │
│              │                                     │                           │
│ progetti     │ editor · diff · test · log          │ conversazione             │
│ recenti      │ terminale · anteprima · mappa repo  │ piano — 16 stadi, dal vivo│
│ sessioni     │ documentazione · problemi           │ ipotesi ed evidenza       │
│ compiti      │                                     │ attività degli strumenti  │
│ agenti       ├─────────────────────────────────────┤ file letti / scritti      │
│ strumenti    │ TERMINALE — multiplo, persistente   │ comandi eseguiti          │
│ plugin       │ build · test · server · log         │ richieste di autorità     │
│ cronologia   │                                     │ sotto-agenti              │
│ preferiti    │                                     │ rischio residuo           │
├──────────────┴─────────────────────────────────────┴───────────────────────────┤
│ stadio 9/16 · 4 file · 12/13 test · 2 warning · 3 processi · ↑2 · 41k token    │
│ · €0,00 locale · 04:12 trascorsi · rete bloccata · sandbox attiva · 2 token vivi│
└────────────────────────────────────────────────────────────────────────────────┘
```

## 5. La barra si chiude, il pannello si aggancia o se ne va

**La barra laterale ha tre stati** — completa, a icone, via — su `[` e `]`, e ricorda la
scelta. Il TUI si apre con la barra già chiusa, perché quella superficie si usa a piena
larghezza.

**Il pannello contestuale ha tre stati** — agganciato come colonna, flottante sopra il
contenuto e trascinabile, oppure via — e ricorda **per destinazione**: la Chat parte senza,
CodeN Evolution parte con.

I pannelli si staccano in finestre proprie per il secondo monitor. La shell da terminale
raggiunge gli stessi pannelli come viste a schermo intero dietro un tasto guida, e porta la
stessa riga di stato.

## 6. Colore e stato

Il colore non è **mai** l'unico segnale: ogni stato ha un glifo e una parola.

| Stato | Colore | Glifo |
|---|---|---|
| Operazione sicura | verde | ✓ |
| In corso | blu | ◐ |
| Autorità richiesta | ambra | ⚑ |
| Errore | rosso | ✕ |
| Distruttiva | rosso scuro | ⚠ |
| Sola lettura | grigio | ○ |
| Sandbox attiva | viola | ◈ |

## 7. Impostazioni: una pagina, con sezioni

```text
  Lingua                l'interfaccia
  Aspetto               nove temi come insieme selezionabile
  Licenza               attivazione, se presente
  Prodotto              impostazioni di NOESAR Evolution
  Privacy e connettori  stato di egress, concessioni attive, revoca
  Persone e accessi     account, ruoli, inviti, MFA
  Modelli e hardware    provider, profili, pianificatore
  Storage e backup      ritenzione, esportazione, ripristino
  Audit ed evidenza     registro, Prove di Sessione, export
  Salute e log          diagnostica
  Aggiornamenti         firma, diff dei permessi, rollback
```

**I nove temi sono rimappature di token**: ognuno cambia l'accento e la tinta dei neutri, e
**nessuno tocca il colore semantico** — "bloccato" resta rosso in tutti e nove. Fra i nove ci
sono un tema chiaro e uno ad alto contrasto: un prodotto che spedisce un solo tema scuro non
supera la regola di contrasto accessibile per chi ha bisogno dell'altro estremo.

## 8. Accessibilità: è un requisito di costruzione, non un'impostazione

Navigazione da tastiera completa, tipo regolabile, tema ad alto contrasto vero, semantica per
lettori di schermo con **regioni live** che annunciano l'output in streaming senza inondarlo,
riduzione delle animazioni, zoom dell'interfaccia, localizzazione completa, rilevamento
automatico di lingua e fuso orario con sovrascrittura manuale.

Obiettivo dichiarato: **WCAG 2.2 AA**. Timestamp memorizzati in UTC e resi con identificatori
di fuso IANA, pianificazioni sicure rispetto all'ora legale, layout pronto per lingue da
destra a sinistra.

## 9. La schermata iniziale

Apri progetto · clona repository · nuovo progetto · importa archivio · connetti repository
remoto · riprendi ultima sessione. Poi: attività recente, compiti programmati, modelli
disponibili con la loro provenienza, salute dei servizi, strumenti installati.

Le azioni rapide sono formulate **come obiettivi**, perché l'Intent Frame parte da un
obiettivo: analizza questo repository · trova e correggi un bug · implementa una funzione ·
genera i test mancanti · controlla la sicurezza · aggiorna le dipendenze · spiega
l'architettura · migliora le prestazioni · prepara una release · revisiona le mie modifiche.

## 10. La striscia di approvazione

Permanente, in fondo, su **ogni** destinazione. È dove un agente che sta lavorando altrove nel
prodotto ti chiede qualcosa. È globale perché l'autorità è globale: un token è un token,
qualunque superficie lo abbia richiesto.
