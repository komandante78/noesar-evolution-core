# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-28. Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai CodeN Ultra, NOESAR V3,
ATOM o altro dell'host. L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ⚠️ REGOLA AGGIUNTA IN QUESTA SESSIONE (Owner, verbatim)

**"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."** Prima di
dichiarare un gap non risolvibile o iniziare a costruire qualcosa, controllare
`find docs/ MASTER_PROJECT/ -newer <ultimo documento letto>`. `D-0210` in questa sessione
ha corretto un errore reale nato dal non averlo fatto (dichiarato "nessun tool SBOM
disponibile" quando un vero SBOM CycloneDX+SPDX esisteva già da tre giorni).

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità. Da `D-0172` impone tre skill sempre attive.
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — **il digest, non i file interi**.
3. `find docs/ MASTER_PROJECT/ -newer docs/SESSION_HANDOFF.md` — regola aggiunta sopra.
4. Questo file, la sezione «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**Controllo sistematico Fase 1-7 fatto su istruzione dell'Owner** (verificare cosa manca
nel codice, non nei documenti, finirlo, poi andare avanti — non più a salti). Poi,
seguendo l'ordine di costruzione **per dipendenza** di
`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §10 (l'ultimo documento scritto, indicato
dall'Owner come quello da seguire):

- Passi 1-8 = Fase 1, già chiusa.
- **`D-0209` passo 9 — il verificatore per ricalcolo — chiuso, CABLATO**:
  `workspace-actions.mjs::approve()` rifiuta la promozione se una claim di contenuto è
  contraddetta, anche con confronto percorsi pulito. `:phase4-recompute-verifier`.
- **`D-0210`**: corretta una dichiarazione falsa di `D-0208` (nessun tool SBOM
  disponibile — falso, esisteva già). Nessun deploy, solo documentazione.
- **`D-0211` passo 10 — il catalogo strumenti a carico zero — chiuso**: a riposo zero
  strumenti caricati, ricercabile per nome/effetto, `scopeRequestToTool()` rende
  meccanico "un effetto non dichiarato è impossibile" (intersezione, non
  controllo-e-rifiuta). **Non ancora cablato** su un mint di token reale — dichiarato in
  `toolCatalogStatus().enforced:false`. `:phase4-tool-catalog` (**installazione
  corrente**).

**Prossima azione**: passo 11 (ATOM come secondo `ReasoningProvider` — richiede 1, 3, 9,
tutti soddisfatti; ma ATOM stesso vive in un repository privato separato per decisione,
quindi questo passo è principalmente il *seam* di integrazione), oppure cablare
`scopeRequestToTool()` su un mint reale in `workspace-actions.mjs`, oppure una decisione
dell'Owner su quale delle molte cose aperte (Fase 2/3/5 di `09_PIANO.md`, MEVCM, seccomp,
`docs/REMAINING_WORK.md`) affrontare.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-tool-catalog` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-recompute-verifier-20260728T142717Z`. Due container di
progetto, che è quanto §5a ammette. Host: 39 totali, 11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione

`D-0203` → `D-0204` → `D-0205` → `D-0206` → `D-0207` → `D-0208` → (controllo Fase 1-7) →
`D-0209` → `D-0210` (correzione) → `D-0211`. Nove commit pushati su `origin/main`.

## ➜ Verifiche prodotte in sessione (cumulative, ultima misura per voce)

```text
unit 914→...→1061, ESLint 191→...→213 file 0 errori, verify-source/http-smoke/
auth-http-smoke PASS ad ogni passo con rotte/wiring nuovi, browser e2e 315/315
(riverificato 6 volte, 0 regressioni), accessibilità 27/27, difetti seminati 19/19
(riverificato 6 volte), scripts/test.sh pass=5 fail=0 invariato. MANIFEST 5788→5812,
sempre N/N verificate (una riga trovata corrotta e riparata durante D-0209 — vedi
memoria permanente su sha256sum -c). Sei deploy live, tutti healthy al primo tentativo,
restarts=0, byte immagine=albero provato ogni volta. gitleaks dopo ogni commit: 0 leak.
DebugLab full-sweep ogni volta che si introduce/tocca una superficie nuova: sempre 0
finding nei file scritti in questa sessione. Un vero SBOM CycloneDX 1.7 + SPDX 2.3
rigenerato dal vivo contro l'immagine di produzione corrente (D-0210).
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Fasi 2, 3, 5 del roadmap `09_PIANO.md` restano sostanzialmente vuote** — verificate
  nel codice, non nei documenti.
- **MEVCM (contaminazione/canary/promozione) non esiste**: zero file.
- **Il file di policy seccomp non è collegato a nulla.**
- **Il catalogo strumenti non è ancora cablato**: `scopeRequestToTool()` esiste e
  funziona (21 test), ma nessuna rotta del prodotto lo chiama ancora prima di coniare un
  token reale.
- **`docs/REMAINING_WORK.md` (26 luglio) elenca molto altro** non toccato in questa
  sessione: WCAG "misurato non certificato", nessun collaudo di sicurezza indipendente,
  passkey/WebAuthn parziali, la matrice di accettazione V4 con 11 criteri di cui solo 2
  registrati in `PROJECT_STATE.json`.
- **F7-001 aperto**: reperti pre-esistenti (subprocess a percorso parziale), mai nei file
  scritti in questa sessione.
- SCIM e il verificatore per ricalcolo (D-0209) sono **enforced**. Sector modules,
  compliance packs, Technology Radar, OIDC, catalogo strumenti **non lo sono ancora**.

## ➜ Blocker aperti

`B-002` (low, nessun gitleaks/trufflehog installabile — regola 45; syft invece **esiste**
già in cache, vedi `D-0210`). Nessun altro.

## ➜ Le domande all'Owner ancora senza risposta

- **Quale piano seguire per "il workspace"**: continuare l'ordine per dipendenza di doc
  15 (passo 11 = ATOM), o costruire la Fase 2 originale di doc 9 (16 stadi/editor/
  terminale/sotto-agenti — molto più grande)?
- **Fase 5 (isolamento)**: collegare davvero il file seccomp esistente?
- **Fase 4 (MEVCM)**: costruire la pipeline di contaminazione/canary?
- **`docs/REMAINING_WORK.md`**: quali dei suoi punti (WCAG, pen test, passkey, matrice
  V4) contano ancora, dato che il metro è cambiato dal V4 alla riscrittura il 26 luglio?
- Le domande precedenti restano aperte: conservazione dati richieste rifiutate (`D-0136`),
  credenziali in PostgreSQL (`F4-013`), attivare TLS, riaprire EXECUTE, SAML, `F7-001`.
