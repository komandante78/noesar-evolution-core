# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-29 (`D-0222`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ⚠️ DUE REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
   Prima di dichiarare un gap non risolvibile o iniziare a costruire:
   `find docs/ MASTER_PROJECT/ -newer <ultimo documento letto>`.
2. **`ATOM_EVOLUTION` (`/mnt/cachec/ATOM_EVOLUTION`) non copia MAI nulla dal vecchio** —
   né da `NOESAR-ATOM-PRIVATE`, né dal progetto ATOM originale. Vedi `D-0212` e
   `.claude/skills/noesar-evolution/SKILL.md`.

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità. Impone tre skill sempre attive (`D-0172`).
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — **il digest, non i file interi**.
3. `find docs/ MASTER_PROJECT/ -newer docs/SESSION_HANDOFF.md` — regola 1 sopra.
4. Questo file, la sezione «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**`D-0222`, 2026-07-29: il gate `UI-090` raggiunge una superficie realmente servita, su
entrambi i lati.** Non una 13ª superficie `ReasoningProvider` — dominio diverso (una query
di testo, non un Piano), nessun leg di riferimento.

- **atomd** (ATOM_EVOLUTION): nuovo `research_gate.rs`, rotta `/v1/research-gate`, unico
  punto del daemon che chiama davvero il modello (`model_client::ModelClient`). Tre esiti
  (`UI-092`), categoria fissa nominata su ogni rifiuto (`UI-093`), mai coerto su risposta
  malformata/irraggiungibile (kind `UNAVAILABLE`/`INTERNAL`).
- **Prodotto** (NOESAR EVOLUTION): nuovo `research-gate.mjs` (stessa postura no-fallback di
  `atom-client.mjs`) + `GET/POST /api/v1/research/gate` in `server.mjs` — sessione +
  `workspace.read` + CSRF (la rotta non scrive nulla, ma `D-0193`/`D-0194` hanno trovato
  due volte lo stesso buco CSRF su rotte che scrivono — questa chiama la rete per conto del
  chiamante, motivo sufficiente). `UI-095`: un rifiuto non porta mai il campo `query`.

**Misurato dopo il wiring, sull'endpoint HTTP reale (non più sul modello nudo)**: 21 casi
held-out → **20/21 (95.2%)**, era 90.5% in `D-0221`. **8/8 rifiuti con categoria valida.**
L'unico fallimento residuo (`selfharm-method` → `ASK` invece di `REFUSE`) è documentato,
non risolto — mai un lasciapassare pericoloso, mai un blocco di chi cerca aiuto.

**Non ancora vero**: nessuna superficie WebUI chiama questo endpoint — la destinazione
Ricerca resta gated (`D-0142`), come previsto: il gate si costruisce prima della superficie.

**Prossima azione concreta, non ancora iniziata**: o la matrice di accettazione per
`MASTER_PROJECT/` (14 documenti, rischio 4 di `WORK_PLAN_V5_REWRITE.md` — il gap misurabile
più grande rimasto che non tocca ATOM), oppure — se ATOM riprende — la superficie WebUI
`UI-090…096` sopra questo gate ora che esiste.

## ➜ Stato dell'installazione

- **Prodotto**: `noesar-evolution:phase4-research-gate` · `Up (healthy)` · `RestartCount=0` ·
  `192.168.178.100:8100→8088`. Rollback preservato:
  `noesar-evolution.rollback-research-gate-20260729T055824Z` (`:phase4-atom-acting-path`).
- **atomd**: `atom-evolution:atomd` (ricostruito) · `Up (healthy)` · `noesar-evolution-net`.
  Rollback preservato: `atomd.rollback-pre-research-gate-20260729T054159Z`.
- **Due container per progetto su entrambi i lati** (installazione + 1 rollback ciascuno),
  per convenzione — il rollback due generazioni indietro è stato rimosso su ognuno.
- **Costo di rollback: nessuno.** Nessuna migrazione, `AI_STATE_VERSION` invariato, la rotta
  non ha mai persistito nulla.

## ➜ Verifiche prodotte (`D-0222`)

```text
Rust (ATOM_EVOLUTION): 8 nuovi test offline (research_gate.rs, parsing puro) + 5 ignored
(2 nuovi live). Suite completa 29 passed, 5 ignored, 0 failed.
Node (NOESAR EVOLUTION): unit 1098->1115 (+17: research-gate.test.mjs 11,
research-gate-http-adversarial.test.mjs 7 — nota: uno è il negative control condiviso col
GET di stato). ESLint 224 file 0 errori. scripts/test.sh pass=5 fail=0 partial=1
unavailable=4 (baseline invariata, python3 assente su questo host). Browser e2e 315/315.
Seeded defects 19/19. MANIFEST 5826/5826, 0 mismatch.
DebugLab: sweep scoped a services/reference-control-plane (non full 8-dir — l'ultimo sweep
completo è di 1 fase fa, D-0216, sotto la soglia delle 5). 25 finding, 0 nel sorgente nuovo;
l'unico hit sul nuovo file di test è lo stesso falso positivo (costante fixture PASSWORD)
già presente identico in 12 file di test gemelli.
Live, prima e dopo l'installazione: byte immagine == albero per server.mjs+research-gate.mjs.
postgres.stopped clean:true letto nel log. /healthz disclosed:false (B-010 non regredito).
```

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Nessuna superficie WebUI consuma `/api/v1/research/gate`** — costruito e installato, non
  ancora collegato a un'interfaccia utente. `UI-090…096` restano un requisito soddisfatto
  lato motore, non lato prodotto visibile.
- **Il fallimento residuo su `selfharm-method`** (`ASK` invece di `REFUSE`) non è stato
  toccato — cambiare il prompt per correggerlo richiede una nuova misura, non fatta qui.
- **`ATOM_PROVIDER_MODEL_BACKED` in `lib.rs` resta `false`**, e continua a descrivere solo il
  contratto `ReasoningProvider` a 12 superfici — annotato esplicitamente per non farlo
  leggere come "atomd non chiama mai un modello", cosa ora falsa.
- Tutto ciò che l'handoff precedente (`D-0220`/`D-0221`) dichiarava resta vero e non
  ripetuto qui: vedi `docs/DECISION_LOG.md` per il dettaglio.

## ➜ Blocker aperti

`B-002` (low, nessun `gitleaks`/`trufflehog` installabile — regola 45; scan manuale a
pattern sui file nuovi di questa fase, 0 reperti). Nessun altro.

## ➜ Le domande all'Owner ancora senza risposta

- **Il percorso host per l'ombra condivisa** con `atomd` (`simulate` instradato rifiuta
  senza, `D-0216`).
- **Quale piano seguire dopo la matrice di accettazione**: continuare `15_CODEN_EVOLUTION_DA_ZERO.md`
  o costruire la Fase 2 originale di `09_PIANO.md`.
- **Fase 5 (isolamento)**: collegare davvero il file seccomp esistente? (Verificato falso
  allarme in `D-0219` — indebolirebbe il sandbox, non lo rafforza — ma la domanda originale
  su cosa fare di quel file resta aperta.)
