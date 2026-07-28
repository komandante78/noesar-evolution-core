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

**`D-0193` chiuso e installato: `workspace-actions.mjs` attaccato al rigore di
`coden-invariant-adversarial.test.mjs`, su richiesta esplicita dell'Owner.** Nuovo file
`workspace-actions-http-adversarial.test.mjs` (9 test HTTP-level, sessione reale, non le
chiamate dirette all'orchestratore che `workspace-actions.test.mjs` già copriva) ha trovato
un difetto vero prima di chiuderlo: `plan`/`approve`/`reject`/`restore` — l'unica superficie
che spende un token e scrive un file vero — non chiamavano mai `requireCsrf()`, a differenza
di ogni altra rotta mutante di `server.mjs`. **Visto fallire rosso** (cookie valido, nessun
header CSRF → 201/200) **prima del fix**, verde dopo. `SameSite=Strict` sul cookie mitigava
già il CSRF classico; questa era la seconda riga di difesa che il resto del codice tratta
come obbligatoria, silenziosamente assente sulla superficie più nuova.

**La clausola sull'autorità di `workspace-actions.mjs` è ora al rigore chiesto**: sessione,
CSRF (×3: assente, sbagliato, presente-e-corretto), identità non client-supplied (`actor` e
`approverId` nel body sono ignorati), WRITE-only strutturale (nessun campo body raggiunge
`blastRadius.destructive`), scope del token calcolato server-side (approve() non legge mai
un elenco file dal client), onestà dello stato in rete, controllo negativo end-to-end.

**Trovato per strada, NOMINATO non riparato** (`F4-017`): `capability/mint` e
`/spend` condividono la stessa identica lacuna CSRF — stesso file, fuori dallo scope di
file dichiarato per questa fase (workspace-actions, non capability). Una fase futura che
tocca `capability.mjs`/le sue rotte HTTP eredita questo come primo item.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-csrf-hardening` · `Up (healthy)` · `restarts=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-workspace-actions-20260728T060127Z` (il predecessore immediato,
porta la lacuna CSRF). Due container di progetto, che è quanto §5a ammette. Host: 39 totali,
11 in esecuzione.

## ➜ Cosa è stato fatto in questa sessione

Un solo file prodotto cambiato: `server.mjs`, due chiamate a `requireCsrf()` aggiunte (dopo
`requireSession`+permesso, prima del corpo dell'handler) sui blocchi `plan` e
`approve/reject/restore`. Un file nuovo: `test/workspace-actions-http-adversarial.test.mjs`.
MANIFEST aggiornato per entrambi (riga sostituita per `server.mjs`, riga aggiunta per il
nuovo test). Nessun altro file di prodotto toccato.

## ➜ Verifiche prodotte in sessione

```text
unit                  890/890  (era 881, +9)
ESLint                186 file · 0 errori · 0 warning · 0 no-undef
browser reale         315/315
accessibilità         27/27 su 27 superfici · 0 fail
difetti seminati      19/19 catturati
MANIFEST              5784/5784 · 0 mismatch · 0 righe non verificabili
AUTH_HTTP_SMOKE PASS · HTTP_SMOKE PASS · SOURCE_VERIFY PASS
Full sweep DebugLab (rule 40d, route/auth-gate change): 74 hit su tutto l'host, 0 dentro
  services/reference-control-plane/ — 71 rumore bandit/ruff pre-esistente su script di
  build (subprocess/password heuristics, nessuno nel diff), 3 semgrep MEDIUM triagiati falsi
  (0o700 è più restrittivo del "fix" 0o644 suggerito dalla regola; Object.assign su un Error
  non è mass-assignment) — tutti fuori da services/reference-control-plane/
byte immagine = albero, byte container vivo = albero (sha256sum, entrambi)
dal vivo: /livez 200, /readyz 200, /healthz 200 invariato, rotta protetta 401, rotta
  inesistente 404 — il fix CSRF stesso è provato dalla suite contro un server locale
  byte-identico (11e: nessuna suite che muta dati contro l'installazione viva)
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`capability/mint`+`/spend` mancano ancora `requireCsrf()`** — `F4-017`, stesso difetto
  di `D-0193`, non riparato in questa fase.
- Tutto ciò che era falso a fine fase precedente e non toccato da questa resta falso:
  `operationsSupported: ['WRITE']` (DELETE/EXECUTE dichiarati non costruiti),
  `testExecution: false`, `runsPersistAcrossRestart: false`, registri in memoria, firma
  provenance simmetrica, `.ps1` mai eseguiti, `F4-014` (esecutore senza oracolo condiviso),
  `F4-015` (`shadowStatus()` scrive su una GET), `F4-016` (reasoning.mjs pianifica contro
  `/workspace` letterale).

## ➜ Blocker aperti

- **`B-001`** — nessun remote. `gh` non installabile.
- **`B-008`** — due store d'identità, migrazione da fare in una fase propria.
- `B-002`, `B-009`, `B-010` — chiusi.

## ➜ Le domande all'Owner ancora senza risposta

Invariate da `D-0189`/`D-0190`: **(3)** rimuovere `apps/webui-react`; **(4)** `B-008`, quale
store è la destinazione; **(5)** `B-001`, si vuole un remote; **(6)** cinque destinazioni
dell'interfaccia «da decidere»; **(7)** conformità della conservazione dei dati delle
richieste rifiutate; **(8)** TLS. **Nuova**: si ripara `F4-017` (`capability/mint`+`/spend`)
in una fase dedicata, o si lascia nominato finché una fase tocca comunque quel file?
