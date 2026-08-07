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

---

## 12. `coden_evolution` — l'accesso in una parola

**Il gesto, fissato dall'Owner** (`16` §4.2b): si scrive `coden_evolution` e parte la
sessione. Nient'altro. L'autenticazione **resta e sta dentro**: è una domanda dopo essere
entrati, con lo stesso secondo fattore del browser, non un ostacolo da superare per
arrivare al programma.

### Le tre vie d'ingresso, in ordine di costo

> **Corretto il 2026-08-07, e la correzione è il punto.** Fino a quella data questa sezione
> descriveva **una sola** via — `ssh` con un utente di sistema dedicato — e la descriveva
> come *la* ricetta. Quella via costa: `root`, `useradd`, una regola `sudoers`, una modifica
> a `sshd_config`, la porta e l'indirizzo di ascolto reali dell'host, e su host con la radice
> in RAM anche un meccanismo di persistenza all'avvio. Sei passi e tre trappole. Su Windows
> è dichiarata **UNVERIFIED**; su macOS richiede un interruttore nelle Impostazioni.
>
> Un prodotto self-hosted deve aprirsi su quello che la persona **ha già**. Le due vie che
> non costano nulla di tutto questo esistevano da prima e non erano nominate qui.

| # | Via | Cosa serve | Su quali sistemi |
|---|---|---|---|
| **1** | **Il browser** — `http://<macchina>:8100/` | **niente** | tutti, telefono compreso; sopravvive al riavvio da sé perché il container è `--restart unless-stopped` |
| **2** | **`coden_evolution` nel proprio terminale** | un account che sa già parlare col proprio motore di container — cioè chi ha messo su il container | Linux, macOS, BSD, WSL, Windows |
| **3** | **`ssh` come utente dedicato non-amministratore** (§12.3) | `root` sull'host, `sudoers`, `sshd` | famiglia per famiglia, **facoltativa** |

**La via 2 in un comando, senza `root`.** L'installatore trova il motore, trova
l'installazione **per label**, estrae l'avviatore e lo mette in `~/.local/bin`:

```sh
curl -fsSLO http://<macchina>:8100/cli/install.sh
curl -fsSL  http://<macchina>:8100/cli/install.sh.sha256   # confrontare, poi:
sh install.sh
```

Su Windows lo stesso con `Install-CodenCli.ps1` da `/cli/install.ps1`. Chi ha il
repository può saltare lo scaricamento: i due file sono `deployment/container/`. Entrambi
si disfano con `--uninstall`, e **nessuno dei due tocca `sshd`, `sudoers` o un gruppo**.

> **Perché la rotta `/cli` esiste.** Senza di essa l'unico modo documentato di *procurarsi*
> l'installatore era il passo 1 della §12.3 — `docker create`, `docker cp`, `docker rm`,
> `chmod`, più il tag dell'immagine — cioè quattro comandi e un dato da ricordare: la stessa
> forma di problema che l'avviatore esiste per abolire, spostata di un piano. La porta era
> già aperta e già serviva la pagina, quindi serve anche i byte. La rotta è **una tabella
> fissa di quattro file sorgente AGPL più le loro impronte**: nessun frammento della
> richiesta raggiunge mai un percorso, non perché sia filtrato ma perché non esiste un
> cammino di codice in cui possa arrivarci (`src/cli-downloads.mjs`).

**Cosa dà il prodotto, e cosa dà l'installazione.** Il confine non si attraversa: il prodotto
fornisce un avviatore che trova la sessione da solo e **non modifica mai la configurazione
dell'host**; l'installazione fornisce l'utente di sistema e la regola del demone `ssh`, che
un essere umano applica — e serve **solo** per la via 3. Il prodotto non possiede la macchina
su cui gira.

| Livello | File | Chi lo mette |
|---|---|---|
| Prodotto | `tools/coden-evolution` (POSIX), `tools/coden-evolution.ps1` (Windows) | spediti nell'immagine |
| Prodotto | `deployment/container/install-coden-cli.sh` e `Install-CodenCli.ps1` | spediti nell'immagine, serviti su `/cli` |
| Installazione da sorgenti | `coden_evolution` accanto a `noesar-evolution` | `deployment/{linux,macos,windows}/` |
| Installazione (solo via 3) | l'utente `coden`, la regola `sshd`, l'eventuale regola di elevazione | **§12.3** |

### 12.1 Come l'avviatore trova la sessione

Non presume nulla e prova tre gradini in ordine, **dichiarando su `stderr` quale ha usato**:

| Gradino | Quando vince | Cosa fa |
|---|---|---|
| `socket` | esiste un socket che questo processo può già raggiungere | avvia il client del terminale su quel socket |
| `engine` | no socket: la sessione è dentro un contenitore | trova il motore (`docker`, `podman`, `nerdctl` — il primo che **risponde**, non il primo installato), trova il contenitore dalla **label** `org.noesar.authority=reference-node`, e rientra in sé stesso lì dentro |
| dichiarazione | niente ha funzionato | elenca cosa ha provato e cosa ha risposto, e rimanda a questa sezione |

Codici d'uscita: `2` argomento rifiutato · `3` nessuna sessione · `4` più di una installazione
(le nomina, **non ne sceglie una**).

### 12.2 Configurazione (facoltativa, dell'installazione)

`/etc/noesar-evolution/launcher.conf` — cinque chiavi, lette una a una. Il file **non viene
mai eseguito né incluso**: una riga che non è una di queste chiavi è ignorata.

```text
socket=/percorso/del/socket        # solo per installazioni da sorgenti
engine=docker                      # salta la scoperta
container=noesar-evolution         # obbligatorio se sull'host gira più di una installazione
elevate=sudo                       # solo dove serve la regola di §12.4
remote_launcher=/opt/noesar/tools/coden-evolution
```

### 12.3 La ricetta `ssh`, per famiglia di sistema — **FACOLTATIVA**

> **Non serve per accedere.** Questa sezione costruisce la **via 3**: un account di sistema
> dedicato, **non amministratore**, che entra da `ssh` e non può fare altro che aprire la
> sessione. È un irrobustimento per chi vuole dare l'accesso al programma **senza** dare un
> account della macchina — non il modo di entrare. Per entrare bastano la via 1 (il browser,
> zero installazione) o la via 2 (`install-coden-cli.sh`, zero `root`), entrambe sopra.
>
> Quello che segue **modifica l'host**: crea un utente, scrive in `/etc/sudoers.d`, modifica
> `sshd_config`. Va applicato da un essere umano che amministra quella macchina, e su alcune
> famiglie di sistemi va **riapplicato a ogni avvio** (§12.5).

> **Questa sezione è stata corretta applicandola davvero** (2026-08-07, `D-0340`). La prima
> stesura era sbagliata in **tre** punti, e nessuno dei tre si vedeva leggendola. Sono segnati
> ⚠️ qui sotto, perché sono esattamente i punti dove un'installazione fallisce in silenzio.

**Passo 0 — i due valori dell'host che non si presumono.** Prima di tutto si leggono dal
`sshd_config` dell'host la **porta** e l'**indirizzo di ascolto**: non sono necessariamente
`22` e «tutte le interfacce». Sull'installazione di riferimento erano `Port 2223` e
`ListenAddress` su una sola interfaccia, e ogni comando qui sotto li usa.

**Passo 1 — prendere l'avviatore.** Su una macchina che ha solo l'immagine e nessun
repository, l'avviatore si estrae dall'immagine — è il motivo per cui viene spedito:

```sh
CID=$(docker create noesar-evolution:<tag>)
docker cp "$CID:/opt/noesar/tools/coden-evolution" /usr/local/bin/coden_evolution
docker rm "$CID"
chmod 0755 /usr/local/bin/coden_evolution
```

**Passo 2 — l'utente di sistema.**

```sh
useradd --system --create-home --shell /bin/sh coden
```

> ⚠️ **La shell deve essere una shell vera.** `sshd` esegue `ForceCommand` **tramite la login
> shell dell'utente** (`$SHELL -c comando`): con `/usr/sbin/nologin` l'accesso viene rifiutato
> e non parte nulla. L'utente **non ottiene comunque una shell**, perché `ForceCommand` la
> sostituisce — la sicurezza sta lì, non nel campo shell.

**Passo 3 — la chiave per arrivare alla macchina.** È il primo dei due livelli di
autenticazione (il secondo è quello del prodotto, dopo l'ingresso):

```sh
install -d -m 0700 -o coden -g coden /home/coden/.ssh
install -m 0600 -o coden -g coden /percorso/della/chiave.pub /home/coden/.ssh/authorized_keys
```

**Passo 4 — la configurazione dell'avviatore.**

```sh
install -d -m 0755 /etc/noesar-evolution
printf 'engine=docker\ncontainer=noesar-evolution\nelevate=sudo\n' > /etc/noesar-evolution/launcher.conf
```

**Passo 5 — la regola del demone `ssh`.**

```text
Match User coden
    ForceCommand /usr/local/bin/coden_evolution
    PermitTTY yes
    AllowTcpForwarding no
    X11Forwarding no
    PermitTunnel no
```

Su **Linux con systemd** (Debian, Ubuntu, Fedora, RHEL, Arch, SUSE) va in
`/etc/ssh/sshd_config.d/60-coden-evolution.conf`, purché `sshd_config` contenga
`Include /etc/ssh/sshd_config.d/*.conf`. Su **Linux senza systemd** e sulle distribuzioni
minimali quella directory spesso **non esiste**: il blocco si scrive in fondo a
`/etc/ssh/sshd_config`. Su **macOS** l'accesso remoto si abilita da *Impostazioni › Generali ›
Condivisione › Accesso remoto* e il file è `/etc/ssh/sshd_config`.

> ⚠️ **Se l'host limita gli accessi, il blocco `Match` è morto finché non si aggiunge
> l'utente.** Molte installazioni hanno `AllowUsers` o `AllowGroups`: sull'host di riferimento
> c'era `AllowUsers root`, e il risultato era un `Permission denied` che **non nomina** la
> causa. Si controlla, e se c'è si aggiunge `coden` a quella riga.

**Passo 6 — validare PRIMA di ricaricare, e ricaricare senza riavviare.**

```sh
sshd -t                 # una configurazione rotta qui chiude fuori l'amministratore
kill -HUP "$(pgrep -f 'sshd.*listener')"   # oppure: systemctl reload sshd / rc-service sshd reload
```

`reload`/`SIGHUP` e **mai** `restart`: le sessioni già aperte non devono cadere.

**Windows.** Si installa `OpenSSH Server` da *Impostazioni › App › Funzionalità facoltative*;
la configurazione sta in `%ProgramData%\ssh\sshd_config` e quella dell'avviatore in
`%ProgramData%\noesar-evolution\launcher.conf`. Il comando forzato è
`powershell -NoProfile -File "C:\Program Files\noesar-evolution\coden-evolution.ps1"`.
**Dichiarato:** il gemello PowerShell **non è mai stato eseguito** — non c'è PowerShell sulla
macchina su cui è stato scritto — ed è coperto da sole asserzioni strutturali. Il livello di
verifica per un'installazione Windows è **UNVERIFIED** finché qualcuno non lo esegue su un host
Windows vero.

### 12.4 L'elevazione — tre righe fisse, nessun jolly

> **L'utente dedicato NON entra nel gruppo del motore di contenitori.** Quel gruppo equivale
> all'amministrazione della macchina: si otterrebbe una shell del prodotto regalando l'host
> (`16` §4.3, trappola 2).

> ⚠️ **Servono TRE righe, non una.** L'avviatore **interroga** il motore prima di usarlo, e
> chiede un terminale **solo se ne ha uno**: produce quindi esattamente tre righe di comando e
> nessun'altra. Misurate, non dedotte. Una regola sola fa fallire l'ingresso da `ssh`
> (che *ha* un terminale) mentre quello da script funziona — il tipo di guasto che sembra
> intermittente.

```text
# /etc/sudoers.d/coden-evolution — modo 0440, validare con `visudo -c -f` prima di installarlo
coden ALL=(root) NOPASSWD: /usr/bin/docker version
coden ALL=(root) NOPASSWD: /usr/bin/docker exec -i noesar-evolution /opt/noesar/tools/coden-evolution
coden ALL=(root) NOPASSWD: /usr/bin/docker exec -i -t noesar-evolution /opt/noesar/tools/coden-evolution
```

Nessuna delle tre contiene un carattere jolly, ed è possibile **solo** perché motore e
contenitore vengono dal file di configurazione di proprietà di root: l'avviatore non può
produrre un argv diverso da questi. Se qualcuno punta `NOESAR_EVOLUTION_LAUNCHER_CONF` a un
file suo, l'argv smette di combaciare e `sudo` rifiuta. **La regola è l'autorità, non
l'avviatore.** L'avviatore usa `sudo -n`: sotto un comando forzato non c'è nessuno a cui
chiedere una password, e uno che si blocca su un prompt invisibile è indistinguibile da uno
rotto.

### 12.5 Le due trappole che restano

1. **Il socket non si pubblica sull'host.** È la porta del motore senza alcuno strato HTTP
   davanti; a limitarlo è il permesso `0600` dentro lo spazio dei nomi del contenitore.
   L'avviatore **va al socket, non lo sposta**: nessun passo di questa ricetta lo espone.
2. **Su alcuni sistemi la configurazione del demone non sopravvive al riavvio — e questo è
   ora misurato, non ipotizzato.** Sull'installazione di riferimento (un NAS appliance) la
   radice del filesystem è in RAM: utente, `sudoers`, `sshd_config` e avviatore **spariscono
   tutti al riavvio**. Su questa famiglia di sistemi la ricetta va riapplicata all'avvio dal
   meccanismo che l'host offre per la persistenza. **Dopo aver applicato la ricetta si riavvia
   la macchina e si riprova**, prima di considerarla fatta: un'installazione che si scopre
   rotta al primo riavvio è la stessa cosa di una non fatta.
