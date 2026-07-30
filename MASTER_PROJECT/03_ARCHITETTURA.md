# 03 · Architettura

## 1. La forma generale

Un solo container OCI. Dentro, un supervisore sottile come PID 1 e **tre figli pari**.

```text
   browser  ─────────┐
   (shell WebUI)     │      ┌──────────────────────────────────────────────┐
                     ├─────▶│  CONTAINER UNICO                             │
   ssh utente@host ──┘      │                                              │
   (shell terminale)        │   PID 1  supervisore                         │
                            │     ├── postgres    (dati, già esistente)    │
                            │     ├── api         (WebUI + protocollo)     │
                            │     └── codev       (motore CodeN Evolution) │
                            └──────────────────────────────────────────────┘
```

**Perché tre pari e non "l'app che fa da padre agli altri":** con un supervisore in cima ogni
componente ha lo stesso contratto di ciclo di vita — avvio, health, politica di riavvio,
flusso di log, segnale di arresto. **Una regola, tre istanze.** Con l'app come padre hai "una
cosa speciale più due figli", cioè due concetti. Meno confusione significa meno concetti, non
meno processi.

**Cosa si guadagna concretamente:** riavvii il motore senza far cadere la WebUI né il
database — se un'indicizzazione impazzisce su un repository enorme, continui a vedere dalla
WebUI cos'è successo, con l'audit che ha registrato tutto. E ogni figlio porta i suoi limiti
di risorse (memoria, CPU, processi), quindi un lavoro pesante non affama il server.

**Cosa non cambia, ed è il guadagno organizzativo vero:**

- **Una sola immagine, una sola versione, un solo aggiornamento.** Non esisterà mai "motore
  1.2 con prodotto 1.1".
- **Il rollback resta quello di oggi**: sostituisci il container, un solo container di
  rollback conservato.
- **Nessun nuovo listener di rete.** Il protocollo di sessione gira su un socket unix dentro
  il container, coerente con quello che PostgreSQL fa già (nessun listener TCP, solo socket
  unix).

**Onestà su cosa costa:** promuovere il supervisore a PID 1 tocca il percorso di avvio e
arresto già verificato — recupero da uccisione brutale del database senza perdita di dati,
arresto pulito con il segnale giusto. Va fatto come passo dichiarato, ripetendo quei test.

## 2. I tre piani

| Piano | Cosa contiene | Linguaggio |
|---|---|---|
| **Controllo** | identità, policy, capability token, audit, aggiornamenti, supervisione, scoperta hardware | autorità |
| **Cognitivo** | provider di ragionamento, gateway modelli, memoria, recupero, agenti, workspace | applicativo |
| **Dati** | PostgreSQL + pgvector, object storage cifrato, archivio eventi | — |

Il piano di controllo è l'unico che decide. Il piano cognitivo **propone**. Il piano dati non
decide niente.

## 3. Il pezzo che oggi manca: il Kernel di Sicurezza

La specifica lo descrive come autorità indipendente **fuori dal modello** con dodici
componenti. Nel prodotto attuale sono 37 righe che controllano stringhe di percorso, e cinque
dei dodici sono zero file.

**La ricostruzione non aggiunge dodici componenti: ne aggiunge uno che li assorbe.**

| Componente specificato | Come si realizza qui |
|---|---|
| Policy Decision Point | **il motore che trasforma un Piano autorizzato in token** |
| Capability Token Broker | **il meccanismo — tutto passa di qui** |
| Path Authorization Broker | token di tipo `write`/`read` su risorse-percorso |
| Network Egress Broker | token di tipo `net` su risorse-host, + lo stato di privacy |
| Secret Broker | token di tipo `secret`, mai il valore, sempre un riferimento |
| Model Trust Registry | token di tipo `model`, emesso solo per modelli con provenienza verificata |
| Update Trust Verifier | token di tipo `update`, con firma e anti-rollback |
| Sandbox Manager | ciò che *spende* i token, e non ha altra autorità |
| Resource Governor | le condizioni scritte dentro il token (memoria, CPU, processi, tempo) |
| Audit Ledger | dove ogni token emesso, speso, negato e revocato viene registrato |
| Identity Guard | chi può chiedere un token |
| Emergency Stop | **revoca tutti i token vivi, ovunque, adesso** |

**Dodici concetti diventano uno.** È la semplificazione più importante di tutto il progetto e
si spiega in una riga: *l'esecutore non può fare nulla senza un token, e i token nascono solo
da un Piano che una persona ha firmato.*

## 4. I contratti congelati

Sono le cuciture versionate. Cambiarle è un evento, non una modifica.

| Contratto | A cosa serve |
|---|---|
| **`ReasoningProvider`** | **il piano** — riferimento pubblico oppure ATOM |
| `ModelRuntimeAdapter` | eseguire modelli: CPU, CUDA, ROCm, Metal, OpenVINO, ONNX, e i prossimi |
| `HardwareProbeAdapter` | scoprire l'hardware in sola lettura |
| `VectorStoreAdapter` | pgvector di default, altri opzionali |
| `ObjectStoreAdapter` | oggetti indirizzati per contenuto, cifrati |
| `IndustryModuleProvider` | moduli di settore |
| `CompliancePackProvider` | pacchetti giurisdizione, firmati e datati |
| `HostBridgeAdapter` | il poco che tocca l'host, sempre mediato |

**Regola comune e non negoziabile: nessun adattatore può auto-concedersi permessi.** Un
manifest è una *richiesta*. I token li emette il motore.

## 5. Gli eventi, e perché sono la base della Prova di Sessione

Ogni evento porta: id, tipo, versione di schema, tempo UTC, attore, tenant, **correlazione**,
**causazione**, risorsa, classificazione, digest del payload.

`causazione` è il campo che fa la differenza fra un log e una ricostruzione: dice **quale
evento ha causato questo**. Con quello, la domanda "perché ha fatto quella cosa?" ha una
risposta che si segue all'indietro, invece di richiedere interpretazione.

Insieme alle fixture di replay, questo è ciò che permette di **rieseguire una sessione e
ottenere le stesse decisioni**.

## 6. Lo stack, e le due deviazioni dichiarate

Il registro delle decisioni V4 approva: Rust per i servizi privilegiati, TypeScript/React per
la WebUI, Python solo per worker supervisionati, PostgreSQL come archivio autoritativo.

Il prodotto costruito è, misurato: **24.563 righe di JavaScript**, 1.145 di Rust, e una WebUI
in JavaScript semplice mentre la cartella React contiene tre file e nessun componente.

**Non fingiamo che sia allineato.** Le due strade sono entrambe legittime, ma vanno scelte:

| Opzione | Cosa comporta |
|---|---|
| **A — il codice si muove verso la decisione** | Riscrivere il piano di controllo in Rust. Onesto rispetto alla specifica, costoso, e rischia di rifare da capo cose che oggi funzionano e sono testate. |
| **B — la decisione si muove verso il codice** | Emendare `V4-D001`/`V4-D002`, tenere JavaScript per il piano applicativo e **Rust solo dove l'autorità lo richiede davvero**: supervisore, sandbox, applicazione dei percorsi, token. |

### ✔ Decisa: opzione B, con questo confine

| In **Rust** — ciò che **decide** e ciò che **confina** | In **JavaScript** — ciò che **propone** e **presenta** |
|---|---|
| Supervisore (PID 1) | Piano applicativo: chat, documenti, agenti, flussi |
| Kernel di sicurezza: policy, capability token, audit | Provider di ragionamento di riferimento |
| Applicazione dei percorsi, sandbox, Landlock/seccomp | Gateway modelli, recupero, orchestrazione |
| Verifica di aggiornamenti e firme | WebUI |
| Indicizzazione pesante del repository | Shell da terminale |

**Perché:** la parte che deve reggere quando tutto il resto è compromesso deve essere
**piccola, tipizzata e separata**. Oggi non è nessuna delle tre. Ma non serve riscrivere tutto
per ottenerlo: serve scrivere **il poco che decide** — che è anche il poco che **oggi non
esiste**, quindi nasce in Rust dalla prima riga invece di dover essere portato.

**Due conseguenze operative:**

1. `V4-D001` e `V4-D002` vanno **emendati**, non ignorati. Lasciare registro e codice in
   contraddizione è il modo in cui un progetto smette di sapere cosa ha deciso.
2. `apps/webui-react` — tre file, nessun componente — va **rimossa**. È schema morto applicato
   al codice: sembra una scelta tecnologica in corso, e non lo è. La WebUI resta JavaScript
   semplice, che è costruita e funziona.

## 7. Isolamento: oggi il container è l'unico confine

La specifica chiede processo non privilegiato, namespace, **Landlock**, profili **seccomp**,
cgroups v2, e **WASM** per i moduli portabili. Nel prodotto attuale: Landlock zero, seccomp
solo quello di default di Docker, nessun WASM, nessun governatore di risorse.

Il rischio corrispondente nel registro è dichiarato *Alto* e non è mai stato trattato. Oggi
**tutto ciò che sta dentro il container condivide un solo raggio d'azione**.

La direzione: ogni capacità gira con i suoi limiti, non con quelli del container.

| Livello | Cosa dà |
|---|---|
| Processo non privilegiato + namespace | separazione di base |
| **cgroups v2** | i tetti di risorse scritti nel token diventano veri |
| **Landlock** | il filesystem visibile è *solo* quello del token, applicato dal kernel |
| **seccomp** per profilo | la superficie di chiamate di sistema si restringe per tipo di lavoro |
| **WASM** per i moduli portabili | i moduli di terze parti non eseguono codice nativo arbitrario |

## 8. Come si aggiorna

Metadati firmati, verifica di radice/delega/scadenza/versione, rifiuto di rollback e di
mix-and-match, download limitato, verifica di firma e digest, analisi di compatibilità e
**diff dei permessi**, quarantena, test, richiesta di autorizzazione, backup, attivazione,
verifica, rollback conservato.

Il **diff dei permessi** è il pezzo che di solito manca altrove: un aggiornamento che chiede
più autorità di quella che aveva prima deve dirlo esplicitamente, e va autorizzato di nuovo.
Un aggiornamento non è un lasciapassare.

## 9. Domani, senza riscrivere niente

| Cosa arriva | Come entra |
|---|---|
| Nuovo acceleratore (NPU, GPU nuova) | un `ModelRuntimeAdapter` + un pacchetto di compatibilità **firmato** — non una release |
| Memoria disaggregata (CXL) | il pianificatore di memoria la vede come un livello in più, non come un caso speciale |
| Confidential computing | il broker di egress passa da "non è uscito" a "è uscito e non era leggibile" |
| Nuovi standard di conformità | un `CompliancePackProvider` firmato e datato |
| Nuovi settori regolati | un modulo, con il suo confine di uso previsto |

**Il Technology Radar è il meccanismo che rende vero tutto questo, e oggi non esiste.** Senza,
ogni hardware nuovo è una *release*. Con, è un *pacchetto firmato*. È la distanza esatta fra
un prodotto che invecchia e uno che si chiama Evolution.

## 10. Matrice di accettazione

Il rischio 4 di `docs/WORK_PLAN_V5_REWRITE.md` («la riscrittura non ha apparato di
accettazione») è chiuso per CodeN Evolution da `CE-001…CE-024` (documento `15`, §11,
`D-0116`) e per l'interfaccia da `UI-001…UI-096` (`docs/WEBUI_DESIGN_V3.md`). Questa
sezione copre ciò che nessuna delle due copre: l'architettura del container stesso. Non
duplica — dove un criterio è già coperto altrove, questa tabella lo dice invece di
riscriverlo. Severità: **C**ritica / **A**lta / **M**edia, come in `15`.

| ID | Criterio | Sev | Verifica | Stato |
|---|---|---|---|---|
| `ARCH-001` | Un solo container OCI, supervisore PID 1 con **tre figli pari** (postgres, api, codev) | **C** | albero dei processi in esecuzione + un health check indipendente per figlio | ⚠ **parziale (`D-0240`)**: `rust/crates/noesar-supervisor` (`noesar-supervisord`) è ora PID 1, `postgres` (via `bin/postgres-child.mjs`) e `api` (`server.mjs`) sono due figli **realmente pari** — verificato dal vivo con l'albero dei processi (`ppid=1` per entrambi). **`codev` resta assente come terzo figlio**: il suo motore gira ancora dentro il processo `api` (`session-protocol.mjs`); separarlo richiede spostare quel dispatch dietro lo stesso socket unix che `tools/tui-client.mjs` già parla dall'esterno — lavoro reale, non fatto qui. Deployato live su `noesar-evolution:phase4-supervisor` |
| `ARCH-002` | Riavviare un figlio non fa cadere gli altri due | **C** | uccidere un figlio, verificare che gli altri due restano `Up` | ✅ **verificato dal vivo in entrambe le direzioni (`D-0240`)**: `kill -9` su `api` → postgres e i suoi worker restano intatti (stessi pid), api rispawnato in 1s; `kill -9` sul wrapper `postgres-child.mjs` → api resta `Up` senza un solo restart, il vero processo postgres sopravvive come orfano (reparented a PID 1, mai perso un dato). Limite dichiarato: il wrapper non si rialza finché l'orfano è vivo (`#clearStalePidFile` rifiuta un secondo postmaster sullo stesso data dir — sicurezza dati, non un bug) |
| `ARCH-003` | Nessun nuovo listener TCP: il protocollo di sessione gira su socket unix | **C** | scansione porte del container, nessuna in ascolto oltre quelle dichiarate | ✅ **verificato dal vivo (`D-0240`)**: `/proc/net/tcp` nel container mostra un solo socket in stato `LISTEN`, sulla porta 8088 dichiarata; il supervisore stesso non apre alcun socket |
| `ARCH-004` | Il piano dati non decide nulla — nessun percorso autorizza direttamente da PostgreSQL | **A** | ispezione statica: nessuna chiamata di autorizzazione nel layer dati | ✅ vero oggi per costruzione (PostgreSQL non ha logica applicativa) |
| `ARCH-005` | Nessun adattatore (`ModelRuntimeAdapter`, `VectorStoreAdapter`, ecc.) può auto-concedersi permessi — un manifest è una richiesta, i token li emette il motore | **C** | test che un adattatore chiede un permesso non concesso e viene rifiutato | ⚠ **parziale (`D-0244`, affinato `D-0252`)**: `local-model-runtime.mjs` (`ModelRuntimeAdapter`) è l'unico adattatore con un'operazione privilegiata, e `launch()` (genera un processo OS reale) richiede un token speso attraverso lo stesso `TokenMinter` di `workspace-actions.mjs`. **`D-0252` ha verificato gli altri sei uno per uno, invece di lasciarli come un unico "non esistono"**: `HardwareProbeAdapter`/`IndustryModuleProvider`/`CompliancePackProvider` sono codice reale e spedito, ma solo lettura/validazione — hanno un manifest esplicito con `operations: []`, non un buco, un fatto dichiarato. Restano davvero aperti solo tre: `VectorStoreAdapter` non è una superficie pluggable (codice first-party unico dietro RBAC+RLS, la premessa di auto-concessione non si applica ancora), `ObjectStoreAdapter` (oggetti indirizzati per contenuto, cifrati) non esiste come capacità nel prodotto, `HostBridgeAdapter` è già coperto sotto due nomi diversi (`local-model-runtime.launch()` + `noesar-sandbox` EXECUTE). `attach()`/`complete()`/`configure()` di `local-model-runtime` restano scoperti dal token (nessun Network Egress Broker), tracciato come `F4-010` |
| `ARCH-006` | `apps/webui-react` rimossa e non reintrodotta | **M** | verifica statica: la directory non esiste nell'albero | ✅ fatto (`D-0195`) |
| `ARCH-007` | Un aggiornamento che richiede più autorità di prima **la dichiara esplicitamente** (diff dei permessi) e va autorizzato di nuovo | **C** | pacchetto di aggiornamento che aumenta lo scope, verifica che sia bloccato senza nuova autorizzazione | ✅ **costruito (`D-0245`)**: `permission-surface.mjs` estrae la superficie dichiarata (permessi RBAC + capability degli adattatori) da qualunque release; `verify-permission-diff.mjs` confronta baseline e candidato, rifiuta ogni ampliamento senza un'autorizzazione che nomini ESATTAMENTE i permessi aggiunti (né di meno né di più). Provato end-to-end contro la superficie reale del codice attuale: un candidato sintetico con 2 permessi in più rifiutato senza autorizzazione, rifiutato con un'autorizzazione fuori scope, accettato solo con lo scope esatto |
| `ARCH-008` | Isolamento per capacità: ogni capacità gira coi limiti scritti nel proprio token, non con quelli del container intero | **A** | misura dei limiti effettivi (cgroup) applicati per sandbox vs per container | ⚠ **meccanismo costruito e MISURATO, non ancora speso da nessuna superficie (`D-0248`)**. La premessa di `D-0246` era sbagliata e l'Owner l'ha rifiutata: chiedere di cambiare l'host è vietato (`CLAUDE10.md` §16), perché il prodotto si installa su PC/server/OS arbitrari e non possiede mai l'host. **Costruito invece un ladder adattivo** (`rust/crates/noesar-sandbox`, `services/reference-control-plane/src/isolation.mjs`): il pavimento è POSIX — `setrlimit` con **anche il limite hard abbassato**, più `PR_SET_NO_NEW_PRIVS` — che non richiede opzioni di kernel né delega cgroup e quindi vale **proprio dove Landlock e cgroup mancano**; sopra, seccomp/Landlock/cgroup usati **solo se l'host li offre**, col livello **dichiarato per installazione**. I limiti viaggiano **dentro il token, sotto il suo MAC** (mirror identico nei due minter, `canonical_limits`/`canonicalLimits`), quindi non sono allargabili fra emissione e spesa — provato manomettendo. **Misurato dal vivo sotto il profilo di hardening di produzione**: figlio tenuto a **64 MiB dentro un container da 8 GiB** (`ulimit -v` letto dal figlio = 65536 KiB mentre il container è unlimited), allocazione da 512 MiB **rifiutata** e da 16 MiB **riuscita** (limite reale, non sandbox rotta), limite hard abbassato quindi il figlio **non può rialzarlo**, `cpuSeconds=1` uccide un ciclo infinito, `ptrace` → **EPERM** dal filtro seccomp (18 syscall), ampliamento oltre il ceiling **rifiutato nominando la dimensione**. Livello su questo host: **tier 1 `SECCOMP_FILTER`** (Landlock e cgroup confermati assenti, gestiti non subiti). **Non fatto e dichiarato**: nessuna superficie del prodotto spende ancora un token attraverso il sandbox — `executor.mjs` continua a rifiutare `EXECUTE` per progetto, e cablarlo è lavoro futuro nominato, non rivendicato qui |
