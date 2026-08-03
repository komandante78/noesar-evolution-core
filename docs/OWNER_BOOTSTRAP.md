# Owner Bootstrap

## Posture

| Property | Rule |
|---|---|
| Default password | **none** — no account exists until the Owner creates one |
| Bootstrap token | 32 bytes from a CSPRNG, generated on first run |
| Where it lives | `RUNTIME_ROOT/config/first-owner-setup.token`, mode `0600`, owner `10001:10001` |
| In the environment | **only the path**, never the value |
| In logs | never — only a 12-hex fingerprint |
| In Git | never |
| Reachability | wherever the port is published — on this installation, `http://192.168.178.100:8100` from the local network. See `docs/LAN_ACCESS_CONFIGURATION.md` |
| Expiry | 72 hours by default (`NOESAR_SETUP_TOKEN_TTL_HOURS`); an expired token is rotated, not left valid |
| Single use | a second setup attempt is refused once the installation is initialised |
| MFA | TOTP enrolment is part of setup and cannot be skipped |

The token is not an environment variable on purpose: `docker inspect` and
`/proc/<pid>/environ` both expose those, and they end up in shell history.

**This was a real gap.** `NOESAR_SETUP_TOKEN_FILE` was declared in `oci/Dockerfile` and
described in the Phase 3 plan, but no code read it — the only working path was the
environment variable. Implemented in Phase 3 (`src/setup-token.mjs`, 11 tests).

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
http://192.168.178.100:8100
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
curl -s http://192.168.178.100:8100/api/v1/auth/status
# expect: {"initialized":true,"pendingSetup":false,"setupTokenRequired":false,"authenticationRequired":true}
```

After that, `config/first-owner-setup.token` has no further power. It may be deleted; it
is not regenerated once the installation is initialised.

### The same flow from the command line

If you prefer curl to the WebUI, the API is the same one the interface calls:

```bash
curl -s -X POST http://192.168.178.100:8100/api/v1/auth/setup \
  -H 'content-type: application/json' \
  -H "x-noesar-setup-token: <the token>" \
  -d '{"username":"<your-username>","displayName":"<Your Name>","password":"<your password>"}'
```

The response returns a `challenge`, a `totpSecret` and an `otpauthUri`. Add the
`otpauthUri` to your authenticator app, then:

```bash
curl -s -X POST http://192.168.178.100:8100/api/v1/auth/setup/confirm \
  -H 'content-type: application/json' \
  -d '{"challenge":"<challenge>","totpCode":"<6 digits>"}'
```

That issues the session cookie (`HttpOnly`, `SameSite=Strict`).

> **On this network, the connection is not encrypted.** There is no TLS, so the
> password and the TOTP code cross your local network in the clear. That is acceptable
> on a network you control. Before this installation is ever reachable from anywhere
> wider, read the last section of this file.

## Why Phase 3 did not do this for you

Username, password and TOTP enrolment are the Owner's choices. The phase specification
forbids creating definitive credentials on the Owner's behalf when the product requires an
interactive choice, so **no Owner account exists on this installation**.

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
recreated on `192.168.178.100:8100` and restarted:

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
