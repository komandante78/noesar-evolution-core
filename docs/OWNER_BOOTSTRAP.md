# Owner Bootstrap

> **Read this first — since `D-0703` (6/09/2026) this is not the default path.** A Docker
> installation configures no setup token, so the product seeds the owner `root`/`noesar` with
> `mustChangePassword: true`, exactly as `INSTALLATION/WELCOME.txt` says before it installs
> anything. Everything below describes the **token flow**, which is what you get when
> `NOESAR_SETUP_TOKEN` or `NOESAR_SETUP_TOKEN_FILE` is set on purpose — the acceptance drivers
> and the runtime smokes all set it. Two rows of the table below belong to that flow and not to
> a default install: "Default password: none", and the MFA row, which predates TOTP enrolment
> becoming optional on 6/09/2026.

## Posture

| Property | Rule |
|---|---|
| Default password | **none** — no account exists until the Owner creates one |
| Bootstrap token | 32 bytes from a CSPRNG, generated on first run |
| Where it lives | `RUNTIME_ROOT/config/first-owner-setup.token`, mode `0600`, owner `10001:10001` |
| In the environment | **only the path**, never the value |
| In logs | never — only a 12-hex fingerprint |
| In Git | never |
| Reachability | wherever the port is published — on this installation, **`https://192.168.178.100:8443`**. The plain port cannot complete this flow in a browser; see the box below. `docs/LAN_ACCESS_CONFIGURATION.md` |
| Expiry | 72 hours by default (`NOESAR_SETUP_TOKEN_TTL_HOURS`); an expired token is rotated, not left valid |
| Single use | a second setup attempt is refused once the installation is initialised |
| MFA | TOTP enrolment is part of setup and cannot be skipped |

The token is not an environment variable on purpose: `docker inspect` and
`/proc/<pid>/environ` both expose those, and they end up in shell history.

**This was a real gap.** `NOESAR_SETUP_TOKEN_FILE` was declared in `oci/Dockerfile` and
described in the Phase 3 plan, but no code read it — the only working path was the
environment variable. Implemented in Phase 3 (`src/setup-token.mjs`, 11 tests).

## Before you start: use the https address, and trust the certificate first

> 🛑 **The plain port cannot sign a browser in, and it fails without saying so.** Since TLS
> was added (`D-0360`) this installation issues its session cookie with the `Secure`
> attribute, which a browser refuses to store when the page came over `http://`. Measured on
> a real browser against a throwaway installation, `D-0364`:
>
> | address | the server's answer | cookies the browser kept | the next authenticated call |
> |---|---|---|---|
> | `http://…:8100` | **200, "signed in"** | **none** | **401** |
> | `https://…:8443` | 200 | `noesar_session`, `noesar_csrf` | 200 |
>
> Over `http` every step below appears to succeed and you land back on the sign-in screen
> with nothing explaining why. This is not a fault in the steps; it is the wrong address.

**So, first:** open **`http://192.168.178.100:8100/ca`** and follow it — it hands you this
installation's certificate and tells you how to install it on this device, and how to check
its fingerprint before you do. That page is deliberately on the plain port: it is what you
need *before* you can trust the encrypted one. Then come back to
**`https://192.168.178.100:8443`**.

Skipping it means the browser shows a warning, and clicking through that warning does **not**
give you a secure context — so the microphone will not work either (`navigator.mediaDevices`
does not exist outside one).

## Steps for the Owner — from a browser on the local network

No PowerShell. No SSH tunnel. No port forwarding.

**1. Read the one-time token.** On the Unraid host itself:

```bash
cat /mnt/cachec/NOESAR_EVOLUTION_RUNTIME/config/first-owner-setup.token
```

It is printed to your terminal only. Do not paste it into a ticket, a chat, a document
or a screenshot. If you want to confirm you are looking at the current token, compare
its fingerprint against the one the running container logs — never against a value
written down anywhere, including this file:

```bash
docker logs noesar-evolution 2>&1 | grep setup-token.available | tail -1
```

**2. Open NOESAR Evolution** in a browser on any machine on your network:

```text
https://192.168.178.100:8443
```

**3. Choose "Create Owner account".**

**4. Enter the token** you read in step 1.

**5. Choose your username and password.** Nobody else knows them and nobody can
recover them for you — there is no default account and no password reset path.

**6. Configure TOTP.** Scan the QR code with your authenticator app and confirm with
the first six-digit code it shows. This step cannot be skipped.

**7. Save the recovery codes privately** — a password manager, not a file on this
server and not a chat message. They are shown once.

**8. Complete the first login** with username, password and a TOTP code.

**9. Perform a step-up authentication** when the interface asks for it on a sensitive
action, and confirm it is required.

**10. Confirm the token is spent.** A second setup attempt must be refused with
`NOESAR is already initialized`, and:

```bash
curl -sk https://192.168.178.100:8443/api/v1/auth/status
# expect: {"initialized":true,"pendingSetup":false,"setupTokenRequired":false,"authenticationRequired":true}
```

After that, `config/first-owner-setup.token` has no further power. It may be deleted; it
is not regenerated once the installation is initialised.

### The same flow from the command line

If you prefer curl to the WebUI, the API is the same one the interface calls:

```bash
curl -sk -X POST https://192.168.178.100:8443/api/v1/auth/setup \
  -H 'content-type: application/json' \
  -H "x-noesar-setup-token: <the token>" \
  -d '{"username":"<your-username>","displayName":"<Your Name>","password":"<your password>"}'
```

The response returns a `challenge`, a `totpSecret` and an `otpauthUri`. Add the
`otpauthUri` to your authenticator app, then:

```bash
curl -sk -X POST https://192.168.178.100:8443/api/v1/auth/setup/confirm \
  -H 'content-type: application/json' \
  -d '{"challenge":"<challenge>","totpCode":"<6 digits>"}'
```

That issues the session cookie (`HttpOnly`, `SameSite=Strict`, **`Secure`**).

`curl` is more forgiving than a browser here and will carry that cookie over `http` as
well — which is why the plain port looks like it works from the command line and does not
work from a browser. Use the `https` address in both, so what you test is what you use.

> **The connection is encrypted, and the certificate is this installation's own.** `-k`
> appears above because `curl` does not read your device's trust store by default; once
> `ca.crt` is installed you can drop it, and a browser needs no equivalent. What is *not*
> protected is anything reaching this installation from outside your own network — before
> that is ever the case, read the last section of this file.

## Why Phase 3 did not do this for you

Username, password and TOTP enrolment are the Owner's choices. The phase specification
forbids creating definitive credentials on the Owner's behalf when the product requires an
interactive choice, so phase 3 created none.

**The Owner created theirs on 2026-08-09**, and this sentence used to end «so no Owner
account exists on this installation» — present tense, and false from that day. It was read
as current state twice before anybody checked it against `GET /api/v1/auth/status`, which
answers `initialized: true`. The reason phase 3 stood back is still the reason; the state it
described stopped being the state.

## What was verified instead

On the real installation:
- the token file is `0600`, owned by `10001:10001`, and its fingerprint matches the
  startup log line;
- setup **without** a token is refused (`Invalid setup token.`);
- setup with a **wrong** token is refused;
- both refusals are recorded in the audit ledger as `auth.setup-denied`;
- only `NOESAR_SETUP_TOKEN_FILE` (the path) appears in the container environment.

On a **disposable probe container**, so the real installation stayed untouched, the whole
flow was proven:
- setup with the file-provided token succeeds and returns the TOTP enrolment secret;
- confirmation issues an `HttpOnly; SameSite=Strict` session;
- a **second** setup attempt is refused: `NOESAR is already initialized`;
- password alone does not issue a session — `mfaRequired: true` with a challenge;
- a wrong TOTP is refused (`Invalid TOTP code.`);
- a correct TOTP logs in as `role=owner`, `mfaEnabled=true`;
- every owner-only route answers 200 with that session and 401 without one.

The probe container was removed afterwards.

Re-verified on the real installation in the LAN access gate, after the container was
recreated on `192.168.178.100:8443` (https) and restarted:

- the token file is still `0600`, `10001:10001`, fingerprint `db1cf03ef221`, matching
  the live container log;
- it is **unused** — `auth/status` reports `initialized: false`;
- it is **not expired** — 7.9 hours of its 72-hour life, expiring `2026-07-28T07:34:24Z`
  — and was therefore **not** rotated;
- setup without a token and setup with a wrong token are both still refused with
  `403 Invalid setup token.`

## Before any remote access

This installation is reachable from the local network and has no TLS. If it is ever
published beyond that:

1. terminate TLS at a reverse proxy (examples ship in `deployment/reverse-proxy/`);
2. set `NOESAR_SECURE_COOKIES=true`;
3. add the external hostname to `NOESAR_ALLOWED_HOSTS`.

## MFA choices at enrolment

TOTP enrolment (step 6 above) cannot be skipped for `owner`/`admin` — that is what
actually satisfies the mandatory-MFA rule. A passkey (WebAuthn, ES256, `attestation:
'none'`) can additionally be registered from Settings > Security once signed in
(`D-0295`), and from then on it works in place of a TOTP code at step 2 of login. It is
never a substitute for TOTP at first enrolment: registering a passkey itself requires
proving presence with the password and a live TOTP code, the same way replacing the
authenticator does.
