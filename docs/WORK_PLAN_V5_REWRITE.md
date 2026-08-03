# Piano di lavoro — la riscrittura come progetto di riferimento

> **Nota (2026-08-03), non riscritto.** Questo piano (Fase 1→7) è stato eseguito quasi per
> intero da `docs/DECISION_LOG.md` `D-0175` in poi — spina dorsale (`ReasoningProvider`,
> capability token, esecuzione in ombra), CodeN Evolution, le due shell, memoria a cubi
> (`CUBE-001…009` tutte chiuse), isolamento (`ARCH-008`), mondo esterno (OIDC/SCIM/Technology
> Radar/moduli di settore). Resta genuinamente aperto solo il Gruppo 6 (pentest indipendente,
> `docs/security/INDEPENDENT_PENTEST_SCOPE.md`) e alcuni criteri della matrice CE-001…024 mai
> ripresi dopo il progetto iniziale (`CE-005`, `CE-010`, `CE-021`) o bloccati per scelta
> dell'Owner (`CE-015`, richiede `EXECUTE`). Questo file resta "provvisorio" nel testo sotto
> perché non è mai stato riportato a "completo" — trattalo come piano storico, non come stato
> corrente.

**Deciso dall'Owner il 2026-07-26.** Da questa data il progetto di riferimento è la
riscrittura in `MASTER_PROJECT/`. La documentazione V4 è rimossa dall'albero di lavoro.

**Lingua.** Questo documento e `MASTER_PROJECT/` sono in italiano su richiesta esplicita
dell'Owner. `CLAUDE10.md` regola 49 impone l'inglese come canonico per gli artefatti: la
traduzione canonica si produce **dopo** l'approvazione dei contenuti, com'è già scritto in
`MASTER_PROJECT/00_LEGGIMI.md`. Tradurre prima significa farlo due volte. Registrato come
deviazione temporanea e dichiarata, non come dimenticanza.

**Stato di questo documento: provvisorio.** L'Owner ha annunciato che porrà domande per
verificare che il progetto coincida con il suo pensiero. Fino ad allora questo è un piano
proposto, non un piano approvato.

---

## Parte 1 — Cosa è stato fatto e gira davvero

Misurato, non ricordato. L'installazione su `192.168.178.100:8100` gira
`noesar-evolution:phase4-wp2`, `healthy`, `RestartCount=0`.

### Costruito, verificato, e che la riscrittura conserva

| Cosa | Evidenza |
|---|---|
| Container OCI singolo, uid 10001, rootfs read-only, `cap-drop ALL`, `no-new-privileges`, tmpfs `noexec`, nessun socket Docker | configurazione live riletta con `docker inspect` |
| **PostgreSQL 18.4 + pgvector 0.8.5** come processo figlio supervisionato, **nessun listener TCP**, `scram-sha-256`, credenziali runtime `0600` | `postgres.ready` nei log, 16 migrazioni, 15 tabelle RLS |
| **Isolamento a livello di riga forzato**, provato contro un avversario nello stesso progetto | fase 4 completion gate |
| Multi-utente a **sei ruoli** con inviti e MFA/TOTP | 29 check dal vivo su quattro account |
| Backup e ripristino con checksum, rifiuto di archivi manomessi | 25/25 byte-identici |
| Arresto pulito e recupero da SIGKILL senza perdita dati | verificato in fase 3 e di nuovo oggi al deploy |
| Contenimento del prompt injection, **zero bypass** | 10 test committati |
| Aggiornamenti firmati Ed25519 con anti-rollback e rollback automatico | update manager |
| WebUI raggiungibile in LAN, `/metrics` autenticato | `livez`/`readyz` 200, `/metrics` 401 |
| **631 test unitari**, ESLint 158 file 0 errori, **233 check in browser reale**, WCAG **26/26**, MANIFEST 5704/5704 | prodotti in sessione |
| Workflows, coda di approvazione, sette stati di privacy | costruiti e **deployati oggi** |

**Questo non si butta.** La riscrittura lo elenca fra il "costruito e verificato" e ne
conferma le scelte, PostgreSQL incluso: *"Non si torna a SQLite. L'isolamento a livello di
riga è ciò che rende applicabili i muri fra le tre semantiche di memoria."*

### Le assenze centrali, misurate

| Manca | Stato reale | Peso |
|---|---|---|
| `ReasoningProvider` | **zero file** | **critico** — è la cucitura di ATOM |
| Capability token | **zero file** | **critico** — unifica dodici componenti in uno |
| Policy Decision Point e la pipeline `AI_PROPOSES→…` | **assenti dal codice** | **critico** |
| Kernel di sicurezza | **37 righe** che controllano stringhe di percorso | **critico** |
| Emergency Stop | **zero file** | critico |
| Esecuzione in ombra | assente | alto — senza, non c'è autocorrezione |
| Isolamento per capacità (Landlock, seccomp per profilo, WASM) | assente | alto |
| Stato di contaminazione, canary, promozione (MEVCM) | assenti — ma `memory_items.provenance` **esiste ed è usato** | alto, **si estende** |
| Model Trust Registry | **schema morto**: `model_descriptors.trust_state` esiste, nessun codice lo legge o scrive | alto — peggio dell'assenza |
| Secret Broker | **parziale** — `credential-vault.mjs`, 9 file lo usano | medio, da consolidare |
| Resource Governor | **parziale** — quota/rlimit in 4 file | medio |
| Verificatore post-esecuzione | assente | medio |
| OIDC / SAML / SCIM | zero file | medio |
| Framework moduli di settore, pacchetti di conformità, Technology Radar | assenti | fase 7 |

---

## Parte 2 — Cosa cambia con la riscrittura

Sette differenze che contano. Il resto — legale, licenze, conformità, confini d'uso — resta
identico, ed è la parte che il V4 aveva fatto meglio.

1. **ATOM da categoria a meccanismo.** Prima: *"un provider di ragionamento proprietario"*.
   Ora: **come funziona** — scompone finché verificare è *ricalcolare*, non *giudicare*.
2. **Dodici componenti di sicurezza diventano uno.** I capability token li assorbono tutti.
   È la differenza più grande per il lavoro: **non si costruiscono dodici sottosistemi**.
3. **La sicurezza diventa strutturale invece che difensiva.** La regola sola: *il motore non
   cambia nulla se non eseguendo un Piano autorizzato*. Il modello **non ha superficie
   d'azione**; l'esecutore **non ha superficie di proposta**.
4. **La memoria guadagna muri applicati dallo schema**, non dalla buona condotta: tre
   semantiche separate, dati di lavoro mai su internet e mai nella semantica del prodotto.
5. **Compare una posizione commerciale**: la **Prova di Sessione** — dimostrare invece di
   affermare. Replay deterministico **al livello delle decisioni**.
6. **CodeN passa da dieci a sedici stadi**, nessuno perso: dieci ne accorpavano di distinti.
   Due shell sulla **stessa sessione viva**, percorso proporzionato al rischio.
7. **Compare una risposta al "domani"**: crescere per **numero** di esperti verificati, non
   per taglia del modello.

E la WebUI: **da 26 destinazioni a 11**.

---

## Parte 3 — Cosa va modificato di ciò che esiste

Non riscritture: innesti e correzioni.

| Intervento | Perché | Rischio |
|---|---|---|
| **Rimuovere `apps/webui-react`** — tre file, nessun componente | schema morto applicato al codice: dice al prossimo che React è lo stack, e non lo è | nullo, non è referenziato |
| **Cablare o rimuovere `model_descriptors.trust_state`** | schema morto: la colonna esiste con i quattro stati giusti e nessuno la usa. Fabbrica evidenza falsa | basso — decisione: si cabla in fase 1 col Model Trust Registry |
| **Consolidare il Secret Broker esistente** (`credential-vault.mjs`) dietro il kernel | esiste già e funziona; va messo dietro i token invece che accanto | medio |
| **Consolidare il Resource Governor esistente** (quota/rlimit) | i tetti scritti nel token devono diventare veri | medio |
| **Estendere `memory_items.provenance`** invece di ricostruire MEVCM | la colonna esiste ed è usata | basso |
| **Emendare il decision log**: `V4-D001` Rust primario, `V4-D002` React canonico | il prodotto e i documenti che lo governano dicono cose diverse e nulla registra quale dei due debba muoversi (`GAP-F`) | nullo, è un atto di governo |
| **Il supervisore diventa PID 1 con tre figli pari** | oggi supervisiona solo il DB | alto — tocca l'avvio dell'installazione viva |
| **La WebUI scende a 11 destinazioni** | oggi ne ha 23, e WP-2 ne ha appena aggiunte due | medio — è WP-3, mai accettata |

**Nessuno di questi tocca PostgreSQL, RLS, multi-utente, backup, aggiornamenti o
accessibilità.** Quella parte è costruita e la riscrittura la conferma.

---

## Parte 4 — Piano di lavoro provvisorio

L'ordine è **per dipendenza, non per importanza**. Da `MASTER_PROJECT/09_PIANO.md`.

### Fase 0 — Governo (nessuna riga di codice, tutto reversibile)

1. Riscrittura importata in `MASTER_PROJECT/` con checksum di provenienza ✅ *fatto*
2. Skill e `CLAUDE10.md` puntano alla riscrittura ✅ *fatto*
3. V4 rimosso dall'albero, recuperabile da git e dagli ZIP sigillati ✅ *fatto*
4. **Domande dell'Owner** — verifica che il progetto coincida col suo pensiero ⏸ *in attesa*
5. Traduzione canonica in inglese, **dopo** l'approvazione dei contenuti ⏸
6. Emendamenti registrati a `V4-D001` / `V4-D002` ✅ *fatto — `D-0169`*. Rust è ora richiesto
   **dove decide e confina**, non ovunque; la WebUI resta JavaScript semplice. `apps/webui-react`
   **non** è stata rimossa: la regola 12 vieta la cancellazione e l'unico precedente passò da un
   emendamento esplicito dell'Owner a `CLAUDE10.md`. Il suo `README` dichiara ora di essere
   superato invece di annunciare un lavoro che non si farà più.

### Fase 0-bis — ATOM separato (fatto 2026-07-26)

ATOM e definito solo in `NOESAR-ATOM-PRIVATE` (`D-0099`). Il crate esiste: 45 file `.rs`,
L0 implementato con 27 test, L1-L8 che rifiutano in modo dichiarato (`D-0100`). La
riscrittura tiene il contratto pubblico e il puntatore.

### Fase 1 — La spina dorsale

> *Esiste un Piano come oggetto, e nulla cambia senza uno.*

1. Il contratto **`ReasoningProvider`**, pubblico e versionato — **la prima riga di codice**
2. Il **provider di riferimento** a L3-L5: `interpret`, `hypothesize`, `plan`, `decompose`,
   `expect`, `constrain`, `classify`, `confidence`, `evidence`, `cancel`, `fixtures`
3. I **capability token** e il motore che li conia da un Piano autorizzato
4. L'**esecuzione in ombra**: copia copy-on-write, test mirati, confronto atteso/reale
5. L'**esecutore che non accetta altro che token**, e la sandbox che li spende
6. Il **registro degli eventi** con correlazione, causazione e digest
7. **Comprensione minima del repository**: linguaggi, punti d'ingresso, indice dei simboli,
   ricerca letterale, mappa delle dipendenze

**Stack, già deciso (D-A):** Rust per ciò che **decide e confina** — supervisore, kernel,
token, audit, sandbox, indicizzazione pesante. JavaScript per ciò che **propone e presenta** —
piano applicativo, provider di riferimento, gateway modelli, WebUI, shell.

**Criterio di "fatto" della fase 1** — e non è "compila":

> Apre un repository vero, ne capisce la struttura, riceve una richiesta, produce un piano,
> ottiene un'autorizzazione, cambia diversi file, mostra il diff, esegue i test, corregge un
> errore, produce un risultato verificabile, ripristina lo stato su richiesta, registra ogni
> operazione — e **non esce mai nemmeno una volta dall'autorità che gli è stata data**, con
> quest'ultima clausola provata da una suite **il cui unico lavoro è provare a farglielo fare**.

Con una clausola in più: **si misura col solo provider di riferimento, senza ATOM.** Se non
passa così, non è finita — è il meccanismo che impedisce ad ATOM di diventare obbligatorio.

### Fasi successive

| Fase | Contenuto |
|---|---|
| **2 — Il workspace** | ciclo a sedici stadi, segnali di secondo livello, editor/diff/terminale/checkpoint/rollback/git, scala di persistenza a otto gradini, rapporto finale con `NON FATTO` obbligatorio |
| **3 — Le due shell e la Prova di Sessione** | protocollo di sessione su socket unix, shell da terminale con forma da tastiera per **ogni** capacità, supervisore a tre figli, Prova di Sessione (a quel punto **assemblaggio, non invenzione**) |
| **4 — Memoria e privacy** | tre semantiche coi muri dello schema, MEVCM completo, broker di egress a sette stati, ricerca su fonti verificate |
| **5 — Isolamento vero** | cgroups per figlio, Landlock, seccomp per profilo, WASM, Resource Governor, Emergency Stop a sei passi |
| **6 — ATOM** | simulazione predittiva, ricerca causale multi-passo, libreria di esperti, sotto-agenti con revisore indipendente |
| **7 — Il mondo esterno** | moduli di settore, pacchetti di conformità, Technology Radar, OIDC/SAML/SCIM, SBOM/ML-BOM/CBOM, build riproducibili, firme |

### Cosa NON costruire — registrato, non dimenticato

Dialoghi di autorizzazione per sottosistema (collassano nei token) · installazione automatica
delle dipendenze · esecuzione cloud e app mobile (**rinviate**, non rifiutate) · telemetria di
default · conferma con un tasto solo · un modello sempre più grande.

---

## Parte 5 — Attriti e rischi dichiarati adesso

1. **Nessun toolchain Rust sull'host**, e la regola 45 vieta di installarlo. I crate esistenti
   sono stati costruiti in container `rust:1-bookworm` effimeri. La fase 1 è Rust dalla prima
   riga: ogni ciclo di build/test paga quell'attrito.
2. **La fase 1 è quattro sottosistemi a zero file**, in un linguaggio dove il prodotto ha
   ~1.100 righe contro ~24.500 di JavaScript. Non è il seguito del lavoro di oggi: è l'inizio
   di un lavoro diverso, che rende il lavoro di oggi il piano applicativo di qualcos'altro.
3. **Il supervisore a tre figli tocca l'avvio dell'installazione viva.** Va fatto blue/green
   con rollback preservato, come il deploy di oggi.
4. **La riscrittura non ha apparato di accettazione.** Zero matrici di accettazione con ID e
   severità, zero tracciabilità, il registro dei rischi appena citato. Il V4 li aveva e adesso
   non sono più nell'albero. **Vanno ricostruiti dentro la riscrittura**, o si perde il modo di
   dire "fatto" in maniera controllabile. Non è un dettaglio: è ciò che ha permesso di scoprire
   che un elenco precedente era sbagliato.
5. **La parte legale, licenze, conformità e confini d'uso** che la riscrittura dichiara di
   conservare **non è più nell'albero**: era nei documenti V4 `50-57`, `60-66`, `70-77`,
   `09_LEGAL_TEMPLATES`. La riscrittura la tiene **per decisione**, non **per contenuto**. La
   fase 7 ne avrà bisogno e andrà recuperata dagli archivi sigillati.
6. **Nessuno dei due progetti ha avuto una revisione indipendente.** Il V4 è stato consegnato
   sigillato da terzi; la riscrittura è stata scritta da me e riletta da me. Il documento 11
   registra 3 errori di analisi e 7 difetti di progetto che ho trovato nel mio stesso lavoro:
   è evidenza di rigore, ed è anche la misura di quanti ne conteneva la prima versione.
