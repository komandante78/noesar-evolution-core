# Phase 4 — update manager test report

## Verdict

```text
UPDATE_MANAGER=PASS
network calls: 0
test keys only: yes, generated at run time
private keys in the repository: none
```

## Coverage

The full §11 matrix is covered by **37 unit tests** in
`services/reference-control-plane/test/update-manager.test.mjs`, all re-run as part of the
351-test suite in this phase. Test key pairs are generated inside the tests; no key material
exists in the repository (asserted by a test of its own: "no update state file ever contains
a private key").

| Requirement | Test |
|---|---|
| valid manifest, valid signature | "a correctly signed package verifies" |
| wrong signature | "a wrong signature is refused" |
| unsigned | "an unsigned package is refused" / "unsigned channel metadata is refused" |
| tampered payload | "a payload tampered with after signing is refused" |
| undeclared file smuggled into the payload | "an undeclared file cannot ride along inside the payload" |
| traversal path in a manifest | "a traversal path in the manifest is refused" |
| expired metadata | "expired metadata is refused, so a stale-metadata attack cannot suppress a fix" |
| replay / anti-rollback | "anti-rollback survives a rollback: a version already installed once cannot return" |
| downgrade | "a downgrade is refused" |
| same version reinstalled | "reinstalling the same version is refused" |
| skipped required intermediate | "a required intermediate version cannot be skipped" |
| wrong channel | "a beta artefact is refused on the stable channel even when correctly signed" |
| separate keys per channel | "a beta key cannot sign a stable artefact: channels have separate pinned keys" |
| channel with no pinned key | "a channel with no pinned key cannot verify anything" |
| private key where a public key is expected | "a private key is refused where a public key is expected" |
| notify only, no automatic install | "the default posture is notify-only with no automatic installation" |
| offline | "the update manager makes no network call" |
| staging isolation | "staging copies into staging/ and never over current/" |
| owner approval + typed confirmation | "applying without owner approval is refused" / "approval requires a typed confirmation" |
| mandatory backup | "an unverified backup aborts the apply before anything changes" / "a failing backup aborts the apply" |
| health-failure rollback | "a candidate that fails its health check is rolled back automatically" |
| migration-failure rollback | "a failed migration rolls back and restores the workspace from the backup" |
| post-promotion failure | "a post-promotion failure after a migration restores the workspace" |
| migration dry run first | "a migration dry run always precedes the real one" |
| rollback restores previous slot | "rollback restores the previous slot and reports health" |
| safe mode blocks apply, allows rollback | "safe mode blocks apply but leaves rollback available" |
| full audit | "every step is written to the audit ledger and the history" |

## Live, on the installed container

| # | Check | Observed |
|---|---|---|
| REC-11 | the update surface is owner-only | unauthenticated `GET /api/v1/updates/status` → **401** |
| REC-12 | slots exist, no key pinned | `current inbox keys previous staging`; inbox empty; **no channel key installed** |
| REC-13 | no network | the inbox is a directory on the bind mount, not a URL |
| — | strong reauth on apply | `POST /api/v1/updates/apply` additionally requires `session.elevatedUntil > now`, i.e. recent password + TOTP |

Because no channel key is pinned, nothing can be verified, and because nothing can be
verified nothing can be applied. That is the shipped default and it is the right one: the
signing side and the portal do not exist yet, so the offline channel is the only usable
path, exactly as Phase 3 recorded.

## What was deliberately not done

No end-to-end apply was performed against the **installation**. Applying an update mutates
`current/`, and the phase specification's own I-series requires the installation to be
returned to a known-good state afterwards; the same paths are already proven by the unit
tests, including automatic rollback on both migration and health failure, so driving a real
promotion against the live instance would have added risk without adding evidence.

`NOESAR_SETUP_TOKEN_TTL_HOURS`, the metadata freshness window and the anti-rollback ceiling
all remain at their shipped defaults; none was relaxed to make a test pass.
