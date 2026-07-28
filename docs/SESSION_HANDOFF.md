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

**Il passo 11 è chiuso, e il valore di ATOM è ora MISURATO invece che asserito.** `plan()` passa
dal router, ogni run porta la provenienza, `simulate` è una superficie del prodotto, e la
**forma** della decomposizione dice **`EXTERNAL_STRICTLY_BETTER`** su compiti presi dalla storia
vera del repository: riferimento **1/52**, ATOM **52/52**, `better=51 worse=0` (`D-0217`).

Restano tre cose, in quest ordine:

1. **Ordinamento e integrità delle dipendenze: nessuno li misura.** Le parti di sola
   osservazione introdotte da `A-0019` **nominano** la parte da cui dipendono, e **nessuna
   legge verifica che ogni `dependsOn` si risolva** a una parte che esiste davvero. È la
   stessa classe di lacuna che `D-0217` ha appena trovato: una proprietà che tutti danno per
   buona e nessun predicato controlla.
2. **Un MOUNT, non un cambio di codice.** Il contratto passa l ombra a `simulate` come
   **percorso**; `atomd` ha **zero mount**, quindi un `simulate` instradato **rifiuta**.
   `NOESAR_SHADOWS_ROOT` esiste perché chiuderlo sia montare la stessa directory nei due
   container. **Serve che l Owner nomini il percorso host** (regola 4), e la radice delle
   ombre **non può stare dentro `/workspace`**.
3. **`ATOM_PROVIDER_MODEL_BACKED = false` resta vero.** Dieci superfici su undici sono
   funzioni totali dei loro argomenti. Ciò che è dimostrato è che la sua **decomposizione** è
   strettamente migliore su lavoro vero — non che ragioni.

## ➜ Stato dell'installazione

`noesar-evolution:phase4-atom-acting-path` · `Up (healthy)` · `RestartCount=0` ·
`192.168.178.100:8100→8088` · rollback preservato
`noesar-evolution.rollback-atom-acting-path-20260728T175658Z` (`:phase4-atom-routing`).
**Quattro** container di progetto: l'installazione, un rollback, `atomd` (componente dichiarato,
`D-0214`) e `atomd.rollback-pre-attribution-*`. Il quarto è dichiarato in
`docs/INSTALLATION_LEDGER.md`: il tag `atom-evolution:atomd` è stato **riusato**, quindi
l'immagine precedente non ha più un nome e quel container fermo **è** il percorso di rollback. Host: 37 container non di
progetto, **invariati**; volumi **25/25** invariati.

**Costo di rollback: nessuno.** Nessuna migrazione, `AI_STATE_VERSION` invariato, nessun dato
toccato. Tornare a `:phase4-atom-routing` toglie l'instradamento dal percorso che agisce e la
superficie `simulate`.

## ➜ Verifiche prodotte (D-0217, la misura)

```text
unit 1082→1092, ESLint 217→221 file 0 errori, MANIFEST 5819→5823 con 0 righe non
verificabili, SOURCE_VERIFY=PASS. ATOM: 71/71 offline (erano 70). Oracolo provato per
MUTAZIONE prima di credere a un numero: tolta una regola → 2 test rossi; ripristinata →
10/10 e file byte-identico.
Misura su 60 compiti da 60 commit reali: DECISIVE=52 (8 esclusi perché già verificabili,
esclusione dichiarata), REFERENCE_SETTLED=1/52, EXTERNAL_SETTLED=52/52,
better=51 worse=0 equal=1 → VERDICT=EXTERNAL_STRICTLY_BETTER.
Prima della riparazione A-0019 in ATOM: 42/52 — la misura ha TROVATO il difetto.
```

## ➜ Verifiche della fase precedente (D-0216)

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

- **Un `simulate` instradato sull'installazione rifiuta** — vedi punto 2 sopra. È corretto e
  dichiarato, non è una predizione mancante.
- **`tools/accessibility-audit.mjs` NON è stato eseguito in questa fase**: richiede
  `puppeteer`, assente sull'host fuori dall'immagine browser-e2e. Nessun markup o CSS è
  cambiato, e la suite browser che rende ogni superficie è stata rieseguita per intero
  (315/315). Il 27/27 in `PROJECT_STATE.json` resta la misura di `D-0209`.
- **`ATOM_PROVIDER_MODEL_BACKED = false`**: dieci superfici su undici sono funzioni totali
  dei loro argomenti. ATOM è logica deterministica dietro un contratto, **non un modello**. Ciò
  che `D-0217` dimostra è che la sua **decomposizione** è strettamente migliore su lavoro vero,
  **non** che ragioni. E la **copertura** di proiezione resta `NO_DIFFERENCE` (`D-0215`): è un
  fatto vero sulla copertura, non un difetto cancellato.
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

- **Il percorso host per l'ombra condivisa** (punto 2 sopra). Senza, `simulate` instradato
  resta un rifiuto onesto invece che una predizione.
- **Quale piano seguire**: continuare l'ordine per dipendenza di
  `15_CODEN_EVOLUTION_DA_ZERO.md`, o costruire la Fase 2 originale di `09_PIANO.md`.
- **Fase 5 (isolamento)**: collegare davvero il file seccomp esistente?
