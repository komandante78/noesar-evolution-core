# SESSION HANDOFF — 2026-08-14 (`D-0445`: il menu `/` da 34 a 17 voci, tutte funzionanti)

## ➜ LA PROSSIMA AZIONE

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
