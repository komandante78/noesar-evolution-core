# SESSION HANDOFF — 2026-08-15 (`D-0456`: i tre finding salvati, indagati — driven, not read)

## ➜ LA PROSSIMA AZIONE

**Owner ha autorizzato "prossima fase" e, alla domanda di chiarimento, scelto: indagare i tre
finding salvati (`F-COMMAND-001`/`F-INTENT-001`/`F-PANEL-001`), non `cargo publish` né Fase D.**

**`F-INTENT-001` CHIUSO.** Non era un bug del resolver — era il CHECK a ricostruire `entries`
come solo `AGENT_COMMANDS`, senza l'address book che il prodotto reale ci mette dentro
(`heardResult()` passa `codenOffered()`). "memory" vive solo nell'address book, quindi non
poteva mai combaciare. Fix: `window.__noesarCodenOffered` esposto (la stessa funzione della
pagina, nessuna lista nuova) e il check ora la chiama. Verde 5/5 run e2e.

**`F-COMMAND-001`/`F-PANEL-001`: causa radice TROVATA (5 run e2e disposable, non indovinata),
ma NON È IL BUG CHE `D-0449` PENSAVA.** Non è un problema di matching né di consegna
dell'evento Enter — due tentativi di fix su quella base (`.focus()` grezzo, poi
`page.focus()` di Puppeteer) sono stati provati e hanno misurabilmente NON funzionato, quindi
scartati invece di essere spacciati per una riparazione. La causa vera, letta da un dump
completo della catena di antenati DOM: `#codenShell` (il prompt legacy) viene nascosto da
`codenTerminalState()` (`app.js` riga ~5943) nell'istante in cui il terminale xterm.js
moderno raggiunge `state==='live'` — per decisione esplicita dell'Owner del 2026-08-13
("`#/coden` mostra UNA chat, mai le due impilate"). Quell'handshake è asincrono e può
completarsi a metà test, DOPO che lo stesso box legacy era già stato usato con successo prima
nella stessa run. **Non è un difetto — è una scelta di strategia di test**: aspettare che il
terminale si assesti prima di scegliere quale superficie guidare, oppure guidare quella
realmente viva in quel momento. Lasciato aperto per una decisione tua, non presa da solo
(`CLAUDE10.md` §40a). Consolidato in `submitCodenAddress()` (nuovo helper, 3 punti prima
duplicati), che ora nomina questa causa esatta invece di un timeout generico.

**Trovato anche, fuori scope, non inseguito**: `F-TERM-002` (nuovo) — il check di `F-TERM-001`
("Enter svuota la riga") fallisce 5/5 in questa sessione. `F-TERM-001` stesso non è regredito
(Ctrl-U e la composizione funzionano); solo lo svuotamento dopo Enter è colpito. Serve una sua
indagine dedicata, guidata come questa — non una supposizione.

**Prossima invocazione**: una decisione su `F-COMMAND-001`/`F-PANEL-001` (aspetta-il-terminale
vs guida-il-vivo), oppure `F-TERM-002`, oppure il token per `cargo publish`, oppure Fase D.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-INTENT-001` | **CHIUSO 2026-08-15** — bug nel check, non nel prodotto; vedi sopra. |
| `F-COMMAND-001`/`F-PANEL-001` | **APERTI** — causa radice trovata, riparazione è una decisione di strategia di test, non un difetto. |
| `F-TERM-002` | **NUOVO, APERTO** — regressione osservata 5/5, non indagata (fuori scope di questa fase). |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5** — dual-license, audit, marchio, termini commerciali. |
| `D-0436`…`D-0445` | **FATTO**, deployati. Solo `D-0438` confermato dall'Owner. |
| ATOM↔CodeN Evolution | **NON VERIFICATO** — serve una sessione autenticata (l'Owner ce l'ha già). |
| `D-0433` | **APERTO.** Stessa condizione già accettata. |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` in `secrets/crates_io_token`, da terminale vero. |

## Verificato IN QUESTA SESSIONE

| Strumento | Risultato |
|---|---|
| `tools/run-browser-e2e.sh` (probe disposable) | **5 run**: 391 check/run, `F-INTENT-001` verde 5/5, `F-COMMAND-001`/`F-PANEL-001` rossi 5/5 con causa nominata, `F-TERM-002` rosso 5/5 |
| `node --test …` | **2546/2547** (1 skip preesistente, invariato) |
| `tools/run-eslint.sh` | **408 file, 0/0/0** — dopo ogni edit |
| pulizia container/rete/tag | verificata dopo le 5 run: solo `noesar-evolution` + 1 rollback, zero tag `*e2e*`/`*probe*` residui |
| bookkeeping di stato | `PROJECT_STATE.json.last_commit` era rimasto a `c849651` con `HEAD` già a `1467033` (i commit `D-0454`/`D-0455` mai chiusi in stato) — riallineato, commit `9d3c4fc`, pushato |

## Cosa NON è stato fatto

- **La riparazione vera di `F-COMMAND-001`/`F-PANEL-001`** — richiede una decisione tua di
  strategia di test (vedi sopra), non eseguita senza di te.
- **`F-TERM-002`** — trovato, non indagato: fuori dallo scope autorizzato di questa fase.
- **`cargo publish`** e **le altre 6 domande di `docs/LICENSE_STRATEGY.md` §5** — invariate da
  `D-0453`, restano per la Fase 5 / per quando fornisci il token.
- **Nessuna conferma visiva dell'Owner** su `D-0436`…`D-0445` (tranne `D-0438`); **ATOM↔CodeN
  Evolution non verificato**.

## Proposta di miglioramento

**`codenTerminalState()` nasconde `#codenShell` incondizionatamente al passaggio a `live`,
anche se un utente reale ci sta scrivendo dentro in quel momento** — lo stesso difetto che
questa sessione ha trovato in forma automatizzata è reale anche per una persona: testo
digitato nel box legacy può sparire silenziosamente sotto un cambio di superficie che l'utente
non ha chiesto. Beneficio: nessun input perso a un evento asincrono di cui l'utente non sa
nulla; costo: una guardia (`if (legacyShell.matches(':focus-within') || legacyShell contains a
non-empty prompt) defer the hide until submit/cancel`) in `app.js`, poche righe. Non eseguita
in questa fase — proposta e registrata, come impone `CLAUDE10.md` §17.
