# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-28. Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai CodeN Ultra, NOESAR V3,
ATOM o altro dell'host. L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità. Da `D-0172` impone tre skill sempre attive.
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — **il digest, non i file interi**.
3. Questo file, la sezione «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**`D-0203`: Fase 1 CHIUSA.** EXECUTE resta rifiutato per design. Su istruzione
dell'Owner, si procede in **Fase 7** ("Il mondo esterno"), **Fasi 2-6 saltate**
esplicitamente.

Tre passi di Fase 7 chiusi e installati **nella stessa sessione, uno via l'altro**, su
istruzione esplicita dell'Owner di non fermarsi:

- **`D-0204` passo 27** — framework moduli di settore + livelli di fiducia
  (`sector-modules.mjs`). `:phase4-sector-modules`.
- **`D-0205` passo 28** — pacchetti di conformità firmati e datati
  (`compliance-packs.mjs`). Firma Ed25519 reale (`node:crypto`), interoperabilità con
  `openssl pkeyutl` **provata in entrambe le direzioni**. `:phase4-compliance-packs`.
- **`D-0206` passo 29** — Technology Radar (`technology-radar.mjs`). A differenza dei
  due precedenti, il seed (15 voci) è **contenuto reale**, non solo framework — riusa la
  firma del passo 28. `:phase4-technology-radar` (**installazione corrente**).

**Prossima azione**: passo 30 (OIDC, SAML, SCIM), o a scelta dell'Owner. Sessione
proseguita senza chiudere fra un passo e l'altro, su istruzione esplicita.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-technology-radar` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-compliance-packs-20260728T111825Z`. Due container di
progetto, che è quanto §5a ammette. Host: 39 totali, 11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione

`D-0203` (chiusura Fase 1, state-only) → `D-0204` (sector-modules.mjs, 3 rotte,
installato) → `D-0205` (compliance-packs.mjs, 3 rotte, 2 CLI tool, firma Ed25519,
installato) → `D-0206` (technology-radar.mjs, 5 rotte, riusa la firma di D-0205,
installato). Tre commit pushati su `origin/main` (`8d02e34`, `1bb43ea`, e il commit di
questa fase — vedi `git log`). Dettaglio completo di ciascuno nel decision log.

## ➜ Verifiche prodotte in sessione (cumulative, ultima misura per voce)

```text
unit 914→932→954→972 (+58 sui tre passi), ESLint 191→193→197→199 file 0 errori,
verify-source/http-smoke/auth-http-smoke PASS ad ogni passo, browser e2e 315/315
(riverificato 3 volte, 0 regressioni), accessibilità 27/27 (riverificato 3 volte),
difetti seminati 19/19 (riverificato 3 volte), scripts/test.sh pass=5 fail=0 invariato
(python3 assente sull'host). MANIFEST 5788→5790→5794→5797, sempre N/N verificate. Byte
immagine = albero verificato ad ogni deploy (5, poi 3, poi 4 file). Tre deploy live
consecutivi, tutti healthy al primo tentativo, restarts=0. gitleaks dopo ogni commit:
0 leak.
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Fasi 2-6 del roadmap non sono costruite** — saltate su istruzione dell'Owner (D-0203).
- **Nessuno dei tre passi è enforced**: `sectorModulesStatus().enforced`,
  `compliancePacksStatus().enforced`, `technologyRadarStatus().enforced` sono tutti
  `false`. Nessuna superficie del prodotto cambia comportamento in base a un modulo di
  settore, un pacchetto di conformità o una voce del radar.
- **Nessun modulo di settore e nessun pacchetto di conformità reale è mai stato
  installato** — `.sector-modules/` e `.compliance-packs/` sono vuote su ogni
  deployment. Il Technology Radar è l'**eccezione dichiarata**: il suo seed (15 voci) è
  contenuto reale, non un placeholder.
- **La regola di transizione del radar copre solo `revoked` come terminale** — nessun
  grafo completo fra i 6 anelli, deliberatamente: non fondato dal testo sorgente.
- **F7-001 aperto**: 23 CRITICAL/9 HIGH in `capabilities/reference/*.py` + 7 CRITICAL/2
  HIGH in due file di `tools/` — stessa classe (subprocess con percorso parziale),
  pre-esistente, mai nei file scritti in questa sessione. Non riparato, fuori scope.
- Tutto ciò che era falso a fine `D-0201` e non toccato resta falso:
  `operationsSupported: ['WRITE']`, `testExecution: false`,
  `runsPersistAcrossRestart: false`, registri in memoria, firma **provenance** (build,
  non compliance-pack/radar) simmetrica, `.ps1` mai eseguiti, TLS costruita ma non
  attiva.

## ➜ Blocker aperti

`B-002` (low, nessun gitleaks/trufflehog installabile — regola 45). Nessun altro.

## ➜ Le domande all'Owner ancora senza risposta

- **La conformità della conservazione dei dati delle richieste rifiutate** — verifica
  legale/normativa esterna a questo progetto (design già autorizzato, `D-0136`).
- **Da `D-0197`, invariata**: credenziali dentro PostgreSQL contro `F4-013`?
- **Da `D-0198`, invariata**: attivare TLS ora fornendo un certificato?
- **Da `D-0201`, invariata**: riaprire EXECUTE come fase propria?
- **`F7-001`**: riparare in una fase dedicata, o accettare come rischio residuo
  dichiarato di codice dormiente?
