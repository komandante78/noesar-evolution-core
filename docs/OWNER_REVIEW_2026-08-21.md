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
| | | | | |

## 4. NON MI PIACE — le direzioni di prodotto

<!-- qui non serve che sia un difetto. "è brutto", "è confuso", "manca" vanno benissimo. -->

| # | dove | cosa non va | come lo vorresti |
|---|---|---|---|
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
