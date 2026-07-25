# Phase 4 — LAN Access and Owner Bootstrap Preparation Gate

**Executed:** 2026-07-25 (UTC)
**Objective:** make the WebUI of the real installation reachable from a browser on the
local network — no PowerShell, no SSH tunnel, no port forwarding — while keeping every
byte of data and every hardening property already in place.
**Phase 5:** not started.

```text
GATE_STATUS                 PASS
LAN_WEBUI_SERVER_BIND       PASS
CLIENT_BROWSER_TEST         AWAITING_OWNER
OWNER_BOOTSTRAP             AWAITING_OWNER_INTERACTION
PUBLIC_INTERNET_EXPOSURE    false
ROUTER_MUTATION             false
UNRELATED_CONTAINERS        untouched
```

**URL for the Owner:** `http://192.168.178.100:8100`

---

## 1. Starting state, and one discrepancy found in it

| Checked | Expected | Observed |
|---|---|---|
| Image tag | `noesar-evolution:phase4-complete` | matches |
| Container | `noesar-evolution` | matches |
| Bind | `127.0.0.1:8100` | matches |
| Container port | `8088` | matches |
| Health | healthy | healthy, 17 components, 0 degraded |
| Working tree | clean | clean, `f5c9cae` |

**`PROJECT_STATE.json` recorded an image ID that the installation was not running.**
It said `sha256:ec2ac8bd…`; the tag `noesar-evolution:phase4-complete` resolves to
`sha256:52987fbb…`, and the container was created from that. `ec2ac8bd` still exists on
this host, untagged: the image was rebuilt at 14:22 UTC and the container created from
the new one at 14:23, one minute later, after the state file had already been written.

Every enumerated precondition passed — the tag, the container, the bind, the port, the
health and the tree all matched — so the gate proceeded. The stale digest is a
documentation defect (`F4L-002`) and is corrected in this gate.

## 2. Backup

`$ARTIFACT_ROOT/backups/phase_4_lan_access_20260725T151501Z/`

```text
docker/     container inspect, image inspect, network inspect, container/network/volume
            inventories captured BEFORE any mutation, container logs, and a structured
            configuration record (image, network, mounts, uid/gid, healthcheck, restart
            policy, resource limits, security options, log config, non-sensitive env)
db/         pg_dump custom-format archive + sha256 sidecar, its pg_restore TOC,
            the 16-row migration ledger, full cluster state
runtime/    the entire runtime root, copied AT REST after a clean shutdown
evidence/   health/readiness/auth snapshots, host interfaces and listeners,
            tracked HEAD archive, setup-token FINGERPRINT (never the token)
ROLLBACK.md the exact recreation command for the previous configuration
BACKUP_MANIFEST.sha256
```

```text
files hashed                 1886
manifest verification   1886/1886 OK
diff against live runtime      0 differences (byte-identical)
0600 modes on secrets       preserved, owner 10001:10001
database dump             113080 bytes, sha256 5632cca8…, 226 TOC entries
```

The environment record redacts by **name**: any variable whose name matches
`token|secret|password|key|credential` is recorded as present, never with its value.

The logical dump was taken while the cluster was running, so it is MVCC-coherent. The
physical copy was taken **after** a clean shutdown — `received fast shutdown request`,
`database system is shut down`, `postgres.stopped clean:true`, `postmaster.pid` gone —
so it is a consistent data directory, not a smear.

## 3. Findings

| ID | Severity | Summary | Status |
|---|---|---|---|
| `F4L-001` | medium | `/metrics` served without a session to any private peer, on a premise LAN access invalidates | CLOSED — fixed, tested, deployed |
| `F4L-002` | low | `PROJECT_STATE.json` recorded a superseded image ID | CLOSED — corrected |
| `F4L-003` | medium | the installers' readiness loop always probed `127.0.0.1` | CLOSED — fixed, tested |
| `F4L-004` | medium | a LAN publish would have answered `421` to every browser request | CLOSED — fixed, tested |
| `F4L-005` | low | `deployment/docker/run.sh` hardcoded the publish address | CLOSED — fixed |
| `F4L-006` | low | the wrong setup-token fingerprint survived in two documents | CLOSED — corrected |
| `F4L-007` | informational | `--memory-swap` is accepted and silently discarded by this kernel | OPEN — recorded |

### F4L-001 — the trust boundary that moved

`/metrics` was reachable with no session. The gate for it was
`if (!isInternalAddress(clientIp(req)))`, with this comment above it:

> *the container publishes on loopback only, so an internal caller is already inside
> the trust boundary*

That comment is the finding. The conclusion was correct, and it depended entirely on a
premise this gate was about to break. It is also subtler than it looks: **behind a
published Docker port, every external caller arrives from the bridge gateway
(`172.22.0.1`), which is itself an RFC1918 address.** The predicate returns "internal"
for a LAN browser exactly as readily as for a host-local process. On a loopback publish
that is harmless, because nothing but a host-local process can reach the port at all. On
a LAN publish the whole subnet reads the exporter.

Confirmed by execution, before and after, not by reading:

```text
before the fix, over the LAN address:   GET /metrics -> 200, 28 series
after the fix,  over the LAN address:   GET /metrics -> 401 Authentication required
```

Fixed by making the exposure scope explicit — see `docs/LAN_ACCESS_CONFIGURATION.md` —
and gating the unauthenticated path on `scope === loopback && peer is private`.
Loopback installations are unaffected, which the tests assert positively so the fix
cannot be mistaken for a blanket lockdown.

**The rule, not only the instance:** the predicate was not deleted. It is a correct
statement about an address, and it was moved to `http-security.mjs` where it can be
tested. What was wrong was the *conclusion drawn from it without knowing the exposure*,
so the exposure is now a declared input rather than an assumption in a comment.

### F4L-003 — an installer that reports FAIL for a successful install

Both Unraid installers polled `http://127.0.0.1:${PORT}/healthz` to decide whether the
container had come up — regardless of where the port was published. With
`NOESAR_BIND_ADDRESS` set to a LAN address, loopback does not answer, so the loop would
have run its 30 attempts and printed `INSTALLATION_STARTUP=FAIL` for an installation
that was healthy. The operator's likely next move — tear it down and retry — would have
been provoked by the check, not by the product.

Found by reading the health loop against the bind change, then pinned by a test that
asserts the probe targets the published address and does **not** fall back to loopback.

### F4L-004 — a LAN publish that answers 421 to every browser

`NOESAR_ALLOWED_HOSTS` is baked into the image as `localhost,127.0.0.1,::1`. A browser
opening `http://192.168.178.100:8100/` sends `Host: 192.168.178.100:8100`, which is not
in that set, so the server answers `421 Unrecognized Host header` — correctly, and
fatally for the objective of this gate. Verified live before the change:

```text
curl -H 'Host: 192.168.178.100:8100' http://127.0.0.1:8100/livez   ->  421
```

Fixed by deriving the allowlist entry from the same setting that drives the publish, in
the runtime as well as in the installers, so the two cannot drift apart. Only the
declared address is added, never its subnet — asserted with a negative control
(`192.168.178.101` is still refused).

### F4L-007 — a flag this kernel accepts and discards

`--memory-swap 8g` was passed as specified. Docker replied:

```text
WARNING: Your kernel does not support swap limit capabilities or the cgroup is not
mounted. Memory limited without swap.
```

and `HostConfig.MemorySwap` reads `-1` in the resulting container. The host has cgroup
v2 with no swap accounting and `/proc/swaps` is empty, so there is no swap to limit and
the flag has no effect either way. Recorded rather than presented as applied — Phase 3
noted the same limitation, and this is the observation that confirms it.

## 4. What was changed

```text
services/reference-control-plane/src/http-security.mjs      exposure scope + predicates
services/reference-control-plane/src/server.mjs             wiring, allowlist, /metrics gate
deployment/lib/network-access.sh                            NEW — shared access selection
INSTALLATION/install-unraid.sh                              access mode, probe fix, flags
deployment/unraid/install-complete.sh                       access mode, probe fix, flags
deployment/docker/run.sh                                    access mode (was hardcoded)
oci/Dockerfile.phase4-complete-lan                          NEW — offline overlay
services/reference-control-plane/test/lan-exposure.test.mjs NEW — 11 checks
tools/test-installer-hardening.mjs                          48 -> 100 checks
```

`--user 10001:10001` and `--memory-swap` were also added to all three installers. The
image already ran as `10001`; passing it explicitly means the installers now state the
whole hardening profile rather than inheriting half of it.

## 5. Tests

```text
unit tests                    455/455    (444 before; 11 added)
installer hardening           100/100    (48 before; 52 added)
eslint                        137 files, 0 errors, 0 warnings, 0 no-undef
eslint self-test              3/3 canaries detected
shellcheck                    all installers + the new library clean
semgrep (changed surface)     0 findings
detect-secrets                0 findings
```

**Both new suites were verified to fail against the pre-fix code before being trusted.**
Reverting the `/metrics` gate to the old predicate fails
`a LAN-published installation refuses /metrics without a session`; neutering the address
validation fails 12 installer checks. A test that cannot fail proves nothing.

One test was **wrong on first writing and is recorded rather than quietly fixed**: the
Host-allowlist check used `fetch()` with a `host` header. `Host` is a forbidden header
name for `fetch`, so undici drops it silently — the request went out with the real host
and the assertion passed while exercising nothing. Rewritten with `node:http`, which
sends what it is given, plus a negative control.

### Dismissed with evidence

| Hit | Why dismissed |
|---|---|
| `SC1007` on `CDPATH= cd --` (×2) | the correct idiom for neutralising `CDPATH`; already triaged on this project once before |
| `SC1091` "not following source" (×3) | the sourced path is resolved at run time from `RUNTIME_ROOT`; shellcheck cannot follow it from its own CWD |
| `SC2034` unused `NOESAR_RESOLVED_*` | they are the library's return values, read by the sourcing installer; silenced narrowly with a stated reason rather than by disabling the rule |

`SC2148` was **not** dismissed. It fired because the sourced library has no shebang, and
without a shell directive shellcheck skips the file entirely — a check that silently
analyses nothing. A `# shellcheck shell=sh` directive was added, and only then did the
file actually get checked.

## 6. Deployment

The fix is source-only, and the container executes the code baked into its image, so it
could not reach the installation without a new image. Confirmed rather than assumed: the
`server.mjs` inside the running container hashed differently from the repository's, the
only mount is `/workspace`, and `/metrics` still answered `200` on the LAN after the
first recreation.

Built as an **offline overlay** on the audited image — `--network=none --pull=false`,
copying exactly the two changed files — the same pattern and the same reasoning
`Dockerfile.phase4` recorded: rebuilding from `oci/Dockerfile` would re-run `apt-get`
and silently re-resolve the OS package set. Lineage is stated, not hidden.

```text
noesar-evolution:phase4-complete-lan   sha256:4e26c950a3d1…
  FROM noesar-evolution:phase4-complete (sha256:52987fbbb7b5…)
  build network: none      files changed: 2      apt steps: 0
```

This is a **declared deviation** from the gate's "use the same image" instruction,
authorised explicitly by the Owner after the alternatives were put to them: accept a
LAN-readable `/metrics` until Phase 5 rebuilds, or roll back to loopback. See `D-0053`.

Rollback container preserved: `noesar-evolution.rollback-lan-phase4complete-20260725T153133Z`.

## 7. Verification after recreation

```text
PORT_BIND            192.168.178.100:8100->8088/tcp
LIVEZ                200
READYZ               200          ready, setupPending true
HEALTHZ              200          healthy, 17 components, 0 degraded
WEBUI                200          21702 bytes, <title>NOESAR Evolution</title>
AUTH_INITIALIZED     false
DATABASE_CONNECTED   true
POSTGRESQL           18.4 (Debian 18.4-1.pgdg12+1)
PGVECTOR             0.8.5
SAFE_MODE            false
METRICS              401          (was 200 before this gate)
DIAGNOSTICS          401          owner-only, unchanged
```

Hardening, verified from **inside** the container rather than from `docker inspect`:

```text
uid:gid            10001:10001          CapEff             0000000000000000
rootfs              read-only            Seccomp            2 (filter mode)
/tmp                exec denied          NoNewPrivs         1
docker socket       absent               mounts of /workspace   1
pids.max            512                  memory.max         8589934592
NOESAR_SETUP_TOKEN  not in the environment (only the file path is)
```

Data plane and integrity:

```text
migrations                16/16, every sha256 present and 64 chars
RLS forced tables         15
RESTRICTIVE policies      4
noesar_app BYPASSRLS      false
listen_addresses          empty — no TCP listener, unix socket only
users                     0 — the installation is still un-bootstrapped
audit chain               11 records, 0 broken links, recomputed not trusted
```

Controlled restart, twice across the gate:

```text
RestartCount            0        no crash loop
setup token fingerprint db1cf03ef221 -> db1cf03ef221   identical
state digest            ebdd76896017d1c4 -> ebdd76896017d1c4   identical
audit records           append-only, nothing lost
clean shutdown          postgres.stopped clean:true, both times
```

Host-level:

```text
listener   192.168.178.100:8100  (docker-proxy)
127.0.0.1:8100 -> connection refused   — the publish moved, it was not duplicated
networks   identical to the pre-gate inventory
volumes    identical to the pre-gate inventory
37 unrelated containers   same set, none started, none removed
```

## 8. The client-side test is NOT claimed

`curl` from the server proves the port is bound and the application answers on the LAN
address. It does **not** prove a browser on another machine can open it — that depends
on the client's own network, and it is the Owner who has that machine.

```text
SERVER_LAN_BIND_TEST   PASS
CLIENT_BROWSER_TEST    AWAITING_OWNER
```

## 9. Owner bootstrap

Prepared, not performed. No account, password, TOTP seed or recovery code was created.

```text
token file        RUNTIME_ROOT/config/first-owner-setup.token
mode              0600          owner   10001:10001
fingerprint       db1cf03ef221  — file and live container log agree
age               7.9 h of 72   expires 2026-07-28T07:34:24Z
rotated           no — the token is still valid, so it was left alone
used              no            auth initialized: false
setup without a token   403 Invalid setup token
setup with a wrong token 403 Invalid setup token
```

The wrong fingerprint `af6f7ca93c31` is gone from the documents that stated it as fact.
It survives only where it is being *corrected* — this gate's finding register and the
handoff's correction note — which is the point of recording a defect rather than
erasing it.

## 10. Limits, stated

* **No TLS.** LAN traffic is plaintext, including the password and TOTP code on first
  login. Acceptable only on a trusted network; required before anything wider.
* **No client-side browser test.** See section 8.
* **No independent penetration test.** The same party wrote the code, the tests and this
  report.
* **Bootstrap is not source-IP restricted**, and could not be trusted if it were: behind
  a published Docker port the peer address is the bridge gateway for every caller. The
  one-time token is what protects it.
* **`--memory-swap` has no effect on this kernel** (`F4L-007`).
* **The image lineage now has five layers of overlay** (`node:22-bookworm-slim` →
  `phase3` → `phase4` → `phase4-complete` → `phase4-complete-lan`). Phase 5 packaging
  should still rebuild from `oci/Dockerfile` with a recorded network step (`D-0033`).
* **No Owner exists**, so nothing here can be called production-ready.
