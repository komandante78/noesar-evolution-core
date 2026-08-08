# The container flags that are NOT in the image — and what breaks without them

**These live only in the `docker run` command.** Rebuilding the image does not restore them, and
`docker inspect` on a container created without them shows nothing missing — which is exactly how
they were absent for weeks. Whoever recreates this container must set all of them.

Written after s334, where two of them were discovered by an outage rather than by reading.

---

## 1. `--health-start-period 90s` and a probe on **`/readyz`**, never `/livez`

```
--health-cmd "<node one-liner GETting http://127.0.0.1:8088/readyz>"
--health-interval 30s --health-timeout 5s --health-retries 3 --health-start-period 90s
```

**What went wrong with `/livez`.** Liveness answers *"the process is alive"*; readiness answers
*"it can actually serve"*. The probe was on `/livez`, so when PostgreSQL failed to start —

```
PANIC: could not locate a valid checkpoint record at 0/2CC5D08
postgres.restart.exhausted restarts=5
data-plane.failed  the postgres peer did not become ready … refusing to serve against a substitute
```

— the API correctly refused to serve, the LAN got **connection refused on every request**, and
**Docker went on reporting `healthy` for eight minutes.** The one signal an operator watches said
the opposite of the truth.

`/readyz` includes the data plane and answers **503** when it is not ready
(`server.mjs`: `json(res, readiness.ready ? 200 : 503, readiness)`).

**Verified rather than assumed** (s334): the probe command exits `0` against `/readyz` at 200 and
`1` against a route answering 401 — so it really reads the status code. Note that a nonexistent
path is **not** a valid negative test here: this server falls back to `index.html` with 200, and
the first attempt at this check passed for that reason.

**Why 90s and not 10s:** a real PostgreSQL start takes longer than the old start period. With a
readiness probe, too short a start period makes a legitimate boot look like a failure.

## 2. `--stop-timeout 60`

Docker's default is **10 seconds**. The shutdown chain inside is longer by design:

| Layer | Grace |
|---|---|
| `noesar-supervisor` (PID 1, Rust) | `GRACEFUL_STOP_TIMEOUT = 45s` |
| `postgres-supervisor.mjs` | `stopTimeoutMs = 30s`, then SIGQUIT + 5s |
| **Docker, as configured** | **10s, then SIGKILL** |

Both inner layers exceed the only one that is actually enforced. A stop that lands during a long
checkpoint is killed mid-write, and the cluster comes back with an unreadable checkpoint record.

**Stated honestly:** in s334 a normal stop completed in **27 ms** (`postgres.stopped clean:true`),
so 10s was not the binding constraint for an ordinary stop, and this flag is **not** proven to be
what corrupted the cluster. It closes a real and measurable hazard; it is not a diagnosis.

## 3. `--ip 172.22.0.5` on `noesar-evolution-net`, and 30 environment variables

19 come from the image and **must not be repeated** — in particular
**`NOESAR_TUI_SOCKET_PATH`**, which comes from the image as `/run/codev-tui.sock`. Setting it
explicitly to the supervisor's internal path left the terminal transport unserved (`D-0339`).

## 4. `--read-only`, `--tmpfs /run:mode=1777`, `--tmpfs /tmp`, `--restart unless-stopped`

`/run` and `/tmp` are tmpfs and are **lost on restart by construction** — sockets and pid files
live there and are recreated. All durable state is in `/workspace` and `/shadows`, both host
volumes. Measured in s334: across a real stop/start the only field of `state/auth.json` that
changes is `lastUsedAt` on the service token; the `tokenDigest` is identical, which is the
evidence that the module reattaches with the same credential rather than being re-issued one.

---

## Generating the command safely

Generate it from the **live** container and validate it on a throwaway with a different name and
IP **before** stopping production. Read the healthcheck back as `CMD-SHELL` from the running
container rather than reconstructing it: a generator that reads its own output has produced the
wrong form before (s320).

---

# Backup — dove sono, e cosa NON copre (s334)

**Prima di s334 NOESAR EVOLUTION non era in alcun backup.** Né il repo né lo stato vivo
comparivano fra le sorgenti: lo script si chiama `BACKUP_NOESAR` e salva `/mnt/cachec/NOESAR/`,
che è la cartella della memoria, non il prodotto. Tutto viveva su un solo NVMe (`/mnt/cachec`,
XFS su `nvme1n1p1`, pool cache **senza parità**) e non esisteva altrove.

## Come funziona

`/mnt/cachec/NOESAR/SCRIPTS/backup_auto.sh <componente>` — tar → `openssl enc -aes-256-cbc
-pbkdf2 -iter 100000` → `scp` verso `root@5.189.167.44:/root/backups/<componente>/` → rotazione
remota `find -mtime +7 -delete`.

Le pianificazioni stanno in **`/boot/config/plugins/dynamix/noesar-backup.cron`**, non nel
crontab di root: quello si perde al riavvio, il file su flash viene ricaricato da `update_cron`.

## Il database non si copia, si estrae

`noesar_evolution` prende un **`pg_dump` dal server VIVO** ed **esclude** `postgresql/` dal tar.
Copiare la data dir di un Postgres in esecuzione produce una copia strappata a metà di un
checkpoint — è esattamente il guasto di s334 (`PANIC: could not locate a valid checkpoint
record`), che ha tenuto il prodotto giù mentre il container si dichiarava sano. Il dump viene
**riletto con `pg_restore -l` prima di essere spedito**: un dump che non si rilegge non è un
backup, e la verifica costa un secondo.

**Provato end-to-end in s334**, non assunto: archivio riscaricato dal VPS, decifrato, `tar`
integro, `auth.json` e `app.js` presenti, `postgresql/` assente (0 file), e il dump
**ripristinato su un Postgres usa-e-getta → 0 errori, 35 tabelle, 19 migrazioni, 2 utenti**.

⚠️ La prima prova di ripristino diede **32 errori** e non era un problema del backup: il
bersaglio era `postgres:18` **senza pgvector**, quindi le tre tabelle con colonne vettoriali non
si creavano. Ripetuta sull'immagine del prodotto: zero errori. **Un ripristino va provato sul
motore vero, o misura il bersaglio invece del backup.**

## Cosa è escluso, e perché

| Escluso | Motivo |
|---|---|
| `ATOM_EVOLUTION/model_store`, `ATOM_MODEL/base` | 34 GB dei 39 sono `.gguf`/`.safetensors` **pubblici e riscaricabili**. Spedirli ogni notte riempirebbe il VPS. I **checkpoint** (4,2 GB) sono invece inclusi: sono addestramento dell'Owner e non esistono altrove. |
| `NOESAR_EVOLUTION_RUNTIME/postgresql` | Sostituito dal `pg_dump`. Includerlo darebbe l'**illusione** di poter ripristinare. |
| `node_modules`, `rust/target`, `vendor` | Rigenerabili da lockfile. |

## Cosa resta scoperto — dichiarato, non nascosto

- **`coden_tui`**: insieme **vuoto dal 27 giugno**, e non ha **nessuna** voce cron. Non è un
  backup che fallisce, è un backup che non è mai stato pianificato.
- **Nessun file `sha256` accanto agli archivi sul VPS.** Il log registra l'impronta alla
  creazione, ma sul disco non c'è nulla con cui riverificare un archivio mesi dopo.
- **La passphrase è dentro lo script, sulla stessa macchina che genera i backup.** Protegge il
  trasporto e il furto del solo file, non la compromissione dell'origine.
- **Una sola destinazione.** VPS Contabo, singolo. Nessuna seconda copia altrove.

**Non è un difetto:** «Archivi conservati: 9 (max 7)» — `find -mtime +7` cancella ciò che ha
*più di* 7 giorni, quindi 8-9 file sono il risultato corretto. È il messaggio a essere
fuorviante. E `nous_model` è **settimanale di domenica**, non fermo.
