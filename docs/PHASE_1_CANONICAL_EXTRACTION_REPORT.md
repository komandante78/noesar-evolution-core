# Phase 1 — Canonical Extraction and Repository Construction: Report

**Phase:** `NOESAR_INSTALLATION_PHASE_1_CANONICAL_EXTRACTION` (1 of 6)
**Result:** `COMPLETED` — canonical repository constructed, with 1 new blocker
recorded (upstream defect, not introduced here).
**Nothing was installed, built, started, or mutated outside `PROJECT_ROOT`.**

---

## 1. Entry state

`PROJECT_STATE.json` read before acting: `current_phase=0`, `next_phase=1`, working
tree clean at `ce34bf4`, all 13 Phase-0 files unmodified.

One nuance recorded rather than glossed: the phase specification expected
`CURRENT_PHASE=0_COMPLETED`, while the state file said
`phase_status=COMPLETE_WITH_BLOCKER`. These are substantively the same — both
Phase-0 blockers carry `blocks_phase_1: false`, and that status is exactly what
Phase 0's own specification prescribed when `gh` is absent. Proceeding was
therefore correct; stopping on a label difference would have been over-literal.

## 2. Archive verification and safe extraction

All five archives were re-verified **by SHA-256, not by name** (all carry a ` (2)`
suffix). 5/5 matched. Pre-extraction safety on every archive:

| Check | Result |
|---|---|
| `unzip -t` | PASS ×5 |
| absolute paths / `../` traversal | 0 / 0 |
| symlinks, devices, FIFOs, sockets | 0 |
| nested archives | 0 |
| case-insensitive collisions | 0 |
| single internal root directory | confirmed ×5 |

Extracted to `$STAGING/PHASE_1/{01_SOURCE,02_RUNTIME,03_SDK,04_SECURITY,05_OPERATIONS}`
— 6,305 files, reconciling exactly with ZIP entry counts, 0 non-regular files on
disk afterwards. Never extracted into the Git root.

## 3. Independent integrity evidence

| Verification | Result |
|---|---|
| Per-package `SHA256SUMS.txt` (all five) | **6,300 / 6,300 OK** |
| Product `MANIFEST.sha256` against repo root | **5,606 / 5,606 OK** |
| Vendored crates vs `.cargo-checksum.json` | **5,090 OK, 0 corrupt, 4 missing** |
| `rust/Cargo.lock` vs delivered provenance hash | **match** |

The product manifest passing at repository root is independent proof that the
canonical placement is right: its paths are product-relative and every one resolves.

## 4. Canonical construction

Package 01's `SOURCE/PRODUCT/` became the repository root — **no artificial wrapper
directory**. Packages 02–05 contributed role material only.

| Outcome over 6,305 file instances | Count |
|---|---|
| Files imported per package (01 / 02 / 03 / 04 / 05) | 5,663 / 134 / 176 / 129 / 203 |
| Unique canonical destinations written | **5,989** |
| Identical duplicates collapsed (`SAME_PATH_SAME_HASH`) | **281 destinations** |
| Differing paths (`SAME_PATH_DIFFERENT_HASH`) | **4 — all explicitly resolved** |
| Excluded from Git (compiled binaries) | 5 → `$ARTIFACT_ROOT` |
| **Unmapped** (would have been silently dropped) | **0** |
| **Collisions with Phase-0 protected paths** | **0** |

All 13 Phase-0 files were byte-compared against a pre-merge backup afterwards:
unchanged. No file was silently chosen over a different file — every conflict is in
`docs/PATH_CONFLICTS.tsv` with analysis, resolution and evidence.

### The four genuine conflicts

1. **`DOCUMENTATION/FOSS_SCOPE.md`** — four *different role-scoped documents*, not
   versions of one file. All four preserved; 03/04/05 renamed with role suffixes.
2. **`DOCUMENTATION/CURRENT_RELEASE_STATUS.md`** — 01 is a packaging/delivery
   status, 02–05 are a feature matrix. Complementary; both preserved (01 becomes
   `COMPLETE_PRODUCT_DELIVERY_STATUS.md`). Both assert `PRODUCTION_READY=false`.
3. **`LICENSES/README.md`** and 4. **`README.md`** — caused by *this phase's own*
   initial mapping collapsing each package envelope onto the product tree. Fixed:
   envelopes now live under `provenance/package-0N/`. The product `MANIFEST.sha256`
   independently confirms the retained variants are the correct ones.

## 5. Defects found

### FIXED_IN_PHASE_1 — the Phase-0 `.gitignore` was silently deleting source

Written blind in Phase 0, before any product was visible, it used un-anchored
directory patterns. Against the real tree it excluded **real source**:

- `rust/.cargo/config.toml` — the *vendoring configuration*; without it cargo
  ignores `vendor/` entirely and tries to reach the network. The delivered
  `BUILD_ARTIFACTS.tsv` lists this file as a required artefact.
- `rust/vendor/rustversion-1.0.23/build/*.rs`,
  `rust/vendor/wasm-bindgen-0.2.126/src/cache/*.rs`,
  `rust/vendor/tracing-0.1.44/test-macros/bin/*.sh`,
  `capabilities/reference/bin/*.py` — source directories that merely *happen* to be
  named `build/`, `cache/`, `bin/`.
- `capabilities/examples/packages/noesar.foundation-public.pem` — a **public**
  Ed25519 key required by the signature-verification examples.

Fixed by anchoring build patterns to the repository root, removing the `.cargo/`
rule in favour of `**/.cargo/credentials*`, and negating `*public*.pem`. Verified
afterwards: the product contains **zero private-key material**.

### DEFERRED_TO_PHASE_2 — policy vs vendor completeness

Four compiled files in `wit-bindgen-0.57.1` (`.a`, 2×`.o`, `.wasm`) are listed in
cargo's checksum manifest but are binaries, which `CLAUDE10.md` §33 forbids.
Excluded from Git, **preserved byte-identical** in
`$ARTIFACT_ROOT/vendor-binary-fragments/` with checksums and a restore procedure.
Low practical impact: reachable only via `wasip2`, not built for linux-x86_64.

### B-003, DEFERRED_TO_PHASE_2 — the delivery is missing 4 upstream source files

`rust/vendor/cc-1.3.0/src/target.rs` declares `mod apple; mod generated; mod llvm;
mod parser;` and **none of the four files ship in any archive**. The packaging
filter that strips Rust build output (`target/`) also stripped a legitimate source
directory — there are **zero** `/target/` paths anywhere in the ZIP.

This contradicts two of the delivery's own claims: the recorded
`vendorManifestAggregate` counts 5,207 vendor files where 5,203 ship, and the
`B001 closure evidence` asserts a "complete vendor snapshot".

**Not fixed, deliberately.** Recreating upstream source would mean fabricating
content, which is forbidden. Impact is bounded: `cc` is reachable only through
`iana-time-zone-haiku` (Haiku OS) and is not compiled on linux-x86_64. Phase 2 must
choose between re-vendoring from crates.io, obtaining a corrected archive, or
accepting the gap with the platform restriction documented.

### DEFERRED_TO_PHASE_5 — documentation accuracy

The retained root `README.md` claims "JavaScript/ESM syntax: 57 files PASS" (the
02 variant said 59). The canonical merged repository actually has **87** non-vendor
JS/MJS files, all passing. The claim is stale; product documentation was not
rewritten in Phase 1.

## 6. Static checks

| Check | Result |
|---|---|
| JSON parse (non-vendor) | **121 / 121 valid** |
| Shell `bash -n` | **46 / 46 clean** |
| JavaScript/ESM `node --check` (non-vendor) | **87 / 87 clean** |
| Product `MANIFEST.sha256` | **5,606 / 5,606 OK** |
| Nested archives in repository | **0** |
| Old-workspace absolute paths (`/home`, `/Users`) | **0** |
| `PREVIEW/DRAFT/SKELETON/RELEASE_CANDIDATE = true` assertions | **0** |
| Product blocker `B001` still open | **no** — closure evidence present |
| `.gitignore` effective | verified; only 4 intended exclusions remain |

No build, compile, or installation was performed.

## 7. Secret scan

`gitleaks` and `trufflehog` remain unavailable (blocker B-002), so the scan is
**heuristic and declared as such**. Over the staged set of 5,984 files:

| Pattern | Result |
|---|---|
| private key / certificate blocks | **0** |
| provider token shapes (`ghp_`, `sk-`, `xox*`, `AKIA`, `AIza`) | **0** |
| credential-bearing URLs | **0** |
| credential keyword → quoted value | 2 hits, both benign |

The 2 hits are the xkcd passphrase `correct horse battery staple` in
`tools/auth-http-smoke.mjs`, a deliberate smoke-test fixture. Independently
confirmed: **zero** private-key material anywhere in the product; the single `.pem`
is a public key.

Forbidden-artefact check on the staged set: **0** archives, **0** `.env`, **0**
databases, **0** shared libraries, **0** ELF executables. The 29 remaining non-text
files are 3 product design PNGs, 1 vendor SVG icon and 25 crypto test-vector
fixtures — none in a prohibited category.

## 8. ATOM boundary

**PASS.** No proprietary ATOM implementation in any package. The only genuine ATOM
artefacts are a public JSON-Schema contract (`private-boundary/atom-provider.schema.json`)
and boundary documentation. `atomic-store.mjs` is a false positive (*atomic*, not
ATOM). No quarantine was required. Full detail in `docs/ATOM_BOUNDARY_AUDIT.md`.

`FOSS_CORE_MUST_REMAIN_AUTONOMOUS` holds **by design** — the core ships a functional
`ReferenceReasoningProvider` — but remains `[UNVERIFIED]` until the Phase-4
ATOM-absent acceptance run, as required.

## 9. Licensing

Inventory only; **nothing was relicensed**. 113 vendored crates, **all permissive**
(73 `MIT OR Apache-2.0`, 19 `MIT`, …), **zero copyleft-only** dependencies. Nothing
in the dependency tree is known to block the proposed `AGPL-3.0-or-later` core.

Gap: **no first-party component declares a licence** (12 crates + 2 Node packages),
there is no root `LICENSE` file, and 86 first-party sources lack SPDX headers.
Verdict in `docs/DUAL_LICENSE_READINESS.md`: **NOT READY**, no blocking obstacle.

The delivered product's own licensing matrix independently matches the Phase-0
proposal (AGPL core + commercial, Apache-2.0 SDK, CC-BY-SA-4.0 docs, ATOM private).

## 10. State at exit

```json
{ "current_phase": 1, "phase_status": "COMPLETED", "next_phase": 2,
  "canonical_repository_constructed": true,
  "installation_complete": false, "production_ready": false }
```

Open blockers: **B-001** (no GitHub remote — `gh` absent), **B-002** (heuristic
secret scanning only), **B-003** (new: `cc-1.3.0` missing 4 upstream files).
None blocks Phase 2.

**Phase 2 was not started.**
