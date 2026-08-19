# SESSION HANDOFF

**Last updated:** 2026-08-19 · **Phase:** `s344` — `D-0548`/`D-0549`/`D-0550` (after `s343`, `D-0546`) · **COMMITTED, NOT DEPLOYED**
**Plan of record:** `MASTER_PROJECT/` · **Live:** `noesar-evolution:d0544-health-lane-20260818T160214Z` (unchanged by this phase, deliberately)

---

## ➜ LA PROSSIMA AZIONE

**Nothing is pending and nothing is half-built.** `s343` shipped the signing tool; `s344` shipped
the thing that makes the format implementable by someone else — the canonical encoding, stated
normatively and measured byte for byte.

**Two candidates, the Owner chooses:**

1. **`D-0550`, a second-language implementation of `VA-012`** (this phase's proposal): ~150 lines
   of Rust in the existing `rust/crates/`, driven by `vectors.json` and nothing else. It converts
   the claim "any language can be measured against these bytes" from `[UNVERIFIED]` into a fact.
   Every implementation that has ever run these vectors is the one that produced them.
2. **`D-0545`, model availability as an observable signal** (still open from `s342`): emit the
   liveness state into structured telemetry so an operator can alert on "the model has been down
   five minutes" without watching a page. Deliberately not `/readyz`.

---

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

**A requirement that had been written but never measured is now measured.** `SPEC.md` has said
since `v1.0.0` that *"the canonical encoding MUST be deterministic and MUST sort object members"* —
inside `VA-010`, where the traceability test only ever checked requirement **ids**. So the sentence
read as closed while nothing could fail because of it. That is this project's own rule 5: a
criterion no row measures is not closed, however clearly it is written.

**`VA-012`, seven numbered rules and 16 byte-exact vectors.** Each vector carries the input value,
the exact expected string **and its SHA-256**, so an implementation that cannot compare strings
byte-for-byte can compare digests. It is the only family here that needs **no key material, no stub
server and no clock** — which is why it is now the recommended starting point for anyone
implementing the contract.

**The vector that matters most:** member order is by **UTF-16 code units**, so `"Z"` sorts before
`"😀"` (first unit `U+D83D`) which sorts before `"Ａ"` (`U+FF21`). A code-point sort — the natural
one in Rust or Python — puts `"😀"` last and produces different bytes, a signature valid over
something nobody else computes, indistinguishable downstream from tampering.

**`D-0548` — a real defect found while writing the spec, not by a scanner.** `new Date(0)` has no
own enumerable properties, so `canonicalJson` encoded it as `{}`: a publisher writing a timestamp
would have signed an empty object, with a signature that verifies perfectly. Now rejected, along
with `undefined`, `NaN`, `±Infinity`, `bigint` and functions. **Proven not to break any live
caller before it was kept** — all five call sites (`authority-protocol`, `authority-ipc-frame`,
`update-manager`, `context-projector`, `sector-modules`) run through the unit suite: 2639 pass.

**A trap caught in the making.** `JSON.stringify(-0)` emits `0`, so the generated negative-zero
vector was flattened to `0 → "0"` and would have passed while measuring nothing — a green light
earned by not looking. `JSON.parse('-0')` *does* preserve the sign, so the literal is hand-written
and a test asserts it survived any future regeneration.

**`CONTRACT_VERSION` 1.0.0 → 1.1.0.** `VA-001` now requires two more functions and `VA-012` is a
new requirement, so an implementation conforming to `1.0.0` no longer conforms. No `kind` string
and no input shape changed meaning — hence a minor. Left at `1.0.0` it would have been a silent
contract change.

**Verification, this session:**

```text
conformance suite                    59 -> 101 cases (both measured), VA-012 carrying 40
ORACLE: an insertion-order encoder   fails 17 of 101, every failure attributed to VA-012
node --test packages/.../test/       39/39 pass
scripts/test.sh                      13/13 steps PASS, exit 0
tools/run-eslint.sh                  430 files, 0 errors, 0 warnings
unit suite                           2639 pass / 0 fail / 1 skipped
```

---

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

**`[UNVERIFIED]`, and it is the point of `D-0550`: no non-JavaScript implementation has ever run
these vectors.** The suite has been seen to fail a *crippled version of itself* — an encoder using
insertion order, an encoder that coerces — never a genuinely different one. UTF-16 ordering and
ECMAScript number formatting are exactly where another language diverges naturally, and that is
precisely what has not been tested. The claim in `VA-012` is written as a requirement, not as a
measured result, and this handoff says so rather than letting the case count imply otherwise.

**Not deployed.** No runtime behaviour changed for any existing caller: the encoder guard rejects
only values no call site passes (measured), and no route, markup or migration was touched.

**Signing vectors were rejected, not forgotten.** They would need a published private key, against
the vector file's own stated rule that only public material is stored. Encoding is the half that
needs no key — and the half a second implementation must get right first.

**`F-UNIT-FLAKE-001` did not reproduce.** This phase's battery preserved the unit step's full
output, as the finding asks. Still open, still one unexplained occurrence.

**The secret scan was heuristic, and says so** — `tools/run-secret-scan.sh` reports
`SECRET_SCAN=SKIPPED reason=image-absent`; pulling the gitleaks image is a network action. Manual
scan of the eight changed files: zero credential-shaped matches, no key material (the vector file
carries public ed25519 material only, by its own rule), no binary or archive.

---

## FILES THIS PHASE CHANGED

```text
MOD  packages/verified-acquisition/SPEC.md                     VA-012 (new), VA-001 widened, v1.1.0
MOD  packages/verified-acquisition/conformance/vectors.json    canonicalisation: 16 vectors
MOD  packages/verified-acquisition/conformance/index.mjs       the runner block + REQUIREMENTS
MOD  packages/verified-acquisition/test/conformance.test.mjs   2 oracle tests + 2 vector guards
MOD  packages/verified-acquisition/src/canonical-json.mjs      D-0548, the non-plain-object guard
MOD  packages/verified-acquisition/src/index.mjs               CONTRACT_VERSION 1.1.0
MOD  packages/verified-acquisition/package.json · README.md    version, and where to start
MOD  docs/DECISION_LOG.md · PROJECT_STATE.json                 D-0548, D-0549, D-0550
BAK  BACKUPS/vectors.json.<UTC> ×2                             taken before the splice, kept
```

---

## OPEN BLOCKERS

`B-002` (stale premise: gitleaks *is* wired, the image is simply absent on this host) and `B-011`
(git history rewritten on the Owner's authorisation, bundle backup taken) — both unchanged. No new
blocker.

---

## THE IMPROVEMENT PROPOSAL — `D-0550`, awaiting the Owner

A minimal Rust implementation of `VA-012` in `rust/crates/`, driven by `vectors.json` and nothing
else. It is the only thing that turns "portable" from a requirement into a measured fact, and the
two places it would most likely fail — UTF-16 member ordering, ECMAScript number formatting — are
exactly the two the vectors were written to catch and have never caught. **Funding fit — Restack ·
traits 2, 5 and 6:** reusable beyond this product, measurably reliable, and the difference between
publishing a library and publishing a format.
