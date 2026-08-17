# SESSION HANDOFF — 2026-08-17 (`D-0501`: `F-SLASH-001` CLOSED, design A)

## ➜ LA PROSSIMA AZIONE

**`F-SLASH-001` is closed.** It had been open since 2026-08-15 and was the last item on the list
waiting on a decision only the Owner could make. Design A was chosen: the `coden-slash-feedback`
step now drives the **live terminal** instead of `#codenPrompt`, the legacy composer the modern
terminal retires by design (`D-0413`). The old step asserted on `[data-bench-panel].active` — a
path the visible surface never takes — which is why no retry could ever fix it.

**Six checks, all PASS on two consecutive runs of the final code.** The Owner's original
complaint is now answered where it lives, not adjacent to it:

| Complaint | Now measured as |
|---|---|
| «non vedo cambiamenti» | the visible surface demonstrably changes — 520 → 685 chars |
| «non si capisce» | the arrow `→ /diff` **and** the reason (`/diff needs <run> to run…`) are on screen |
| «non so se funzionano» | `/diff <realRunId>` returns that run's own record — `status: RESTORED`, real uuid, real plan steps, not a placeholder |

Probe: **498/500**.

**Next — Owner's choice**:
1. **`F-E2E-001`** — recommended. This session produced its **second independent observation**,
   four days after the first, with the symptom matching the old record verbatim. Its own text set
   the bar ("a flake chased without a second observation is a guess"); that objection is now gone,
   so it is the one open item whose cost-to-chase just dropped.
2. One of the **6 remaining** "backend proven, not e2e-driven" gaps: `#/research`, theme/accent,
   log-search/debug-mode, skills, modules, remote-targets.
3. Another named open item (see table).

No code changes or deployment without explicit Owner authorization.

## Questa sessione, cinque fasi — tutte committate e pushate

| Fase | Cosa è vero adesso che prima non lo era |
|---|---|
| `D-0497` | `TOOLS_MODULES_INDEX` completo, **102/102**. `cargo test --workspace --offline` → **144/144**, prima misura reale dello stack Rust. 3 finding nuovi. |
| `D-0498` | `#/settings/updates` guidato end-to-end, 5 check. 6° dei 9 gap e2e di `D-0491` chiuso. |
| `D-0499` | La dipendenza d'ordine silenziosa fra `updates` e `authority-form` è un'assertion, con **controllo positivo permanente** che prova che il detector discrimina. |
| `D-0500` | `soft()` dichiara le assertion che un blocco interrotto non ha raggiunto — conteggio **derivato**, mai tenuto a mano. |
| `D-0501` | `F-SLASH-001` **CLOSED**, design A. |

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-E2E-001` | **OPEN — 2ª osservazione (`D-0501`)**, non riparato. `s327/4b`, dipendente da ordine o tempi. Il più pronto da inseguire. |
| 6 remaining "backend proven, not e2e-driven" | **OPEN** — `#/research`, theme/accent, log-search/debug-mode, skills, modules, remote-targets. |
| `F-TOOLS2-001` | **OPEN, recorded** — 3/17 slash command non testati al livello di dispatch. `D-0497`. |
| `F-RUST-001` | **OPEN, recorded** — 8/20 crate Rust senza test; `noesar-auth` (Argon2/TOTP reali) compilata e mai chiamata. `D-0497`. |
| `F-CAP4-001` | **OPEN, recorded** — `capabilities/sandbox/` + `templates/` non letti da alcun codice. `D-0497`. |
| 7 API groups senza test dedicato | **RECORDED** — `artifacts`, `chat`, `closures`, `conversations`, `knowledge`, `search`, `sources`. `D-0494`. |
| `F7-001` | **OPEN, fuori scope** — `capabilities/reference/*.py`, 23 CRITICAL/9 HIGH dal sweep `D-0204`. |
| `F-MODEL-001` | **OPEN**, attende scelta Owner — `#/models` `servedBy` non dichiarato. `D-0395`. |
| `#/coden/bench/documentation` copy | **OPEN, `D-0489`** — testo proposto, serve approvazione. |
| ATOM licence | **APPLICATO** — aperto, AGPL, repository separato invariato. `D-0468`. |
| Product access control | **DECISO** — registrazione, mai licenza a codice. `D-0467`/`D-0468`. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` da terminale vero. |
| `F-I18N-002` | **OPEN**, not re-baselined — 643 closable of 904 (baseline 607). |
| `F-MANIFEST-001` | **OPEN**, pre-esistente — `MANIFEST.sha256` 5898 vs 6568 file tracciati. |
| `F-ROT-001` | **OPEN** — `NOESAR_ALLOWED_HOSTS` nomina ancora l'IP pre-rotazione. |
| Independent pentest (beta criterio 4) | **OPEN, non pianificato** — scope pronto, serve l'Owner per ingaggiare un tester esterno. |

Tutti gli altri: **FIXED/DEPLOYED/CLOSED** in `docs/DECISION_LOG.md`.

## Verificato IN QUESTA SESSIONE

`cargo test --workspace --offline`: **144/144** (container `rust:1-bookworm` usa e getta,
`--network none`, dipendenze vendored). Probe finale: **498/500**, e i 6 check `POINT-2B` verdi su
**due run consecutive** del codice finale. `D-0500`'s counting logic: **9/9** casi oracolo, visti
rossi prima. `tools/run-eslint.sh`: 411 file, 0 errori, 0 warning. `node tools/verify-source.mjs`:
`SOURCE_VERIFY=PASS migrations=19 baseline=12/12 intact`. Secret scan: **euristica** —
`gitleaks` assente su questo host, dichiarato (regola 45). `docker ps -a` dopo ogni run: esattamente
i due container permessi, nessun tag immagine e2e e nessuna rete stampata sopravvissuta.

## Cosa NON è stato fatto

- **`F-E2E-001` non è riparato** — ha ora la sua seconda osservazione, che è informazione, non una
  riparazione. Fuori dallo scope autorizzato di `D-0501`.
- **Due difetti nei check NUOVI di questa fase sono stati trovati guidandoli, non leggendoli**, e
  riparati prima di chiudere: un'attesa soddisfatta dall'**eco** del comando inviato
  (`coden-terminal.js:442`), e un diagnostico a fetta cieca che mostrava il JSON del comando
  *precedente*. Entrambi sono registrati in `D-0501` perché sono la ragione per cui il primo
  risultato "verde" non era verde.
- **`usage` non è asseritο** nel check del `/diff` nudo: la riga `Usage:` è reale ma la sua
  presenza sulle righe visibili dipende da quanto è scorso il transcript — misurata `true` in una
  run e `false` in quella successiva, su codice identico. Asserirla comprerebbe un flake.
- **I 6 gap page-level, `F-TOOLS2-001`, `F-RUST-001`, `F-CAP4-001`, gli 8 crate Rust senza test,
  la ri-triage di `F7-001`** — registrati, nessuno costruito.
- **Nessun codice di prodotto è stato modificato in nessuna delle cinque fasi.**

## Proposta di miglioramento

**Questo giro (`D-0501`)**: entrambi i difetti trovati oggi nei check nuovi appartengono a **una
sola classe** — un'attesa che il test stesso può soddisfare. L'eco del comando soddisfaceva
`waitForFunction`, e la fetta cieca "confermava" leggendo l'entry sbagliata. La suite ha 500
check e nessun modo di distinguere *"ho atteso una prova"* da *"ho atteso il mio stesso input"*.
Un helper `awaitAnswer(marker, { notMerely })` che **rifiuta** un marcatore già presente prima
della sottomissione renderebbe questa classe impossibile per costruzione, invece di lasciarla da
riscoprire un check alla volta: cattura lo schermo prima, e se il marcatore atteso è già lì
fallisce subito dicendo «questa attesa era già soddisfatta prima dell'azione». Costo: ~12 righe e
un call site per attesa (oggi ~15 nei blocchi terminale). Beneficio: la classe di difetto che ha
prodotto due falsi verdi in una sola fase non può ripresentarsi in silenzio. Registrata, non
costruita — toccherebbe l'harness nella stessa fase che l'ha già cambiato per altro.

**Precedenti (`D-0500`-`D-0460`)**: vedi `docs/DECISION_LOG.md`.
