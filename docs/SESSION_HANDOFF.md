# SESSION HANDOFF

**Last updated:** 2026-08-19 · **Phase:** `s345` — `D-0551`/`D-0552`/`D-0553` (after `s344`, `D-0549`) · **COMMITTED, NOT DEPLOYED**
**Plan of record:** `MASTER_PROJECT/` · **Live:** `noesar-evolution:d0544-health-lane-20260818T160214Z` (unchanged by this phase, deliberately)

---

## ➜ LA PROSSIMA AZIONE

**Nothing is pending and nothing is half-built.** The `[UNVERIFIED]` that `s344` closed with —
*"no non-JavaScript implementation has ever run these vectors"* — is now a measurement.

**Three candidates, the Owner chooses:**

1. **`D-0553`, differential fuzz between the two implementations** (this phase's proposal): random
   values with numbers concentrated at the ECMAScript presentation boundaries, encoded by both and
   compared. It removes the limitation named below, which is real and currently open.
2. **`D-0545`, model availability as an observable signal** (open since `s342`).
3. **`D-0550`, the Rust variant** — rejected *for now*, not abandoned; the reasoning is in `D-0551`.

---

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**`conformance/python/` is a second implementation of `VA-012`**, written from `SPEC.md` and **not
translated** from the JavaScript — translating it line by line would have reproduced its
assumptions along with its behaviour and proved nothing. It reads `vectors.json` as data and
checks each case twice: against the exact expected string, and against the SHA-256 of the encoded
bytes, so an implementation that cannot compare strings byte-for-byte can compare digests.

**Python gets these rules wrong by default in six places — measured on `python:3-slim`, offline,
before the implementation was written.** That list is the practical value of `VA-012` to anyone
implementing it, and it is now in the specification:

| Rule | Python's default |
|---|---|
| 2 | `sorted()` orders by **code point**: `Z, é, Ａ, 😀`. The rule requires `Z, é, 😀, Ａ` |
| 4 | `repr(1e-7)` → `1e-07` · `repr(1.0)` → `1.0` · `repr(-0.0)` → `-0.0` |
| 5 | `json.dumps` escapes every non-ASCII character unless `ensure_ascii=False` |
| 5 | with `ensure_ascii=False` it then emits an unpaired surrogate **raw** — not valid UTF-8 |

**The vectors caught two real defects on their first cross-language run.** That is the argument for
having written them, and it is not a hypothetical:

- **the implementation**: delegating strings to `json.dumps` emitted a raw lone surrogate where the
  rule requires `\ud800`. Rule 5 is now written out by hand rather than delegated.
- **the artefact itself** (`D-0552`): the JSON text `-0` parses to negative zero in JavaScript and
  to the **integer `0`** in Python. The sign was lost in the *parser*, before any encoder saw it —
  so the case would have reported a Python failure that was really a reader disagreement, and on a
  reader rounding the other way it would have passed while testing nothing. Written `-0.0`, both
  preserve it.

**Verification, this session:**

```text
python:3-slim, --network none, repo read-only     40/40 checks, CANONICAL_JSON_PYTHON: PASS
node --test packages/.../test/                    39/39 pass
scripts/test.sh                                   14/14 steps PASS, exit 0 (canon-python is new)
tools/run-eslint.sh                               430 files, 0 errors, 0 warnings
```

---

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

**The open limitation, named rather than left for a reader to find.** `VA-012` rule 4 is a general
algorithm and the vector family measures it with **eight** numeric values across three cases.
`1e-6` versus `1e-7` is exactly where the exponential threshold flips, and **neither implementation
is tested there**. Sixteen hand-written vectors prove the two agree on sixteen documents; they do
not prove the rule was implemented. That is `D-0553`, and until it runs, "the two implementations
agree" means *on these cases*, not *in general*.

**Rust was rejected for now, with a reason, and stays open.** `pyrun` already existed; a new crate
would drag in the locked-build and provenance apparatus (`tools/test-rust-build-provenance.py`) for
an artefact that is a test oracle. Python was also the *better* test here — a language whose
defaults are wrong in six places measures more than a second implementation of similar design.

**Not deployed.** A conformance oracle and a test artefact; no route, no runtime path, no markup.

**Portability, checked before closing.** The new step runs through `pyrun`, which prefers a real
`python3` and otherwise uses a disposable `--network none` container with the repository mounted
read-only; where a host has neither, `scripts/test.sh` declares `UNAVAILABLE` — never a silent
skip. Nothing presumes this host. `[VERIFIED]` on this host: no `python3`, `cargo`, `rustc` or `go`
is installed; both `python:3-slim` and `rust:1-bookworm` images are present locally.

**`F-UNIT-FLAKE-001` remains open**, one unexplained occurrence, not reproduced in this phase's
battery either.

**The secret scan was heuristic, and says so** — the gitleaks image is absent and pulling it is a
network action. Manual scan of the changed set: zero credential-shaped matches, no key material.

---

## FILES THIS PHASE CHANGED

```text
NEW  packages/verified-acquisition/conformance/python/canonical_json.py   the second implementation
NEW  packages/verified-acquisition/conformance/python/run_vectors.py      the vector runner
MOD  packages/verified-acquisition/conformance/vectors.json               D-0552, -0 -> -0.0
MOD  packages/verified-acquisition/SPEC.md                                the six divergences
MOD  packages/verified-acquisition/README.md                              where to start
MOD  scripts/test.sh                                                      step canon-python
MOD  docs/DECISION_LOG.md · PROJECT_STATE.json                            D-0551, D-0552, D-0553
```

---

## OPEN BLOCKERS

`B-002` (stale premise: gitleaks *is* wired, the image is simply absent on this host) and `B-011`
(git history rewritten on the Owner's authorisation, bundle backup taken) — both unchanged. No new
blocker.

---

## THE IMPROVEMENT PROPOSAL — `D-0553`, awaiting the Owner

A differential fuzz between the two implementations: random JSON values, numbers concentrated at
the ECMAScript presentation boundaries (`1e-7`/`1e-6`, `1e20`/`1e21`, `2^53`, denormals, negative
zero), encoded by both and failing on the first disagreement. It is the only thing that turns
"they agree on sixteen documents" into "the rule is implemented". **Funding fit — Restack · traits
5 and 6:** differential testing against a second implementation is the strongest reliability
evidence a format specification can carry, and it is what a reviewer of an interoperability claim
actually looks for.
