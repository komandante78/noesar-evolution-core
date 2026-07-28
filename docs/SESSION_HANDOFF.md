# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-28. Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ⚠️ DUE REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
   Prima di dichiarare un gap non risolvibile o iniziare a costruire:
   `find docs/ MASTER_PROJECT/ -newer <ultimo documento letto>`. `D-0210` ha corretto un
   errore reale nato dal non averlo fatto.
2. **`ATOM_EVOLUTION` (`/mnt/cachec/ATOM_EVOLUTION`) non copia MAI nulla dal vecchio** —
   né da `NOESAR-ATOM-PRIVATE`, né dal progetto ATOM originale. Vedi `D-0212` e
   `.claude/skills/noesar-evolution/SKILL.md`.

## ➜ Leggi in quest'ordine

1. `CLAUDE10.md` — l'autorità. Impone tre skill sempre attive (`D-0172`).
2. `.claude/skills/noesar-evolution-context/state-digest.sh` — **il digest, non i file interi**.
3. `find docs/ MASTER_PROJECT/ -newer docs/SESSION_HANDOFF.md` — regola 1 sopra.
4. Questo file, la sezione «LA PROSSIMA AZIONE».

## ➜ LA PROSSIMA AZIONE

**Il passo 11 è chiuso per la parte che è codice.** `plan()` — l'unico percorso che conia un
capability token e scrive un file vero — passa dal `ReasoningRouter`, ogni run porta la
**provenienza**, e `simulate` è una superficie del prodotto
(`POST /api/v1/workspace-actions/{runId}/simulate`). Installato `:phase4-atom-acting-path`.

Restano due cose, in quest'ordine:

1. **Un MOUNT, non un cambio di codice.** Il contratto congelato passa l'ombra a `simulate`
   come **percorso**, e il provider la legge. `atomd` installato ha **zero mount**
   (`docker inspect atomd → Mounts: []`), quindi un `simulate` instradato **rifiuta** — il
   rifiuto è riportato come rifiuto, mai come predizione né come `supported: false`.
   `NOESAR_SHADOWS_ROOT` è stato aggiunto perché chiuderlo sia esattamente questo: montare
   la stessa directory in entrambi i container. **Serve che l'Owner nomini il percorso host**
   (regola 4: fuori da `PROJECT_ROOT` è sola lettura salvo che la fase lo nomini), e la
   radice delle ombre **non può stare dentro `/workspace`** — `shadow.mjs` rifiuta un'ombra
   contenuta nell'albero che ombreggia.
2. **La misura del valore.** `CE-023` è soddisfatto nella forma e dice **`NO_DIFFERENCE`**:
   per-compito `better=0 worse=0 equal=9 di 9`. La differenza fra i due provider è nella
   **forma della decomposizione**, non nella copertura. Serve una metrica sulla forma, oppure
   compiti tratti da un **repository vero** invece dei nove sintetici.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-atom-acting-path` · `Up (healthy)` · `RestartCount=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-atom-acting-path-20260728T175658Z` (`:phase4-atom-routing`).
**Tre** container di progetto: l'installazione, un rollback, e `atomd` — il terzo è un
**componente dichiarato** (`D-0214`), non un sopravvissuto. Host: 37 container non di
progetto, **invariati**; volumi **25/25** invariati.

**Costo di rollback: nessuno.** Nessuna migrazione, `AI_STATE_VERSION` invariato, nessun dato
toccato. Tornare a `:phase4-atom-routing` toglie l'instradamento dal percorso che agisce e la
superficie `simulate`.

## ➜ Verifiche prodotte in questa fase

```text
unit 1071→1082 (+11), ESLint 216→217 file 0 errori 0 warning 0 no-undef,
browser e2e 315/315, difetti seminati 19/19, scripts/test.sh pass=5 fail=0 partial=1
unavailable=4 (invariato, python3 assente su questo host), MANIFEST 5818→5819 con
0 mismatch e 0 righe non verificabili, HTTP_SMOKE=PASS, AUTH_HTTP_SMOKE=PASS,
SOURCE_VERIFY=PASS. Byte immagine == albero 4/4 prima di installare.
DebugLab sweep COMPLETO (superficie nuova ⇒ 40d lo impone): services/ 0, ai-workspace/ 0,
rust/crates/ 0, oci/ 0 — zero finding in tutto ciò che questa fase ha scritto.
```

**Dal vivo, prima di installare, su coppia effimera** (rete + 3 prodotti + 1 `atomd`, tutti
rimossi nella stessa fase), con l'ombra condivisa fra i due container:

| Configurazione | Esito |
|---|---|
| daemon presente | `plan` **201**, provenienza `expect=atom`; `simulate` **200 `supported:true`**, `predictedDiff:["modify a.txt [step-1]"]` |
| daemon fermo | `plan` **503**, **nessuna run creata**, workspace invariato |
| nessun provider esterno | ogni superficie `reference`, `simulate` **`supported:false`** — `CE-022` regge |
| CSRF assente | **403** su `simulate` |

**Dal vivo, sull'installazione** (mai una suite che muta dati, §3a 11e): `healthy`,
`RestartCount=0`, `/livez` `/readyz` `/healthz` **200**, `/healthz` con `disclosed:false`
(`B-010` non regredito), `POST …/simulate` **401** contro **404** di una rotta inesistente.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Un `simulate` instradato sull'installazione rifiuta** — vedi punto 1 sopra. È corretto e
  dichiarato, non è una predizione mancante.
- **`tools/accessibility-audit.mjs` NON è stato eseguito in questa fase**: richiede
  `puppeteer`, assente sull'host fuori dall'immagine browser-e2e. Nessun markup o CSS è
  cambiato, e la suite browser che rende ogni superficie è stata rieseguita per intero
  (315/315). Il 27/27 in `PROJECT_STATE.json` resta la misura di `D-0209`.
- **`ATOM_PROVIDER_MODEL_BACKED = false`**: dieci superfici su undici sono funzioni totali
  dei loro argomenti. ATOM è logica deterministica dietro un contratto, non un modello — ed è
  la ragione strutturale per cui `CE-023` misura zero.
- **Fasi 2, 3, 5 del roadmap `09_PIANO.md` restano sostanzialmente vuote.** MEVCM non esiste.
  Il file di policy seccomp non è collegato a nulla. Il catalogo strumenti non è cablato su un
  mint di token reale.
- **`F7-001` aperto**, riconfermato da questo sweep: `capabilities/` 45 finding e `tools/` 12,
  tutti della stessa classe (subprocess a percorso parziale), **nessuno nei file di questa
  fase**. Un finding in `apps/webui-static/app.js:135` (`insecure-object-assign`) **dismesso
  con evidenza**: `Object.assign` attacca tre proprietà con **nome letterale** a un `Error`
  appena creato — nessun oggetto controllato dall'utente, nessuna mass assignment.
- **`docs/REMAINING_WORK.md` (26 luglio)** elenca altro non toccato: WCAG «misurato non
  certificato», nessun collaudo di sicurezza indipendente, passkey/WebAuthn parziali.

## ➜ Blocker aperti

`B-002` (low, nessun `gitleaks`/`trufflehog` installabile — regola 45). Nessun altro.

## ➜ Le domande all'Owner ancora senza risposta

- **Il percorso host per l'ombra condivisa** (punto 1 sopra). Senza, `simulate` instradato
  resta un rifiuto onesto invece che una predizione.
- **Quale piano seguire**: continuare l'ordine per dipendenza di
  `15_CODEN_EVOLUTION_DA_ZERO.md`, o costruire la Fase 2 originale di `09_PIANO.md`.
- **Fase 5 (isolamento)**: collegare davvero il file seccomp esistente?
