# SESSION HANDOFF — 2026-08-15 (`D-0456`/`D-0457`: i tre finding indagati, la proposta implementata)

## ➜ LA PROSSIMA AZIONE

**Owner ha detto "NON DARMI PROPOSTE SE PENSI SIA VALIDO... IMPLEMENTA, PROCEDI PURE" sulla
proposta di miglioramento del giro precedente. Implementata, verificata, committata, pushata
— NON deployata (deployment resta un'autorizzazione a parte, regola 77).**

**Riassunto dei tre finding, stato finale:**

- **`F-INTENT-001` CHIUSO.** Bug nel check e2e (ricostruiva l'input del resolver senza
  l'address book), non nel prodotto. Verde 7/7 run.
- **`F-COMMAND-001`/`F-PANEL-001`: bug di prodotto reale trovato E RIPARATO** —
  `codenTerminalState()` (`app.js`) nascondeva `#codenShell` (il prompt legacy) in modo
  incondizionato nell'istante in cui il terminale moderno diventava `live`, anche se una
  persona ci stava scrivendo dentro in quel momento: parole digitate sparite sotto un cambio
  di superficie senza preavviso. Ora differisce il nascondimento finché il box è occupato
  (focus o testo non inviato) e riprova quando la persona ha finito. **Misurato**: la corsa di
  fase 3c che questo finding nominava è passata da 5/5 fallimenti a 0/2; la prima occorrenza
  di `workspace-actions` (creazione piano) pure. **Resta UNA terza occorrenza** (plan-restore,
  tardi nel flusso) che NON è una corsa — a quel punto il terminale è live e stabile da molti
  passi, quindi il box legacy resta nascosto per progetto, correttamente. Serve che il TEST
  impari a guidare quell'indirizzo attraverso qualunque superficie sia davvero attiva
  (terminale live vs box legacy) — decisione di strategia di test, ancora tua.
- **`F-TERM-002` (nuovo)**: regressione osservata 5/5 (poi non ricontrollata nelle run 6-7,
  irrilevante alla riparazione di questo giro), non indagata — fuori scope.

**Prossima invocazione**: la decisione su come il test dovrebbe raggiungere il pannello Plan
di restore quando il terminale è stabilmente live, oppure autorizzazione a indagare
`F-TERM-002`, oppure il token per `cargo publish`, oppure Fase D, oppure autorizzazione a
**deployare** questa riparazione sull'installazione live (non fatto in questo giro).

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-INTENT-001` | **CHIUSO 2026-08-15.** |
| `F-COMMAND-001` | **RIPARATO** (bug di prodotto reale, app.js) — 5/5→0/2, test di regressione `coden-legacy-shell-hide.test.mjs` 4/4. Non ancora deployato. |
| `F-PANEL-001` | **PARZIALMENTE RIPARATO** — 2 occorrenze su 3 pulite. La terza è una collisione di design a stato stabile, non una corsa; decisione di strategia di test aperta. |
| `F-TERM-002` | **APERTO, non indagato** — regressione osservata 5/5, fuori scope di questa fase. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| ATOM↔CodeN Evolution | **NON VERIFICATO** — serve una sessione autenticata (l'Owner ce l'ha già). |
| `D-0433` | **APERTO.** Stessa condizione già accettata. |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` in `secrets/crates_io_token`, da terminale vero. |

## Verificato IN QUESTA SESSIONE

| Strumento | Risultato |
|---|---|
| `tools/run-browser-e2e.sh` (probe disposable) | **7 run totali**: le prime 5 hanno trovato la causa; le run 6-7, dopo la riparazione, mostrano `BROWSER_E2E_FAIL` sceso da 4 a 2 |
| `node --test …` | **2550/2551** (1 skip preesistente) — ha bloccato una regressione reale prima del commit: `webui-boot-order.test.mjs` (`D-0416`) ha trovato `legacyHidePending` dichiarato dopo `initRouter()` (temporal dead zone), riparato spostandolo |
| `tools/run-eslint.sh` | **409 file, 0/0/0** — dopo ogni edit |
| pulizia container/rete/tag | verificata dopo tutte le run: solo `noesar-evolution` + 1 rollback, zero tag `*e2e*`/`*probe*` residui |
| nuovo test di regressione | `coden-legacy-shell-hide.test.mjs` — 4/4, guardia sulla forma del fix in `app.js` |

## Cosa NON è stato fatto

- **Il deployment** della riparazione `app.js` sull'installazione live — non autorizzato in
  questo giro (regola 77: il deployment resta una decisione a parte).
- **La terza occorrenza di `F-PANEL-001`** — richiede una decisione tua di strategia di test
  (vedi sopra), non presa da solo.
- **`F-TERM-002`** — trovato, non indagato: fuori dallo scope autorizzato di questa fase.
- **`cargo publish`** e **le altre 6 domande di `docs/LICENSE_STRATEGY.md` §5** — invariate.
- **Nessuna conferma visiva dell'Owner** su `D-0436`…`D-0445` (tranne `D-0438`); **ATOM↔CodeN
  Evolution non verificato**.

## Proposta di miglioramento

**La stessa collisione di design appena riparata per il box legacy esiste, simmetrica, per il
terminale moderno**: se un utente sta scrivendo NEL terminale nell'istante in cui
`codenTerminalState()` transita a `failed`/`refused` (per esempio una disconnessione di rete),
il box legacy ricompare sotto di lui senza preavviso, esattamente lo scambio di ruoli del
difetto appena chiuso. Beneficio: coerenza — un solo principio ("mai interrompere una persona
a metà") applicato a entrambe le direzioni della transizione, non solo a una; costo: la stessa
guardia, letta al contrario, sul ramo `show`. Non eseguita in questo giro — proposta e
registrata, come impone `CLAUDE10.md` §17.
