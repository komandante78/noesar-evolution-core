# NOESAR Evolution — Session Handoff

> Aggiornato 2026-08-01 (`D-0284`). Stato completo in `PROJECT_STATE.json`, storia in
> `docs/DECISION_LOG.md`, installazioni in `docs/INSTALLATION_LEDGER.md`.
>
> ## ⏭ PRIMA AZIONE ALLA RIAPERTURA (s303 → s304)
>
> **`D-0283` e `D-0284` sono entrambi installati e verificati dal vivo** in questa
> sessione (Owner: "PROCEDI"). Correzione importante trovata leggendo il contratto ATOM
> prima di costruire `D-0284`: le quattro superfici scritte in precedenza
> (`classify`/`confidence`/`evidence`/`expect`) erano sbagliate — le prime tre sono
> firmate su un `Plan` di modifica codice, non su un reperto. Le superfici giuste sono
> `hypothesize`+`evidence` (`CLAUDE.md` già corretto). **Committato e pushato**:
> `NOESAR-EVOLUTION` `ff39fdb`+`fbf168c`, `ATOM-EVOLUTION` `f5227a7` (campo `model`,
> `A-0022`, anch'esso installato dal vivo in `atomd`).
>
> 1. Fase 2 di Debug Evolution: restano quattro ruoli aperti (`security`, `reproducer`,
>    `root-cause`, `patch-review`) — `reproducer`/`patch-review` toccano esecuzione/patch,
>    esplicitamente escluse dal manifesto del modulo, da scoping prima del codice.
> 2. Il quarto filo dell'Owner (Passkey/WebAuthn → `oci/Dockerfile` → Blocco G) riprende
>    ora, nessun altro filo davanti. Primo passo: leggere `auth.mjs`/`auth-crypto.mjs`
>    prima di scrivere codice.
> 3. **Nota di processo, s303**: la ricreazione di `atomd` per `A-0022` ha usato `docker
>    rm` invece di `docker rename` — il container di rollback non esiste più (a
>    differenza di `noesar-evolution`, dove il pattern rename-poi-rm è stato rispettato).
>    Il rollback resta comunque possibile: l'immagine precedente è preservata
>    (`atom-evolution:atomd-pre-a0022-20260801T150733Z`, verificata byte-per-byte) e la
>    configurazione completa è registrata in `docs/DECISION_LOG.md` A-0022 — richiede un
>    `docker run` da zero, non un semplice `docker start`.
> **Cap: ≤150 righe** (`noesar-evolution-budget` §3).
> **Piano di lavoro multi-fase Owner** ("finisci tutto il progetto, massimo 4 pause"):
> A → B → C → pausa 1 → **decisione WebUI** → pausa 2 → E+F → pausa 3 →
> G Owner Bootstrap+pentest → pausa 4 (obbligatoria, non automatizzabile).
> **Blocco A, B, C, D COMPLETI. Blocco E+F: 3/7 debito chiuso (`D-0271`), poi SEI pivot
> Owner** — `D-0273`…`D-0278` — **tutti chiusi**, seguiti da `D-0279`/`D-0280` (auth
> service-token + credenziali modulo NOESAR-provisioned), `D-0281` (rete dedicata + bug
> di riconciliazione tool) e `D-0282` (link sidebar riparato via proxy autenticato). Il
> quarto filo (Passkey/WebAuthn → `oci/Dockerfile` → Blocco G) resta l'unico non ancora
> ripreso.

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

Il tag **vivo** è **`noesar-evolution:phase4-debug-evolution-triage`** (`D-0284`, `FROM
:phase4-module-plug-and-play`) a **20 layer overlay2** (`RootFS.Layers`, non `docker
history`) — ben sotto il limite di 128. Usare questo tag come base del prossimo `FROM`.
**Causa strutturale invariata**: `oci/Dockerfile` canonico non fa boot — Thread 2
dell'Owner sotto, ancora aperto.

## ⛔ LA PROSSIMA AZIONE — nessuna sul lato modulo/triage, riprende il quarto filo

`D-0283` e `D-0284` sono installati, verificati dal vivo, committati e pushati.
**Nessuna azione dell'assistente è pendente su modulo/plug-and-play/triage.** Riprende:
scoping dei quattro ruoli agente restanti (Fase 2), poi il quarto filo Owner
(Passkey/WebAuthn).

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

## ➜ Stato dell'installazione

- **Prodotto vivo**: `noesar-evolution:phase4-debug-evolution-triage` (`D-0284`) ·
  `Up (healthy)` · `192.168.178.100:8100→8088` + `192.168.178.100:8089→8089`. Rollback:
  `noesar-evolution.rollback-module-plug-and-play-20260801T150531Z`
  (`:phase4-module-plug-and-play`).
- **`debug-evolution`**: `Up (healthy)`, invariata da `D-0281`.
- **`atomd`**: ricostruito per `A-0022` (campo `model`), `Up (healthy)`,
  `identity()`/`hypothesize()` invariate dal vivo. **Nota di processo**: la ricreazione
  ha usato `docker rm` invece di `docker rename` — nessun container di rollback esiste
  per questo passo (a differenza di `noesar-evolution`); il rollback resta possibile
  tramite l'immagine preservata `atom-evolution:atomd-pre-a0022-20260801T150733Z` (byte
  verificati) + un `docker run` da zero con la configurazione registrata in
  `ATOM_EVOLUTION/docs/DECISION_LOG.md` A-0022.
- **`D-0283` e `D-0284` sono entrambi nell'immagine viva**, verificati dal vivo.

## ➜ Cosa NON è vero, e non va scoperto per caso

- **`modules-registry.mjs` esiste ancora sul disco, non importato** — scelta deliberata
  (`CLAUDE10.md` regola 12, nessun emendamento richiesto).
- **Le due variabili d'ambiente sopravvivono a un uninstall anche dopo `D-0283`** — per
  scelta: dicono dove sta il modulo, non che sia installato. Dopo un uninstall sono
  inerti, e reinstallare resta un clic senza toccare Docker.
- **Un uninstall non cancella nulla dal disco**: manifest e `state.json` restano, con
  `status:"uninstalled"`.
- **`D-0284` non tocca `evidence(claim)` direttamente** — solo `hypothesize()`, perché
  `Hypothesis.supporting`/`.contrary` portano già l'evidenza di entrambi i lati. La
  superficie `evidence` resta configurata (`NOESAR_EXTERNAL_SURFACES`) ma senza un
  chiamante proprio.
- **Il pulsante Triage esiste, la Fase 2 non è completa**: solo `DETECTED →
  HYPOTHESIZED`, solo due dei sei ruoli dichiarati. `reproducer`/`patch-review` restano
  fuori scope finché non c'è uno scoping esplicito (toccano esecuzione/patch).
- **Lavoro committato E pushato**: `NOESAR-EVOLUTION` `ff39fdb` (feat, D-0283+D-0284)
  + `fbf168c` (pin) su `origin/main`. `ATOM-EVOLUTION` `f5227a7` (A-0022) su
  `origin/main`.
- **Il proxy funziona per QUALSIASI utente NOESAR autenticato con `workspace.read`**, non
  solo Owner — stesso livello di permesso già usato dalla rotta GET del catalogo.

## ➜ Blocker aperti

`B-002` (stale, superseded da `B-011`). `B-011` (low-deferred): rotazione token rimandata
a fine progetto. `oci/Dockerfile`/layer-depth: Thread 2 dell'Owner sotto, ancora aperto,
margine ampio (20/128 layer sul tag corrente). Harness E2E incompleta (sopra), non
tracciata come blocker del prodotto — non blocca il deploy. **Nuovo**: `atomd` non ha
più un container di rollback dedicato dopo `A-0022` (vedi nota di processo sopra) — solo
un'immagine preservata, non tracciato come blocker perché il rollback resta comunque
eseguibile.

## ➜ Le domande all'Owner ancora senza risposta

1. **Scoping dei restanti quattro ruoli agente** (`security`, `reproducer`, `root-cause`,
   `patch-review`) — `reproducer`/`patch-review` toccano esecuzione/patch, esclusi dal
   manifesto del modulo, servirà una decisione esplicita prima del codice.

Nessun'altra domanda aperta: rebuild/deploy di `D-0283`/`D-0284`/`A-0022`, commit e push
di entrambi i repository sono tutti chiusi in questa sessione.
