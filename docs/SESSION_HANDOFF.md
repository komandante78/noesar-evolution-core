# SESSION HANDOFF — 2026-08-13 (`D-0431` risolto su istruzione diretta: una sola chat su `#/coden`)

## ➜ LA PROSSIMA AZIONE

**L'installazione gira su `noesar-evolution:d0431c-onechat-20260813T174751Z` dalle 17:48:05Z,
sana.** Su istruzione diretta dell'Owner, dopo aver visto la pagina vera: `#codenShell` (il
prompt/trascrizione/menu vecchio) è ora **nascosto** ogni volta che il terminale è `live` —
non più solo etichettato. Provato con screenshot + query DOM su un probe usa-e-getta:
`terminalState=live, codenShellHidden=true, altezza box=0`.

1. **Apri `https://<host>:8443/#/coden`** e conferma a occhio: **una sola superficie**, solo
   il terminale emulato. Se il terminale non si aggancia (browser senza JS/iframe, bridge che
   rifiuta), il box vecchio torna visibile — è il ripiego voluto (§63-64), non cancellato (regola 12).
2. **`D-0435` — debito reale, non nascosto**: circa 12 controlli in `tools/browser-e2e.mjs`
   continuano a pilotare `#codenPrompt`/`#codenMenu` direttamente (i controlli di fase-3a, la
   catena F-TERM-001, i flussi `/diff`/`/plan`/`/approve`) e ora falliscono o si bloccano contro
   un elemento nascosto. Ho provato due riparazioni (rivelazione una tantum — perde la corsa
   contro l'aggancio reale del terminale; `MutationObserver` — causa un timeout Puppeteer non
   ancora spiegato) e le ho **annullate entrambe** invece di spedire un tentativo non verificato.
   Serve una fase dedicata: ogni punto va o ridiretto al terminale, o reso una prova esplicita
   del percorso di ripiego.
3. **`D-0433` — ancora aperto, si ripresenterà**: questa è stata la **quarta** volta che questa
   sessione ha rifatto il deploy. L'hook di chiusura bloccherà ancora.
4. **Poi, come già proposto**: igiene del repository, riconciliazione dei tre piani.

**Rollback**, se qualcosa non convince:

```sh
docker stop --timeout 30 noesar-evolution && docker rm noesar-evolution \
  && docker rename noesar-evolution-pre-20260813T174805Z noesar-evolution && docker start noesar-evolution
```

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `D-0430` chip modello | **FATTO.** |
| `D-0431` "due chat" | **RISOLTO** — nascosto sul serio, non solo etichettato. Provato con screenshot. |
| `D-0432` / `D-0415(b)` | **CHIUSO.** |
| `D-0433` | **APERTO, bloccante.** Quarto redeploy in sessione — vedi decision log. |
| `D-0435` | **NUOVO, APERTO.** ~12 controlli E2E rotti dalla correzione di `D-0431`, non riparati stasera per non spedire un tentativo alla cieca su codice di test già causa di due timeout non spiegati. |
| `D-0427`, `D-0429` | Invariati. |
| Igiene repository | Proposta, non iniziata. |

## Verificato IN QUESTA SESSIONE (ultimo giro)

| Strumento | Risultato |
|---|---|
| `node --test …` | **2539/2540** (1 skip preesistente) |
| `tools/run-eslint.sh` | **407 file, 0 errori** |
| Screenshot + query DOM (probe usa-e-getta, mai sull'installazione viva) | `codenShellHidden=true`, altezza 0 — prova diretta che la correzione visibile funziona |
| `tools/run-browser-e2e.sh` | **NON verde, dichiarato tale.** Si blocca sui punti che pilotano `#codenPrompt`, vedi `D-0435`. |
| Byte-verify | `app.js` immagine↔albero identico |
| Pulizia §5a | rollback vecchio rimosso, container non di progetto invariati a 52 |

## Cosa NON è stato fatto

- **`D-0435` non riparato**: causa nota, riparazione rimandata — due tentativi falliti stasera,
  nessuno spedito.
- **`D-0433` non riparato**: stesso motivo di prima, invariato.
- **Nessuna conferma a occhio dell'Owner** sul deploy finale.
- Igiene repository, riconciliazione dei tre piani: proposte, non iniziate.
- **Nessuna push**: non eseguita nell'ultimo giro di questa sessione.

## Proposta di miglioramento

**Uno screenshot reale del punto toccato, non solo `/livez`, come passo ripetibile del deploy**
— usato tre volte stasera per diagnosticare quello che nessuna suite automatica aveva ancora
misurato. `D-0429` lo propone per l'handshake TLS; estenderlo a "la destinazione toccata da
questa fase" chiuderebbe la stessa classe di difetto (`D-0426`, `D-0431`) prima che arrivi
all'Owner.
