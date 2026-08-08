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
