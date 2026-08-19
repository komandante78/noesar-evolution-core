# Gap register — what remains, measured

> **Measured 2026-08-19 (`s346`, `D-0554`). Re-measure before quoting.** Every row below was
> produced by a command recorded beside it, in the session that wrote it. A row older than the
> phase reading it is a claim about the past, not a fact about now — that is the mistake this
> file exists to stop repeating.

**Why this file exists.** The Owner asked what remains to finish the project, and no document
could answer it. All four candidates were stale, and two of them said so about themselves:

| Document | Last measured | Why it could not answer |
|---|---|---|
| `MASTER_PROJECT/09_PIANO.md` §1 | 2026-07-26 | 4 of its 15 rows measured **false** on 2026-08-19 |
| `docs/WORK_PLAN_V5_REWRITE.md` | 2026-08-03 | self-declares *"piano storico, non stato corrente"* |
| `docs/REMAINING_WORK.md` | 2026-07-26 | measures against the **retired V4 ruler** (`D-0219`) |
| `PROJECT_STATE.json` → `deferred_items` | various | two entries measured **false** on 2026-08-19 |

`REMAINING_WORK.md`'s own banner says a live list "now lives in `docs/SESSION_HANDOFF.md`". It
does not: the handoff is capped at 150 lines and describes *the current phase*, by design. That
pointer is corrected to point here.

**This file is NOT the acceptance matrix** — and the matrix exists, contrary to what this very
paragraph said when it was written a day earlier. `docs/WORK_PLAN_V5_REWRITE.md` §5 risk 4 —
*"la riscrittura non ha apparato di accettazione: zero matrici con ID e severità"* — and the
first version of `G-01` repeating it were **both measured false on 2026-08-19** (`D-0556`):
**53 criteria** with id, severity and stated verification method live in four documents of
`MASTER_PROJECT/`, and their own header already says *"ogni riga è verificabile eseguendo, non
leggendo"*.

Two corrections in two days, on the same question, is the argument for `docs/acceptance-matrix.json`
and `tools/verify-acceptance-matrix.mjs`: the matrix is now **read by a machine**, kept in step
with the documents that own it, and its gap is a **number that can only improve** — 36 criteria
with no recorded verdict, 15 of them critical.

---

## 1. The capability measurement, and exactly what it proves

**Method, declared so it can be challenged.** For each capability of `09_PIANO.md` §1, the
module that *owns* it was identified **by name** in `services/reference-control-plane/src/` or
`rust/crates/`, then measured for: size, how many other source files import it (reachability
from the product, not from a test), and how many test files reference it.

**What it proves:** the capability is present, reachable and has tests.
**What it does not prove:** that it is complete or correct. That is the acceptance matrix's job
(`G-01`), and no amount of grep substitutes for it.

**Why the method is stated at all.** The first attempt matched by first `grep` hit and reported
`scim.mjs` as the SAML implementation — a file that names SAML only to explain why SAML is the
one deliberately not attempted. It also reported Emergency Stop as present on the strength of
`safety_interlock: { emergencyStop: false }`, a hardware flag in a module catalogue. A measure
that can do that is not a measure, and the corrected one is the only one recorded here.

| `09_PIANO.md` §1 said (2026-07-26) | Measured 2026-08-19 | Evidence |
|---|---|---|
| `ReasoningProvider` — **zero file** | **present** | `reasoning.mjs`, 356 lines, 5 importers, 3 test files |
| Capability token — **zero file** | **present** | `capability.mjs`, 264 lines, 8 importers, **18** test files |
| Emergency Stop — zero file | **still absent** | no module; the only hit is a hardware `safety_interlock` flag |
| Policy Decision Point / `AI_PROPOSES` | **absent under that name** | `grep AI_PROPOSES` → none; `approval-queue.mjs` (202 lines) carries the approval half |
| Security kernel — *37 lines of path strings* | **superseded** | 20 Rust crates incl. `noesar-security-kernel`, `noesar-authority-daemon`, `noesar-capability`, `noesar-executor`. `authority.mjs` (56 lines) is a **mode selector**, not the kernel |
| Shadow execution — absent | **present** | `shadow.mjs`, 433 lines, 5 importers, 5 test files |
| Contamination / canary / promotion | **partial** | `privacy.mjs` 335 lines, 4 test files; MEVCM as specified not verified here |
| Model Trust Registry — *dead schema* | **wired** | `publisher-registry.mjs` 191 lines + `model-descriptor-authenticity.mjs`; `D-0521`/`D-0536` made a signed descriptor required and an unsigned one unstartable |
| Secret Broker — partial | **present, thin file** | `ai-workspace/credential-vault.mjs` 46 lines, **12** test files |
| Resource Governor — partial | **absent under that name** | `grep resourceGovernor` → none; `isolation.mjs` (174 lines) carries profiles |
| Landlock / seccomp / WASM — absent | **present, host-adaptive** | `isolation.mjs` + `rust/crates/noesar-sandbox`; `ARCH-008` closed by `D-0253` |
| Sector modules — absent | **present** | `sector-modules.mjs`, 535 lines, 7 importers |
| Compliance packs — absent | **present** | `compliance-packs.mjs`, 226 lines, 4 importers |
| Technology Radar — absent | **present** | `technology-radar.mjs`, 216 lines |
| OIDC — zero file | **present** | `oidc.mjs`, 144 lines |
| SCIM — zero file | **present** | `scim.mjs`, 213 lines |
| SAML — zero file | **deliberately not attempted** | stated in `scim.mjs`'s own module comment |
| Post-execution verifier — absent | **present** | `verification.mjs`, 168 lines |
| *(not in that table)* passkey/WebAuthn | **present** | `webauthn.mjs` 251 lines; `auth.mjs:17` imports `verifyAssertion`/`verifyRegistration` |

**`09_PIANO.md` is deliberately NOT edited.** Its SHA-256 still matches
`MASTER_PROJECT/PROVENANCE.sha256` — verified this session — and that intact checksum is what
makes it the plan as delivered. The correction lives here; the plan of record stays as received.

---

## 2. The open register

Ordered by what unblocks what, not by severity.

| id | Gap | Evidence measured 2026-08-19 | Blocks |
|---|---|---|---|
| **G-01** | ~~No acceptance matrix~~ — **CORRECTED 2026-08-19 (`D-0556`), this row was wrong.** 53 criteria with id, severity and stated verification method **do exist**, in 4 documents. What was missing is that **nothing read them**, and that **36 carry no recorded verdict at all — 15 of them CRITICAL**, including `CE-001`, the product's central security claim | `node tools/verify-acceptance-matrix.mjs` → 53 criteria, 17 with a verdict, 36 without, 15 critical unstated. Now a battery step with a ratchet that may only go down | **the 15 critical verdicts** are what block saying "done" |
| **G-02** | ~~`oci/Dockerfile` reproducing the live image is `[UNVERIFIED]`~~ — **CLOSED 2026-08-19 (`D-0559`)**, and the answer inverted the question: the recipe is faithful and **the running image is what drifted**. Two defects repaired in the recipe (a schema never copied; modes inherited from the build host, which is why the live image ships the application **world-writable**) | Built `--no-cache`, **exit 0**; two builds byte-identical over 437 files; **436/436** byte-equal to the tree; runtime configuration **identical** to the live image; `tools/verify-image-provenance.sh` is now a preflight gate and was seen to refuse the live image | ~~delivery ZIPs~~ — **new finding `F-IMAGE-STALE-001`** below |
| **F-IMAGE-STALE-001** | 9 files in the **running** image are older than the tree, because each overlay copies only what its phase touched | 8 test files + `package.json`'s `scripts` block. **No runtime module is stale** — checked path by path, not assumed | nothing today; closed by the next deployment, which the gate now measures |
| **G-03** | Legal / licence / compliance content is not in the tree | `WORK_PLAN_V5_REWRITE.md` §5 risk 5 — in the sealed archives only | phase 7, commercial posture |
| **G-04** | `MANIFEST.sha256` covers 5,898 of 6,646 tracked files; no generator, no verifier step | `F-MANIFEST-001`, medium | integrity claims |
| **G-05** | Emergency Stop (the six-step sequence) absent | §1 above | `09_PIANO` phase 5 |
| **G-06** | 8 of 20 Rust crates carry zero tests; `noesar-auth` holds untested Argon2/TOTP nothing calls | `F-RUST-001`, medium | authority assurance |
| **G-07** | Legacy `#codenPrompt` Enter does not reach `submitCodenPrompt` | `F-COMMAND-001`, medium | — |
| **G-08** | Independent penetration test not performed | scope written: `docs/security/INDEPENDENT_PENTEST_SCOPE.md` | `PRODUCTION_READINESS_V050.md` promotion |
| **G-09** | `CE-015` blocked by Owner choice (needs `EXECUTE`; `D-0253` may have unblocked it) | `WORK_PLAN_V5_REWRITE.md` header note | — |
| **G-10** | 10 low/informational findings open | `PROJECT_STATE.open_findings` | — |

**The product's own declaration, unchanged and correct:** `PROJECT_STATE.json` →
`"production_ready": false`.

---

## 3. How to keep this file honest

1. **Re-measure before quoting.** Every row carries the command that produced it; run it.
2. **A row that changes gets a new date, not an edit in silence.**
3. **Nothing here overrides `PROJECT_STATE.json`.** Blockers and findings live there; this file
   is the *map*, and where the two disagree the state file wins and this one is wrong.
4. **When `G-01` is built, this file becomes its summary, not its rival.** Two registers that
   can disagree are the problem this one was created to fix, one level up.
