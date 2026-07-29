# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-29 (`D-0231`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

**Unica eccezione documentata (`D-0232`, 2026-07-29)**: il file dei pesi
`phi-4-Q4_K_M.gguf`, già scaricato per CodeN Ultra, è stato **letto** (copia read-only,
`cp --reflink`, CodeN Ultra non in esecuzione al momento) su istruzione diretta dell'Owner
che ha nominato il peso per nome — non una mia interpretazione della regola. Nessuna
dipendenza runtime fra i due progetti: `atom-evolution-model` serve il proprio file dentro
`ATOM_EVOLUTION/model_store/`, mai una chiamata a CodeN Ultra.

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

**`D-0231`, terza fase della stessa giornata: il "session protocol" — `docs/
CODEN_EVOLUTION_DESIGN_V1.md` §17 — costruito, e NON è una shell.** Su istruzione esplicita
dell'Owner ("va costruito comunque, ora o dopo, è inutile fermarsi") è stato costruito **il
resto** del workbench CodeN Evolution: un unix socket (`session-protocol.mjs`, a
`/workspace/tui.sock`, visibile sull'host in `NOESAR_EVOLUTION_RUNTIME/tui.sock`) per un
**terminale vero** (`tools/tui-client.mjs`, CLI Node zero-dipendenze, readline) e il bridge
HTTP dello stesso dispatch (`POST /api/v1/tui/command`) per il tab Terminal del workbench —
**un solo motore, due shell**, entrambe sulle stesse istanze di `workspace-actions`/
`repo-map`/event ledger già in uso da Plan/Shadow/Diff.

**Confine rispettato, non un'esitazione**: quando l'Owner ha chiesto "e non puoi crearlo?"
riferendosi a "un vero protocollo di sessione su unix socket", la risposta è stata **sì, ma
non una shell POSIX grezza** — l'architettura del progetto stesso disegna il Permission
Engine fra OGNI shell (WebUI o Terminale) e il Sandbox Runtime, "tokens only". Questo
protocollo **non ha nessun metodo `exec`**: ogni comando (`plan`/`simulate`/`approve`/
`reject`/`restore`/`get`/`events`/`map`/`search`/`status`) è una delle operazioni già
guardiane del prodotto. `workspace-actions.mjs` continua a rifiutare EXECUTE e DELETE
"permanently and on purpose" su **entrambe** le shell.

**2 bug reali trovati costruendo, non leggendo**: (1) `readline.question()` di Node
ri-registra un listener a un colpo solo per ogni chiamata — su stdin in pipe, se lo script
arriva tutto in un unico chunk, il secondo prompt si blocca per sempre perché il listener
si attacca dopo che la riga è già passata; riparato con un `LineReader` a coda persistente.
(2) Il pannello Preview usava `background:#fff` — un colore letterale fuori dal layer dei
token, che il guardiano proprio del progetto ("no colour literal survives outside the token
definitions") esiste per catturare: `seeded-defect-proof` è passato da 19/19 a **6/19**
(ogni difetto seminato aveva improvvisamente DUE test che obiettavano invece di uno).
Riparato con `var(--surface-code)`, tornato 19/19.

## ➜ Stato dell'installazione

- **Prodotto**: `noesar-evolution:phase4-session-protocol` · `Up (healthy)` ·
  `RestartCount=0` · `192.168.178.100:8100→8088` · stessa configurazione del predecessore.
  Rollback preservato: `noesar-evolution.rollback-session-protocol-20260729T150250Z`
  (`:phase4-workspace-actions-panels`).
- **atomd**: invariato, `atom-evolution:atomd` · `Up (healthy)` · `noesar-evolution-net`.
- **Due container per progetto** (installazione + 1 rollback, il più recente). Reti (10)
  e volumi (29) invariati prima/dopo la rimozione del rollback precedente.
- **Costo di rollback: nessuno.** Nessuna migrazione, `AI_STATE_VERSION` invariato. ⚠
  Tornare a `:phase4-workspace-actions-panels` toglie solo socket/bridge/tab Terminal;
  Plan/Shadow/Diff/Editor/Preview/Problems/Logs/Map (`D-0230`) restano invariati.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **Nessun `exec`** in nessuna delle due shell — solo le operazioni già guardiane.
- **La password del client TUI non è mascherata a schermo** — farlo bene richiede la
  modalità raw del terminale, che non esiste su una pipe; rimandato, non un blocco.
- **Nessuna superficie WebUI consuma ancora `/api/v1/research/gate`** — invariato da `D-0222`.
- **`ATOM_PROVIDER_MODEL_BACKED` in `lib.rs` resta `false`** — invariato da `D-0226`.
- **Tests execution resta rifiutata per design** — `execute()` riceve sempre `tests:[]`.

## ➜ Blocker aperti

`B-002` (low, nessun `gitleaks`/`trufflehog` installabile — regola 45; scan manuale a
pattern su tutte e tre le fasi di oggi, 0 reperti). Nessun altro.

## ➜ Verificato in questa fase (terzo giro, D-0231)

Unit 1126/1126 (+7, `session-protocol.test.mjs` sul trasporto socket direttamente — importare
`server.mjs` nei test non esegue mai la guardia d'ingresso che avvierebbe un socket reale),
ESLint 229 file 0 errori, `scripts/test.sh` 10/10, `auth-http-smoke`+`http-smoke` PASS,
browser E2E **327/327** (+2: il tab Terminal raggiunge il motore reale, e raggiunge LO STESSO
run creato dal pannello Plan), accessibilità 27/27, seeded-defect-proof 19/19 (dopo la
riparazione del colore letterale), MANIFEST 5835/5835. **Verificato anche a mano** contro un
server reale fuori dalla suite di test: `tools/tui-client.mjs` connesso su un vero unix
socket, login con account+TOTP reali, piano reale creato — l'hang che questa fase ha
riparato non si riproduce più.

## ➜ Privacy banner → footer, disclaimer AI, bug Ramo rimandato — `D-0235`

Bug menu "Ramo" **resta aperto**, l'Owner l'ha rimandato dopo che nessuna ipotesi verificabile
via codice l'ha riprodotto. Eseguito invece: banner privacy (01_PRODUCT/12) spostato dalla
Home in una riga permanente nel footer (`#footerPrivacy` — stesso stato verificato dal
server, non testo statico), scritta *"NOESAR EVOLUTION is an AI and can make mistakes."*
sotto il composer Chat. Banco E2E dedicato (6 controlli sul ciclo `LOCAL ONLY VERIFIED` ↔
`REMOTE MODEL ACTIVE`) aggiornato al nuovo selettore e **rieseguito per davvero**: 327/327.
Installato `:phase4-privacy-footer`.

## ➜ Chat UI fix + incidente auto-causato — `D-0234`

2 bug riparati e installati (`:phase4-chat-ui-fixes`): Enter invia il messaggio (era
Ctrl/Cmd+Enter), stacking context esplicito su `.chat-toolbar`/`.chat-grid` per i menu
segnalati "nascosti sotto la chat" (non riprodotto in headless Chrome, fix applicato
comunque perché sicuro e corretto per la classe di sintomo). **Durante il deploy**: la
modifica `D-0233` a `state/ai-workspace.json` era stata scritta da fuori il container e
lasciata di proprietà `root` — al riavvio il container è entrato in crash-loop (`EACCES`).
Riparato con `chown 10001:10001`. **Lezione permanente: `chown` esplicito ogni volta che si
scrive un file di stato da fuori il container, non solo `chmod`.**

## ➜ Chat (progetti/conversazioni, superficie diversa da CodeN Evolution) — `D-0233`

Era un guscio vuoto: tutto costruito (route/orchestratore/streaming/RAG/UI) ma **nessun
provider acceso** — `409` a ogni messaggio. Ora il profilo `local-openai-compatible` è
`enabled`, punta a Phi-4 (`http://172.22.0.4:8420/v1`, IP fisso di `atom-evolution-model`)
ed è il `defaultProviderId`. Verificato con streaming reale su istanza usa-e-getta prima di
toccare il file di stato live. Provider **esterni** (OpenAI/Anthropic/Kimi) restano spenti —
Owner: "un'opzione", non necessaria ora.

## ➜ Le domande all'Owner ancora senza risposta

Nessuna. Le due che comparivano qui sono risposte — vedi `D-0232`. (1) Il percorso host per
l'ombra condivisa con `atomd` era già risolto da `D-0226` (il mount esiste,
`NOESAR_EVOLUTION_SHADOWS` su entrambi i lati) — la domanda era rimasta nell'elenco per
deriva, non perché il lavoro mancasse. (2) L'Owner ha scelto: modello vero, Phi-4.
`atom-evolution-model` ora serve **Phi-4-14B-Instruct Q4_K_M** invece di Qwen2.5-7B —
misurato 90.5% sullo stesso banco `UI-090` di `D-0221` (stesso aggregato di Qwen, profilo di
errore diverso), e verificato anche sul percorso realmente servito
(`workspace-actions.plan()` reale contro `atomd` reale, `provenance` mostra `provider:"atom"`
su tutte le sei superfici che `plan()` invoca).
