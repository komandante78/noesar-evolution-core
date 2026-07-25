# Rollback and Recovery Plan

How to undo anything Phase 3 does, and how to recover from failure at runtime.

**Governing rule:** an operation that cannot be rolled back is not performed. Every
mutating step in Phase 3 is preceded by a verified backup.

---

## 1. What can actually change

| Object | Created by | Reversible | How |
|---|---|---|---|
| Docker image `noesar-evolution:v4-complete` | Phase 3 step 4 | yes | `docker image rm`; previous tag retained |
| Base image `node:22-bookworm-slim` | step 3 | yes | `docker image rm` (harmless to keep) |
| Network `noesar-evolution-net` | step 5 | yes | `docker network rm` — used by nothing else |
| Container `noesar-evolution` | step 6 | yes | stop + rename (keep) or remove |
| `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME/` | step 2 | yes | directory is new; nothing else writes there |
| Repository commits | step 10 | yes | local git; nothing pushed (no remote) |

**Nothing else on the host is touched.** No existing container, network, image, share
or dataset is modified — that is a stop criterion, not an aspiration.

## 2. Backups

### Pre-install (Phase 3 step 1)

`/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/pre_phase3_install_<UTC>/` containing a
full `git archive` of HEAD, the image and container inventories, and a self-verifying
`SHA256SUMS.txt`.

### Ongoing workspace backup

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
BK=/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/workspace_$TS
mkdir -p "$BK"
docker stop noesar-evolution                     # quiesce: JSON data plane, no online snapshot
tar -C /mnt/cachec/NOESAR_EVOLUTION_RUNTIME -cf "$BK/workspace.tar" workspace
docker start noesar-evolution
(cd "$BK" && sha256sum workspace.tar > SHA256SUMS.txt)
```

Stopping first is deliberate: the reference data plane is file-backed JSON with no
snapshot isolation, so a hot copy can capture a half-written state. A few seconds of
downtime buys a restorable backup.

**A backup is only real once `sha256sum -c` passes.** Verify at creation and again
before any restore.

### Retention

Keep the pre-install backup indefinitely, the last 7 workspace backups, and always at
least one verified backup older than the most recent change. Never delete the last
good backup to make room.

## 3. Rollback during installation

| Failing step | Action |
|---|---|
| 1 backup | stop; nothing has changed yet |
| 2 runtime root | `rm -rf` the newly created directory (safe: brand new, nothing else writes there) |
| 3 base image | `docker image rm node:22-bookworm-slim`; nothing else changed |
| 4 build | `docker image rm noesar-evolution:v4-complete`; host untouched |
| 5 network | `docker network rm noesar-evolution-net` |
| 6 run | `docker rm -f noesar-evolution`; optionally remove the runtime root |
| 7 health | keep the container **stopped, not removed**, capture `docker logs --tail 200`, then remove after diagnosis |
| 8 bootstrap | remove the container **and** the workspace — a half-bootstrapped identity store must not be reused |
| 9 verification | full rollback per §4 |

## 4. Full rollback to pre-install state

```bash
BK=/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/pre_phase3_install_<UTC>
(cd "$BK" && sha256sum -c SHA256SUMS.txt) || { echo "BACKUP INVALID - STOP"; exit 1; }

docker rm -f noesar-evolution 2>/dev/null || true
docker network rm noesar-evolution-net 2>/dev/null || true
docker image rm noesar-evolution:v4-complete 2>/dev/null || true
mv /mnt/cachec/NOESAR_EVOLUTION_RUNTIME \
   /mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/quarantined_runtime_$(date -u +%Y%m%dT%H%M%SZ)
git -C /mnt/cachec/NOESAR_EVOLUTION reset --hard <pre-phase-3 commit>
```

**Move the runtime root, never delete it** — it may hold the only copy of state worth
diagnosing. Deletion is a separate, later decision.

**Verify:** container gone, network gone, image gone, runtime root moved aside, git at
the expected commit, working tree clean, and every unrelated container still in exactly
the state recorded in `containers_before.txt`.

## 5. Version rollback (after an update)

Slot model from `docs/UPDATE_MANAGER_DESIGN.md` §2:

```text
stop candidate -> restore previous/ -> restore the workspace backup IF migrations ran
-> start -> health check -> record outcome
```

- If migrations ran, the workspace **must** be restored from the pre-update backup;
  forward migrations are not assumed reversible.
- If they did not, the image swap alone is sufficient and data is untouched.
- `previous/` is never deleted until a new promotion has passed its health check.
- **Automatic** on failed migration, failed candidate health, or failed post-promotion
  verification; also available manually.

## 6. Runtime recovery (watchdog)

Levels 0–5 are defined in `docs/LOGGING_DEBUG_WATCHDOG_DESIGN.md` §4. Recovery-relevant
behaviour:

| Situation | Response |
|---|---|
| Transient component failure | levels 1–2, retry / restart component |
| Process wedged | level 3–4: exit non-zero, Docker `unless-stopped` restarts |
| ≥3 restarts in 10 min | **crash loop** → stop escalating, enter **safe mode** |
| Safe mode | providers/agents/tools disabled; WebUI and audit read-only |
| Post-update failure | triggers the §5 version rollback |

Refusing to restart forever is the important part: a restart loop against a corrupt
data plane destroys more than it repairs. Safe mode preserves the evidence.

## 7. Disaster recovery

Loss of the container or image → rebuild from the repository (§Phase 3 steps 3–6) and
restore the newest verified workspace backup.

Loss of `/mnt/cachec` → the repository is reconstructible from the five sealed archives
(SHA-256 verified, unmodified in `/mnt/user/downloads/NOESAR_EVOLUTION_FINAL`) plus the
Phase-0/1/2 history; workspace state is only as good as the newest off-device backup.

**Known gap, stated plainly:** all backups currently live on `/mnt/cachec`, the same
device as the runtime. That is sufficient for install/update rollback but is **not**
disaster recovery — a device failure loses both. Copying backups to the array
(`/mnt/user/...`) or off-host is a decision for the owner; it is recorded here rather
than silently assumed.

## 8. Verification checklist after any rollback

1. `docker ps -a` matches the pre-change inventory, plus/minus only intended objects.
2. No unrelated container changed state.
3. `git status --porcelain` clean; HEAD at the expected commit.
4. `sha256sum -c MANIFEST.sha256` → 5610/5610.
5. `node tools/test-packaging-filters.mjs` → PASS.
6. Vendor: 113 crates, 5,094 files, 0 missing, 0 corrupt.
7. Outcome recorded in `docs/INSTALLATION_LEDGER.md`, including what failed and why.
