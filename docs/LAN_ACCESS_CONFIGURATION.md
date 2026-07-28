# LAN Access Configuration

How NOESAR Evolution decides which address its WebUI is published on, what it refuses
to do, and what changes about the security posture when the answer is not loopback.

---

## The setting

```text
NOESAR_BIND_ADDRESS
```

| Value | Meaning |
|---|---|
| `127.0.0.1` | this server only — **the default for every new installation** |
| a specific LAN address | reachable from other machines on the local network |
| `0.0.0.0` | every interface, including any public one — **refused by default** |

A new installation that nobody configures is reachable from the machine it runs on and
nowhere else. Widening that is always an explicit act.

`0.0.0.0` additionally requires `NOESAR_ALLOW_PUBLIC_BIND=true`. The installer cannot
tell from inside the host which of its interfaces face the internet, and NOESAR ships
without TLS, so it refuses the guess rather than making it.

### The derived setting

```text
NOESAR_BIND_SCOPE = loopback | lan | custom
```

Normally derived from `NOESAR_BIND_ADDRESS` and never set by hand. It exists because
**a process cannot observe the address its container was published on**: inside the
network namespace the server sees `NOESAR_HOST=0.0.0.0` whether Docker forwards from
`127.0.0.1` or from a LAN address. The scope is therefore declared by whoever published
the port. Unset means `loopback`.

## The access-mode prompt

On a terminal, the installers ask:

```text
Access mode:
1. Local server only
2. Local network
3. Custom interface
```

Option 2 lists the addresses actually configured on this host, and only those that are:

* **not** loopback;
* **private** (RFC1918);
* **not** on a virtual interface — `docker*`, `br-*`, `veth*`, `virbr*`, `vmnet*`,
  `tun*`, `tap*`, `wg*`, `zt*`, `tailscale*` are all excluded.

So a Docker bridge, a VM bridge, a VPN endpoint or a public address is never proposed
automatically. The selected address is echoed before anything starts, and the final URL
is printed when the installation comes up.

**Nothing outside this host is touched.** No router configuration, no UPnP, no port
forwarding, no firewall rule. Making the service reachable from the internet is not
something these installers can do, by design and not by omission.

### Precedence

1. `NOESAR_BIND_ADDRESS` in the environment — explicit, scriptable, no prompt
2. the choice remembered from the last install — survives updates and reinstalls
3. the interactive prompt — only when there is a terminal
4. `127.0.0.1`

A non-interactive run with nothing configured takes the secure default. An installation
is never silently widened because nobody was there to answer.

### What is remembered, and where

`RUNTIME_ROOT/config/network-access.json`, mode `0600`, owned by the container user:

```json
{
  "accessMode": "local-network",
  "bindAddress": "192.168.178.100",
  "bindScope": "lan",
  "hostPort": "8100",
  "containerPort": "8088",
  "url": "http://192.168.178.100:8100/"
}
```

It lives in the workspace, not in the image and not in Git, so an update or a reinstall
keeps answering on the address the Owner bookmarked.

### What the installer refuses

| Input | Outcome |
|---|---|
| an address no interface on this host carries | refused, with the available addresses listed |
| `0.0.0.0` | refused unless `NOESAR_ALLOW_PUBLIC_BIND=true` |
| a public (non-RFC1918) address | refused unless `NOESAR_ALLOW_PUBLIC_BIND=true` |

A refusal happens **before** `docker run`, so nothing is started and nothing has to be
undone.

---

## What changes when the scope is not loopback

### The Host allowlist

The published address is added to `NOESAR_ALLOWED_HOSTS` automatically. This is not
cosmetic: without it every browser request to `http://<lan-ip>:8100/` is answered
`421 Unrecognized Host header`, which presents as a broken installation rather than as
a policy decision. The publish address and the allowlist are driven from the same
setting so they cannot drift apart.

Everything else is still refused. Only the declared address is added — not its subnet:

```text
Host: 192.168.178.100:8100   200
Host: localhost:8100         200
Host: 192.168.178.101:8100   421
Host: attacker.example       421
```

### `/metrics` moves behind authentication

This is the one behavioural change, and it closes a real hole.

`/metrics` was served without a session to any caller whose peer address was private.
The reasoning was written into the code: *"the container publishes on loopback only, so
an internal caller is already inside the trust boundary"*. That reasoning is correct
while the publish is `127.0.0.1` — and it is load-bearing, because **behind a published
port every external caller arrives from the Docker bridge gateway, which is itself an
RFC1918 address**. The peer address alone therefore proves nothing. On a loopback
publish "private peer" really does mean "a process on this host", since nothing else can
reach the port at all. On a LAN publish it means nothing, and the exporter — request
paths, status codes, safe-mode state, log volume — would be readable by the whole subnet.

| Exposure scope | `/metrics` without a session |
|---|---|
| `loopback` | served, as before (no regression for existing installations) |
| `lan` | `401` — `audit.read` required |
| `custom` | `401` — `audit.read` required |

### What does *not* change

* **No CORS.** No `Access-Control-Allow-Origin` is emitted on any route, on any scope.
  There is no wildcard because there is no CORS at all: the WebUI is same-origin with
  its API, so nothing needs one. `Cross-Origin-Resource-Policy: same-origin` and
  `Cross-Origin-Opener-Policy: same-origin` are sent on every response.
* **No WebSocket.** The product has no WebSocket endpoint, so there is no WebSocket
  Origin allowlist to configure. Streaming uses SSE over the same origin.
* **CSRF** is unchanged: a double-submit token, `noesar_csrf`, verified against the
  session on every mutating route.
* **Cookies** are unchanged: `noesar_session` is `HttpOnly; SameSite=Strict`.
  `SameSite=Strict` is correct precisely because all access is same-origin.
* **`Secure` is not set** while `NOESAR_SECURE_COOKIES=false` and no in-process TLS is
  configured. Setting it over plain HTTP would make the browser discard the session
  cookie and the Owner could not log in at all. It is implied `true` automatically once
  `NOESAR_TLS_CERT_FILE`/`NOESAR_TLS_KEY_FILE` are set (see `## TLS` below) — the product
  will not serve a non-`Secure` cookie over a connection it just encrypted itself.
* **CSP, XSS and framing protections** are untouched: `default-src 'self'`,
  `object-src 'none'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
* **`/diagnostics` stays owner-only** on every scope.
* **Bootstrap** is reachable from wherever the port is published — loopback, or the LAN
  address expressly configured — and is protected by the one-time setup token, not by
  the network. Source-IP restriction is not implemented and could not be trusted here
  anyway: behind Docker's published port the peer address is the bridge gateway for
  every caller, so the runtime cannot distinguish a LAN client from a local one. That
  is stated rather than approximated.

---

## TLS

**TLS is off by default.** Traffic between a browser on the LAN and this host is
plaintext unless one of the two paths below is configured: session cookie, CSRF token,
password on first login, and the TOTP code all cross the network in the clear otherwise.
That is acceptable only on a network the Owner controls and trusts, and TLS is required
before this installation is published beyond one.

There are **two ways to add it, and they are not combined**:

### Option A — a reverse proxy in front (recommended when one is already part of the deployment)

The product speaks plain HTTP on `127.0.0.1:8088` and something else terminates TLS —
examples in `deployment/reverse-proxy/` (`nginx.conf.example`, `Caddyfile.example`).
1. terminate TLS at the reverse proxy;
2. set `NOESAR_SECURE_COOKIES=true` on the NOESAR container (the proxy's TLS is invisible
   to it — nothing in-process tells it the connection upstream is encrypted);
3. add the external hostname to `NOESAR_ALLOWED_HOSTS`.

### Option B — the product terminates TLS itself (no separate proxy to run)

Set both `NOESAR_TLS_CERT_FILE` and `NOESAR_TLS_KEY_FILE` to PEM files mounted read-only
into the container (a self-signed pair for LAN use, or a real certificate — the product
does not generate one itself: which name it is for and whether it is CA-issued is an
operator decision, the same reasoning `NOESAR_BIND_ADDRESS` already applies). Both
variables must be set together — one without the other fails startup loudly rather than
falling back to plaintext silently. `NOESAR_SECURE_COOKIES` is then implied `true`
automatically. The container's own healthcheck adapts to either transport at runtime.
Example, a throwaway self-signed pair for LAN-only use:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /path/on/host/key.pem -out /path/on/host/cert.pem \
  -days 365 -subj "/CN=<the LAN hostname or IP you will browse to>"
# then mount both read-only and set:
#   NOESAR_TLS_CERT_FILE=/run/secrets/tls/cert.pem
#   NOESAR_TLS_KEY_FILE=/run/secrets/tls/key.pem
```

A browser will show a certificate warning for a self-signed pair — expected, and no
different in substance from `Caddyfile.example`'s `tls internal`. It is still real
encryption of the traffic; it is not a real identity assertion to a stranger.

### Either way

1. remember that passkey/WebAuthn is still **missing** — TOTP is what exists today;
2. note that no independent penetration test has been performed.

---

## Verifying an installation

```bash
docker port noesar-evolution                        # the publish
curl -i http://<bind-address>:8100/livez            # 200
curl -i http://<bind-address>:8100/metrics          # 401 on a LAN scope
docker logs noesar-evolution 2>&1 | grep runtime.started
```

The startup line reports the scope without printing any address — the log sink redacts
IPv4 literals, so an address there would come out as `[REDACTED_IP]`:

```json
{"event":"runtime.started","bind_scope":"all-interfaces","exposure_scope":"lan",
 "metrics_requires_authentication":true}
```

`bind_scope` is what the process listens on *inside* its namespace, which in a container
is always `all-interfaces` and says nothing about reachability. `exposure_scope` is what
the operator published it on *outside*. They are different questions and the log now
answers both.

## Tests

| Property | Where |
|---|---|
| loopback is the default; explicit LAN honoured; address not on host refused; `0.0.0.0` refused without override; choice persists across reinstall; URL printed; readiness probes the published address | `tools/test-installer-hardening.mjs` (100 checks) |
| scope derivation, `/metrics` gating matrix, Host allowlist, no CORS header on any route | `services/reference-control-plane/test/lan-exposure.test.mjs` (11 checks) |
| a half-configured cert/key pair is refused; an unreadable or non-PEM file is refused; both files well-formed activates TLS | `services/reference-control-plane/test/tls.test.mjs` (9 checks) |
| the server actually switches transport against a real listener; HSTS only appears once TLS genuinely terminates the connection; secure cookies are implied automatically; the healthcheck answers in both modes | `tools/tls-smoke.mjs` |

Both were verified to fail against the pre-fix behaviour before being trusted.
