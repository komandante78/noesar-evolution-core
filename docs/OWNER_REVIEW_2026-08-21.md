# Owner review — passata live, 2026-08-21

**A cosa serve questo file.** L'Owner cammina il prodotto vivo superficie per superficie e
registra **cosa non funziona** e **cosa non gli piace**. Da qui esce la lista dei cambiamenti,
poi un aggiornamento unico, poi debug + vulnerabilità + T2, poi i benchmark.

**Perché è un file e non una chiacchierata.** Un'osservazione che vive solo nella conversazione
sparisce alla sessione dopo. Questo progetto ha già pagato quella lezione tre volte in una
settimana con record rimasti indietro (`D-0554`, `D-0614`, e `MANIFEST.sha256` falso per 109
commit). Quello che non è scritto in un file, non esiste.

**Installazione in prova:** `noesar-evolution:d0611-run-lane-metric-20260821T032222Z`,
`running`/`healthy`. Il prodotto risponde su `http://<host>:8100` e `https://<host>:8443`.

---

## 0. Due colonne diverse, e non vanno mescolate

| | **NON FUNZIONA** | **NON MI PIACE** |
|---|---|---|
| che cos'è | un difetto: la cosa non fa ciò che dichiara | una scelta di prodotto: fa quello che dice, ma non va bene così |
| chi decide | si ripara, non si discute | **decide l'Owner** — è una direzione, non un bug |
| come si chiude | un test che prima fallisce e poi passa | un criterio nuovo, scritto prima di costruire |

Tenerle separate serve a una cosa sola: un difetto si ripara subito, una preferenza si progetta.
Confonderle è come si finisce a "riparare" qualcosa che nessuno aveva chiesto di cambiare.

---

## 1. Come si scrive una riga

Una riga per osservazione. Anche brevissima — meglio sei parole scritte che un paragrafo pensato.

```text
[F|P] · <dove> · <cosa succede> · <cosa ti aspettavi>
```

`F` = non funziona · `P` = non mi piace. `<dove>` = il comando (`/plan`) o il pannello
(`chatWorkPanel`), e **quale shell**: `web`, `tui`, o entrambe.

**Esempi della forma giusta:**

```text
F · /measure · web · gira ma non mostra niente · doveva mostrare il diff
P · Home · la cifra della metrica è troppo piccola, non si legge
F · /skills · tui · elenco vuoto · sull'installazione ci sono delle skill
```

---

## 2. Le superfici da camminare — l'elenco completo, misurato oggi

Spuntare man mano. **Una superficie non camminata è una superficie non verificata**, e va
lasciata senza spunta invece che data per buona.

### 2.1 Il menu unico — 29 voci `[VERIFIED]` da `apps/shared/coden/agent-commands.js`

**Le due shell non devono divergere in nessun punto.** Se provi una voce solo da una parte,
scrivilo: metà prova non è una prova.

| | comando | cosa dichiara di fare | web | tui |
|---|---|---|---|---|
| 1 | `/plan` | avvia un piano da un obiettivo | ☐ | ☐ |
| 2 | `/simulate` | cosa farebbe il piano, senza eseguire | ☐ | ☐ |
| 3 | `/measure` | esegue nell'ombra e mostra cosa fa | ☐ | ☐ |
| 4 | `/approve` | approva un piano MISURATO | ☐ | ☐ |
| 5 | `/reject` | rifiuta un piano in attesa | ☐ | ☐ |
| 6 | `/restore` | annulla una esecuzione promossa | ☐ | ☐ |
| 7 | `/diff` | cosa ha cambiato una esecuzione | ☐ | ☐ |
| 8 | `/map` | scansione: linguaggi, punti d'ingresso, simboli | ☐ | ☐ |
| 9 | `/search` | ricerca letterale nel workspace | ☐ | ☐ |
| 10 | `/events` | la traccia causale di un lavoro | ☐ | ☐ |
| 11 | `/status` | stato motore, autorità, ombra | ☐ | ☐ |
| 12 | `/grants` | i permessi che il motore tiene adesso | ☐ | ☐ |
| 13 | `/revoke` | ritira un permesso vivo | ☐ | ☐ |
| 14 | `/retention` | cosa rimuoverebbe uno sweep — non rimuove | ☐ | ☐ |
| 15 | `/sweep` | **cancella byte** — attenzione, è distruttivo | ☐ | ☐ |
| 16 | `/review` | quanto costa la revisione umana per modifica | ☐ | ☐ |
| 17 | `/sessions` | elenco sessioni | ☐ | ☐ |
| 18 | `/git` | branch e divergenza del workspace | ☐ | ☐ |
| 19 | `/runs` | le esecuzioni, dalla più recente | ☐ | ☐ |
| 20 | `/session` | tutto ciò che una sessione contiene | ☐ | ☐ |
| 21 | `/session-action` | archivia, cestina, elimina o ripristina | ☐ | ☐ |
| 22 | `/divergence` | le convenzioni con cui questo repo scrive | ☐ | ☐ |
| 23 | `/skills` | quali skill ha l'installazione, e se sono usabili | ☐ | ☐ |
| 24 | `/skills-search` | trova una skill per cosa fa | ☐ | ☐ |
| 25 | `/closure` | chiude un lavoro: fatto, NON fatto, residuo | ☐ | ☐ |
| 26 | `/help` | questi comandi | ☐ | ☐ |
| 27 | `/clear` | pulisce il transcript a schermo | ☐ | ☐ |
| 28 | `/model` | elenca o carica i modelli dell'installazione | ☐ | ☐ |
| 29 | `/logout` | chiude la sessione | ☐ | ☐ |

> **`/sweep` cancella byte che non tornano.** Non è mai stato eseguito con `apply:true` su dati
> reali, deliberatamente. Se lo provi, provalo **sapendo** che cancella.

### 2.2 I pannelli della WebUI — `[VERIFIED]` da `apps/webui-static/index.html`

| pannello | ☐ |
|---|---|
| `chatWorkPanel` — il lavoro in chat | ☐ |
| `planPanel` — il piano | ☐ |
| `contextPanel` — il contesto | ☐ |
| `sessionsPanel` — le sessioni | ☐ |
| `attachCodePanel` — allegare codice | ☐ |
| `modelCatalogPanel` — catalogo modelli | ☐ |
| `modelAcquisitionsPanel` — acquisizione modelli | ☐ |
| `researchProviderPanel` — provider di ricerca | ☐ |
| `researchOutcomePanel` — esito della ricerca | ☐ |
| `recoveryCodesPanel` — codici di recupero | ☐ |
| Home — la metrica e lo stato | ☐ |
| accesso / login / MFA | ☐ |
| impostazioni e temi (9 temi, incluso alto contrasto) | ☐ |

---

## 3. NON FUNZIONA — i difetti

<!-- una riga per osservazione, formato §1. Non serve ordinarle: le ordino io dopo. -->

| # | dove | shell | cosa succede | cosa ti aspettavi |
|---|---|---|---|---|
| 1 | modelCatalogPanel (`#/models`) | web | **RIPARATO in questa sessione (`D-0639`)** — due stringhe dello stato vuoto erano già nel catalogo i18n ma mai passate per `t()` nel rendering | corretto: entrambe ora tradotte |
| 2 | modelCatalogPanel (`#/models`) | web | **TRIAGIATO, non un difetto (`D-0639`)** — controllata la cartella reale dell'installazione (`.../models/` non esiste): zero modelli scaricati per davvero tramite questo meccanismo. Il catalogo diceva il vero | nessuna azione di codice; se un modello risulta presente per altra via (Ollama, endpoint esterno) va dichiarato come tale, non come "scaricato" |
| 3 | modelCatalogPanel (`#/models`) | web | **RIPARATO in questa sessione (`D-0639`)** — la corsia "downloaded" dichiarava l'azione "Use" in prosa ma non disegnava mai un controllo per farla | pulsante "Load into memory" + conferma, aggiunto |
| 4 | modelCatalogPanel (`#/models`) | web | **TRIAGIATO (`D-0639`)** — i "9 selezionati" sono la corsia `available` (registro noto, paginato 6 per pagina); nessun bug di conteggio trovato | resta aperto se la richiesta è di UX diversa, non di correttezza — da chiarire |
| 5 | voiceFace (voce, `#/chat`) | web | **RIPARATO in questa sessione (`D-0637`/`D-0638`)** — causa radice trovata: la chat non aveva NESSUN percorso di esecuzione per `/`, né da tastiera né da voce; scriveva sempre testo letterale al modello. Ora un comando `/` in chat viene eseguito davvero (stesso motore di CodeN); dalla voce, solo i comandi sicuri (permesso `.read`, nessun `confirm`) partono da soli — gli altri restano da confermare a mano, apposta | comportamento nuovo da riprovare dal vivo — vedi `D-0639` per cosa resta `[UNVERIFIED]` |
| 6 | voiceFace (voce, `#/chat`) | web | **NON toccato, causa radice non ancora cercata (`D-0639`)** | prossima fase: investigare `voice-session.js` (~900 righe) |
| 7 | `#/documents` | web | **RIPARATO in questa sessione (commit `063d0b9`)** — cliccando appariva "Artifacts" invece di "Documents" | corretto: intestazione, pulsanti e stato vuoto dicono ora "Documents/documento" |
| 8 | `#/coden-tui` | web | **RIPARATO in questa sessione (commit `4e98494`)** — non dichiarava il comando `coden_evolution` (ssh + una parola) già costruito | dichiarato come percorso principale, il comando manuale resta come alternativa |
| 9 | projectsPanel (`#/projects`) | web | **RIPARATO in questa sessione (`D-0639`)** — il backend aveva già tutto (`archived`, `listProjects` già lo filtrava); mancava solo il pulsante | "Delete" con doppia conferma (digitare il nome del progetto), aggiunto |
| 10 | `＋ Conversazione` (`#/chat`) | web | **RIPARATO in questa sessione** — se nessun progetto esisteva ancora, il click falliva in silenzio (`apps/webui-static/app.js:988`). **Correzione alla riga sotto**: la sidebar "chat recenti" e archivia/elimina **esistono già** (`#chatNav`, provato dal vivo dal test `s326` — righe, titoli, link all'archivio che è la stessa pagina con seleziona-tutto/ripristina/elimina di Settings › Sessions); il difetto vero era solo il click silenzioso, non l'assenza della sidebar | ora: se non c'è nessun progetto, apre la pagina Progetti col modulo pronto invece di fallire in silenzio |
| 11 | `#/agents` | web | **RIPARATO in questa sessione (`D-0639`)** — "eliminare" era già risolto (Archive, `D-0397`, rimuove davvero dalla lista); mancava lo stato. Aggiunto un'etichetta derivata da `state.agentRuns`: non ancora eseguito / funzionante / in errore / in corso | badge sulla card, aggiunto |
| 12 | menu `/` (chat, web) | web | **CORREZIONE alla dichiarazione precedente (`D-0637`)**: la sessione scorsa aveva chiuso questa riga misurando che il MENU si apre/filtra/completa — vero, e resta vero. Ma non aveva misurato se **premere Invio eseguisse davvero il comando risolto**: non lo faceva, in nessuna shell raggiunta dalla chat — scriveva sempre il comando come testo al modello. Causa radice ora riparata (`D-0637`) | riga 5 di questa tabella per il dettaglio; la parte "si apre/filtra/completa" resta `CHIUSO`, la parte "esegue" era aperta e ora è riparata — da riverificare dal vivo |
| | | | | |

## 4. NON MI PIACE — le direzioni di prodotto

<!-- qui non serve che sia un difetto. "è brutto", "è confuso", "manca" vanno benissimo. -->

| # | dove | cosa non va | come lo vorresti |
|---|---|---|---|
| 1 | modelCatalogPanel (`#/models`) | la lista mostra solo un sottoinsieme di modelli, sembra limitata | tutti i modelli disponibili elencati (o un modo per vederli tutti), non solo una selezione ristretta |
| 2 | modelCatalogPanel (`#/models`) | manca un'icona informativa ("i") con spiegazione di come caricare/usare un modello | un'icona "i" con una spiegazione chiara del procedimento |
| 3 | chatWorkPanel — menu "Progetto" (`#/chat`) | menu con: Nessun progetto · Conversazione · Debug Evolution · ＋ Conversazione · Ramo (main) · Ramifica · Confronta i rami · Unisci · Fornitore/instradamento · Instradamento automatico · Modello · ID del modello o valore predefinito del fornitore · Confronta i modelli — non si capisce nulla, non è per niente intuitivo | un menu comprensibile, con voci chiare o spiegate |
| 3 · **RIAPERTA dall'Owner il 2026-08-24** | idem | *«il menu sopra la chat è un menu per software per bambini»*. `D-0641` aveva raggruppato i dieci controlli in tre schede etichettate e li aveva lasciati tutti a schermo: il problema non era il raggruppamento, era la **permanenza**. Su questa colonna **decide l'Owner** (§0), quindi la sua parola di oggi supera la chiusura precedente | **RIFATTA `D-0683`**: la barra tiene solo dove sei (progetto › conversazione, ramo, fornitore), le nove azioni stanno dietro un solo "⋯". Vista renderizzata, non dedotta |
| 4 | voiceFace (voce, `#/chat`) | la voce (sintesi) è orribile, non sembra umana | una voce naturale, umana |
| 5 | voiceFace (voce, `#/chat`) | la schermata della voce è statica, non sembra intelligenza artificiale, sembra un gioco per bambini | un'interfaccia con vera interazione, non statica |
| 6 | `#/knowledge` | non si capisce a cosa serva né se funziona — "come le altre, non ha personalità" | un'identità e uno scopo chiari (in attesa: cosa vuole l'Owner che questa pagina dica di sé) |
| 7 | `#/memory` | stesso problema di Knowledge — non si capisce se deve starci e cosa deve fare | un'identità e uno scopo chiari (stesso, in attesa della visione dell'Owner) |
| 8 | `#/research` | nessun fornitore di ricerca configurabile, non si capisce come funzioni — "senz'anima, senza evoluzione" | fornitori configurabili + un'identità chiara |
| 9 | chat / CodeN Evolution (capacità generale) | se scrivo di creare un agente, deve crearlo — "non voglio storie" | creazione agenti guidata dal linguaggio naturale, in chat e in CodeN |
| 10 | NOESAR EVOLUTION (capacità generale) | — | il prodotto deve essere multimodale |
| **11** · aggiunta il 2026-08-24 | `#/chat` | *«ho detto di mettere qualcosa per pulire intera chat e non è stata fatta»*. Non era stata fatta davvero: l'unico clear esistente era il **comando** `/clear`, dichiaratamente solo-visivo e memorizzato nel localStorage di quel browser — non scopribile dall'interfaccia e invisibile su un secondo dispositivo | **FATTA `D-0683`**: voce `Clear conversation` nel menu "⋯", non distruttiva (apre un ramo nuovo vuoto; i messaggi restano leggibili sul ramo di prima). La cancellazione vera resta in Sessions, con cestino a 30 giorni |
| **4 · 5 · RIAPERTE dall'Owner il 2026-08-24** | voiceFace (`#/chat`) | *«la voce è un qualcosa di squallido»*. `D-0642`/`D-0644` le avevano chiuse in attesa di verifica dal vivo: l'Owner l'ha vista dal vivo e non basta | **APERTE** — è il prossimo lavoro |
| | | | |

## 5. Numeri di partenza per i benchmark

Un benchmark senza un "prima" non dimostra nessun miglioramento. Da riempire **durante** la
passata, non dopo: costa nulla adesso e non si recupera più poi.

| superficie | quanto ci mette (percepito) | note |
|---|---|---|
| apertura della Home | | |
| `/plan` → piano a schermo | | |
| `/measure` → diff a schermo | | |
| `/search` su tutto il workspace | | |
| avvio della sessione `ssh` | | |

---

## 6. Cosa succede dopo questo file

1. **Triage.** Ogni riga di §3 verificata contro il codice reale: un falso positivo "riparato" è
   una regressione introdotta per niente (`CLAUDE10.md` §40b). Ogni scarto viene scritto con la
   sua prova.
2. **Lista dei cambiamenti**, ordinata per ciò che sblocca cosa, non per ordine di scoperta.
3. **Aggiornamento unico**, costruito a fette con `T0`/`T1` continui — e **un solo deploy**.
   Il costo è dichiarato: finché non si deploya, l'installazione viva resta indietro rispetto
   all'albero, ed è un debito §3a **aperto e scritto**, non nascosto.
4. **Debug, vulnerabilità, `T2` intero** alla fine, sull'installazione nuova.
5. **Benchmark mirati** contro i numeri di §5.
