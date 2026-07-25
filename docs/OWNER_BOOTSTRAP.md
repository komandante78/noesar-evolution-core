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
| Reachability | loopback only (`127.0.0.1:8100`), because that is the only place the port is published |
| Expiry | 72 hours by default (`NOESAR_SETUP_TOKEN_TTL_HOURS`); an expired token is rotated, not left valid |
| Single use | a second setup attempt is refused once the installation is initialised |
| MFA | TOTP enrolment is part of setup and cannot be skipped |

The token is not an environment variable on purpose: `docker inspect` and
`/proc/<pid>/environ` both expose those, and they end up in shell history.

**This was a real gap.** `NOESAR_SETUP_TOKEN_FILE` was declared in `oci/Dockerfile` and
described in the Phase 3 plan, but no code read it — the only working path was the
environment variable. Implemented in Phase 3 (`src/setup-token.mjs`, 11 tests).

## Steps for the Owner

Run these on the Unraid host itself. The token is printed to your terminal only; do not
paste it into a ticket, a chat, or a file.

```bash
# 1. read the token (never commit it, never log it)
sudo cat /mnt/cachec/NOESAR_EVOLUTION_RUNTIME/config/first-owner-setup.token

# 2. begin setup — choose your own username and a strong password
curl -s -X POST http://127.0.0.1:8100/api/v1/auth/setup \
  -H 'content-type: application/json' \
  -H "x-noesar-setup-token: <the token>" \
  -d '{"username":"<your-username>","displayName":"<Your Name>","password":"<your password>"}'
```

The response returns a `challenge`, a `totpSecret` and an `otpauthUri`. Add the
`otpauthUri` to your authenticator app.

```bash
# 3. confirm with the first code your app shows
curl -s -X POST http://127.0.0.1:8100/api/v1/auth/setup/confirm \
  -H 'content-type: application/json' \
  -d '{"challenge":"<challenge>","totpCode":"<6 digits>"}'
```

That issues the session cookie (`HttpOnly`, `SameSite=Strict`) and the installation is
initialised. Alternatively open `http://127.0.0.1:8100/` and follow the same flow in the
WebUI.

```bash
# 4. confirm it is done, and that the token is spent
curl -s http://127.0.0.1:8100/api/v1/auth/status
# expect: {"initialized":true,"pendingSetup":false,"setupTokenRequired":false,"authenticationRequired":true}
```

After that, `config/first-owner-setup.token` has no further power. It may be deleted; it
is not regenerated once the installation is initialised.

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

## Before any remote access

This installation is loopback-only and has no TLS. If it is ever published beyond
`127.0.0.1`:

1. terminate TLS at a reverse proxy (examples ship in `deployment/reverse-proxy/`);
2. set `NOESAR_SECURE_COOKIES=true`;
3. add the external hostname to `NOESAR_ALLOWED_HOSTS`;
4. treat passkey/WebAuthn as still **missing** — TOTP is what exists today.
