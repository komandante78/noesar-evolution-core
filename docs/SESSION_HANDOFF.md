# NOESAR EVOLUTION — Session Handoff

> Aggiornato 2026-07-30 (`D-0242`). Stato completo in `PROJECT_STATE.json`, storia in
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

**`D-0244`: ARCH-005 — `local-model-runtime.mjs` non può più autorizzarsi da solo.**
Chiude l'ultimo dei tre item lasciati aperti da `D-0240` (INST-004 → `D-0241`, split `codev`
→ `D-0242`, ARCH-005 → questa fase). Nuovo `adapter-capability.mjs`: `ADAPTER_MANIFESTS`
(oggi solo `{'local-model-runtime': {operations: ['EXECUTE']}}`) + `AdapterGrantOrchestrator`,
che ricalca `plan()`/`approve()` di `workspace-actions.mjs` e conia attraverso lo STESSO
`TokenMinter` — nessun secondo motore, nessuna nuova operazione (EXECUTE esiste già ed è già
"esecuzione di codice arbitrario"). `local-model-runtime.mjs::launch()` — l'unico metodo
dell'adattatore che genera un processo OS reale e gli affida la GPU — ora esige e spende un
token prima di fare qualunque cosa; senza un `minter` agganciato, rifiuta a prescindere
(guasto chiuso, non aperto). Nuove route (`server.mjs`, stessa permission `model.manage` +
CSRF delle route local-model esistenti): `GET /api/v1/adapters`, `POST /api/v1/adapters/
:resource/grants`, `POST /api/v1/adapters/grants/:runId/approve|reject`; `/launch` ora
inoltra `capabilityToken` dal body.

**26 test nuovi, verificati non assunti**: 7 in `local-model-runtime.test.mjs` (rifiuta
senza motore, senza token, con token forgiato — un byte di MAC capovolto —, con token di un
altro minter, non rigioca un token dopo l'uso, rifiuta un'operazione fuori manifest, rifiuta
un adattatore sconosciuto), 12 in `adapter-capability.test.mjs`, 7 in
`adapter-capability-http-adversarial.test.mjs` (route HTTP reali + sessione reale, controllo
negativo che prova che il flusso legittimo request→approve→launch→release funziona ancora e
il token speso non si può rigiocare). Unit **1155/1155** (+26), ESLint 235 file 0 errori,
`scripts/test.sh` 10/10, `auth-http-smoke` PASS. `MANIFEST.sha256` **5841/5841**.

**Deployato in produzione** (`:phase4-arch005-adapter-gate`, `FROM :phase4-codev-peer` —
nessun Rust toccato, nessuna ricompilazione del supervisore, solo `services/
reference-control-plane/` ricopiato): byte immagine provati identici all'albero, stop pulito
(`postgres.stopped clean:true` nel log), backup 12.5 MB, predecessore a rollback,
configurazione riletta dal container sostituito. **Verificato dal vivo**: `Up (healthy)`,
hardening `INST-004` intatto, `/livez`+`/readyz` 200, `GET /api/v1/adapters` 401 contro
`/api/v1/does-not-exist` 404, albero processi conferma ancora i tre peer di `D-0242`,
`migrations":16` (0 rieseguite), `identity-projected: projected:1`.

**Dichiarato, non nascosto**: il container vivo gira con `NOESAR_LOCAL_MODEL_RUNTIME=disabled`
— `launch()` rifiuta al controllo `disabled` prima ancora di arrivare al gate nuovo. Il gate
è reale ed è provato dalla suite di test sopra; su QUESTA installazione non ha ancora nulla
da proteggere perché la funzionalità che protegge è essa stessa spenta. `attach()`/
`complete()`/`configure()` sullo stesso adattatore restano scoperti (dichiarato, non un
secondo motore improvvisato per coprirli); nessuna superficie WebUI chiama ancora le nuove
route (stessa postura di `D-0222` per `/api/v1/research/gate`); gli altri sei adattatori di
`03 §4` non esistono ancora, quindi i loro manifest non sono scritti.

**Prossima azione scelta (istruzione ricevuta in `D-0242`: "vai avanti col resto, obiettivo
finire NOESAR EVOLUTION")**: dei rimanenti criteri della matrice `03 §10` in
`03_ARCHITETTURA.md`, restano `⏳ ARCH-007` (diff dei permessi su un aggiornamento che chiede
più autorità — non costruito) e `⏳ ARCH-008` (isolamento per-capacità: Landlock/seccomp/
cgroups scritti nel token, rischio Alto dichiarato e mai trattato dalla Fase 4). Nessuna
nuova domanda posta all'Owner in questa chiusura — procedere con uno dei due salvo
redirezione.

---

**`D-0242`: ARCH-001 COMPLETO — `codev` è un vero terzo peer OS, deployato in produzione.**
Design: relay byte-transparent (`bin/codev-child.mjs`), zero logica di business — `api`
resta l'unico proprietario del dispatch/auth/orchestrator, si è spostato solo il socket su
cui ascolta (esterno → interno, `/run/codev-peer.sock`). **2 bug reali trovati costruendo**:
(1) il default Docker per il tmpfs `/run` è `0755` root, non `1777` come `/tmp` — `api`
(uid 10001) non poteva creare il socket interno finché non ho aggiunto `mode=1777` al mount
(`INST-004`, restaurato poche ore prima nella stessa sessione, ereditava questo buco senza
saperlo: nessuno scriveva su `/run` prima di `codev`); (2) `server.listening` diventa `true`
PRIMA che il callback col chmod sia girato — un mio test lo dava per buono e leggeva i
permessi troppo presto, corretto sincronizzando sul log della relay stessa. **Verificato dal
vivo, non assunto**: sessione terminale reale autenticata end-to-end attraverso la relay
(login+TOTP+status, payload reale dal motore in esecuzione); `kill -9` su `codev` →
respawn ~1s, api/postgres intatti; `kill -9` su `api` → postgres/codev intatti, una NUOVA
connessione tentata a metà restart si chiude subito senza dati invece di restare appesa;
`docker stop -t 60` → tutti e tre i peer `child.stopped`, 0.122s. **Deployato in produzione**
(`:phase4-codev-peer`): albero processi da `/proc` conferma i tre peer reali
(`postgres`/`codev`/`api`, tutti `ppid=1`), 16 migrazioni non rieseguite, identità reale
intatta, `INST-004` ancora integro. Unit **1129/1129** (+3), ESLint 232 file 0 errori, Rust
**26 binari 0 falliti** (+3). §5a rispettato.

---

**`D-0241`: INST-004 riparato e reinstallato sul vivo — la domanda posta in chiusura `D-0240`
è risposta.** Owner ha scelto INST-004 (più veloce, sicurezza già in produzione) fra le tre
opzioni. Redeploy solo-configurazione (stesso tag `:phase4-supervisor`, nessuna rebuild):
`--read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 512
--memory 8g --cpus 4 --tmpfs /run:rw,nosuid,nodev,noexec --tmpfs /tmp:rw,nosuid,nodev,noexec`
ripristinati. Sequenza consueta: stop pulito (`postgres.stopped clean:true` nel log) →
backup runtime (12.5 MB) → predecessore a rollback → nuovo container con env/mount/rete/porta
**riletti dal container sostituito** + i flag di hardening → verificato dal vivo:
`docker inspect` conferma tutti e sei i campi, `/livez`+`/readyz` 200, `/api/v1/shadow` 401
vs `/does-not-exist` 404, albero processi da `/proc` conferma **ARCH-002/ARCH-003 non
regrediti** (PID 1 = supervisore, api e postgres-child entrambi figli diretti), 16 migrazioni
non rieseguite, identità reale intatta. §5a rispettato (2 container, vecchio rollback
rimosso). Dettaglio completo in `D-0241`, ledger in `docs/INSTALLATION_LEDGER.md`.
**Non investigato**: quando/come il drift sia nato (predata questa sessione, `D-0240` lo ha
solo trovato).

**Prossima azione scelta (non richiesta di nuovo all'Owner — istruzione ricevuta: "vai avanti
col resto, obiettivo finire NOESAR EVOLUTION")**: si procede con la separazione di `codev`
come vero terzo figlio (completa `ARCH-001`, oggi `⚠ parziale`), prima di `ARCH-005` — usa
infrastruttura già costruita questa settimana (`session-protocol.mjs`, socket unix già
raggiunto dall'esterno da `tools/tui-client.mjs`) invece di aprire una superficie nuova.

---

**`D-0240`: ARCH-001 costruito (parziale), ARCH-002/ARCH-003 verificati dal vivo uccidendo
processi reali, non leggendo l'architettura.** `rust/crates/noesar-supervisor`
(`noesar-supervisord`) è ora PID 1 del container — deployato live su
`noesar-evolution:phase4-supervisor`. Spawna `postgres` (`bin/postgres-child.mjs`, nuovo
wrapper sottile che possiede esattamente ciò che `PostgresSupervisor` possedeva già —
initdb/spawn/crash-restart/migrazioni, invariati) e `api` (`server.mjs`, ora
`NOESAR_POSTGRES_PEER_MODE=1`) come **due figli realmente pari**, non più uno annidato
nell'altro. **`codev` resta assente come terzo figlio** — il suo motore gira ancora dentro
`api` (`session-protocol.mjs`); separarlo richiede spostare quel dispatch dietro lo stesso
socket unix che `tools/tui-client.mjs` già parla dall'esterno. `ARCH-001` è registrato
**⚠ parziale**, non fatto — dichiararlo fatto con `codev` ancora dentro `api` sarebbe
esattamente il tipo di prova fabbricata che le regole di questo progetto vietano.

**ARCH-002 e ARCH-003 verificati dal vivo, non assunti**: albero processi da `/proc`
(postgres e api entrambi `ppid=1`, il vero binario postgres figlio del wrapper non di
api); `kill -9` su api → postgres e i suoi worker restano intatti, api rispawnato in ~1s;
`kill -9` sul wrapper postgres → api resta `Up` senza un solo restart, il vero postgres
sopravvive come orfano (reparented a PID 1) — **limite noto e accettato**: il wrapper
rifiuta di rialzarsi finché l'orfano è vivo (`#clearStalePidFile`, sicurezza dati non un
bug); `docker stop -t 60` pulito in 0.157s, `postgres.stopped clean:true`; un solo socket
`LISTEN` (8088) in `/proc/net/tcp`.

**Deployato sul vivo con la sequenza consueta**: stop pulito → backup runtime 75 MB →
predecessore rinominato a rollback → nuovo container con configurazione **riletta** dal
sostituito (non ritrascritta a memoria) → verificato `Up (healthy)`, dati preesistenti
intatti (16 migrazioni non rieseguite, identità reale proiettata). Due container di
progetto rispettati.

**Reperto nuovo, NON riparato in questa fase**: `docker inspect` sul container PRIMA della
sostituzione mostrava `ReadonlyRootfs:false`/`CapDrop:null` — ma `INST-004` è registrato
`✅` con "rootfs read-only · cap-drop ALL · no-new-privileges · tmpfs noexec" in più voci
precedenti di `docs/INSTALLATION_LEDGER.md`. Qualche ricreazione del container fra allora
e oggi (probabilmente durante `s286`) le ha perse senza che nessuno se ne accorgesse. Non
ripristinate qui — mescolare un cambio di postura di sicurezza non verificato con
ARCH-001 avrebbe reso indistinguibili due regressioni diverse se qualcosa si fosse rotto.
**Serve una fase dedicata**: riverificare `INST-004` e, se confermato perso, ripristinarlo
con i valori esatti (dimensione tmpfs, sintassi pids-limit) mai riverificati qui.

**Prossima scelta — POSTA all'Owner in chiusura, RISPOSTA ATTESA all'apertura della
prossima sessione**: `ARCH-005` (progettare il gate di capability per gli adattatori —
riusare il motore di capability già esistente per `workspace-actions`, non improvvisarne
uno nuovo: nessuno dei sette adattatori del documento `03 §4` esiste come modulo nominato,
`grep` conferma zero occorrenze; l'unico che esiste per davvero sotto altro nome è
`local-model-runtime.mjs`, 536 righe, e NON passa ancora dal motore di capability token)
oppure la riparazione `INST-004` (più veloce, riguarda la sicurezza del container GIÀ in
produzione — vedi il finding sopra). La separazione di `codev` come vero terzo figlio
resta una terza opzione aperta, non bloccata dalle altre due. **Prima azione della
prossima sessione: chiedere all'Owner quale delle tre.**

---

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

## ➜ Pannello contestuale ora trascinabile — `D-0239`

Owner: "float non me la fa spostare" — vero, zero logica di drag esisteva. Aggiunto
trascinamento reale (titolo = maniglia, `pointerdown`/`move`/`up`), posizione ricordata
per destinazione. **Difetto reale trovato costruendo**: `inset-block-start`/`top` sono la
stessa proprietà fisica, un ordine di scrittura sbagliato nello style inline annullava la
componente verticale (misurato dal vivo: `top` atterrava a 0) — riparato in 2 punti,
rimisurato corretto, posizione sopravvive al reload. E2E 327/327 rieseguito. Installato
`:phase4-panel-draggable`.

## ➜ Pannello contestuale globale (◫ Panel) disattivato di default — `D-0238`

`#contextPanel` (System trust/Context control/Data controls, uguale su ogni pagina,
distinto dal menu `D-0237`) apriva sempre "attraccato" alla prima visita. Ripiego cambiato
da `'docked'` a `'hidden'` — si attiva solo se cliccato, la memoria per-destinazione già
esistente resta invariata. `browser-e2e.mjs` aggiornato e rieseguito: 327/327.
Installato `:phase4-panel-hidden-default`.

## ➜ Colonna agente CodeN Evolution → menu — `D-0237`

Dopo `D-0236` l'Owner segnalava ancora "un abisso" fra banco e colonna destra: causa reale,
5 pannelli sempre espansi insieme = altezza sommata. Ora è un menu, un pannello alla volta
(`Plan` di default), stesso schema delle schede del banco ma istanza separata (`UI-032`
non toccato). Altezza pagina **3510px → 1968px**. Click reale verificato, E2E 327/327
rieseguito. Installato `:phase4-coden-agent-menu`.

## ➜ Colonna agente CodeN Evolution decluttered — `D-0236`

10 riquadri → 5: sei pannelli a una frase (Hypothesis and evidence/Tool activity/Files read
and written/Commands run/Sub-agents/Residual risk) fusi in un unico "Agent activity" con
sottotitoli. `Tools` (LOCAL·MCP·OPENAPI) **lasciato dov'era** — spostarlo in una 12ª scheda
del banco avrebbe rotto `UI-032` (Alta priorità, 11 schede esatte, testato in
`webui-markup-structure.test.mjs`), verificato PRIMA di scrivere codice. Screenshot reale
prima/dopo (3883px → 3510px), browser E2E 327/327 rieseguito. Installato
`:phase4-coden-agent-declutter`.

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
