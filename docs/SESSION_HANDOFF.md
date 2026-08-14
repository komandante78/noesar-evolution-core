# SESSION HANDOFF — 2026-08-14 (`D-0449`: `D-0435` chiuso — e ha smascherato un arretrato vero)

## ➜ LA PROSSIMA AZIONE

**Owner ha autorizzato la riscrittura di `D-0435` con l'istruzione esplicita "non lasciare
nulla a metà". `D-0435` È CHIUSO, verificato su 3 run puliti consecutivi.** Ma chiudere il crash
che bloccava l'intera suite dopo il 6° step su 35 ha fatto girare **386 controlli invece di 228
— 158 mai eseguiti da almeno un giorno** — e tre di quelli nuovi falliscono per ragioni
**non collegate** a `D-0435`/`D-0437`. Vedi `D-0449` nel decision log per il dettaglio completo.

**Cosa è chiuso davvero (verificato, non dichiarato):**
- `tools/browser-e2e.mjs` POINT 3 riscritta contro il design flat del menu, guidata attraverso
  il terminale (5 proprietà nuove: rank/filtro, Tab, un comando reale, `/logout`, un indirizzo
  reso inline). Nessuno dei 5 nuovi controlli fallisce, su 3 run.
- Altri due siti rotti dalla STESSA causa (`D-0437`, stesso giorno) corretti nello stesso giro:
  un'attesa per la stringa `DESTINATIONS` (rimossa) e un'asserzione `count===0` (era 17).
- Un flake di timing in F-TERM-001 sostituito con un poll.

**Cosa NON è chiuso — tre scoperte nuove, non tentate oltre la diagnosi (`F-COMMAND-001`,
`F-INTENT-001`, `F-PANEL-001` in `PROJECT_STATE.json.open_findings`):**
1. **`F-COMMAND-001`** (medium) — il tasto Enter sul prompt legacy `#codenPrompt`, dopo un
   valore impostato via `page.evaluate`, non arriva a `submitCodenPrompt()`. Causa NON trovata;
   diagnostica aggiunta nel test, lasciata a fallire con l'evidenza invece di essere silenziata.
2. **`F-INTENT-001`** (low) — un classificatore di intento risponde `{kind:'nothing'}` per
   l'input "memory" invece di instradarlo.
3. **`F-PANEL-001`** (medium) — lo step `workspace-actions` va in timeout aspettando
   `[data-agent-panel="plan"].active`, mai raggiunto prima d'ora.

**Perché non ho continuato**: quattro sottosistemi diversi, non varianti della stessa causa —
esattamente lo schema "guessing is not fixing" (`CLAUDE10.md` §40a). L'Owner ha chiesto di
finire UNA fase, non di aprirne una nuova senza confine.

**Prossima invocazione**: l'Owner sceglie quale dei tre nuovi finding investigare per primo
(`F-COMMAND-001` consigliato — blocca un gesto reale dell'utente), oppure passa alla **Fase C**
(`noesar-sandbox` standalone).

**Difetto reale trovato e riparato in una fase precedente della stessa sessione**:
`docs/WORK_PLAN_V5_REWRITE.md` diceva `CE-005`/`CE-010` "mai ripresi" — falso, verificato contro
l'albero corrente: entrambi implementati. Corretto alla fonte (`D-0447`).

**Vecchia prossima azione (D-0445), ancora in sospeso, non toccata questa fase:**

## ➜ ex-LA PROSSIMA AZIONE (D-0445)

**L'installazione gira su `noesar-evolution:d0445-menu-20260814T112604Z` dalle 11:26:20Z, sana,
byte-verificata.**

**Apri `https://<host>:8443/#/coden`, premi `/` e conferma che ora si legge.** Il menu è passato
da 34 voci a 17, e — più importante — **le voci che non facevano nulla ora non ci sono più, e
quelle che restano rispondono davvero**.

**Il difetto vero, misurato non ipotizzato**: `coden-terminal.js` non aveva affatto il ramo
`navigate`. Tutti i 17 comandi di navigazione cadevano in `if (turn.kind !== 'call')` e finivano
in un `draw()` vuoto: **nessun messaggio, nessun movimento, nessun errore — silenzio**. È
esattamente quello che avevi riportato. Aggiunto il ramo, rispecchiando la shell `ssh` attraverso
la STESSA tabella `showAddress`.

**Perché le 17 voci sono state tolte** (tre misure, non una preferenza):
1. Erano una **seconda copia**: `coden-address-book.mjs` deriva già dal markup tutte le 13
   destinazioni (misurato: 54 indirizzi). Nulla è diventato irraggiungibile — scrivere
   `/settings` risolve ancora, attraverso la lista derivata invece che scritta a mano.
2. Nel terminale del browser **non facevano nulla** (il punto 1 qui sopra).
3. Nel browser **duplicavano la barra laterale**, che le porta già tutte e 13 come bottoni.

**Il menu adesso** — 17 voci, tutte agiscono: `/plan /simulate /approve /reject /restore /diff
/map /search /events /status /sessions /git /closure /help /clear /model /logout`.

**Rollback**, se non convince:

```sh
docker stop --timeout 30 noesar-evolution && docker rm noesar-evolution \
  && docker rename noesar-evolution-pre-20260814T112620Z noesar-evolution && docker start noesar-evolution
```

## ➜ D-0446 (governance, non un phase-D-0445)

`.claude/skills/noesar-evolution-funding-fit/SKILL.md` creata e agganciata a `CLAUDE10.md`
(regola 69a + import). Registra i criteri NLnet/Restack reali forniti dall'Owner. Nessun
impatto sul prodotto: solo governance di sessione. Vedi `D-0446` nel decision log.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `D-0436`…`D-0441` | **FATTO**, deployati. Solo `D-0438` (margine terminale) confermato dall'Owner. |
| `D-0442` CE-020 in `node --test` + igiene immagini | **FATTO.** |
| `D-0443` report "Nothing named `M`" | **CHIUSO** — comportamento corretto, non un bug; ha rivelato il problema vero. |
| `D-0444` `/model <id>` | **FATTO, DEPLOYATO.** Non ancora provato con un modello reale (nessuno presente su questa installazione). |
| `D-0445` menu `/` 34→17 + ramo `navigate` | **FATTO, DEPLOYATO.** Conferma visiva in sospeso. |
| ATOM↔CodeN Evolution | **NON VERIFICATO** — serve una sessione autenticata (l'Owner ce l'ha già). Guarda il chip "reasoning". |
| `D-0435` | **APERTO** — è l'unico fallimento E2E rimasto (228/229), identico prima e dopo `D-0445`. |
| `D-0433` | **APERTO.** Dodicesimo redeploy in sessione — stessa condizione già accettata. |
| `D-0427`, `D-0429` | Invariati. |

## Verificato IN QUESTA SESSIONE (ultimo giro)

| Strumento | Risultato |
|---|---|
| `node --test …` | **2546/2547** (1 skip preesistente) |
| `tools/run-eslint.sh` | **408 file, 0 errori** |
| `node tools/acceptance/ce-020-tui-fullscreen.mjs` | **18/18** — TUI ssh, tastiera vera contro motore vero |
| `tools/run-browser-e2e.sh` (probe usa-e-getta) | **228/229** — l'unico fallimento è `D-0435`, identico al giro precedente ⇒ nessuna regressione |
| Menu misurato | 34 → **17** voci, ogni superstite agisce; **0** nomi duplicati fra registro e libro indirizzi (erano 17) |
| Byte-verify | 3 file modificati, container↔albero identici |
| `/shared/coden/coden-address-views.mjs` | **200** sull'installazione viva — il nuovo import risolve dove deve |
| Cleanup §5a | rollback vecchio rimosso, container non di progetto invariati a 50, volumi invariati a 63 |

## Cosa NON è stato fatto

- **Nessuna conferma visiva dell'Owner** su `D-0436`…`D-0445` (tranne `D-0438`).
- **`D-0444` non provato con un modello reale** — nessun secondo modello sul disco.
- **ATOM↔CodeN Evolution non verificato** — serve una sessione autenticata.
- **`D-0435` non riparato** — resta l'unico fallimento E2E; **`D-0433`** invariato.

## Proposta di miglioramento

**Un test che fallisca quando un `turn.kind` non ha un ramo in una shell.** `D-0445` è esistito
perché `coden-terminal.js` gestiva 8 dei 9 tipi che `planTurn` può restituire e il nono cadeva in
un `draw()` muto — nessun test poteva vederlo, perché "non fa nulla" non lancia e non stampa. Un
controllo che enumeri i `kind` prodotti dal modello condiviso e pretenda un ramo in ogni shell
chiuderebbe quella classe intera, che è la stessa forma del difetto `D-0435` e di `CE-033`.
