# SESSION HANDOFF — 2026-08-14 (`D-0450`: Phase C first slice — `noesar-sandbox` extraction proven)

## ➜ LA PROSSIMA AZIONE

**Owner ha scelto l'opzione (b) offerta da `D-0449`: Fase C (`noesar-sandbox` standalone,
`FUNDING/19_WORK_PLAN_TO_BETA.md`), autorizzando esplicitamente di salvare i tre finding aperti
(`F-COMMAND-001`/`F-INTENT-001`/`F-PANEL-001`) per una fase dedicata **alla fine** di questo
filone di lavoro — non toccati questa fase, invariati.**

**Cosa è chiuso davvero (verificato, non dichiarato) — prima fetta della Fase C:**
- `rust/crates/noesar-sandbox/Cargo.toml` letteralizzato: niente più `.workspace = true`, valori
  reali + metadata di pubblicazione (`description`/`repository`/`readme`/`keywords`). Backup in
  `BACKUPS/noesar-sandbox-Cargo.toml.20260814T142614Z`.
- `rust/crates/noesar-sandbox/README.md` aggiunto (nuovo).
- **Estrazione provata due volte**: in-tree, `cargo test -p noesar-sandbox --offline --locked`
  → **21/21**. Fuori dal repository — la sola directory della crate copiata in
  `scratchpad/noesar-sandbox-extracted/` con `libc-0.2.189` vendorizzato e un proprio
  `.cargo/config.toml`, nessun `[workspace]` genitore — build + test dentro un container
  `rust:1-bookworm --network none`: **21/21**, e il binario compilato risponde correttamente a
  `--detect` dallo stesso container isolato.
- Regressione in-tree: `node --test` **2546/2547** (1 skip preesistente, invariato),
  `verify-source.mjs` **PASS**.

**Cosa NON è stato fatto — la fetta successiva della Fase C, esplicitamente rinviata:**
pubblicazione reale su `crates.io`, estrazione in un repository git separato, CI che esegua questo
pattern automaticamente. Tutte e tre sono azioni esterne o irreversibili (`CLAUDE10.md` regola 77)
che richiedono una propria autorizzazione dell'Owner — non assunte qui. Dettaglio completo:
`D-0450` nel decision log.

**Tre finding salvati per la fine, invariati** (`PROJECT_STATE.json.open_findings`):
`F-COMMAND-001` (medium, Enter sul prompt legacy non arriva a `submitCodenPrompt()`),
`F-INTENT-001` (low, classificatore `memory→nothing`), `F-PANEL-001` (medium, timeout
`workspace-actions` su `[data-agent-panel="plan"].active`). Nessuno indagato questa fase.

**Prossima invocazione**: l'Owner sceglie fra (a) la fetta successiva di Fase C (publish/CI —
richiede autorizzazione esplicita), (b) i tre finding salvati, ora o quando l'Owner dice "alla
fine", (c) Fase D (Capability Token open spec, WP4, dipende dal pattern appena provato in Fase C).

## ➜ Precedenti azioni, invariate, non toccate questa fase

`D-0445` (menu `/` 34→17 + ramo `navigate`, installato `noesar-evolution:d0445-menu-
20260814T112604Z`) e `D-0446` (funding-fit skill) restano come descritto nel decision log alle
rispettive voci — nessuna conferma visiva dell'Owner ancora arrivata su `D-0436`…`D-0445` tranne
`D-0438`. Rollback di `D-0445`, se serve:

```sh
docker stop --timeout 30 noesar-evolution && docker rm noesar-evolution \
  && docker rename noesar-evolution-pre-20260814T112620Z noesar-evolution && docker start noesar-evolution
```

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-COMMAND-001`/`F-INTENT-001`/`F-PANEL-001` | **APERTI, salvati per la fine** (istruzione Owner, questa fase). |
| `D-0436`…`D-0445` | **FATTO**, deployati. Solo `D-0438` confermato dall'Owner. |
| `D-0444` `/model <id>` | **FATTO, DEPLOYATO.** Non ancora provato con un modello reale. |
| ATOM↔CodeN Evolution | **NON VERIFICATO** — serve una sessione autenticata (l'Owner ce l'ha già). |
| `D-0435` (E2E harness) | **CHIUSO** (`D-0449`) — vedi backlog salvato sopra per il seguito. |
| `D-0433` | **APERTO.** Stessa condizione già accettata. |

## Verificato IN QUESTA SESSIONE (ultimo giro)

| Strumento | Risultato |
|---|---|
| `cargo test -p noesar-sandbox --offline --locked` (in-tree, container `rust:1-bookworm`) | **21/21** |
| `cargo build --release --offline` + `cargo test --offline` (estratta, fuori repo, `--network none`) | **21/21**, binario funzionante |
| `grep -rl` per riferimenti al monorepo dentro la copia estratta | **zero hit** |
| `node --test …` | **2546/2547** (1 skip preesistente) |
| `verify-source.mjs` | **PASS** |
| secret scan | euristico (gitleaks assente, dichiarato) — nessuna stringa credential-shaped |

## Cosa NON è stato fatto

- **Pubblicazione `crates.io`, repository git separato, CI del pattern di estrazione** — rinviati,
  richiedono autorizzazione esplicita.
- **I tre finding `F-COMMAND-001`/`F-INTENT-001`/`F-PANEL-001`** — salvati per la fine, non
  indagati per istruzione diretta dell'Owner.
- **Nessuna conferma visiva dell'Owner** su `D-0436`…`D-0445` (tranne `D-0438`).
- **`D-0444` non provato con un modello reale**; **ATOM↔CodeN Evolution non verificato**.

## Proposta di miglioramento

**Un template di clean-room-extraction test riusabile**, non solo per `noesar-sandbox`: le crate
`WP3`/`WP4`/`WP5` (`noesar-contracts`/token-spec/conformance-suite, Fasi D-E del work plan) ripetono
esattamente questo pattern — copiare, vendorizzare solo le dipendenze dirette, buildare
`--network none` senza workspace genitore. Uno script (`tools/verify-crate-extraction.sh <crate>`)
che generalizzi i passi fatti a mano qui eviterebbe di reinventarlo ad ogni fase e darebbe
un'evidenza misurabile ("estraibile: sì/no") invece di una prosa ripetuta — beneficio: Fasi D/E
partono più veloci; costo: uno script nuovo, piccolo, da scrivere e testare una volta.
