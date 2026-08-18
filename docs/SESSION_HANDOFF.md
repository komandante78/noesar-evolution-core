# SESSION HANDOFF

**Last updated:** 2026-08-18 · **Phase:** `s339` — `D-0526`…`D-0533` · **COMMITTED, NOT PUSHED, NOT DEPLOYED**
**Plan of record:** `MASTER_PROJECT/` · **Head:** `cb01846` (1 ahead of `origin/main`) · **Live:** `noesar-evolution:d0523-descriptor-signing-20260818T060209Z` (still `s338`)

---

## ➜ LA PROSSIMA AZIONE

**The Owner authorised the commit** («poi fai commit») and only that was done. Two things wait on
a further word:

1. **Push** — nothing has left this machine.
2. **Deploy** of the `D-0526` half. The overlay **must copy `packages/verified-acquisition/`** or
   the server throws on its first import — see below.

**`D-0528` is governance-only and could be committed on its own** — it touches no product code:
the funding skill now names six platforms with their URLs, their licence terms and the date each
was read, because the version written on 2026-08-14 described a programme that had closed on
2026-06-01. **NGI Zero has concluded**; the target is **Restack** when its call reopens after
summer 2026.

**Read this before deploying — it is why this deployment is not routine.** The control plane now
imports from `packages/`, which the base image did **not** copy. That is repaired in
`oci/Dockerfile`, and `tui-import-closure.test.mjs` now proves it by walking the server's own
import graph. **An overlay Dockerfile for this phase must copy `packages/verified-acquisition/`
too** — an overlay copying only the changed `services/` files would ship a server that throws on
its first import and restart-loops.

**Then, on a new instruction: the `/model` chain** («poi vai avanti con /model»). Not started —
rule 9. Its first measurement, before any code: *can a local inference runtime exist on this host
without a host-level change?* (platform law §60-64). `NOESAR_LOCAL_MODEL_RUNTIME` is `disabled` on
the container, no model artefact is on disk, no runtime binary is in the image.

---

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`packages/verified-acquisition/` exists as a component another project could adopt**, and the
product consumes it rather than a copy of it.

| | |
|---|---|
| one implementation, not two | the three former paths in `services/…/src/` are **re-export shims**. Nothing deleted (rule 12), originals backed up (rule 22), and the nine callers of `canonical-json.mjs` are untouched |
| a versioned contract | `CONTRACT_VERSION 1.0.0`, one public entry point, a **frozen** `REFUSALS` list so a consumer can assert it handles every refusal |
| self-contained | its imports reach **nothing outside itself** — measured: `node:crypto`, `node:fs`, `node:url`, `node:test`, `node:assert` and its own files |
| the suite is the specification | `conformance/index.mjs` imports **no test runner** and returns a plain report; the origin-policy half is declarative JSON a non-JavaScript runtime can execute |
| the suite has been seen to fail | it is run against **broken** implementations — missing function, permissive origin policy, ignored byte cap — because a suite never seen to fail has not been shown to measure anything |
| it is inside a gate | added to `npm test` **and** the pre-commit hook. A conformance suite no gate runs is one that rots |

**Two defects found in this diff and repaired at the rule, not the instance:**

1. **`oci/Dockerfile` did not copy `packages/`.** The shipped server would have thrown on its
   first import — a container that starts, fails and restarts for ever. The `COPY` line is the
   instance; the rule is that `tui-import-closure.test.mjs` now walks **the server's** import
   graph, not only the shell's. **The oracle was proven to fire**: with the `COPY` line removed in
   memory, the package resolves to `null` — the exact failure the test reports.
2. **The closure walker read comments as code.** `repo-map.mjs` documents `import … from './x'` in
   prose, and the walker went looking for a file named `x`. It failed loudly by luck; a comment
   naming a path that *exists* would have demanded a `COPY` for a file nothing imports. Comments
   are stripped before matching now.

**Evidence, produced this session:**

- `npm test` → **2623 tests, 2622 pass, 0 fail, 1 skipped** (+9 from the package).
- `node tools/model-acquisition-e2e.mjs` → **`PASS`, 33/33** — the whole signed chain still works
  through the shims, against the real control plane.
- `bash tools/run-eslint.sh` → **0 errors, 0 warnings, 424 files**.
- `node tools/verify-source.mjs` → `SOURCE_VERIFY=PASS`.

---

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **Not committed, not pushed, not deployed.** The installation still serves `s338`.
- **No overlay Dockerfile was written for this phase.** It must copy `packages/verified-acquisition/`
  — see the warning above. Writing it belongs to the deployment, not to this build.
- **Publication is not done and was not decided.** The package is in no registry, and rule 35 keeps
  the repository private until an explicit recorded decision.
- **The licence question is open, not settled.** The package carries `AGPL-3.0-or-later` because the
  code does; whether a component meant for adoption should be more permissive — the sibling
  `@noesar/sdk` is Apache-2.0 — is the Owner's call and was **not** taken here.
- **Some in-file commentary still cites this project's decision records** (`D-05xx`, `MC-00x`).
  Honest provenance, not a dependency: nothing in the code reads them. A publish-ready pass would
  neutralise the prose.
- **The browser suite was not re-run** — `[UNVERIFIED]`, low risk: this phase changed no markup and
  no browser JavaScript. It runs with the deployment.
- **`F-MODEL-AUTH-001`** unchanged: authenticity gates acquiring, not starting, and neither shell
  displays it.
- **No delete route, no discovery, no download resume, no quarantine retention, `MANIFEST` not
  regenerated.** Unchanged.
- **`gitleaks` is absent.** The secret scan was **heuristic** and is declared as such.

---

## FILES THIS PHASE CHANGED

| File | What |
|---|---|
| `packages/verified-acquisition/` | **new** — `package.json`, `README.md`, `LICENSE`, `src/{index,transport,authenticity,canonical-json}.mjs`, `conformance/{index.mjs,vectors.json}`, `test/conformance.test.mjs` |
| `services/…/src/{model-transport,model-descriptor-authenticity,canonical-json}.mjs` | **re-export shims**, each stating where the implementation went and why the path stays |
| `oci/Dockerfile` | copies `packages/verified-acquisition/` — without it the server throws on its first import |
| `services/…/test/tui-import-closure.test.mjs` | walks the **server's** import graph too; strips comments so prose is not read as code |
| `.githooks/pre-commit`, `package.json` | the package suite is inside the gate |
| `.claude/skills/noesar-evolution-funding-fit/SKILL.md` | rewritten (`D-0528`): six named platforms with URLs, the licence requirement of each, the geography that disqualifies, and **the date every row was read** |
| `.claude/hooks/lib/container-baseline.sh` | (`D-0530`) the exemption states §21b directly — exactly two survivors — and the scope pattern accepts the **dot** separator this project actually uses for probes |
| `.claude/hooks/test/test-container-baseline.sh` | 4 new fixtures: two deployments in one session · two rollbacks block · a rollback with no installation blocks · a probe beside the two permitted survivors still blocks |
| `.claude/skills/noesar-evolution{,-budget}/SKILL.md` | (`D-0531`) the improvement proposal must name its funding platform and trait; **"fits none" is a valid written answer** |
| `packages/verified-acquisition/SPEC.md` | **new** (`D-0533`) — eleven normative requirements `VA-001`…`VA-011`, each naming the case family that measures it; traceability enforced in both directions |
| `packages/verified-acquisition/conformance/vectors.json` | 8 fixed ed25519 authenticity vectors, **public material only** — another language can be measured against the same bytes |
| `docs/DECISION_LOG.md` | `D-0526`…`D-0533` |
| `BACKUPS/d0524_extraction_20260818T073509Z/` | the three originals, before the shims replaced them |

---

## OPEN BLOCKERS

- `B-002` **stale premise** (`D-0257`): re-measured — `gitleaks` is genuinely absent.
- `B-011` low, deferred (`D-0258`): history rewritten on the Owner's explicit authorisation.

---

## THE IMPROVEMENT PROPOSAL — `D-0532`, awaiting the Owner

`D-0527` and `D-0529` were authorised and are **executed**, as `D-0530` and `D-0531`.

**`D-0532`:** make the conformance suite publishable **on its own** — vectors, runner and a short
specification — so another project can adopt the *guarantees* without adopting this
implementation. **Funding fit: Restack · traits 1, 2 and 5** — a delimited result, reusable by
construction, with reliability that is measured rather than asserted; and it is what NLnet's own
eligibility page funds in as many words («technical validation … testing infrastructure …
standards participation»).
