# Update Manager Design

**Current state.** There is no update manager. `updates/` contains exactly two files:
`README.md` and `verify-offline-update.py` — an offline package verifier, no
downloader, no stager, no promoter, no rollback. Everything below is design.

```text
DEFAULT_MODE=NOTIFY_ONLY      AUTOMATIC_INSTALL=false     OWNER_APPROVAL_REQUIRED=true
OFFLINE_UPDATE=true           ROLLBACK_REQUIRED=true
```

The system **never installs anything by itself.** It may check, download, verify and
stage; applying always requires an explicit owner decision.

---

## 1. Channels

| Channel | Contents | Approval | Signing key |
|---|---|---|---|
| `stable` | general releases | owner | release key |
| `security` | security fixes only; surfaced with higher priority, still not auto-applied | owner | release key |
| `beta` | pre-release; opt-in, never a default | owner | beta key |
| `owner` | builds issued to a specific installation/entitlement | owner | release key + entitlement binding |
| `offline` | a package supplied by hand, no network at all | owner | release key |

Channels are **separate namespaces with separate keys**, so a beta key can never sign
a stable artefact. The open-core, commercial and private-ATOM channels are separated
the same way — see `docs/LICENSING_AND_PORTAL_INTERFACE.md`.

## 2. Slots

```text
current/    the running version
previous/   the last known-good version, kept for rollback
staging/    a candidate being verified; never executed from here
```

Promotion is `staging → current`, demoting the old `current → previous`. Only one
version is ever runnable at a time, and `previous` is never deleted until a new
promotion has passed its health check.

## 3. Pipeline

```text
1  CHECK        fetch signed channel metadata (or read an offline bundle)
2  NOTIFY       surface availability to the owner; STOP unless approved
3  DOWNLOAD     into staging/, never over current/
4  VERIFY       signature -> hash -> version -> compatibility -> anti-rollback
5  BACKUP       workspace + data plane + current image tag
6  MIGRATE      forward migrations, dry-run first, transactional where possible
7  HEALTH       start candidate, poll /readyz and /healthz within a timeout
8  PROMOTE      atomic slot switch, only on a healthy candidate
9  VERIFY-POST  re-check health after promotion
10 ROLLBACK     automatic on failure at 6, 7 or 9
```

Steps 4 and 5 are non-skippable. An update that cannot be rolled back is not applied.

## 4. Signed metadata and packages

Channel metadata is itself signed, so an attacker cannot suppress a security update by
serving stale JSON:

```json
{
  "channel": "stable",
  "generated_utc": "2026-07-25T06:00:00Z",
  "expires_utc": "2026-08-01T06:00:00Z",
  "min_supported_version": "0.6.0",
  "releases": [{
    "version": "0.7.0",
    "artifact_sha256": "...",
    "size_bytes": 0,
    "min_upgrade_from": "0.6.0",
    "requires_migration": true,
    "security": false,
    "signature": "ed25519:..."
  }],
  "signature": "ed25519:..."
}
```

Verification order, all mandatory:

1. **metadata signature** against the pinned channel public key;
2. **metadata freshness** — reject if `expires_utc` has passed (stale-metadata attack);
3. **package signature** (Ed25519, detached);
4. **package SHA-256** against the signed value;
5. **version monotonicity** — `new > current` (anti-rollback);
6. **`min_upgrade_from`** — refuse to skip a required intermediate;
7. **channel match** — a `beta` artefact is refused on `stable`.

Ed25519 matches what the product already uses for capability packages
(`capabilities/examples/packages/noesar.foundation-public.pem`), so the verification
primitive already exists in the codebase.

### Anti-rollback

Downgrades are refused by default. The last-installed version is recorded in a
tamper-evident ledger entry, so deleting local state does not enable a silent
downgrade. A deliberate downgrade is an explicit owner action with a typed
confirmation, recorded in the ledger — not a normal update path.

## 5. Offline update

The whole pipeline runs with no network:

```text
noesar-update-<version>.tar
  manifest.json          version, hashes, migrations, min_upgrade_from
  manifest.sig           detached Ed25519 over manifest.json
  payload/               the artefacts
  SHA256SUMS.txt
```

Owner drops the bundle in `/workspace/updates/inbox/`, the manager verifies it with the
**same** verification code as the online path — offline must not be a weaker route.
`updates/verify-offline-update.py` is the existing seed for this.

## 6. Rollback

Triggered automatically when migration fails, the candidate fails health check within
its timeout, or post-promotion verification fails. Also available manually.

```text
stop candidate -> restore previous/ -> restore workspace backup if migrations ran
-> start -> health check -> record outcome
```

Rollback is only trustworthy if the backup at step 5 is verified, so the backup is
checksummed at creation and validated before restore. Detail in
`docs/ROLLBACK_AND_RECOVERY_PLAN.md`.

## 7. Data sent to noesar.com

**Minimum viable, and nothing else:**

```text
installation_id   (random, per install, not derived from hardware)
product_version
channel
os/arch           (linux/x86_64)
entitlement_id    (only when a licensed channel is used)
```

**Never sent:** conversations, prompts, documents, memory, embeddings, file names,
credentials, provider keys, user identities, email addresses, IP-derived location,
usage statistics, telemetry.

The check is a **pull**: the product asks for metadata, the server does not push and is
never given a callback. Update checking must be disableable entirely, in which case
only the offline channel remains. Default posture stays private-by-default, consistent
with external providers being default-deny.

## 8. Interfaces

```text
GET  /api/v1/updates/status         current version, channel, last check, available update
POST /api/v1/updates/check          owner-only; explicit, never automatic
POST /api/v1/updates/stage          download+verify into staging; no execution
POST /api/v1/updates/apply          owner-only; typed confirmation; runs 5-9
POST /api/v1/updates/rollback       owner-only
GET  /api/v1/updates/history        ledger view
```

All are owner-only and audited: who, when, from which version to which, verification
outcome, and result.

## 9. What is NOT built now

The `noesar.com` server side is **not** implemented — only the contract the product
expects. See `docs/LICENSING_AND_PORTAL_INTERFACE.md`. Until it exists, the `offline`
channel is fully functional on its own, which is deliberate: the product must never
depend on a portal to stay updatable.

## 10. Phase placement

Design only (Phase 2). Implementation is **not** Phase 3 — Phase 3 installs the
current version. The update manager is a substantial subsystem needing its own scoped
work, and its acceptance (signed update applied, unsigned rejected, downgrade blocked,
rollback proven) is already listed in `docs/PHASE_4_ACCEPTANCE_PLAN.md` as
simulate-only until the implementation exists.
