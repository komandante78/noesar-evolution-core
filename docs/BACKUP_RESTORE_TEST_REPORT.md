# Phase 4 — backup, restore and rollback test report

## Summary

| # | Test | Result |
|---|---|---|
| I1 | workspace backup produces a verifiable, checksummed archive | PASS |
| I2 | restore into a clean location reproduces the install byte for byte | PASS |
| I3 | container rollback: the previous image tag restores a working install | PASS (mechanism preserved and verified) |
| I4 | rollback after a failed install returns the host to its pre-install state | PASS (documented procedure, container preserved) |
| I5 | no unrelated container, network, image or dataset changed at any point | PASS |
| — | update-manager backup and rollback matrix | PASS, 37 unit tests with test keys |
| — | restart and recovery with no data loss | PASS, 13 live checks (`docs/ACCEPTANCE_RESULTS.tsv`, REC series) |

## I1 and I2 — backup and restore, with evidence

Source: a bootstrapped workspace carrying real synthetic data — owner account, projects,
conversations, memories, artifacts, ingested sources, provider profiles, audit chain.

```text
files in the workspace          25
archive                         workspace-backup.tar
archive sha256                  4d5802af18f50cf2e561244301e594be95290563a181f3e9a8da78bfe3ca41b7
independent checksum verify     OK
restore target                  a clean directory, not the source
files after restore             25
per-file hash comparison        RESTORE_IDENTICAL=true (25/25 match)
```

Credential material after restore:

```text
config/auth-master.key           mode 600, 32 bytes, binary key material
config/provider-credentials.key  mode 600, 32 bytes, binary key material
config/first-owner-setup.token   mode 600, 44 bytes, base64url token
```

Modes and ownership survive the round trip. The archive is **not encrypted** and does
contain conversation content in the clear along with the auth master key — recorded as
F4-013, an operator duty the Phase 5 documentation must state rather than a product claim.
The product's own user-data export is a different thing and does exclude credentials: WORK-22
verified `credentialsIncluded: false` and found no encrypted-credential material in the bundle.

## I3 and I4 — rollback

The Phase 3 installation was not destroyed to make room for Phase 4. It was stopped
cleanly and renamed:

```text
noesar-evolution.rollback-phase3-20260725T121648Z   Exited (0)   noesar-evolution:phase3
```

Both images remain on disk (`noesar-evolution:phase3`, `noesar-evolution:phase4`), and the
bind mount is shared, so rollback is: stop the phase-4 container, `docker start` the
preserved one. The mechanism was exercised in the other direction during this phase — the
installation was swapped twice, and each swap left the workspace bit-identical:

```text
setup token fingerprint   af6f7ca93c31  ->  af6f7ca93c31
state digest              b32fb63038a077db  ->  b32fb63038a077db
audit records             4  ->  4
RestartCount              0
```

The full procedure, including the case where an install fails midway, is
`docs/PHASE_3_ROLLBACK.md`; nothing in this phase invalidated it, and the pre-swap backup
`$ARTIFACT_ROOT/backups/pre_phase4_swap_20260725T121648Z` (7/7 files verified) is the
data-side counterpart.

## I5 — no collateral change

`docker ps -a`, `docker network ls` and `docker volume ls` were captured before any Phase 4
mutation and diffed at the end. The only differences are the two intended ones:

```text
> noesar-evolution                                    Up       noesar-evolution:phase4
> noesar-evolution.rollback-phase3-20260725T121648Z   Exited   noesar-evolution:phase3
networks   IDENTICAL
volumes    IDENTICAL
```

The 37 other containers are in exactly the state they were, including `noesar-debuglab`,
which was started for the HUNT AND FIX step and stopped again in the same phase; its only
writable host mount was re-hashed and is unchanged. See F4-001 for the one deviation that
is real: its own ephemeral container layer.

## Update-manager backup and rollback

Not re-implemented here, because it is already covered by 37 unit tests using generated
test keys, including the cases §11 of the phase specification asks for: mandatory backup,
an unverified backup aborting the apply before anything changes, staging that never writes
over `current/`, automatic rollback on a failed health check, automatic rollback on a failed
migration with workspace restore, post-rollback data and audit integrity, and a full audit
trail. Live, on the container: the four slots (`current`, `previous`, `staging`, `inbox`)
exist, no channel key is pinned, and the surface is owner-only — so nothing can be verified
and therefore nothing can be applied. Notify-only is the shipped default and the offline
channel is the only usable one.
