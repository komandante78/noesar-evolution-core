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
| 1 | modelCatalogPanel (`#/models`) | web | lingua impostata su italiano, ma il testo è misto — non tutto tradotto | tutta la pagina in italiano, coerente |
| 2 | modelCatalogPanel (`#/models`) | web | mostra solo 1 modello come scaricato/pronto all'uso | tutti i modelli scaricati e pronti all'uso, mostrati |
| 3 | modelCatalogPanel (`#/models`) | web | manca il pulsante "carica in VRAM" e la richiesta di conferma per caricare in RAM | un pulsante per caricare il modello e una domanda di conferma prima di caricarlo in memoria |
| 4 | modelCatalogPanel (`#/models`) | web | la pagina mostra 9 modelli "selezionati" ma non è chiaro cosa sono gli altri / dov'è il resto del catalogo | chiarezza su cosa significa "selezionato" e dove sono gli altri modelli disponibili |
| 5 | voiceFace (voce, `#/chat`) | web | a voce: "verifica se il modello è carico" → scrive solo `/models`, non fa altro | che capisca l'intento e risponda/agisca davvero, non solo componga un comando slash |
| 6 | voiceFace (voce, `#/chat`) | web | la voce si interrompe/blocca durante l'uso, invece di restare attiva | resti attiva finché non la fermo io, ed esegua tutto quello che chiedo nel programma |
| 7 | `#/documents` | web | **RIPARATO in questa sessione (commit `063d0b9`)** — cliccando appariva "Artifacts" invece di "Documents" | corretto: intestazione, pulsanti e stato vuoto dicono ora "Documents/documento" |
| 8 | `#/coden-tui` | web | **RIPARATO in questa sessione (commit `4e98494`)** — non dichiarava il comando `coden_evolution` (ssh + una parola) già costruito | dichiarato come percorso principale, il comando manuale resta come alternativa |
| 9 | projectsPanel (`#/projects`) | web | creo un progetto, appare in "progetti disponibili", ma non c'è modo di eliminarlo | un modo per eliminare un progetto, con doppia conferma |
| 10 | `＋ Conversazione` (`#/chat`) | web | se nessun progetto esiste ancora, il click fallisce in silenzio (solo una riga di stato facile da perdere) — **causa trovata**: `apps/webui-static/app.js:988` | un percorso chiaro per creare il primo progetto, poi la conversazione; la nuova chat deve comparire subito in una lista "chat recenti" nella sidebar, con archivia/elimina |
| 11 | `#/agents` | web | creo agenti ma non li posso eliminare, e non si capisce se sono davvero attivi/funzionanti | poter eliminare un agente; uno stato chiaro (attivo/inattivo) |
| 12 | menu `/` (chat e CodeN, web e tui) | entrambe | segnalato più volte dall'Owner come "non fatto come Claude Code" — letto il codice, sembra corretto (`isCommandPrompt`/`matchCommands`), **non verificato dal vivo**: possibile che due caselle di testo diverse abbiano il menu cablato solo su una (già successo: `F-COMMAND-001`, `F-SLASH-001`, `F-TERM-001`) | **richiede una sessione col browser vero — in attesa di conferma dell'Owner per usare `claude-in-chrome`** |
| | | | | |

## 4. NON MI PIACE — le direzioni di prodotto

<!-- qui non serve che sia un difetto. "è brutto", "è confuso", "manca" vanno benissimo. -->

| # | dove | cosa non va | come lo vorresti |
|---|---|---|---|
| 1 | modelCatalogPanel (`#/models`) | la lista mostra solo un sottoinsieme di modelli, sembra limitata | tutti i modelli disponibili elencati (o un modo per vederli tutti), non solo una selezione ristretta |
| 2 | modelCatalogPanel (`#/models`) | manca un'icona informativa ("i") con spiegazione di come caricare/usare un modello | un'icona "i" con una spiegazione chiara del procedimento |
| 3 | chatWorkPanel — menu "Progetto" (`#/chat`) | menu con: Nessun progetto · Conversazione · Debug Evolution · ＋ Conversazione · Ramo (main) · Ramifica · Confronta i rami · Unisci · Fornitore/instradamento · Instradamento automatico · Modello · ID del modello o valore predefinito del fornitore · Confronta i modelli — non si capisce nulla, non è per niente intuitivo | un menu comprensibile, con voci chiare o spiegate |
| 4 | voiceFace (voce, `#/chat`) | la voce (sintesi) è orribile, non sembra umana | una voce naturale, umana |
| 5 | voiceFace (voce, `#/chat`) | la schermata della voce è statica, non sembra intelligenza artificiale, sembra un gioco per bambini | un'interfaccia con vera interazione, non statica |
| 6 | `#/knowledge` | non si capisce a cosa serva né se funziona — "come le altre, non ha personalità" | un'identità e uno scopo chiari (in attesa: cosa vuole l'Owner che questa pagina dica di sé) |
| 7 | `#/memory` | stesso problema di Knowledge — non si capisce se deve starci e cosa deve fare | un'identità e uno scopo chiari (stesso, in attesa della visione dell'Owner) |
| 8 | `#/research` | nessun fornitore di ricerca configurabile, non si capisce come funzioni — "senz'anima, senza evoluzione" | fornitori configurabili + un'identità chiara |
| 9 | chat / CodeN Evolution (capacità generale) | se scrivo di creare un agente, deve crearlo — "non voglio storie" | creazione agenti guidata dal linguaggio naturale, in chat e in CodeN |
| 10 | NOESAR EVOLUTION (capacità generale) | — | il prodotto deve essere multimodale |
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
