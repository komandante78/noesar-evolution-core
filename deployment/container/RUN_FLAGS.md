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

## 3. `--ip 172.22.0.5` on `noesar-evolution-net`, and 44 environment variables

**18 come from the image and must not be repeated** — in particular
**`NOESAR_TUI_SOCKET_PATH`**, which comes from the image as `/run/codev-tui.sock`. Setting it
explicitly to the supervisor's internal path left the terminal transport unserved (`D-0339`).
The other **26 are explicit** and exist nowhere but the run command.

**Count them with `grep -c .`, never `wc -l`** — a trailing blank line made an earlier session
report one variable too many and call a correct note wrong.

## 3b. The eight voice variables, and the two containers they point at (s337)

`docs/VOICE.md` says voice is "environment variables and no code". Those variables live **only in
this run command**, so a container recreated without them is an installation that has silently
stopped being able to hear or speak — and the interface will report that honestly, which makes the
symptom look like a deliberate configuration rather than an omission.

```
-e NOESAR_VOICE_TRANSCRIBE_ENDPOINT=http://172.22.0.8:8000
-e NOESAR_VOICE_TRANSCRIBE_MODEL=Systran/faster-whisper-small
-e NOESAR_VOICE_LANGUAGE=it
-e NOESAR_VOICE_SPEAK_ENDPOINT=http://172.22.0.7:8880
-e NOESAR_VOICE_SPEAK_MODEL=kokoro
-e NOESAR_VOICE_SPEAK_VOICE=if_sara
-e NOESAR_VOICE_RUNE=im_nicola
-e NOESAR_VOICE_ESTRELA=if_sara
```

They point at **two containers that are in no image of this product** and must exist beside it:

| container | image | address | serves |
|---|---|---|---|
| `noesar-voice-hear` | `ghcr.io/speaches-ai/speaches:latest-cuda` | 172.22.0.8:8000 | `/v1/audio/transcriptions` |
| `noesar-voice-speak` | `ghcr.io/remsky/kokoro-fastapi-cpu:latest` | 172.22.0.7:8880 | `/v1/audio/speech` |

⚠️ **`speaches` will not serve a model it was never told to install.** A fresh cache answers
`404 "Model … is not installed locally"` to every transcription until
`POST /v1/models/Systran/faster-whisper-small` has been called **once**. The cache is the named
volume `noesar_voice_hear_cache`; destroy it and that call must be repeated.

⚠️ **Telemetry is off by explicit variable, not by default.** The first run of `speaches` opened
connections to `huggingface.co` and `api.gradio.app` at startup. `HF_HUB_DISABLE_TELEMETRY=1`,
`GRADIO_ANALYTICS_ENABLED=False` and `DO_NOT_TRACK=1` are set for that reason: in a product whose
whole argument is that no vendor sees what you say, a voice server phoning home is not a detail.

**Speech runs on CPU deliberately.** phi-4 holds 10 353 MiB of a 12 288 MiB card, so Kokoro on the
GPU would compete with the model that answers. Whisper `small` fits in what is left — 412 MiB,
measured, 1.8 s for a short utterance. `Systran/faster-whisper-medium` was tried and **hangs
without ever loading** (VRAM never moves), so `small` is what is configured. The model is a
variable, not a rebuild: a card with more headroom changes one string.

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

---

# 5. TLS — `NOESAR_TLS_PORT`, and the two things it would break without it (s336)

The microphone is the reason this exists, not hardening: `navigator.mediaDevices` does not exist
outside a secure context, so a product on `http://192.168.178.100:8100` cannot open one however
well its voice engine is configured.

```
-e NOESAR_TLS_CERT_FILE=/workspace/tls/leaf.crt
-e NOESAR_TLS_KEY_FILE=/workspace/tls/leaf.key
-e NOESAR_TLS_CA_FILE=/workspace/tls/ca.crt
-e NOESAR_TLS_PORT=8443
-e NOESAR_PUBLIC_TLS_URL=https://192.168.178.100:8443
-p 192.168.178.100:8443:8443
```

**`NOESAR_TLS_PORT` is what keeps the module attached.** With it, TLS faces the LAN and the main
port stays plain for the private container network. Without it, the historical behaviour applies
and the MAIN listener becomes TLS — which breaks two things that were measured before the change:

- **Debug Evolution calls this control plane at `http://noesar-evolution:8088`** with a service
  token. A TLS main port detaches it unless the module's own trust store learns this certificate,
  and that is another product's container.
- **The module console proxy on 8089 is reached by a browser.** Its scheme now follows the main
  listener automatically. Left plaintext while cookies became `Secure`, it would answer the
  sign-in page to somebody demonstrably signed in one tab over — and nothing would have said
  "your cookie was not sent".

**`secure_cookies` becomes true and cannot be forced back** while this process holds the private
key. So the plain port can no longer sign a browser in; that is correct, and it is why the LAN
address to use is the **https** one.

The certificate lives in `/workspace/tls/` (host: `NOESAR_EVOLUTION_RUNTIME/tls/`) — a local CA
plus a leaf with SANs for `192.168.178.100`, `127.0.0.1`, `172.22.0.5`, `localhost`,
`noesar-evolution`, `noesar.local`. Install **`ca.crt`** once per device and no browser warns
again, including after the leaf is re-issued. `ca.key` and `leaf.key` are `0600`, owned by 10001.

**`NOESAR_TLS_CA_FILE` is what makes that installable without `docker cp` (`D-0364`).** With it the
product serves **`http://192.168.178.100:8100/ca`** — a plain-text page with per-device instructions —
plus `/ca.crt` and `/ca.crt.sha256`. Unauthenticated on purpose: the session cookie only travels over
a connection the browser already trusts, and this is the file that earns that trust.

⚠️ **Point the variable at the CA, never at the leaf.** The product refuses a file that did not sign
`leaf.crt` and answers 404 instead — but naming `leaf.crt` here would be accepted only while the leaf
is self-signed, which this installation's is not. On the day the leaf is re-issued, devices trusting
the CA keep working and devices trusting a leaf stop.

⚠️ **The fingerprint shown on `/ca` arrives over a connection nothing has authenticated.** Read the
real one from the container's own start-up line `trust-anchor.published`, or with
`docker exec noesar-evolution openssl x509 -in /workspace/tls/ca.crt -noout -fingerprint -sha256`,
and compare it on the device before installing. Note that `sha256sum ca.crt` gives a **different**
number — that one is over the file, the fingerprint is over the certificate.

🛑 **`NOESAR_PUBLIC_TLS_URL` is not decoration — without it the product cannot name the address
that works (`D-0365`).** The plain port **cannot sign a browser in**: the session cookie is
`Secure`, and a browser will not keep a `Secure` cookie from an `http://` page. The server still
answers **200** and issues it, so the failure is silent — `curl` keeps that cookie and works,
which is why every automated check passed on an address where a person fails.

With the variable set, the sign-in screen says so and links to the working address. Set it to the
**published** URL, not the container's port: the product knows what it listens on, never what the
run command mapped it to. A non-https or malformed value is refused rather than shown — the
warning still appears, without a destination.

**It also drives the redirect (`D-0366`).** A **page** load on the plain port answers **302** to
this address, because a warning only reaches somebody who reloads and a bookmark is not refreshed
by a deploy. Never redirected: `/api/…` (Debug Evolution calls this port in plaintext with a
service token **by design**), `/ca*` (how a device comes to trust the destination), and
`/livez` `/readyz` `/healthz` `/metrics` (a probe that does not follow redirects would read a
302 as an outage). Unset the variable and nothing moves.

⚠️ **Pre-existing, found while verifying this and NOT caused by it:**
`NOESAR_ALLOWED_HOSTS=localhost,127.0.0.1,::1` does not include `noesar-evolution`, so a request
carrying that Host is answered **421** whatever the transport. The same URL with an allowed Host
answers 200. If the module is ever meant to call back on its service name, that variable is what
needs it — not TLS.

---

# 6. `NOESAR_ALLOWED_HOSTS` must name the SERVICE name too (s336)

```
-e NOESAR_ALLOWED_HOSTS=localhost,127.0.0.1,::1,192.168.178.100,172.22.0.5,noesar-evolution
```

**Found by measuring, and it was broken before this session touched anything.** The live value
was `localhost,127.0.0.1,::1`. The published LAN address passes by another route, so a browser
was fine — but Debug Evolution is configured to call this control plane at
`http://noesar-evolution:8088`, and every such request was answered **421 Misdirected Request**:

| Host header | before | after |
|---|---|---|
| `192.168.178.100:8100` | 200 | 200 |
| `noesar-evolution:8088` | **421** | 200 |
| `172.22.0.5:8088` | **421** | 200 |
| `attacker.example:8088` | 421 | **421** |

The last row is the point: the control still refuses a Host nobody published. Adding the service
name and the fixed container IP widens the allowlist only for clients that can resolve them,
which is containers on the private network — the module itself. A browser on the LAN cannot.

⚠️ Not caused by TLS, and not fixed by it. It presents as "the module is fine" because the module
is healthy and simply never gets an answer on that path.
