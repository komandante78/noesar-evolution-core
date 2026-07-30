# 08 · Installazione — cosa va installato

## 1. Il principio: un container, nessuna sorpresa sull'host

**Un solo container OCI esterno.** Nessun Docker dentro Docker, nessun runtime annidato,
nessun Compose obbligatorio, nessuna dipendenza da cloud, e **nessun percorso Unraid
cablato**. Il socket Docker **non** viene montato.

**Niente viene installato in silenzio.** Driver, runtime, modelli, pacchetti di sistema: la
rilevazione e la raccomandazione sono automatiche, l'installazione **mai**. Il prodotto ti
dice esattamente cosa gli serve e cosa eseguirebbe; l'esecuzione è un'azione autorizzata con
un token.

## 2. Cosa c'è dentro il container

| Componente | Cos'è | Stato oggi |
|---|---|---|
| **Supervisore** | PID 1, avvia e sorveglia i tre figli | da costruire (oggi supervisiona solo il DB) |
| **PostgreSQL 18 + pgvector** | archivio autoritativo e ricerca vettoriale | **già dentro e funzionante** |
| **api** | WebUI, protocollo di sessione, piano applicativo | esiste come processo unico |
| **codev** | motore CodeN Evolution | da costruire |
| **Kernel di sicurezza** | policy, capability token, audit | **da costruire** (oggi 37 righe) |
| **Provider di ragionamento** | il riferimento pubblico | **da costruire** (oggi zero) |
| **Runtime dei modelli** | adattatori CPU/GPU | parziale |
| **Sandbox** | dove i token si spendono | parziale (solo confine container) |

### PostgreSQL: com'è configurato, e perché così

Già costruito e verificato, e resta così:

- **Processo figlio supervisionato** nell'unico container, non un servizio esterno.
- **Nessun listener TCP**: `listen_addresses=''`, solo socket unix, `scram-sha-256`, e
  `pg_hba` senza alcuna riga `host`. Il database non è raggiungibile dalla rete, punto.
- **Credenziali generate a runtime**, permessi `0600`, mai in git, mai nelle immagini, mai
  nelle variabili d'ambiente, mai nei log.
- **Migrazioni con registro sha256**, isolamento a livello di riga attivo e **forzato**.
- **Backup e ripristino con checksum** che rifiuta un archivio manomesso.
- **Arresto pulito con il segnale giusto** (fast, non smart — smart può essere ucciso a metà
  checkpoint) e recupero verificato da uccisione brutale del postmaster senza perdita di dati.

**Non si torna a SQLite.** L'isolamento a livello di riga è ciò che rende applicabili i muri
fra le tre semantiche di memoria: toglierlo andrebbe rimesso subito.

## 3. Come gira il container

```text
  utente non-root (uid 10001)
  root filesystem in sola lettura
  tutte le capability rimosse  (cap-drop ALL)
  no-new-privileges
  seccomp attivo
  tmpfs montato noexec
  nessun socket Docker
  un solo mount scrivibile: /workspace
  health check, arresto controllato, fallback CPU
```

Tutto questo **è già costruito e verificato dall'interno del container**. Quello che manca è
il livello sotto: capability, Landlock, seccomp per profilo, cgroups per figlio, WASM per i
moduli portabili — cioè **isolamento per capacità, non solo per container** (vedi documento
03, §7).

## 4. Il workspace persistente

Un solo mount scrivibile, con questa struttura:

```text
  /workspace
    ├── config          configurazione, token di setup, credenziali generate
    ├── data            PostgreSQL
    ├── models          modelli, con la loro provenienza
    ├── capabilities    strumenti e plugin installati
    ├── memory          le tre semantiche
    ├── documents       documenti caricati
    ├── knowledge       grafo e indici derivati
    ├── evaluations     benchmark e risultati
    ├── releases        immagini e rollback
    ├── audit           registro append-only + Prove di Sessione
    ├── logs            JSON, UTC, redatti al punto di uscita
    ├── backups         archivi con checksum
    └── licenses        entitlement, se presenti
```

**Limite dichiarato e ancora aperto:** un backup del workspace **non è cifrato e contiene la
chiave master di autenticazione**. O si cifra, o la documentazione lo dice in chiaro come
dovere dell'operatore. Non va lasciato implicito.

## 5. Cosa serve sull'host

**Minimo:**

| | |
|---|---|
| Runtime container | Docker o Podman |
| CPU | x86-64 moderna, 4 core |
| RAM | 8 GB (16 consigliati) |
| Disco | 20 GB + spazio per modelli e documenti |
| GPU | **nessuna** — il fallback CPU è dichiarato e funzionante |

**Consigliato per lavoro reale:** 32-64 GB di RAM, una GPU con almeno 12 GB di VRAM, disco a
stato solido.

**Non serve installare sull'host:** nessun database, nessun Python, nessun Node, nessun driver
oltre a quello che la tua GPU già usa. Sta tutto nell'immagine.

## 6. Installazione

```bash
docker run -d \
  --name noesar-evolution \
  --restart unless-stopped \
  -p 127.0.0.1:8100:8088 \
  -v /percorso/scelto/da/te:/workspace \
  --user 10001:10001 \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:noexec,nosuid,size=256m \
  --network noesar-evolution-net \
  noesar-evolution:<versione>
```

**Sulla porta:** `127.0.0.1:8100` la rende raggiungibile solo dalla macchina stessa. Per
raggiungerla dalla LAN si pubblica sull'indirizzo della macchina — ed è una decisione, con la
sua conseguenza, non un default.

> Su questo è già stato trovato un difetto reale che vale la pena ricordare: pubblicando su un
> indirizzo di rete, l'endpoint delle metriche diventava leggibile **da tutta la LAN**, perché
> un peer dietro una porta pubblicata appare sempre come il gateway del bridge, cioè come un
> indirizzo privato "fidato". Il controllo che diceva "solo dalla rete locale" quindi
> approvava chiunque. Corretto — e serve da promemoria: **un controllo di rete va provato sul
> bind reale**, non sul localhost.

**Il primo avvio** genera un token di setup, lo scrive nel workspace con permessi `0600` e lo
mostra nei log una sola volta. Da lì si crea l'account Owner nel browser: password scelta da
te, MFA obbligatoria, dieci codici di recupero.

## 7. GPU

```bash
  --gpus all        # e nient'altro
```

Il prodotto **rileva** la GPU, ne descrive VRAM, driver e runtime, e **raccomanda** un
profilo. Non installa driver, non scarica modelli, non muta l'host.

Profili disponibili: Automatico, Bilanciato, Massime prestazioni, Bassa latenza, Throughput,
Contesto, Basso consumo, Risparmio memoria, Deterministico, Personalizzato.

**Il pianificatore di memoria** calcola pesi, overhead di quantizzazione e runtime, cache KV,
contesto, batch, concorrenza, memoria degli adattatori, riserva per GPU e sistema, margine di
sicurezza e topologia. Strategie: solo CPU, GPU piena, offload a strati, streaming dei pesi,
memory mapping, cache KV quantizzata, e — quando ci sono più schede — **un compito per scheda
o un modello per scheda**.

**Onestà sul multi-GPU:** schede di produttori diversi vanno bene per *carichi separati*. Un
singolo gruppo tensor-parallel misto **non viene promesso** senza supporto runtime testato. E
molta RAM di sistema (128-512 GB) abilita modelli più grandi e offload, ma **non è prestazione
VRAM**.

## 8. Modelli

Ogni modello porta: identità, editore, sorgente, licenza, uso previsto ed escluso,
architettura, formato, precisione, quantizzazione, **hash e firma**, model card, provenienza
dei dati, vincoli commerciali, RAM/VRAM richieste, contesto validato, benchmark, avvisi.

Ciclo: scopri → ispeziona licenza → verifica editore/hash/firma → scansiona → pianifica
compatibilità → benchmark → approva → attiva → monitora → aggiorna/revoca/annulla.

**Nessun download silenzioso, nessuna attivazione silenziosa.** Un modello remoto è un
**connettore** e cambia l'indicatore di privacy.

## 9. Aggiornamenti

Metadati firmati, verifica di radice/delega/scadenza/versione, rifiuto di rollback e
mix-and-match, download limitato, verifica di firma e digest, analisi di compatibilità,
**diff dei permessi**, quarantena, test, **richiesta di autorizzazione**, backup, attivazione,
verifica, rollback conservato.

Il rollback è **un container**: si sostituisce l'installazione e si tiene fermo il predecessore
immediato. Le immagini precedenti restano su disco, quindi ogni percorso documentato funziona
ancora anche quando il container di rollback viene rimosso.

**Regola di igiene, permanente:** ogni container, tag immagine e rete creati per un lavoro
temporaneo vengono rimossi dal lavoro che li ha creati. A fine fase sopravvivono **due**
container — l'installazione in esecuzione e **un** rollback. Le reti bridge contano: ognuna si
prende una subnet dal pool finito di Docker, e una rete dimenticata la nega a *tutti* i
progetti dell'host. `docker system prune` e simili sono **vietati senza eccezioni**: agiscono
su tutto l'host.

## 10. Cosa si può dire dell'installazione, e cosa no

**Si può dire:** self-hosted, local-first, controllato dal cliente, estensibile, consapevole
dell'hardware, utilizzabile senza servizi cloud NOESAR obbligatori.

**Richiede prova di release specifica:** offline, air-gap, compatibilità runtime, multi-GPU,
alta disponibilità, accessibilità, build riproducibili.

**Non si può dire senza qualificazione:** certificato GDPR/AI Act/HIPAA/FDA, dispositivo
medico, certificato per il volo, rendimenti garantiti, a prova di hacker, egress zero
assoluto. Lo stato regolatorio appartiene a un modulo specifico, con un uso previsto, una
release e un deployment.

## 11. Matrice di accettazione

Stessa premessa del documento `03 §10`: rischio 4 chiuso altrove per CodeN Evolution
(`15`) e interfaccia (`docs/WEBUI_DESIGN_V3.md`), questa tabella copre l'installazione.
Severità: **C**ritica / **A**lta / **M**edia.

| ID | Criterio | Sev | Verifica | Stato |
|---|---|---|---|---|
| `INST-001` | Il socket Docker **non** è montato nel container | **C** | `docker inspect` sui Mounts del container in esecuzione | ✅ vero oggi, verificato dal vivo ripetutamente |
| `INST-002` | Nessuna installazione silenziosa — driver, runtime, modelli, pacchetti richiedono un token autorizzato, mai un'azione automatica | **C** | tentativo di installazione senza token, verifica del rifiuto | ⏳ oggi non c'è ancora un token da presentare — nessuna superficie lo richiede |
| `INST-003` | PostgreSQL senza listener TCP (`listen_addresses=''`, solo socket unix, `scram-sha-256`, `pg_hba` senza righe `host`) | **C** | ispezione della configurazione dal container in esecuzione | ✅ già costruito e verificato |
| `INST-004` | Container non-root (uid 10001), rootfs sola lettura, `cap-drop ALL`, `no-new-privileges`, tmpfs `noexec` | **C** | `docker inspect` sul container installato | ✅ già costruito e verificato — pattern riapplicato a ogni fase di questa sessione (`atomd`, `:phase4-research-gate`) |
| `INST-005` | Un solo mount scrivibile, `/workspace` | **A** | `docker inspect` Mounts | ✅ vero sull'installazione corrente |
| `INST-006` | Il backup del workspace è cifrato, **oppure** la WebUI dichiara esplicitamente che contiene la chiave master di autenticazione | **A** | `services/reference-control-plane/test/webui-markup-structure.test.mjs` — asserisce il testo, non solo l'esistenza della sezione | ✅ **corretto qui (`D-0223`)**: il testo era già presente nella pagina Backups ma senza test che lo proteggesse; una modifica futura poteva cancellarlo senza che nulla se ne accorgesse. Verificato in rosso rimuovendo il testo, poi ripristinato |
| `INST-007` | Il bind su un indirizzo di rete non espone un endpoint interno (es. metriche) a tutta la LAN per il difetto "peer come gateway fidato" | **C** | `services/reference-control-plane/test/lan-exposure.test.mjs` | ✅ trovato e corretto (fase 4 LAN access gate) |
| `INST-008` | Aggiornamento: rifiuta rollback e mix-and-match, verifica firma/digest, diff dei permessi, richiede autorizzazione esplicita | **A** | `tools/cbom.mjs`, `generate-mlbom.mjs`, `sign/verify-release-artifact.mjs` — firma Ed25519 verificata `D-0208`; diff dei permessi in `tools/generate-permission-surface.mjs`+`verify-permission-diff.mjs`, `D-0245` | ⚠ **quasi completo**: firma, provenienza e diff dei permessi tutti costruiti e provati; resta da collegare il diff dei permessi allo stesso passo che verifica firma/digest in un'unica pipeline di aggiornamento — oggi sono due strumenti CLI distinti, non un solo comando |
| `INST-009` | Igiene container: a fine fase sopravvivono esattamente due container di progetto (installazione + un rollback) | **A** | conteggio `docker ps -a` a chiusura fase | ✅ osservato e mantenuto per ogni fase di questa sessione |
| `INST-010` | Installer multipiattaforma: hardening e filtri di packaging non regrediscono | **A** | `tools/test-installer-hardening.mjs`, `tools/test-cross-platform-installers.mjs`, `tools/test-packaging-filters.mjs` | ✅ 100/100 + 73/73 (windows non eseguito) — misurato `2026-07-27` |
