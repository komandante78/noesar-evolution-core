# Declared-effect receipts — prototype

**Status: prototype, 2026-09-21.** What exists is described below with the commands that show it.
What does not exist yet is listed at the end, and a receipt says it about itself too.

## The idea

An automated change — `npm install`, a dependency update, a CI script, an AI agent — **states
what it will touch**, runs against a **disposable copy**, and leaves a **signed receipt** with a
verdict a machine can act on without trusting whoever made the change:

| Verdict | Meaning |
|---|---|
| `CLEAN` | it touched only what it declared, and its command succeeded |
| `UNDECLARED_EFFECT` | it touched something it did not declare |
| `DECLARED_FAILED` | the command it declared failed |
| `NOT_MEASURED` | nothing could be observed — never counted as clean |

The real directory is never written. The receipt is an [in-toto Statement v1](https://github.com/in-toto/attestation)
inside a [DSSE](https://github.com/secure-systems-lab/dsse) envelope signed with Ed25519, so it can
be checked with the public key alone. The verifier **recomputes the verdict from the recorded
evidence**: a correctly signed receipt whose verdict does not follow from its own evidence is
refused.

It is not new machinery. The copy and the observation are `ShadowWorkspace`, and the comparison is
`compare()` in `services/reference-control-plane/src/shadow.mjs` — the code this product already
uses to refuse a plan whose effects were not the declared ones, with a second implementation in
`rust/crates/noesar-shadow` held to the same vectors (`conformance/shadow-vectors.json`).

## Try it

Needs Node.js 22 and Docker. The command runs in `node:22-bookworm-slim`, pinned by digest,
with no network unless `--network` says otherwise.

```sh
node tools/effect-receipt.mjs keygen --out ./receipt-key
node tools/effect-receipt.mjs run --workspace ./app \
  --declare node_modules/ --declare package.json --declare package-lock.json --declare '~/.npm/' \
  --key ./receipt-key.pem --out receipt.json -- npm install --offline ./some-package.tgz
node tools/effect-receipt.mjs verify --in receipt.json --pub ./receipt-key.pub.pem
```

A declaration ending in `/` is a prefix; anything else is one exact path; `~/` is the HOME the
command saw, which lives inside the copy. `run` exits `0` only on `CLEAN`, so it can gate a pipeline.

**Measured 2026-09-21**, three local packages installed with `--network=none`:

| Package | Verdict |
|---|---|
| a plain package | `CLEAN` — 9 files, all inside the declaration |
| a package whose `postinstall` appends a key to `~/.ssh/authorized_keys` | `UNDECLARED_EFFECT: ~/.ssh/authorized_keys (CREATED)` |
| a tarball that does not exist | `DECLARED_FAILED` |

In all three the real directory was unchanged, and each receipt verified with the public key.

## What a receipt does not cover — yet

Written into every receipt under `notMeasured`, not only here:

- **network traffic**, when the network was reachable (with `--network=none` it was denied, not measured);
- **files written elsewhere in the container** — outside the workspace copy and its HOME, discarded unobserved;
- **processes started and system calls made**.

Not built: a published predicate specification, verifiers in other languages, runners other than
Docker, and observation of the network and of system calls.

Tests: `services/reference-control-plane/test/effect-receipt.test.mjs`.
