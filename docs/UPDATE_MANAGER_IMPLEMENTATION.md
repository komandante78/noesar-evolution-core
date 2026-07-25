# Update Manager — Implementation

Implements the client side of `UPDATE_MANAGER_DESIGN.md`. Module:
`services/reference-control-plane/src/update-manager.mjs`. 37 tests.

```text
DEFAULT_MODE=NOTIFY_ONLY   AUTOMATIC_INSTALL=false   OWNER_APPROVAL_REQUIRED=true
OFFLINE_UPDATE=true        ROLLBACK_REQUIRED=true    PORTAL_CONFIGURED=false
```

Observed live on the installation:

```json
{"mode":"NOTIFY_ONLY","automaticInstall":false,"ownerApprovalRequired":true,
 "offlineUpdate":true,"rollbackRequired":true,"portalConfigured":false,
 "channel":"offline","channels":["stable","security","beta","owner","offline"],
 "installedVersion":"0.6.0","highestEverInstalled":"0.6.0","staged":null,
 "slots":{"current":0,"previous":0,"staging":0,"inbox":0},"pinnedChannelKeys":[]}
```

## Never automatic

`automaticInstall` is not a setting that could be flipped: **nothing in the class calls
`apply()` on its own**, and `apply()` refuses outright if the flag is ever set. Checking
for updates is a read; it installs nothing, which is asserted by test.

## No network, by construction

This build contacts nothing. A test strips comments from the module and asserts it
contains no `fetch(`, `node:http`, `node:https`, `node:net`, `node:dns`, no `http://`,
no `https://` and no `noesar.com`. The `offline` channel is fully functional on its own —
deliberately, so the product never depends on a portal to stay updatable.

## Channels and keys

`stable` · `security` · `beta` · `owner` · `offline`

Each channel pins its **own** public key at `updates/keys/<channel>.pub.pem`. A beta key
therefore cannot sign a stable artefact — tested, and it fails at signature verification
rather than at a name check. A channel with no pinned key can verify nothing. Installing
a **private** key where a public key belongs is refused explicitly.

## Verification, in order, all mandatory

**Channel metadata** (signed over canonical JSON):
1. signature against the pinned channel key;
2. channel match;
3. **freshness** — `expires_utc` in the past is refused, because serving stale but validly
   signed JSON is how a security update gets suppressed.

**Package** (detached Ed25519 over the exact `manifest.json` bytes):
1. package signature;
2. channel match — a `beta` artefact is refused on `stable`;
3. manifest expiry;
4. **version monotonicity** — a downgrade or a reinstall of the current version is refused;
5. **anti-rollback** — refused if that version was ever installed before, tracked in
   `highestEverInstalled`, so rolling back does not reopen the door;
6. `min_upgrade_from` — a required intermediate cannot be skipped;
7. **per-file SHA-256** for every declared file, plus rejection of any **undeclared** file
   in the payload and of any path that escapes it.

Two signing conventions, deliberately: metadata is an in-memory object so it is signed
over canonical JSON; a package manifest is a file so it is signed over its exact bytes.

## Slots

```text
inbox/     operator-supplied bundles
staging/   a verified candidate; never executed from here
current/   the running version
previous/  the last known-good version
```

Staging re-verifies what actually landed in `staging/`, not what was inspected in
`inbox/`. Promotion is `staging → current`, demoting `current → previous`. `previous/` is
replaced only at promotion time, so it is never absent while an update is in flight.

## Pipeline

```text
CHECK → NOTIFY → (owner approval) → STAGE → VERIFY → BACKUP → MIGRATE → HEALTH
      → PROMOTE → VERIFY-POST → ROLLBACK on failure at MIGRATE, HEALTH or VERIFY-POST
```

- **Approval** requires the typed confirmation `APPLY UPDATE`. Applying without approval
  is refused.
- **Apply** additionally requires recent strong reauthentication at the HTTP layer.
- **Backup is not skippable.** If it throws, or returns anything other than
  `verified: true`, the apply aborts before anything changes — tested both ways, with the
  installation still at its original version and `current/` still empty afterwards.
- **Migrations dry-run first**, then run for real; the order is asserted.
- **Rollback is automatic** on migration failure, on a candidate that fails its health
  check, and on post-promotion failure. If migrations had already run, the workspace is
  restored from the pre-update backup, because forward migrations are not assumed
  reversible.

## Safe mode

`apply` is blocked in safe mode; `rollback` stays available, because that is how an
operator gets out of a bad update. Tested.

## API

```text
GET  /api/v1/updates/status     GET  /api/v1/updates/history
POST /api/v1/updates/check      POST /api/v1/updates/channel
POST /api/v1/updates/stage      POST /api/v1/updates/approve
POST /api/v1/updates/apply      POST /api/v1/updates/rollback
```

All owner-only, all CSRF-protected, all audited: who, when, from which version to which,
verification outcome and result. `update.check`, `update.staged`, `update.approved`,
`update.backup`, `update.health` and `update.apply` were all observed in the ledger, with
the chain verifying.

## Keys and fixtures

Every key used in testing is generated at run time. **No signing key exists in this
repository**, and a test asserts the update state file never contains `PRIVATE KEY` or
even a PEM header.

## Not implemented

The `noesar.com` server side, the downloader, and the entitlement binding for the `owner`
channel. Only the contract the product expects exists. Until a portal exists the `offline`
channel is the whole product, which is the intended posture.
