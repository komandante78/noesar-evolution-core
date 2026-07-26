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

**La raccomandazione è B, con un confine preciso**: Rust per ciò che *decide* e per ciò che
*confina* (supervisore, kernel di sicurezza, enforcement filesystem, indicizzazione pesante);
JavaScript per ciò che *propone e presenta*. Non perché Rust sia migliore in astratto, ma
perché la parte che deve reggere quando tutto il resto è compromesso deve essere piccola,
tipizzata e separata — e oggi non è nessuna delle tre.

**Ciò che non è accettabile è lasciare i due in contraddizione**: un registro delle decisioni
che dice "Approvato" mentre il codice fa un'altra cosa è il modo in cui un progetto smette di
sapere cosa ha deciso.

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
