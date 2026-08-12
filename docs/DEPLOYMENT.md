# Deployment — the §3a sequence, as a tool

`CLAUDE10.md` §3a describes how this product is replaced on a live installation. It used to be
prose, performed by hand. It is now `tools/deploy/redeploy.sh`, and this file is what an operator
reads before running it.

## What it is for

Replacing the running container with one derived **from the container it replaces**, changing only
what was explicitly asked for:

| Change | Command |
|---|---|
| rotate a secret held in the environment | `--rotate-secret VAR[,VAR…]` |
| move to another image already on disk | `--image TAG` |
| both at once | give both flags |

It never builds, never pulls, never pushes, and decides nothing.

## How to run it

```sh
# 1. Always first. Read-only: no value generated, no file written, no container touched.
tools/deploy/redeploy.sh --source noesar-evolution --check

# 2. Only after the check passes, and only with the Owner's authorisation.
tools/deploy/redeploy.sh --source noesar-evolution --apply --authorized-by-owner \
  --rotate-secret ATOM_TOKEN,NOESAR_RUST_REASONING_TOKEN
```

Exit codes are distinct on purpose, so a caller can tell the cases apart:

| | |
|---|---|
| `0` | deployed |
| `1` | preflight refused — nothing was touched |
| `2` | usage, missing authorisation, or a change that changes nothing |
| `5` `6` | the value or the recipe failed its own checks — **before** anything was stopped |
| `7` | a failure before the rename — the installation is stopped, nothing renamed |
| `4` | something failed after the rename and the **rollback was performed** |
| `9` | the rollback itself failed — manual intervention |

## The five properties it guarantees

1. **Every read of the source happens before the first mutation.** Nothing after the rename may
   name the source container.
2. **The creation recipe is proven complete before anything is stopped** — including the two
   settings that live on the container and not in the image, `--stop-timeout` and the log
   rotation, which a naive recreate loses in silence.
3. **From the rename onwards, every failure rolls back**, including one nobody anticipated.
4. **No secret is printed and none travels in `argv`**: values reach Docker through a `0600`
   `--env-file` that a trap shreds. No length and no hash are printed either — a printed hash of a
   secret is a reusable artefact, and a printed length narrows a search.
5. **Nothing presumes a particular host**: no path, no package, no Docker version. Tools are
   detected and their absence is declared (`CLAUDE10.md` §60-64).

## Why properties 1 and 3 exist, in one paragraph

On 2026-08-12 the sequence was performed by hand and stopped production for **43.8 s**
(`D-0390`). A patch written to stop the recreate losing `--stop-timeout` put the reads of that
setting *after* the rename; `docker run` then died with `no such object`, with production already
stopped and renamed. It was `D-0362`'s fault happening a second time for the same structural
reason. Property 1 is that lesson, and the fixture asserts it against the shipped file's own text —
because a read that is not there is never reached, so no runtime test can defend it.

## Testing it

```sh
npm run test:redeploy
```

70 assertions over 9 scenarios against a **fake Docker** with **synthetic** secrets: the check is
read-only, both refusal paths, a two-variable rotation, an image change, an absent image refused
without a pull, three failures before the rename, four failures after it — each rolling back — no
secret in `stdout`/`stderr`/`argv`, temporary files gone on every path, and the static invariants.

The daemon is fake by necessity: the thing under test *stops and replaces the installation*, so
there is no version of "test it for real" that is not a deployment. What that buys is real —
before this tool existed, the fixture caught a defect that would have rolled back a **perfectly
successful** deployment, because `grep -c` exits 1 when it counts zero and the `ERR` trap was
armed.

The fixture proves ordering, cancellation and recovery. It proves **nothing** about Docker itself.

## What it does not do, and you must

- **Acceptance.** The tool proves the container is healthy, the supervised children started and no
  authentication failure was logged. It cannot sign in. Anything that needs a session — that the
  reasoning chain answers, that a page renders — is verified by a person afterwards.
- **Cleanup.** The predecessor is kept as the one rollback `CLAUDE10.md` §21b permits. Removing an
  older one is a separate, named decision.
- **The backup it takes holds whatever the workspace holds**, credentials included. It is written
  `0600` inside a `0700` directory under `BACKUPS/` and is never copied out.
