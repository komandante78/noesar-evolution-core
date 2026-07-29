# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-29 (`D-0228`). Stato completo in `PROJECT_STATE.json`, storia in
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

**Le altre decisioni di questa giornata, in una riga ciascuna** (il dettaglio vive in
`docs/DECISION_LOG.md`, non qui):

- **`D-0225`** — niente si installa per verificare: `scripts/test.sh` ricade su un container
  `python:3-slim` effimero. Eseguendoli per la prima volta ha trovato **due bug preesistenti**
  (lista di 12 migrazioni stale dopo le `0013-0016`; booleani JSON dentro sorgente Python).
  `pass=5 unavailable=4` → **`pass=10 fail=0 partial=0 unavailable=0`**.
- **`D-0224`** — `INST-006` era già vero ma **non protetto**: la disclosure sul backup non
  cifrato esisteva nella WebUI senza alcun test. Aggiunto, provato in rosso e ripristinato.
- **`D-0223`** — il rischio 4 era chiuso solo a metà: scritte `ARCH-001…008`, `INST-001…010`,
  `CUBE-001…009`, `SESS-001…003` dopo aver letto i 14 documenti (3568 righe). Ogni riga marca
  lo stato reale, non un verde di default.
- **`D-0222`** — il gate `UI-090` su una superficie realmente servita (atomd
  `/v1/research-gate` + prodotto `/api/v1/research/gate`), **20/21** contro 15/21 della
  denylist. Nessuna superficie WebUI lo consuma ancora: la Ricerca resta gated (`D-0142`).

**Decisione rimandata all'Owner, da prendere ad apertura della prossima sessione** — chiesto
esplicitamente "test su modello vero? un benchmark con scritture complesse?" a fine sessione,
e la risposta onesta era no a entrambi: le 12 superfici sono **tutte** funzioni deterministiche
(`MODEL_BACKED=false`), l'unico punto che chiama un modello è il gate `UI-090` (classificazione,
non ragionamento), e i 4 casi del banco `simulate` erano file sintetici da poche righe, non
scritture complesse reali. **Due strade diverse, non decise qui**:
1. Un modello vero nel circuito del ragionamento — richiede scegliere QUALE delle 10 superfici
   deterministiche sostituire con una chiamata a un LLM, una decisione di design, non tecnica.
2. Un banco `simulate`/`decompose` su cambiamenti reali e complessi (commit veri di questo
   repository, non file sintetici) — più piccolo, non richiede un modello nuovo.

**Se nessuna delle due viene scelta**: `ARCH-001` — il supervisore PID 1 a tre figli pari è
**tuttora zero file**, il criterio critico più grosso rimasto — o la superficie WebUI
`UI-090…096` sopra il gate che ora esiste.

## ➜ Stato dell'installazione

- **Prodotto**: `noesar-evolution:phase4-atom-all-surfaces` · `Up (healthy)` ·
  `RestartCount=0` · `192.168.178.100:8100→8088` · mount `/shadows` **rw**,
  `NOESAR_SHADOWS_ROOT=/shadows`, `NOESAR_EXTERNAL_SURFACES` = **tutte e dodici**.
  Rollback preservato: `noesar-evolution.rollback-all-surfaces-20260729T072501Z`
  (`:phase4-research-gate`).
- **atomd**: `atom-evolution:atomd` (con registro di sessioni) · `Up (healthy)` ·
  `noesar-evolution-net` · mount `/shadows` **ro**. Rollback preservato:
  `atomd.rollback-pre-sessions-20260729T072209Z`.
- **Radice ombre condivisa**: `/mnt/cachec/NOESAR_EVOLUTION_SHADOWS`, `10001:10002`, `2750`
  (setgid). Fuori da `/workspace` per costruzione; XFS, quindi il reflink è reale.
- **Due container per progetto su entrambi i lati** (installazione + 1 rollback ciascuno).
- **Costo di rollback: nessuno.** Nessuna migrazione, `AI_STATE_VERSION` invariato.
  ⚠ Tornare indietro riporta ATOM a **tre** superfici e fa rifiutare di nuovo `simulate`
  (nessun mount) e `fixtures` (nessun registro di sessioni).

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
