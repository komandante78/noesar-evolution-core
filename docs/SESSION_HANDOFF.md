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

**`D-0228`, stessa giornata: ATOM misurato contro la REALTÀ, e un limite strutturale trovato.**
`tools/measure-simulation-accuracy.mjs`: `simulate` predice, poi le scritture vengono
**eseguite davvero** e il filesystem è riletto — la verità di terreno è la directory dopo, non
ciò che lo strumento si aspettava (l'attesa non è mai scritta nel test: si osserva prima, si
scrive, si osserva dopo). **`EXACT_MATCH=6/7`, `FALSE_PREDICTIONS=1`, `MISSES=0`.**

Il caso che fallisce è `rewrite-identical-content`: la scrittura produce i byte già presenti,
quindi **non accade nulla**, ma `simulate` dice `modify`. **Non è un difetto di ATOM**: il
Piano nomina **percorsi, non contenuti**, quindi il contratto non gli dà l'informazione per
saperlo. Il caso avversario è tenuto **dentro** il banco, non rimosso per pulire il punteggio.
⚠ La direzione conta: ATOM **non ha mai mancato** un cambiamento reale — ha nominato uno che
non è avvenuto. Un predittore che avvisa in eccesso è revisionabile; uno che manca un
cambiamento lo lascia passare inosservato.

**`D-0227`, stessa giornata: il primo banco sulla fedeltà del replay.** `SESS-002` non era mai
stato misurato perché non *poteva* esserlo: senza registro di sessioni `fixtures` rifiutava
sempre. `tools/measure-replay-fidelity.mjs` → **`FAITHFUL_SESSIONS=8/8`, `64/64` voci
riprodotte, `DIVERGED=0`**. L'oracolo è **provato per manomissione a ogni esecuzione** (si
corrompe la risposta registrata lasciando l'input intatto: il replay deve divergere — misurato
`2/3 reproduced, faithful=false`); se non cattura, lo strumento **rifiuta di riportare
numeri**. ⚠ Non dimostra che un modello riproduca il proprio output — misura il livello di cui
il prodotto è responsabile (`11 · P1`).

**Stato dei benchmark, onesto** — quattro misure su dodici superfici:

| Banco | Contro cosa | Risultato |
|---|---|---|
| `decompose` (forma) | provider di riferimento, 60 commit veri | **51/51** contro **0/51** |
| gate `UI-090` | denylist testuale, 21 casi held-out | **20/21** contro 15/21 |
| fedeltà replay (`SESS-002`) | ricalcolo del daemon | **8/8** sessioni, 64/64 voci |
| accuratezza `simulate` | **la realtà** (filesystem dopo esecuzione vera) | **6/7**, 1 falsa predizione, **0 mancate** |

**Solo l'ultimo misura contro qualcosa che non siamo noi.** Gli altri tre confrontano ATOM col
**nostro** provider di riferimento o con sé stesso: **nessun benchmark contro un sistema terzo
o un dataset pubblico esiste.** E **otto superfici su dodici non hanno alcun banco.**

**`D-0226`, stessa giornata: ATOM risponde su TUTTE E DODICI le superfici.** Misurato coi
byte installati contro il daemon installato: `ANSWERED=12/12`, `ROUTED_TO_ATOM=12/12`.
Tre cause distinte, ognuna diagnosticata **eseguendo**, non leggendo:

| Superficie | Causa vera | Natura |
|---|---|---|
| `expect` | il piano del mio probe era degenere (nessun file, nessun comando) | **non un difetto** — era la garanzia di ATOM che funzionava |
| `simulate` | `atomd` non aveva **alcun mount** sulla radice delle ombre | configurazione, non codice |
| `fixtures` | il daemon costruiva `AtomProvider::new()`, senza registratore | **unico vero buco di codice** |

Radice condivisa `/mnt/cachec/NOESAR_EVOLUTION_SHADOWS` (`10001:10002`, setgid) montata rw
sul prodotto e **ro** su `atomd`; scrittura, reflink e lettura cross-uid provate in container
prima del deploy. Registro di sessioni in `atomd` (header `x-atom-session`, cap 64, sfratto
del più vecchio che **dichiara** di essere uno sfratto invece di sembrare una sessione vuota).
`simulate` **predice davvero**: distingue `modify existing.txt` da `create brand-new.txt`
leggendo l'ombra. Daemon giù → **12/12 `UNAVAILABLE`, zero fallback**.
⚠ **Conseguenza**: con 12 superfici instradate, `atomd` giù fa 503 su tutte e dodici invece
che su tre. Rollback = un `docker run` senza `NOESAR_EXTERNAL_SURFACES`.

**`D-0225`, stessa giornata: niente si installa per verificare — un container usa-e-getta,
e trova due bug veri.** L'Owner ha chiesto se installare-poi-disinstallare per testare fosse
ammesso: no (regola 20/21), l'alternativa sanzionata è un container effimero (regola 21a).
`scripts/test.sh` e `test-packaging-filters.mjs` ora ricadono su `python:3-slim` offline se
`python3` manca sull'host — stesso schema già usato per Rust/ESLint. **Eseguiti per la prima
volta, hanno trovato due bug reali preesistenti**: `verify-postgres-migrations.py` aveva 12
migrazioni codificate a mano, mai aggiornate dopo che le `0013-0016` sono atterrate;
`test-packaging-filters.mjs` incorporava booleani JSON (`true`/`false`) dentro sorgente
Python (`NameError` garantito). Entrambi corretti, provati per mutazione dal vivo.
`scripts/test.sh`: `pass=5 unavailable=4` → **`pass=10 fail=0 partial=0 unavailable=0`**.

**`D-0224`, stessa giornata: `INST-006` era già vero, e non protetto.** Verificandolo per
`D-0223` ho trovato che la WebUI dichiara già "not encrypted... authentication master key"
in `view-backups` — ma zero test lo proteggevano da una cancellazione silenziosa. Aggiunto
`webui-markup-structure.test.mjs::INST-006`, provato in rosso rimuovendo il testo dal vivo
e poi ripristinato. `INST-006` passa da ⚠ a ✅ nella tabella di `08`. Nessun deploy: la
WebUI servita non è stata toccata, solo protetta.

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

**`D-0223`, stessa giornata: il rischio 4 era chiuso solo a metà.** `D-0116` (documento 15,
`CE-001…024`) dichiarava il rischio 4 di `WORK_PLAN_V5_REWRITE.md` chiuso, ma copriva solo
CodeN Evolution; `UI-001…096` (`docs/WEBUI_DESIGN_V3.md`) copre l'interfaccia. Tre aree dei
14 documenti non avevano **un solo ID**: architettura, installazione, memoria a cubi.
Letti tutti i 14 documenti (3568 righe) prima di scrivere un ID — non inventati, estratti
dalle affermazioni testabili già nel testo. Scritte: `ARCH-001…008` (doc 03), `INST-001…010`
(doc 08), `CUBE-001…009` (doc 14, tutto ⏳ per costruzione — nulla di quel documento è
implementato), `SESS-001…003` (doc 01, il pacchetto Prova di Sessione). **Ogni riga marca lo
stato reale** (✅ costruito/verificato, ⏳ non costruito, ⚠ parziale o aperto) — non un verde
di default: `INST-006` (backup non cifrato) resta ⚠ aperto, dichiarato anche nel documento 05.
**Nessun criterio è stato costruito o verificato in questa fase**: la matrice rende dicibile
"fatto" per ID, non lo dichiara.

**Prossima azione concreta, non ancora iniziata**: costruire contro i criteri marcati ⏳
critici (es. `ARCH-001` il supervisore a tre figli, tuttora zero file), oppure — se ATOM
riprende — la superficie WebUI `UI-090…096` sopra il gate `D-0222` ora che esiste.

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
