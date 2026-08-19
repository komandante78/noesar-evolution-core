# SESSION HANDOFF

**Phase:** `G-02` — `D-0559` (work), `D-0560` (proposal, saved not executed).
**Commit:** `d07c69b`, pushed to `origin/main`. **Nothing was deployed.**
**Live installation:** unchanged — `noesar-evolution:d0544-health-lane-20260818T160214Z`,
`running`/`healthy`, `RestartCount=0`, `/livez` and `/readyz` **200** on HTTP `:8100` and
HTTPS `:8443`, verified after cleanup.

## ➜ LA PROSSIMA AZIONE

**The 15 CRITICAL acceptance criteria that carry no recorded verdict (`G-01`), `CE-001` first**
— *nessun percorso muta il workspace senza spendere un token coniato da un Piano autorizzato*,
the product's central security claim, with no verdict recorded anywhere.

`node tools/verify-acceptance-matrix.mjs` prints the list and holds the ratchet: 53 criteria,
17 with a verdict, 36 without, 15 of those critical. It never decides that a criterion passes —
status is read from the owning document. Closing one means **producing the evidence** and
recording the verdict where the criterion lives, not editing the projection.

Owner instruction, 2026-08-19: proceed toward FINISHED **without asking** which improvement to
build. Proposals are saved, not executed.

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`oci/Dockerfile` builds, and the question came back inverted: the recipe is faithful and the
RUNNING IMAGE is what drifted.** It is the only build recipe that travels in the delivery
archives and it had never been built once.

| Measured | Result |
|---|---|
| `docker build --no-cache -f oci/Dockerfile` | **exit 0** · 27 crates compiled offline from `rust/vendor` · `postgres (PostgreSQL) 18.4 (Debian 18.4-1.pgdg12+1)` printed **inside** the build · ~40 s cold |
| two independent builds (cached vs `--no-cache`) | **byte-identical over 437 files**, both Rust binaries included |
| repaired image ↔ working tree | **436 / 436** byte-equal · 0 differing · 0 absent from tree |
| repaired image ↔ live image, runtime configuration | **identical**: Env, Entrypoint, Cmd, User, WorkingDir, ExposedPorts, Volumes, Healthcheck |
| world-writable paths in the repaired image | **0** (was: the whole application) |

**Two defects the measurement found, repaired in the recipe:**

1. **`schemas/model-descriptor.schema.json` was never copied.** The live image has it — an
   overlay added it after the fold — and the canonical file did not. Invisible to everything:
   the runtime validator implements the schema's keywords in code and never reads the file, so
   no test failed and no container misbehaved. Only comparing the two images could see it.
2. **File modes were inherited from the build host.** `COPY` preserves the source mode, and the
   share this project is built on gives every file `666` and every script `777` — so the **live
   image ships the application world-writable**, and two acceptance scripts world-writable *and*
   world-executable. The documented `--read-only` root filesystem is the only thing that has
   been standing between that and a container process rewriting the product's own source, and
   nothing anywhere said so. It is also why two builds of one commit on two machines produce
   different images. Now normalised in the image (`0755` dirs, `0755` executables, `0644` the
   rest, keeping the one bit git tracks) and asserted with `test … -perm -o+w … = 0`.

**The instrument, and the gate.** `tools/verify-image-provenance.sh` compares application bytes,
modes and symlinks, runtime configuration, and tree↔image. `tools/deploy/redeploy.sh` now runs
it in **preflight** whenever `--image` is given, and refuses a target that does not match the
tree. `CLAUDE10.md` §3a 11c was being satisfied by hand **at the scope of the overlay** — the
`d0544` ledger entry records "byte-equal tree↔image 3/3" because that overlay copied three files.

**Verification produced this session:** unit **2686 pass / 0 fail / 1 skipped**;
`SOURCE_VERIFY=PASS migrations=19 baseline=12/12`; redeploy fixture **73/73**, its 3 new
assertions **seen to fail** on the pre-change file; the provenance gate **seen to fire** (refuses
the live image, 15 differing; passes the built one, 436/436); ESLint **433 files, 0 errors**
(pre-commit hook); packaging/installer suites **3/3**; shellcheck via a disposable offline
container.

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **Nothing was deployed.** The nine stale files in the running image are 8 test files plus the
  `scripts` block of `package.json` — **no runtime module is stale**, path by path, so this is
  not a blocking defect, and deployment is a stop condition (§77), not a phase's own call.
- **`F-IMAGE-STALE-001` stays open** (new, low). It closes at the next deployment, which the new
  gate now measures for the first time.
- **The image was never started.** Every read of it was `docker run --rm --network none` with an
  explicit `/bin/sh` entrypoint, so the supervisor never ran. That the **repaired** image boots
  and serves is therefore `[UNVERIFIED]` — the deployment that closes `F-IMAGE-STALE-001` is
  what will establish it.
- **The secret scan was HEURISTIC**, declared as such: `tools/run-secret-scan.sh` reported
  `SECRET_SCAN=SKIPPED reason=image-absent` for `zricethezav/gitleaks:latest`, and rule 45
  forbids installing tooling to satisfy the rule. Pattern scan of the staged diff: no key,
  token, password or credential-bearing string; no archive, binary, database or `.env` staged.
- **T2/T3 were not run.** No JavaScript, no route, no DOM and no migration changed; the change
  map's targeted tier is what ran. Declared, not implied.
- **Dismissed with evidence during HUNT AND FIX** (scoped to the diff, 4 files): `SC1007` on
  `CDPATH= cd` — the idiom every shipped script here uses, already named as a known false
  positive by the phase skill; `SC2034 ROLLED_BACK` in `redeploy.sh` — a real dead assignment,
  pre-existing and outside this diff's cause, with no behavioural effect because `rollback()`'s
  contract is its return code. Left alone rather than edited into the rollback path for style.
- **87 overlay files remain in `oci/`.** Retiring them as the deployment mechanism is `D-0560`,
  proposed, not executed; deleting them is forbidden (§12) and undesirable — they are the only
  written record of how the running image came to hold what it holds.

## FILES THIS PHASE CHANGED

```text
oci/Dockerfile                          + the missing schema COPY, + mode normalisation
tools/verify-image-provenance.sh        NEW — the instrument (203 lines)
tools/deploy/redeploy.sh                + the preflight provenance gate
tools/deploy/test/redeploy-fixture.sh   + section 10, 3 static assertions on the gate
MANIFEST.sha256                         oci/Dockerfile hash refreshed (line 341)
docs/GAP_REGISTER.md                    G-02 closed; F-IMAGE-STALE-001 added
docs/DECISION_LOG.md                    D-0559, D-0560
docs/INSTALLATION_LEDGER.md             the NOT-DEPLOYED entry, with what it corrects above it
PROJECT_STATE.json                      live keys + the new open finding
EVIDENCE/g02_*.txt                       the four measurement records
```

## SESSION CLOSE — `CLAUDE10.md` §5a, run in full

Inventory: `EVIDENCE/docker_inventory_pre_cleanup_G02_20260819T063134Z.txt`.
Three throwaway tags created this phase (`g02-provenance`, `g02-nocache`, `g02-fixed`) removed
by name; no target was `Up`; every analysis container was `docker run --rm`, so none survived to
be removed. **Containers 52 → 52 · volumes 65 → 65 · networks 10 → 10.** No `prune` of any kind.
Product proven healthy afterwards (`running`/`healthy`, four `200`s).

## THE IMPROVEMENT PROPOSAL — `D-0560`, **saved, not offered**

Build every future image from the canonical `oci/Dockerfile` instead of an 88th overlay, so an
installation is a **tree state** rather than an accumulation nobody can name. It is now cheap
(~40 s cold) and proven. Cost: a full build per deployment instead of a thin layer.
**Funding fit: Restack · trait 5** — an image whose contents are a function of a commit is
auditable; one whose contents are a function of its build order is not.

## OPEN BLOCKERS

`B-002` stale-premise (the secret-scan premise is false as written) and `B-011` low-deferred
(history rewrite, 2026-07-30, Owner-authorised, bundle backup taken). Neither blocks the next
action. `production_ready` stays **false**, correctly.
