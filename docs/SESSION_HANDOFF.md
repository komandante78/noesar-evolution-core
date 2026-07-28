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

**`D-0194` chiuso e installato: `F4-017` riparato — stessa lacuna CSRF di `D-0193`, questa
volta su `/api/v1/capability/mint` e `/spend`.** `D-0193` aveva chiuso la lacuna su
`workspace-actions.mjs` e **nominato** (non riparato) la stessa lacuna sulle rotte che
mintano/spendono il token stesso, fuori dallo scope di file dichiarato in quella fase.
L'Owner ha detto «procedi»: stesso file già toccato, nessuna ragione per rimandare.

`capability-http-adversarial.test.mjs` (4 test) ha ottenuto un piano VERO da
`/api/v1/workspace-actions/plan` e attaccato mint/spend con la richiesta che una chiamata
legittima costruirebbe. **Visto fallire rosso in modo concreto**: un cookie valido senza
header CSRF poteva mintare **e spendere** un token — lo spend forgiato ha davvero consumato
l'unico uso del token prima della riparazione (non solo "avrebbe potuto", l'ha fatto,
verificato nel test). `requireCsrf()` aggiunto dopo il controllo `workspace.write` già
esistente; verde dopo, incluso che uno spend forgiato non consuma più un uso.

**Con questo, tutte le rotte mutanti di `server.mjs` chiamano `requireCsrf()`.** Nessuna
lacuna nota di questa classe resta aperta.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-capability-csrf` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-csrf-hardening-20260728T061943Z` (il predecessore immediato,
porta la lacuna `F4-017`). Due container di progetto, che è quanto §5a ammette. Host: 39
totali, 11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione (due fasi, `D-0193` + `D-0194`)

Un solo file di prodotto cambiato in entrambe le fasi: `server.mjs`, tre chiamate a
`requireCsrf()` aggiunte in totale (2 sul blocco workspace-actions, 1 sul blocco condiviso
capability mint/spend). Due file di test nuovi:
`workspace-actions-http-adversarial.test.mjs` (9 test) e
`capability-http-adversarial.test.mjs` (4 test). MANIFEST aggiornato a ogni passo.

## ➜ Verifiche prodotte in sessione (stato finale, dopo entrambe le fasi)

```text
unit                  894/894  (era 881 a inizio sessione, +13)
ESLint                187 file · 0 errori · 0 warning · 0 no-undef
browser reale         315/315
accessibilità         27/27 su 27 superfici · 0 fail
difetti seminati      19/19 catturati
MANIFEST              5785/5785 · 0 mismatch · 0 righe non verificabili
AUTH_HTTP_SMOKE PASS · HTTP_SMOKE PASS · SOURCE_VERIFY PASS
Full sweep DebugLab, RIPETUTO due volte (rule 40d, due cambi di auth-gate): 0 hit dentro
  services/reference-control-plane/ in entrambe le corse; stesso rumore pre-esistente
  (71 bandit/ruff su script di build, 3 semgrep MEDIUM falsi) fuori da quella cartella
byte immagine = albero, byte container vivo = albero (sha256sum, entrambe le fasi)
dal vivo: /livez 200, /readyz 200, /healthz 200 invariato, rotte protette 401, rotta
  inesistente 404 — i fix CSRF stessi sono provati dalle suite contro un server locale
  byte-identico (11e: nessuna suite che muta dati contro l'installazione viva)
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- Tutto ciò che era falso a fine fase precedente e non toccato da questa sessione resta
  falso: `operationsSupported: ['WRITE']` (DELETE/EXECUTE dichiarati non costruiti),
  `testExecution: false`, `runsPersistAcrossRestart: false`, registri in memoria, firma
  provenance simmetrica, `.ps1` mai eseguiti, `F4-014` (esecutore senza oracolo condiviso),
  `F4-015` (`shadowStatus()` scrive su una GET), `F4-016` (reasoning.mjs pianifica contro
  `/workspace` letterale).

## ➜ Blocker aperti

- **`B-001`** — nessun remote. `gh` non installabile.
- **`B-008`** — due store d'identità, migrazione da fare in una fase propria.
- `B-002`, `B-009`, `B-010` — chiusi.

## ➜ Le domande all'Owner ancora senza risposta

Invariate da `D-0189`/`D-0190`, nessuna nuova aperta da questa sessione: **(3)** rimuovere
`apps/webui-react`; **(4)** `B-008`, quale store è la destinazione; **(5)** `B-001`, si vuole
un remote; **(6)** cinque destinazioni dell'interfaccia «da decidere»; **(7)** conformità
della conservazione dei dati delle richieste rifiutate; **(8)** TLS.
