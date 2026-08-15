# SESSION HANDOFF — 2026-08-15 (`D-0454`: `F-HOOK-005` root cause found and fixed)

## ➜ LA PROSSIMA AZIONE

**Governance, non Fase C: `F-HOOK-005` (SessionStart non scriveva la baseline dei container)
aveva root cause ignota da tre giorni (D-0396). Trovata e riparata in questa sessione — vedi
`D-0454`. Fase C (WP6) resta ESATTAMENTE dove D-0453 l'aveva lasciata: non "quasi tutta chiusa",
un solo comando tecnico resta scoperto e nominato sotto, nessun altro pezzo di Fase C è stato
toccato da questo giro.**

**Resta UN solo comando tecnico (`cargo publish`), e 6 domande legali/di prodotto esplicitamente
per la Fase 5 — nessuna delle due nascosta.**

**Fatto in questo giro (verificato, non dichiarato):**
- `LICENSE` (testo verbatim AGPL-3.0-or-later, scaricato con `curl` da `gnu.org` — non
  ricostruito a memoria, diffato byte-identico) + `NOTICE` aggiunti alla radice di
  `NOESAR-EVOLUTION` **e** di `github.com/komandante78/noesar-sandbox`.
- Ambito **scelto da te**, non deciso da me: solo la licenza open-core, non le altre 6 domande
  aperte di `docs/LICENSE_STRATEGY.md` §5 (meccanismo dual-license, audit dipendenze, marchio,
  termini commerciali) — quelle restano per la Fase 5, nominate esplicitamente nel documento.
- `docs/LICENSE_STRATEGY.md` §5 aggiornato voce per voce, non riscritto.

**Cosa resta — un solo comando, delimitato con precisione:**
`cargo publish`, e serve solo `CARGO_REGISTRY_TOKEN`. Via sicura, stesso schema di
`secrets/github_push_token` già in uso in questo repository:
```
printf '%s' "IL_TUO_TOKEN_CRATES_IO" > /mnt/cachec/NOESAR_EVOLUTION/secrets/crates_io_token
chmod 600 /mnt/cachec/NOESAR_EVOLUTION/secrets/crates_io_token
```
fatto da un terminale vero, non con `!comando` in chat (stesso motivo di `B-001`). Poi basta
dirmi "l'ho messo in `secrets/crates_io_token`".

**Tre finding salvati per la fine, invariati** (`PROJECT_STATE.json.open_findings`):
`F-COMMAND-001` (medium), `F-INTENT-001` (low), `F-PANEL-001` (medium) — nessuno indagato.

**Prossima invocazione**: token per `cargo publish` quando vuoi pubblicare davvero, oppure
autorizzi (a) i tre finding salvati, (b) Fase D (Capability Token spec, WP4).

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-HOOK-005` | **CHIUSO 2026-08-15 (`D-0454`)** — matcher `SessionStart` non copriva `clear`; riparato + test di regressione, 249/249 suite hook verde. |
| `F-COMMAND-001`/`F-INTENT-001`/`F-PANEL-001` | **APERTI, salvati per la fine** (istruzione Owner). |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5** — dual-license, audit, marchio, termini commerciali. |
| `D-0436`…`D-0445` | **FATTO**, deployati. Solo `D-0438` confermato dall'Owner. |
| `D-0444` `/model <id>` | **FATTO, DEPLOYATO.** Non ancora provato con un modello reale. |
| ATOM↔CodeN Evolution | **NON VERIFICATO** — serve una sessione autenticata (l'Owner ce l'ha già). |
| `D-0433` | **APERTO.** Stessa condizione già accettata. |

## Verificato IN QUESTA SESSIONE (ultimo giro)

| Strumento | Risultato |
|---|---|
| `curl gnu.org/licenses/agpl-3.0.txt` vs `LICENSE` committato | `diff` — **identico** |
| `git push` `LICENSE`+`NOTICE` a `noesar-sandbox` | commit `7c93a5b` |
| `node --test …` | **2546/2547** (1 skip preesistente, invariato) |
| `verify-source.mjs` | **PASS** |
| secret scan (euristico) su `LICENSE`/`NOTICE`/`docs/LICENSE_STRATEGY.md` | nessuna stringa credential-shaped |

## Cosa NON è stato fatto

- **`cargo publish`** — manca solo `CARGO_REGISTRY_TOKEN`, via sicura descritta sopra.
- **Le altre 6 domande di `docs/LICENSE_STRATEGY.md` §5** — deliberatamente non toccate, per
  scelta esplicita tua quando te l'ho chiesto: meccanismo CLA/DCO, audit dipendenze, licensing
  di asset/modelli terzi, policy marchio, termini della licenza commerciale, consistenza
  `LICENSE`/`NOTICE` su ogni futuro repository spin-off (WP4/WP5).
- **I tre finding salvati** — non indagati, per istruzione diretta dell'Owner.
- **Nessuna conferma visiva dell'Owner** su `D-0436`…`D-0445` (tranne `D-0438`).
- **`D-0444` non provato con un modello reale**; **ATOM↔CodeN Evolution non verificato**.

## Proposta di miglioramento

**Un check automatico che ogni repository spin-off (WP4/WP5 dopo Fase D) porti `LICENSE` +
`NOTICE` prima del primo push pubblico** — oggi `D-0453` l'ha fatto a mano per
`noesar-sandbox`; `tools/verify-crate-extraction.sh` potrebbe rifiutarsi di dichiarare PASS se
la crate non ha entrambi i file, così la lacuna non si ripete ad ogni estrazione. Beneficio:
zero repository pubblici senza licenza per dimenticanza; costo: una manciata di righe nello
script già esistente.
