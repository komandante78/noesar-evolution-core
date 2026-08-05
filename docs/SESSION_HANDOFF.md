# NOESAR Evolution — Session Handoff

> ## ⏭ STATO CORRENTE — 2026-08-05, fine **Fase 6** (`D-0323`, `428a5e3`). **NON deployata.**
>
> **Programma attivo: CodeN Evolution.** Due file soli, in quest ordine:
> `MASTER_PROJECT/16_CODEN_EVOLUTION_LA_GENERAZIONE_E_L_ACCESSO.md` (§0 = cosa deve fare) e
> `MASTER_PROJECT/17_CODEN_EVOLUTION_PIANO_DI_LAVORO.md` (le 8 fasi). La skill
> `noesar-evolution` è obbligatoria — **il registro degli skill non la conosce sotto questo
> nome**: si legge da `/mnt/cachec/NOESAR_EVOLUTION/.claude/skills/noesar-evolution/SKILL.md`.
> Il contratto a 6 righe si scrive PRIMA di toccare un file.
>
> ### Fatto — **fase 6**: se ATOM cade, il prodotto continua E LO DICE
>
> La regola nell intestazione del router era letta corta: diceva *«non deve mai ripiegare **in
> silenzio**»* e il codice applicava *«non deve mai ripiegare»*. La parola che porta il peso è
> **in silenzio**.
>
> ```text
> PRIMA   (atomd usa-e-getta FERMATO DAVVERO, stato container `exited`, non uno stub)
>         expect() THREW ReasoningUnavailable · plan() THREW ReasoningUnavailable
>         router.degradations() — il metodo non esisteva: nulla registrava un ripiego
>         => nessun compito poteva essere portato a termine
> DOPO    (stesso demone, sempre `exited`)
>         plan() PENDING_APPROVAL 11,1 s · degraded=true provider=reference · 3 eventi
>         authoring authored=2 refused=0 degradations=2 · approve() promoted=true
>         src/login.js 87684a5ec052f695 -> 82d8a5ac2a625a3b   (i byte su disco SI SONO MOSSI)
>         Prova di Sessione: degraded=true, **entrambe** le sorgenti nominate, sempre 10 campi
> ```
>
> **La decisione di ripiego vive in un posto solo per metà**: `ReasoningRouter#degrade` e
> `declaredFallbackGenerator`. Le porte **rifiutano invece di scegliere**, per costruzione
> (`D-0322`), quindi la scelta sta dove può essere dichiarata: il punto di assemblaggio.
>
> **Due cose NON degradano, di proposito.** Un **rifiuto** (ATOM ha risposto; chiedere a un
> provider più debole finché uno dice sì è come un rifiuto diventa un consiglio) — e un
> **passo già cominciato con ATOM**, che si ferma con un **checkpoint riprendibile** invece di
> cucire metà ragionamento di una qualità e metà di un altra. `NOESAR_ATOM_FALLBACK=off`
> riporta il comportamento pre-fase-6, **dichiarato**, non nascosto.
>
> **Due difetti trovati ESEGUENDO, riparati nella fase:**
> 1. `Author.author()` chiamava il generatore **fuori** dal proprio `try`: un `AuthoringRefused`
>    sollevato dalla **porta** (ciò che `atomAuthoringGenerator` fa su `NOT_A_FILE` dalla 5b)
>    sfuggiva e **buttava via ogni file già scritto** nella run — contro una regola scritta in un
>    commento venti righe più sotto.
> 2. `server.mjs` **non costruiva nessun Author**: il prodotto installato poteva pianificare e
>    non scrivere mai un byte.
>
> **Scope dichiarato:** `17` nomina 4 file, la fase ne ha toccati 7. `tools/coden-view-model.mjs`
> **non esiste** — il view model condiviso è `apps/webui-static/coden-view-model.js`, e `17` è
> stato corretto.
>
> **Verifiche in sessione:** unit **1807/1808** (0 fail, 1 skip preesistente), ESLint **332
> file 0/0/0**, e2e browser **257/266** (i 9 identici alla baseline s323), `CE-020` e `CE-021`
> 0 fail, **18 mutazioni → 18 uccise** da baseline verificata verde prima — 3 sopravvissute al
> primo giro, ognuna nominava un buco vero di copertura, chiuse e non argomentate via.
> Secret scan: **3 reperti preesistenti** (commit del 30/07 e 02/08), **nessuno** in un file
> toccato da questa fase. L atomd usa-e-getta è stato rimosso nella fase; **l atomd vivo non è
> mai stato fermato** (up da 3 giorni, healthy). **Niente deployato.**
>
> ### Prossima — **fase 7**: il profilo di divergenza collegato
>
> **Prima misura:** `divergence-profile.mjs` **non è importato da nessun file** (costruito in
> s320, mai cablato). Vincolo che un test già impone: sulla WebUI va reso come i **quattro
> segnali col loro `level`**, **mai** come un numero. `buildAuthoringPrompt` accetta già
> `profile` e lo formatta `- segnale: livello`: la metà Autore è cablaggio, non disegno.
>
> ### ⏸️ Aperto, non è codice
>
> `atom-evolution:atomd-a0025-authoring` (binario `baef9d51…`) è **costruito e provato ma NON
> deployato**: il demone vivo resta su `atomd-a0024-sigterm`, e rimpiazzare ciò che sta
> servendo è una decisione dell Owner. `D-0312` chiede anche la **frequenza** delle cadute di
> ATOM: la fase 6 la registra per run ma non la aggrega (proposta in `D-0323`, non eseguita).

## 🛑 REGOLA ZERO — un solo progetto esiste

Lavorando qui si nomina e si tocca **solo** NOESAR EVOLUTION. Mai altro dell'host.
L'autorità operativa è `CLAUDE10.md` e vale **solo** qui.

## ⚠️ CINQUE REGOLE PERMANENTI (Owner, verbatim)

1. **"Fai sempre riferimento agli ultimi documenti che trovi in noesar_evolution."**
2. **`ATOM_EVOLUTION` non copia MAI nulla dal vecchio.** Vedi `D-0212`.
3. **LEGGE DI PIATTAFORMA (`CLAUDE10.md` §16, `D-0247`)**: self-hosted, mai una modifica
   all'host come rimedio.
4. **DOVERE DI AVANZAMENTO (`CLAUDE10.md` §17, `D-0247`)**: ogni fase produce una proposta
   di miglioramento — `D-0275` è la prova che viene eseguita, non solo registrata.
5. **`EXECUTE`, la custodia di chiavi di firma, la forma di un modulo, l'attivazione ad
   alto rischio e la registrazione/revoca publisher sono tutte decisioni del CLIENTE**
   (`D-0250`, `D-0271`-`D-0275`): mai prese da sole.

## ⛔ IMPORTANTE PER QUALSIASI BUILD FUTURO — layer depth del base image

Il tag **vivo** di NOESAR EVOLUTION è invariato da `D-0286`:
**`noesar-evolution:phase4-debug-evolution-remote-targets`**
(`FROM :phase4-debug-evolution-security-root-cause`, +`openssh-client`) a
**24 layer overlay2** (`RootFS.Layers`, non `docker history`) — ben sotto il limite di
128. `D-0287` non ha toccato nessun file NOESAR EVOLUTION, solo Debug Evolution. Debug
Evolution vivo è ora **`debug-evolution:1.1.0-toolpack-wiring`** (`D-0287`, `FROM` lo
stesso `Dockerfile` di sempre — non un `FROM` a strati come NOESAR EVOLUTION, questo
prodotto ricostruisce l'intero `Dockerfile` a ogni release — ora **2,58 GB**, misurato,
da 119 MB: `golang-go`+`default-jre-headless`+Node/npm+l'albero di dipendenze di
`checkov`, il costo reale di 20 analizzatori veri). **Causa strutturale invariata**:
`oci/Dockerfile` canonico di NOESAR EVOLUTION non fa boot — Thread 2 dell'Owner sotto,
ancora aperto.

## ⛔ LA PROSSIMA AZIONE — Fase 4 di Debug Evolution (memoria a cubi), poi il quarto filo

`D-0283`…`D-0287` sono tutti installati, verificati dal vivo. **Nessuna azione
dell'assistente è pendente su modulo/plug-and-play/triage/Fase 2/Fase 3/cablaggio
toolpack.** Il piano in 5 fasi di Debug Evolution è chiuso fino alla Fase 3 — resta solo
la **Fase 4** (memoria a cubi + vettori nel DB del modulo), da scoping esplicito
(embedder da decidere) prima del codice, per istruzione dell'Owner di finire Debug
Evolution prima di altro. `D-0287` (20 analizzatori statici reali) **non è parte del
piano in 5 fasi** — è stato costruito rispondendo a una domanda diretta dell'Owner su
quanti tool Debug Evolution usasse davvero, non su richiesta di avanzare una fase.
`reproducer`/`patch-review` e i 16 tool `executes_project_code:true`/dynamic/fuzzing
lasciati fuori da `D-0287` restano dichiaratamente fuori scope (serve `EXECUTE` acceso,
l'Owner ha rifiutato due volte di farlo come effetto collaterale) — non c'è altra azione
pendente su quei ruoli/tool finché non si riapre il filo apposta.

## ➜ `D-0283` (questa sessione) — cosa è stato fatto

Owner (s302): "disinstallare debug evolution deve lasciare noesar intatto". Non era vero.
`NOESAR_DEBUG_EVOLUTION_URL`/`_TOKEN` sono variabili d'ambiente del container di NOESAR, e
tre superfici le leggevano direttamente: i 3 tool Agents/Workflows riseminati **con
credenziale valida a ogni boot**, il proxy console sulla 8089 aperto, e il service token
del modulo sempre valido — tutto indipendente dall'installazione. E `uninstall` non
esisteva affatto (il commento di `deactivateSectorModule()` lo dichiarava fuori scope).

Regola introdotta, in un solo posto (`module-wiring.mjs`, nuovo): **l'ambiente dice DOVE
sta il modulo, `sector-modules/<id>/state.json` dice SE NOESAR ci parla**.
`reconcileModuleWiring()` in `server.mjs` è ora l'unica chiamata che ogni transizione di
ciclo di vita fa (install, activate, deactivate, uninstall e boot) e muove le tre superfici
in **entrambe** le direzioni. Aggiunti `uninstallSectorModule()`, la rotta
`POST /api/v1/sector-modules/catalog/:id/uninstall` (owner + CSRF, niente step-up: togliere
un modulo è una de-escalation) e il pulsante Uninstall sulla card, dietro conferma.

Due correzioni obbligate dal fatto che il manifest **resta su disco** (regola 12, ed è la
prova d'audit di cosa è stato fidato qui): `activate` rifiuta un modulo `uninstalled`, e
`install` sopra un `uninstalled` è permesso e **porta avanti la history**. I tool sono
disabilitati e svuotati della credenziale, non cancellati: un agente o uno step di workflow
può referenziarne uno, e `disabled` è già rifiutato da `tool-executor.mjs` e
`workflow-service.mjs`.

## ➜ Verificato in `D-0283`

| Verifica | Risultato |
|---|---|
| `npm test` (suite completa) | **1434/1435 PASS** (1 skip pre-esistente, 0 fail, +18 nuovi) |
| `tools/run-eslint.sh` | **283 file · 0 errori · 0 warning** |
| `npm run test:accessibility` | **27/27** |
| `tools/run-browser-e2e.sh` | **209/217** — 8 fallimenti **pre-esistenti**, misurati identici su un worktree pulito di `HEAD` prima di attribuirli |
| unit `module-wiring` | 7/7 (AgentService/AtomicJsonStore/CredentialVault reali) |
| end-to-end uninstall | 6/6: ambiente configurato + niente installato → 0 tool, niente proxy, bridge `409`; install+activate → 3 tool armati, proxy in ascolto, service token che autentica su HTTP reale; uninstall → tutto disarmato, token che non autentica più, catalogo `not-installed`; re-install → stessi id, nessun duplicato, history cumulativa |
| unit `uninstallSectorModule` | 5/5 (incluso il rifiuto senza capability token) |

## ➜ Installato e verificato dal vivo (Owner: "PROCEDI")

`oci/Dockerfile.phase4-module-plug-and-play` (`FROM :phase4-module-console-proxy`, 18
layer). Sequenza: `docker stop -t 60` → `postgres.stopped clean:true` in log, exit 0 →
backup completo a servizio fermo (`BACKUPS/runtime_pre_module_plug_and_play_deploy_
20260801T133906Z.tar.gz`, 13 MB, `schemaVersion:3`) → §5a (rollback più vecchio
rimosso, container soltanto) → ricreato.

**Difetto reale trovato e riparato nello stesso deploy**: la prima ricreazione ha
copiato mount/env/rete/porte/restart-policy ma NON l'hardening di sicurezza del
container (`--read-only`, `--tmpfs /run`+`/tmp mode=1777`, `--cap-drop ALL`,
`--security-opt no-new-privileges:true`, `--ipc private`, `--shm-size`) —
`api` è entrato in crash-loop su `EACCES: listen /run/codev-peer.sock` perché `/run`
è finito sull'overlay invece che sul tmpfs `mode=1777` che il container originale
aveva sempre. **Non è un difetto del codice `D-0283`** (`session-protocol.mjs`/
`codev-relay` non toccati in questa decisione). Riparato rimuovendo il container rotto
e ricreando dall'`HostConfig` completo letto da `docker inspect` **prima** dello stop
(regola permanente: ispezionare prima di ogni `rm`). Sano al secondo tentativo.

Verificato dal vivo: `module-console-proxy.started port:8089` in log (ora condizionato
sul modulo attivo, non più sulla sola variabile d'ambiente); `data-plane.ready
migrations:19 rls_tables:18 production_ready:true` invariato; `/livez` 200, `/readyz`
200; `sector-modules/debug-evolution/state.json` ancora `active`; i 3 tool Debug
Evolution in `state/ai-workspace.json` tutti `disabled:false` con credenziale; il
token di servizio del modulo autentica una richiesta HTTP reale (`200`); `POST
/api/v1/debug-evolution/rescan` senza sessione risponde `401` (non `409`) — conferma
che il gate "modulo attivo" introdotto in questa decisione è vivo e corretto.
`debug-evolution`/`atomd`/`atom-evolution-model`: invariati, tutti sani per tutto il
deploy. Esattamente due container `noesar-evolution*` sopravvivono (§5a).

## ➜ Difetto trovato e NON riparato (fuori scope, dichiarato)

L'immagine E2E (`tools/run-browser-e2e.sh`) copia solo `apps/webui-static/` e
`services/reference-control-plane/src/`: mancano `schemas/` e `capabilities/`, quindi
`GET /api/v1/sector-modules/catalog` risponde `500 industry-module-manifest.schema.json is
missing or malformed` **da quando la rotta esiste** (`D-0277`). Separatamente il Postgres
E2E non ha `noesar_knowledge.memory_records` → `500` su `/api/v1/approvals` e
`/api/v1/memory/recall`. Sono gli 8 fallimenti E2E, tutti dell'harness, nessuno del
prodotto.

## ➜ `D-0284` (questa sessione) — Debug Evolution Fase 2, prima fetta

Il piano in 5 fasi di Debug Evolution (Owner s302) nominava la Fase 2 così: "agenti — un
compito ciascuno, lettura riga per riga; il verdetto vero/falso-positivo NON va
inventato: è ATOM (superfici `classify`/`confidence`/`evidence`/`expect`)". Due cose
sbagliate in quella frase, corrette leggendo il codice reale invece di portarle avanti:

1. **Debug Evolution ha già tutto l'impianto**: stato dei reperti (`DETECTED → … →
   CONFIRMED`, macchina a stati `can_transition()`), ledger di evidenza con 11 tipi
   (incluso `AI_HYPOTHESIS`/`COUNTER_EVIDENCE`), rotte `POST .../evidence` e
   `.../transition` già funzionanti (l'"Evidence Court", `D-0280`), e **sei ruoli agente
   già dichiarati** in `de_v2/app.py` (`AGENTS`: discovery, security, skeptic,
   reproducer, root-cause, patch-review) **mai collegati a nulla**. Zero modifiche al
   `.pyz`.
2. **Le quattro superfici erano sbagliate.** `classify`/`confidence`/`expect` sono
   firmate su un `Plan` di modifica codice (`ATOM_EVOLUTION/contract/noesar-reasoning`),
   non su un reperto — usarle avrebbe significato inventare un "piano" finto solo per
   farci entrare un reperto. Le superfici giuste: `hypothesize(intent,gathered) ->
   Hypothesis[]` e `evidence(claim) -> Evidence`. `Hypothesis` porta già dentro di sé sia
   `supporting` (discovery) sia `contrary` — una ricerca vera di controevidenza
   (`NOT_SOUGHT`/`NONE_FOUND`/`FOUND{evidence}`) — quindi discovery+skeptic sono **una
   sola chiamata**, non due.

Costruito (**prima fetta**: discovery+skeptic soltanto, decisione Owner esplicita —
`reproducer`/`patch-review` toccano esecuzione/patch, escluse dal manifesto del modulo):
`debug-evolution-triage.mjs` (conversione pura), `triageUnclassifiedFindings()` in
`debug-evolution-bridge.mjs`, `POST /api/v1/debug-evolution/triage` (owner+CSRF, stesso
gate `isModuleActive` di D-0283), pulsante **"Triage findings"** sulla card del modulo
(Owner: voluto subito, a differenza di Rescan che resta solo API). Trovato e corretto en
passant: `router.identity()` risponde sempre per il provider di riferimento, mai instrada
— la risposta della rotta usa `provenance()` invece, che dice davvero chi ha risposto.

## ➜ Verificato in `D-0284`

| Verifica | Risultato |
|---|---|
| `npm test` (suite completa) | **1448/1449 PASS** (1 skip pre-esistente, 0 fail, +14 nuovi) |
| `tools/run-eslint.sh` | **286 file · 0 errori · 0 warning** |
| unit conversione | 10/10: intent esclude remediation/esecuzione, evidenza mai vuota, `SUPPORTED`/`UNSUPPORTED_INFERENCE`→riga con testo reale, nessun tipo ATOM è mai `PRIMARY`, `NOT_SOUGHT`/`NONE_FOUND` non generano riga contraria |
| HTTP end-to-end | 4/4, contro uno stub ATOM che risponde la vera forma del wire (`wire.rs`) e uno stub Debug Evolution **con stato reale**: solo il reperto `DETECTED` viene visitato, 2 righe di evidenza reali arrivano con il testo dello stub intatto, transizione con `actor:'atom'`, `provenance` conferma che ha risposto ATOM (non il reference provider); una seconda esecuzione non ritriagia nulla perché lo stato è davvero cambiato |

## ➜ Installato e verificato dal vivo (Owner: "PROCEDI")

`oci/Dockerfile.phase4-debug-evolution-triage` (`FROM :phase4-module-plug-and-play`, 20
layer). Stessa sequenza di `D-0283`: `docker stop -t 60` → `postgres.stopped clean:true`,
exit 0 → backup (`BACKUPS/runtime_pre_debug_evolution_triage_deploy_
20260801T150531Z.tar.gz`, 13 MB, `schemaVersion:3`) → §5a → ricreato **con l'`HostConfig`
completo letto prima dello stop** (la lezione di `D-0283` applicata subito dopo averla
imparata) — sano al primo tentativo, nessun imprevisto.

Verificato dal vivo, non solo in test: `identity()` di `atomd` interrogata da dentro
`noesar-evolution` — invariata, nessun campo `model` nella risposta (nessun `ATOM_MODEL`
configurato in nessun container, quindi il filo resta identico); una vera chiamata
`hypothesize()` dal vivo risponde correttamente; `POST /api/v1/debug-evolution/triage`
senza sessione risponde `401` (rotta viva e raggiungibile); `sector-modules/
debug-evolution/state.json` ancora `active`; il token di servizio del modulo autentica
ancora. **Non verificato dal vivo**: il flusso Triage con una sessione Owner reale —
nessuna password/TOTP disponibile in questa sessione, stessa cautela di `D-0279`/
`D-0282`/`D-0283`.

## ➜ `D-0285` (questa sessione) — Debug Evolution Fase 2, seconda fetta

Confermato dall'Owner: `security`+`root-cause` ora (stesso schema, pura ragione), `reproducer`/
`patch-review` restano fuori scope — richiedono esecuzione vera di codice, e `EXECUTE`
(sandbox già costruito, `D-0249`/`D-0250`/`D-0253`, spento per scelta di progetto) non va
acceso come effetto collaterale di questa funzione.

**Terza correzione**, trovata prima di scrivere codice: la prima proposta per `security`
diceva "produce evidenza `SEMANTIC_REACHABILITY`". Sbagliato — in `de_v2/core.py` quel tipo
sta con `STATIC_ANALYZER`/`DETERMINISTIC_REPRODUCER`/`RUNTIME_DETECTOR`/`FORMAL_PROOF`,
evidenza verificata da strumento o esecuzione, non un'opinione di modello. Etichettare così
una risposta ATOM avrebbe dichiarato un rigore mai eseguito — lo stesso errore di
`classify`/`confidence`/`expect`. `security` e `root-cause` aggiungono quindi righe
`AI_HYPOTHESIS` come `discovery`, e **nessuno dei due tenta una transizione oltre
`HYPOTHESIZED`** — `REACHABILITY_CHECKED` resta lavoro per uno strumento vero o un umano.

Costruito: `findingAsSecurityIntent()` + `findingAsRootCauseIntent()` in
`debug-evolution-triage.mjs`, esportate insieme a `findingAsDiscoveryIntent()` (rinominata)
come `TRIAGE_ROLE_INTENTS`. `triageFinding()` ora chiama `hypothesize()` **tre volte per
reperto** (non sei — la chiamata discovery copre già skeptic via `Hypothesis.contrary`),
somma tutta l'evidenza con un tag `role` in `metadata` per tracciabilità, poi un solo
tentativo di transizione con motivazione che cita tutti e tre i ruoli. Stesso pulsante
Triage, stessa rotta — evidenza più ricca per clic, non una superficie nuova.

## ➜ Verificato in `D-0285`

| Verifica | Risultato |
|---|---|
| `npm test` (suite completa) | **1452/1453 PASS** (1 skip pre-esistente, 0 fail, +4 netti su `D-0284`) |
| `tools/run-eslint.sh` | **286 file · 0 errori · 0 warning** |
| unit | 4 nuovi test (forma intent security/root-cause, `TRIAGE_ROLE_INTENTS`, evidenza security resta `AI_HYPOTHESIS` mai `SEMANTIC_REACHABILITY`) + i test esistenti estesi per il tag `role` |
| HTTP end-to-end | lo stub ATOM ora risponde diversamente per ciascuno dei 3 `intent.goal`; confermate esattamente 3 chiamate `hypothesize()` (non 6), 4 righe di evidenza con i tag di ruolo giusti, una transizione con la motivazione di tutti e tre i ruoli, `provenance()` conferma ATOM su tutte e tre |

## ➜ Installato e verificato dal vivo (Owner: "procedi pure")

`oci/Dockerfile.phase4-debug-evolution-security-root-cause` (`FROM
:phase4-debug-evolution-triage`, 21 layer). Stessa sequenza degli altri due deploy di
questa sessione: `docker stop -t 60` → `postgres.stopped clean:true`, exit 0 → backup
(`BACKUPS/runtime_pre_debug_evolution_security_root_cause_deploy_20260801T154006Z.tar.gz`,
13 MB, `schemaVersion:3`) → §5a → ricreato con l'`HostConfig` completo letto prima dello
stop — sano al primo tentativo, nessun imprevisto (terzo deploy di fila senza sorprese).

Verificato dal vivo: `POST /api/v1/debug-evolution/triage` senza sessione risponde `401`;
una vera chiamata `hypothesize()` con l'intent `security` (reachability da trust boundary)
inviata da dentro `noesar-evolution` verso `atomd` risponde correttamente sul filo reale.
**Non verificato dal vivo**: il flusso Triage completo con una sessione Owner reale —
stessa cautela di `D-0279`/`D-0282`/`D-0283`/`D-0284`.

## ➜ `D-0286` (questa sessione) — Debug Evolution Fase 3, bersagli remoti via SSH

Confermato dall'Owner via `AskUserQuestion` prima di scrivere codice: binario di sistema
`openssh-client` (non una libreria SSH JS), copie scaricate persistenti — sovrascritte al
refetch, mai cancellate dopo la scansione, stesso trattamento dei progetti locali di oggi
— autenticazione solo a chiave privata (niente password), verifica dell'host tramite
impronta pinnata dall'Owner (non TOFU). La credenziale non tocca mai Debug Evolution: NOESAR
gira `ssh-keyscan` alla registrazione (pinna la chiave pubblica intera, non solo
l'impronta — `scp`/`ssh` verificano la chiave vera, non un suo hash, quindi pinnare solo
l'impronta sarebbe stato teatro di sicurezza), gira `scp` al fetch (verificato contro quella
chiave, `StrictHostKeyChecking` mai allentato), poi carica il risultato sulla nuova rotta di
Debug Evolution `POST /api/v2/projects/import` — la stessa postura "un'autenticazione sola,
ed è di NOESAR" di `D-0280`, estesa a SSH.

**Difetto vero trovato fermando il container per il deploy, non inventato**: `docker stop -t
30 debug-evolution` è tornato `ExitCode 137` (SIGKILL) invece di un'uscita pulita. Causa
radice: `appliance/run.py` girava il processo server con `subprocess.call()`, che non
inoltra segnali al figlio — `SIGTERM` uccideva subito il wrapper PID-1 (Python non installa
un handler di default), lasciando il vero server orfano finché il timeout di Docker non
arrivava a `SIGKILL`. Il percorso di spegnimento pulito del server stesso (`de_v2/cli.py`,
`finally: srv.shutdown(); ...; app.store.db.close()`) non è mai stato raggiunto — non perché
sbagliato, ma perché niente lo invocava mai. `PRAGMA integrity_check` ha confermato `ok`
(17 progetti, 84 reperti) sia prima che dopo, quindi SQLite non si è corrotto — proprietà di
SQLite, non motivo per lasciare quel percorso di spegnimento com'era. Corretto traducendo
`SIGTERM` nel path che il figlio già gestisce correttamente (`except KeyboardInterrupt`,
cioè `SIGINT`) — non un inoltro letterale, perché il figlio non ha comunque un handler per
`SIGTERM`. Verificato dal vivo su container usa-e-getta: `docker stop -t 10` prima
30s+`137`, dopo `0.145s`+`ExitCode 0`.

Costruito: `remote-target-registry.mjs` (stati `awaiting-key`→`active`, mirror di
`provider-gateway.mjs`), `remote-target-fetch.mjs` (`keyscanHost()`/`fetchRemoteTarget()`,
spawn via argv mai stringa shell, chiave e `known_hosts` scritti solo in una `mkdtemp` con
`finally` incondizionato di pulizia — stessa convenzione di `sandbox-runner.mjs`),
`AI_STATE_VERSION` 3→4 (`remoteTargets`, migrazione puramente additiva, stessa forma di
1→2), rotte `GET/POST /api/v1/debug-evolution/remote-targets` + `/:id/activate` +
`/:id/rotate-key` + `/:id/fetch-and-scan` + `DELETE /:id`, pannello "Remote targets" nella
Settings UI. Sul lato Debug Evolution: `Application.import_remote()` + `POST
/api/v2/projects/import`, con `tarfile.extractall(dest, filter='data')` (PEP 706, stdlib da
Python 3.12) contro path-traversal/device-node/setuid — scelto invece di un controllo di
contenimento scritto a mano perché è la difesa nativa già vagliata da CPython stesso.

## ➜ Verificato in `D-0286`

| Verifica | Risultato |
|---|---|
| `npm test` (suite completa) | **1477/1478 PASS** (1 skip pre-esistente, 0 fail, +25 netti su `D-0285`) |
| `tools/run-eslint.sh` | **291 file · 0 errori · 0 warning** |
| unit | 11 test `remote-target-registry.test.mjs` (validazione, round-trip activate/rotate/resolve, 409 su ri-activate, 404 su id ignoto, storico `recordFetch`, `remove()`) |
| SSH reale | 5 test `remote-target-fetch.test.mjs` contro un **vero `sshd` locale** (non mock): `keyscanHost()` con impronta reale verificata, `fetchRemoteTarget()` con fetch reale annidato, rifiuto `HOST_KEY_MISMATCH` su chiave pinnata manomessa, rifiuto `AUTH_FAILED` su chiave non autorizzata |
| HTTP end-to-end | 7 test `remote-target-http.test.mjs`: `sshd` reale + stub import di Debug Evolution (cattura i byte tar reali caricati) + `server.mjs` reale — registra→lista→activate→fetch-and-scan→409 se modulo inattivo→delete |
| migrazione stato | `ai-state-migration.test.mjs` riscritto: versione 3→4, nuovo test "un stato v3 guadagna `remoteTargets` e nient'altro cambia" |
| Debug Evolution, dal vivo, prima del packaging | tarball valido → `201` + progetto reale registrato; tarball corrotto con `../../etc/evil_payload` → `400` `refused a tar member: ... outside the destination`, nulla è uscito dalla destinazione (confermato con `find` sull'intero host); slug non valido → `400`; refetch dello stesso slug → file vecchi spariti, nuovi presenti (sovrascrittura reale) |

## ➜ Installato e verificato dal vivo (Owner: "procedi pure")

`oci/Dockerfile.phase4-debug-evolution-remote-targets` (`FROM
:phase4-debug-evolution-security-root-cause`, 24 layer, aggiunge `openssh-client` via
`apt-get`). Debug Evolution: `.pyz` ripacchettato (`zipapp.create_archive`, filtro
`__pycache__`), backup `debug-evolution.pyz.bak_pre_remote_targets_<ts>`, `SHA256SUMS`
aggiornato e verificato 31/31 (incluso il fix di `run.py`, backup non salvato come
`.bak_pre_*` separato prima della modifica — unica lacuna minore rispetto alla convenzione
del progetto per questo file specifico).

Sequenza deploy `debug-evolution`: `docker stop -t 30` (`137` scoperto e poi risolto, sopra)
→ `SHA256` verificato → §5a → ricreato con l'`HostConfig` completo → sano. Sequenza deploy
`noesar-evolution`: `docker stop -t 60` → `postgres.stopped clean:true`, exit 0 → backup
(`BACKUPS/runtime_pre_debug_evolution_remote_targets_deploy_20260801T163154Z.tar.gz`, 13 MB,
`schemaVersion:4`) → §5a → ricreato con l'`HostConfig` completo — sano al primo tentativo,
quarto deploy di fila senza imprevisti (a parte il difetto di `run.py`, trovato *misurando*
l'esito di `docker stop`, non assumendolo).

Verificato dal vivo: entrambi i container `Up (healthy)` sui tag nuovi; `docker stop -t 10
debug-evolution` ora `0.145s`+`ExitCode 0` (era `30s`+`137`); `PRAGMA integrity_check` `ok`
prima e dopo, 17 progetti/84 reperti intatti. **Non verificato dal vivo**: il flusso
Registrazione→Activate→Fetch&scan completo con una sessione Owner reale e un host SSH vero
fuori dal laboratorio di test — stessa cautela di `D-0279`/`D-0282`/`D-0283`/`D-0284`/
`D-0285`.

## ➜ `D-0287` (questa sessione) — 20 analizzatori statici reali, non parte del piano in 5 fasi

L'Owner ha chiesto, senza mezzi termini: quanti tool usa davvero Debug Evolution per fare
controlli, e a che livello siamo — un modulo mediocre, ottimo, professionale? La risposta
onesta, misurata prima di rispondere: **zero tool esterni**. Tutti gli 84 reperti nel
database vivo venivano da `program-genome`, cinque regex scritte a mano in `core.py`. Gli
otto toolpack sotto `appliance/toolpacks/*.pyz` esistevano già — con un `ToolRunner` vero
(sandboxing offline di default, `GOPROXY=off`/`PIP_NO_INDEX=1` a meno di autorizzazione
esplicita), parser SARIF/JSON per ogni strumento, un CLI `run <tool_id>` funzionante — ma
`discover_toolpacks()` (`de_v2/app.py`) li invocava solo con `doctor` per il cruscotto,
mai per una scansione vera.

Cablati 20 dei 29 tool catalogati: quelli **offline** (nessun `network_required`) e che
**non eseguono codice del progetto** (`executes_project_code:false`) — 11 da
`static-quality.pyz` (`ruff`, `mypy`, `pyright`, `typescript`, `shellcheck`, `hadolint`,
`semgrep-ce`, `clang-tidy`, `cppcheck`, `checkstyle`, `luacheck`), 9 da
`security-supply-chain.pyz` (`bandit`, `gosec`, `semgrep-security`, `detect-secrets`,
`gitleaks`, `trufflehog`, `checkov`, `tfsec`, `kube-linter`). Confermato dall'Owner via
`AskUserQuestion`, due volte: gli 8 tool che controllano dipendenze contro database di
vulnerabilità live (`pip-audit`, `cargo-audit`, `cargo-deny`, `govulncheck`, `npm-audit`,
`osv-scanner`, `trivy-fs`, `grype-dir`) restano fuori — il `ToolRunner` di
`security-supply-chain.pyz` li blocca già da solo (`BLOCKED_REQUIRES_NETWORK_
AUTHORIZATION`) come seconda barriera; i restanti 8 tool `executes_project_code:true`
(`eslint`, `pylint`, `cargo-clippy`, `staticcheck`, `go-vet`, `rubocop`, `phpstan`,
`stylelint`) più `dynamic-analysis.pyz`/`fuzzing-symbolic.pyz` interi restano fuori scope,
serve `EXECUTE` acceso — l'Owner l'ha rifiutato di nuovo, seconda volta questa sessione.

I reperti dei tool arrivano nell'Evidence Court come evidenza `STATIC_ANALYZER`
(`core.py::make_tool_finding()`, nuova) con un solo tentativo di transizione `DETECTED →
HYPOTHESIZED` — mai oltre: `can_transition()` rifiuta già `CONFIRMED` su sola evidenza
statica, la stessa cautela di `D-0285`. Selezione per profilo: `fast` gira solo i 7 tool
che ciascun registry marca `enabled_by_default`; `normal` aggiunge i tool rilevanti per
linguaggio/manifest presenti nel progetto (derivati dalla stessa lista file già
enumerata dal passaggio per-file, nessuna seconda scansione del filesystem); `deep` gira
tutti e 20, più `trufflehog` (tenuto fuori da `normal` — verificato dal vivo che i suoi
detector sono deliberatamente più conservativi di `gitleaks` su segreti sintetici, non un
difetto).

**Difetto vero trovato in un toolpack mai esercitato prima**: il parser `shellcheck` di
`static-quality.pyz` si aspettava una lista JSON semplice, ma `--format=json1` (il comando
che quel toolpack usa davvero) restituisce `{"comments":[...]}` — ogni reperto shellcheck
veniva scartato in silenzio da quando il toolpack esiste, mai scoperto perché nessuno
l'aveva mai davvero invocato. Riparato in `de_toolpack/parsers.py`, verificato dal vivo:
86 reperti prima della riparazione, 87 dopo — il reperto `SC2086` mancante, presente.

## ➜ Verificato in `D-0287`

| Verifica | Risultato |
|---|---|
| Installazione | tutti e 20 i binari (apt/pip/npm/luarocks/6 binari Go con SHA-256 verificato contro le pubblicazioni ufficiali) verificati singolarmente contro un repository di test multi-linguaggio (Python/Shell/Dockerfile/C/Terraform/Kubernetes/Go/Lua/Java), ciascuno con un reperto reale noto, prima di scrivere codice di cablaggio |
| Scansione `deep` end-to-end | attraverso il vero HTTP API: 20/20 tool tentati, 20/20 completati puliti (0 saltati, 0 in errore, 0 in timeout), reperti reali con evidenza/transizioni corrette — eseguita prima su un harness separato, poi di nuovo contro l'immagine di produzione vera tramite il suo vero entrypoint `run.py` (non aggirato) |
| Regressione `D-0286` | `docker stop -t 10` ancora `0,145s`/`ExitCode 0` sull'immagine nuova — il fix non è regredito |
| Scansione reale contro codice reale | 203 file del vero albero sorgente `reference-control-plane` di NOESAR EVOLUTION, 138 reperti — in gran parte `detect-secrets: Secret Keyword` dentro file `*.test.mjs`, quasi certamente falsi positivi su credenziali fittizie di test: restano a `HYPOTHESIZED`, mai asseriti veri — l'Evidence Court funziona come deve |

## ➜ Installato e verificato dal vivo (Owner: "procedi pure" / cablaggio confermato via `AskUserQuestion`)

Solo `debug-evolution` — nessun file NOESAR EVOLUTION toccato, nessun commit necessario su
quel lato per il codice. Immagine: `debug-evolution:1.1.0-toolpack-wiring`, cresciuta da
119 MB a **2,58 GB** (misurato, non stimato — `golang-go` per `gosec`,
`default-jre-headless` per `checkstyle`, Node/npm per `typescript`, l'albero di
dipendenze di `checkov`: il costo reale di 20 analizzatori veri, non un tool sintetico).
`debug-evolution.pyz` e `static-quality.pyz` backuppati `.bak_pre_*` prima della modifica
(convenzione senza git di Debug Evolution), `SHA256SUMS` aggiornato per `Dockerfile` +
entrambi i `.pyz`, verificato 31/31. Sequenza deploy: `docker stop -t 30` → `0,154s`,
`exit 0` → backup volume (732 MB) → §5a → ricreato con l'`HostConfig` completo (5 bind
mount inclusi i due albero-sorgente in sola lettura, `--ip 172.22.0.2` fissato) — sano al
primo tentativo, `PRAGMA integrity_check` `ok`, 17 progetti/84 reperti preesistenti
intatti.

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-debug-evolution-remote-targets` (`D-0286`,
  invariato in `D-0287`) · `Up (healthy)` · `192.168.178.100:8100→8088` +
  `192.168.178.100:8089→8089`. Rollback:
  `noesar-evolution.rollback-debug-evolution-security-root-cause-20260801T163154Z`
  (`:phase4-debug-evolution-security-root-cause`).
- **`debug-evolution`**: `debug-evolution:1.1.0-toolpack-wiring` (`D-0287`) ·
  `Up (healthy)` · ip fisso `172.22.0.2`. Rollback:
  `debug-evolution.rollback-remote-targets-20260801T172826Z`
  (`:1.1.0-remote-targets`).
- **`atomd`**: invariata da `A-0022`, `Up (healthy)`.
- **`D-0283`…`D-0287` sono tutti nell'immagine viva**, verificati dal
  vivo.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`modules-registry.mjs` esiste ancora sul disco, non importato** — scelta deliberata
  (`CLAUDE10.md` regola 12, nessun emendamento richiesto).
- **Le due variabili d'ambiente sopravvivono a un uninstall anche dopo `D-0283`** — per
  scelta: dicono dove sta il modulo, non che sia installato. Dopo un uninstall sono
  inerti, e reinstallare resta un clic senza toccare Docker.
- **Un uninstall non cancella nulla dal disco**: manifest e `state.json` restano, con
  `status:"uninstalled"`.
- **`D-0284`/`D-0285` non toccano `evidence(claim)` direttamente** — solo
  `hypothesize()`, perché `Hypothesis.supporting`/`.contrary` portano già l'evidenza di
  entrambi i lati. La superficie `evidence` resta configurata
  (`NOESAR_EXTERNAL_SURFACES`) ma senza un chiamante proprio.
- **Il pulsante Triage esiste, la Fase 2 non è completa**: solo `DETECTED →
  HYPOTHESIZED`, quattro dei sei ruoli dichiarati (`D-0285` aggiunge `security`+
  `root-cause` a `discovery`+`skeptic`). `reproducer`/`patch-review` restano
  **dichiaratamente e definitivamente fuori scope** finché `EXECUTE` non viene acceso
  con una decisione a sé — l'Owner l'ha rifiutato come effetto collaterale di questa
  sessione, anche per `D-0286`.
- **`security` non produce `SEMANTIC_REACHABILITY`** — resta `AI_HYPOTHESIS` come ogni
  altro ruolo di questa fetta; quel tipo è riservato a evidenza verificata da strumento
  o esecuzione, non a un'opinione di modello (terza correzione della sessione, stessa
  categoria di `classify`/`confidence`/`expect`).
- **Debug Evolution non vede mai la chiave privata SSH** — resta nel vault di NOESAR,
  scritta solo in una `mkdtemp` `tmpfs`-adiacente con `finally` incondizionato; quello che
  arriva a Debug Evolution è solo il tarball già scaricato, via `POST
  /api/v2/projects/import` con lo stesso token di servizio di `D-0280`.
  **Fase 3 di Debug Evolution è quindi completa** — resta aperta solo la Fase 4 (memoria a
  cubi + vettori, decisione dell'embedder ancora da prendere).
- **`run.py` non aveva un handler di segnale prima di `D-0286`** — non un difetto di questa
  sessione, preesistente da quando l'appliance esiste; trovato perché il deploy misura
  sempre l'esito reale di `docker stop`, mai assunto. **Tenuto anche dopo `D-0287`**
  (verificato di nuovo sull'immagine nuova).
- **Il parser `shellcheck` di `static-quality.pyz` scartava ogni reperto in silenzio prima
  di `D-0287`** — stesso principio: non un difetto introdotto ora, preesistente da quando
  il toolpack esiste, mai scoperto perché mai invocato prima di questa sessione.
- **8 dei 29 tool catalogati restano deliberatamente fuori** (controllano dipendenze
  contro database live) — non un limite tecnico, una scelta dell'Owner confermata via
  `AskUserQuestion`; il `ToolRunner` li blocca comunque di default anche se qualcuno li
  invocasse per errore.
- **`syft-dir` è installabile ma non collegato**: genera un SBOM, non un reperto
  (`parser:"none"`) — categoria diversa, lasciata fuori scope su questa base, non per
  svista.
- **Lavoro committato E pushato, tutto**: `NOESAR-EVOLUTION` `ff39fdb` (feat,
  D-0283+D-0284) + `fbf168c` (pin) + `408fac4` (doc) + `e5159fb` (feat, D-0285) +
  `4d30820` (pin) + `d1c1b73` (feat, D-0286) + `664cca3` (pin) + `86847ca` (doc, D-0287) su
  `origin/main`. `ATOM-EVOLUTION` `f5227a7` (A-0022) su `origin/main` — invariata da
  `D-0286`. `DEBUG_EVOLUTION` non ha repository git (`CLAUDE.md`) — la sua convenzione è
  `.bak_pre_<motivo>_<timestamp>` + `SHA256SUMS`, seguita per `debug-evolution.pyz`,
  `static-quality.pyz` e `Dockerfile` in `D-0287` (backup preso per tutti e tre) e non per
  `run.py` in `D-0286` (modificato senza backup separato, lacuna minore annotata sopra e
  ancora non richiusa).
- **Il proxy funziona per QUALSIASI utente NOESAR autenticato con `workspace.read`**, non
  solo Owner — stesso livello di permesso già usato dalla rotta GET del catalogo.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata
a fine progetto. `oci/Dockerfile`/layer-depth: Thread 2 dell'Owner sotto, ancora aperto,
margine ampio (24/128 layer sul tag corrente — invariato da `D-0287`, che non tocca
NOESAR EVOLUTION). Harness E2E incompleta (sopra), non tracciata come blocker del
prodotto — non blocca il deploy. `atomd` non ha più un container di rollback dedicato
dopo `A-0022` (nota di processo, sezione D-0285 sopra) — solo un'immagine preservata, non
tracciato come blocker perché il rollback resta comunque eseguibile. `run.py` modificato
senza `.bak_pre_*` separato (sopra) — non tracciato come blocker perché `SHA256SUMS`
copre comunque l'integrità del file distribuito. **Nuovo, non un blocker**: l'immagine
`debug-evolution` è cresciuta a 2,58 GB — non blocca nulla di documentato, ma è un fatto
da tenere presente per storage/tempi di build futuri.

## ➜ Le domande all'Owner ancora senza risposta

Nessuna sul lavoro fatto. `D-0283`…`D-0287`, `A-0022`: tutti installati dal vivo,
verificati, committati/pushati dove esiste git (`DEBUG_EVOLUTION` via la sua convenzione
file-based, senza git). `reproducer`/`patch-review` e i tool `executes_project_code:true`/
dinamici/fuzzing lasciati fuori da `D-0287` restano dichiaratamente fuori scope finché non
si apre un filo dedicato su `EXECUTE` — non è una domanda in sospeso, è una decisione già
presa due volte (no, non ora). **Aperta per la prossima sessione**: il piano in 5 fasi di
Debug Evolution è completo fino alla Fase 3 — resta solo la Fase 4 (memoria a cubi +
vettori, decisione dell'embedder) prima che qualsiasi altro filo dell'Owner possa
riprendere, per istruzione esplicita dell'Owner in questa sessione ("non proporre altro se
non finisci debug evolution"). `D-0287` non cambia questo: non era parte del piano in 5
fasi, ma non lo sostituisce neppure — la Fase 4 resta l'unica cosa dichiarata aperta lì.
