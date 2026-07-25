# Phase 3 — Rollback

What Phase 3 changed, and exactly how to undo each part. The general recovery model is in
`ROLLBACK_AND_RECOVERY_PLAN.md`; this file is the concrete record for what was actually
installed.

**Outcome of this phase: `PHASE_3_ROLLBACK = NOT_REQUIRED`.** Installation and health
verification passed, so no rollback was executed. Everything below is the procedure that
was prepared and remains available.

## What actually changed on the host

| Object | Reversible | How |
|---|---|---|
| Image `noesar-evolution:phase3` | yes | `docker image rm noesar-evolution:phase3` |
| Base image `node:22-bookworm-slim` | yes | `docker image rm` — harmless to keep |
| Network `noesar-evolution-net` | yes | `docker network rm` — used by nothing else |
| Container `noesar-evolution` | yes | `docker rm -f noesar-evolution` |
| `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME` | yes | brand-new directory; **move it aside, do not delete** |
| Repository commits | yes | local git only; no remote exists |

**Nothing else on the host was touched.** No pre-existing container, network, image,
volume or share was modified — verified by diffing `docker ps -a`, `docker network ls` and
`docker volume ls` against the inventories captured before any change.

## Verified backup

```text
/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/phase_3_20260725T065555Z
```

`sha256sum -c SHA256SUMS.txt` → **6 035 / 6 035, exit code 0**. Verify it again before
using it: a backup is only real once the check passes.

Additional per-change backups taken in this phase:

- `BACKUPS/seccomp-noesar.json.20260725T071840Z.bak` — before marking the profile
- `BACKUPS/phase3_installer_seccomp_20260725T072032Z/` — the three installers, unmodified
- `BACKUPS/MANIFEST.sha256.pre_phase3_*.bak` — the manifest before the Phase 3 update

## Full rollback

```bash
BK=/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/phase_3_20260725T065555Z
(cd "$BK" && sha256sum -c SHA256SUMS.txt) || { echo "BACKUP INVALID - STOP"; exit 1; }

docker rm -f noesar-evolution                 2>/dev/null || true
docker network rm noesar-evolution-net        2>/dev/null || true
docker image rm noesar-evolution:phase3       2>/dev/null || true

mv /mnt/cachec/NOESAR_EVOLUTION_RUNTIME \
   /mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/quarantined_runtime_$(date -u +%Y%m%dT%H%M%SZ)

git -C /mnt/cachec/NOESAR_EVOLUTION reset --hard 28c8883
```

**Move the runtime root, never delete it.** It may hold the only copy of state worth
diagnosing — including the bootstrap token and the audit ledger. Deletion is a separate,
later decision.

`28c8883` is the Phase 2 head, i.e. the commit immediately before any Phase 3 change.

## Partial rollback, by failing step

| Failing step | Action |
|---|---|
| Runtime root creation | remove the newly created directory; nothing else has changed |
| Base image pull | `docker image rm node:22-bookworm-slim` |
| Build | `docker image rm noesar-evolution:phase3`; the host is untouched |
| Network creation | `docker network rm noesar-evolution-net` |
| Container start | `docker rm -f noesar-evolution`; optionally move the runtime root aside |
| Health check | keep the container **stopped, not removed**, capture `docker logs --tail 200`, remove only after diagnosis |
| Bootstrap | remove the container **and** the workspace — a half-bootstrapped identity store must not be reused |
| Post-install verification | full rollback, above |

## Verification after any rollback

1. `docker ps -a` matches `phase_3_.../containers_before.txt` apart from intended objects.
2. No unrelated container changed state.
3. `docker network ls` matches `networks_before.txt`.
4. `docker volume ls` matches `volumes_before.txt`.
5. `git status --porcelain` clean, `HEAD` at the expected commit.
6. `sha256sum -c MANIFEST.sha256` passes.
7. `node tools/test-packaging-filters.mjs` and `node tools/test-installer-hardening.mjs`
   both pass.
8. Vendor: 113 crates, 5 094 files, 0 missing, 0 corrupt.
9. The outcome is recorded in `INSTALLATION_LEDGER.md`, including what failed and why.

## Known gap, stated plainly

Every backup lives on `/mnt/cachec`, the same device as the runtime. That is sufficient
for install and update rollback and is **not** disaster recovery: a device failure loses
both. Copying backups to the array or off-host is an open decision for the Owner, recorded
rather than silently assumed.
