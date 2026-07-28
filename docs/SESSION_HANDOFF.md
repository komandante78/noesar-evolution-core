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

**`D-0195`: `apps/webui-react` rimossa su emendamento esplicito dell'Owner** — secondo named
exception alla regola 12 di `CLAUDE10.md` (il primo era `MASTER_REFERENCE/`, `D-0097`/§1a).
Tre file dodici righe, nessun componente reale, già segnalati come schema morto dal proprio
`README.md`. Trovato per strada un difetto latente in `tools/generate-inventory.mjs` — la
frase generata per l'inventario nominava `apps/webui-react` come stringa letterale invece di
derivarla dai dati calcolati, e con la cartella rimossa si sarebbe autocontraddetta
("0 manifest(s) … chiefly apps/webui-react"); corretto per essere derivato dai dati. Sistemati
anche `eslint.config.mjs` (ignore + rules block morti) e il test che ne verifica la
allowlist, più la voce `deferred_items` in `PROJECT_STATE.json` che descriveva la cartella
come non spedita.

**`D-0196`: altre tre domande standing risposte, nessuna costruita.** Nella stessa sessione
l'Owner ha risposto: **`B-008`** → PostgreSQL è la destinazione dell'identità, migrazione in
una fase propria; **`B-001`** → sì a un remote, l'Owner fornirà le credenziali (non ancora
fornite in questa sessione — bloccato); **TLS** → si apre una fase dedicata. Nessuna delle tre
è stata costruita qui: una fase, un solo obiettivo (regola 9), e combinarle sarebbe stato
scope creep (regola 11).

**Prossima fase, a scelta dell'Owner**: una delle tre — migrazione identità su PostgreSQL
(`B-008`), TLS, o il remote git (`B-001`, appena le credenziali sono disponibili). Nessuna
delle tre è iniziata.

## ➜ Stato dell'installazione

**Invariato da `D-0194`** — questa fase è source-only, `apps/webui-react` non era mai spedita
nell'immagine (`tools/generate-inventory.mjs` lo dichiarava già), quindi nessun rebuild/deploy.
`noesar-evolution:phase4-capability-csrf` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-csrf-hardening-20260728T061943Z`. Due container di progetto, che è
quanto §5a ammette. Host: 39 totali, 11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione (`D-0195` + `D-0196`)

`git rm -r apps/webui-react` (3 file). Modificati: `CLAUDE10.md` (emendamento regola 12),
`eslint.config.mjs`, `services/reference-control-plane/test/static-analysis-config.test.mjs`,
`tools/generate-inventory.mjs` (fix del difetto latente), `PROJECT_STATE.json`
(`deferred_items`, `next_action`, `last_commit`, `last_updated`), `MANIFEST.sha256`.
`docs/DECISION_LOG.md`: due voci nuove, `D-0195`+`D-0196`.

## ➜ Verifiche prodotte in sessione (source-only — nessun T2/T3, niente è installato)

```text
unit                  894/894  (invariato — nessun test copriva apps/webui-react)
ESLint                187 file · 0 errori · 0 warning · 0 no-undef (invariato)
tools/verify-source.mjs → SOURCE_VERIFY=PASS, migrations=16, baseline=12/12 intact
MANIFEST               5785 → 5782 (3 righe rimosse), 5782/5782 verificate — conteggio OK
  incrociato con le righe del file, non solo l'exit code di sha256sum -c (lezione D-0186)
node --check            eslint.config.mjs, static-analysis-config.test.mjs,
  tools/generate-inventory.mjs — sintassi OK
```

Non eseguiti in questa fase (non necessari — nessuna rotta, markup, CSS, DB o Rust toccati):
browser e2e, accessibilità, difetti seminati, http-smoke, DebugLab sweep, build immagine.

## ➜ Cosa NON è vero, e non va scoperto per caso

- Tutto ciò che era falso a fine fase precedente e non toccato da questa sessione resta
  falso: `operationsSupported: ['WRITE']` (DELETE/EXECUTE dichiarati non costruiti),
  `testExecution: false`, `runsPersistAcrossRestart: false`, registri in memoria, firma
  provenance simmetrica, `.ps1` mai eseguiti, `F4-014` (esecutore senza oracolo condiviso),
  `F4-015` (`shadowStatus()` scrive su una GET), `F4-016` (reasoning.mjs pianifica contro
  `/workspace` letterale).
- `B-008` deciso ma **non migrato**: `state/auth.json` resta la fonte viva.
- `B-001` deciso ma **bloccato**: nessuna credenziale fornita, nessun remote configurato.
- TLS deciso ma **non costruito**: l'installazione resta senza certificato.

## ➜ Blocker aperti

- **`B-001`** — remote voluto dall'Owner, in attesa delle sue credenziali. `gh` non installabile.
- **`B-008`** — due store d'identità; destinazione decisa (PostgreSQL), migrazione non fatta.
- `B-002`, `B-009`, `B-010` — chiusi.

## ➜ Le domande all'Owner ancora senza risposta

Quattro delle sei precedenti sono state risposte in questa sessione (`apps/webui-react`,
`B-008`, `B-001`, TLS — vedi `D-0195`/`D-0196`). Restano:

- **La conformità della conservazione dei dati delle richieste rifiutate** — non è una
  decisione dell'Owner da prendere: il disegno è già autorizzato (`D-0136`), manca una
  verifica di conformità legale/normativa esterna a questo progetto, prima che diventi
  codice in produzione.
- **La domanda "cinque destinazioni UI da decidere" era già stata risposta da `D-0125`**
  (mappa 23→11 completa) — era rimasta nell'elenco standing per errore, non riproporla.
