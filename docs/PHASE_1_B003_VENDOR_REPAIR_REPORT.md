# Phase 1 — B-003 Vendor Repair Report

**Phase:** `NOESAR_PHASE_1_B003_VENDOR_REPAIR`
**Result:** **REPAIRED AND VERIFIED.** `B-003 = CLOSED`, `B001 = CLOSED`.
**Network used: NO.** **Phase 2 not started.**

---

## 1. What was broken

`rust/vendor/cc-1.3.0/src/target.rs` declares `mod apple; mod generated; mod llvm;
mod parser;`. All four module files were absent from every one of the five delivered
archives, because the packaging filter that strips Rust build output (`target/`) also
removed a legitimate vendored **source** directory.

## 2. Authoritative recovery — no network

The files were recovered from **two independent copies already present on this
server**, so the authorised temporary network access was **not used at any point**:

| Source | Path |
|---|---|
| **Primary** — the delivery's own build staging, the phase named in its `PROVENANCE.json` | `/mnt/cachec/NOESAR_EVOLUTION_CANONICAL_V1/BUILD_ARTIFACTS/RUST_MANIFEST_REMEDIATION_V1/staging/rust/vendor/cc-1.3.0/` |
| **Corroborating** — the canonical candidate tree | `/mnt/cachec/NOESAR_EVOLUTION_CANONICAL_V1/WORKSPACE/CANONICAL_CANDIDATE_V1/PRODUCT/rust/vendor/cc-1.3.0/` |

The two sources are byte-identical to each other (`diff -rq` → 0 differences).
Nothing was fabricated, hand-written, or taken from an unverified repository.

### Proof the files are the official upstream ones

Each recovered file was hashed and compared to the `.cargo-checksum.json` that
crates.io publishes with the crate:

| File | SHA-256 | vs `.cargo-checksum.json` |
|---|---|---|
| `src/target/apple.rs` | `da9411b2c4db419e0fa39f765ee53b8665b3837fb39827679a53238734a4a1c1` | **MATCH** |
| `src/target/generated.rs` | `74af61aa7b73356d5476b03e646d97105c42d973736b2a20dcc41129b147ce90` | **MATCH** |
| `src/target/llvm.rs` | `06d6351653e23314de3e0ebe3125ddea7a2617303bff639dbbef787b16691e2a` | **MATCH** |
| `src/target/parser.rs` | `26b064a952858635ac38531874c0aa6db2c4a99bef8dd55f36a761370c3ac270` | **MATCH** |

Both independent copies produced these same hashes.

### Package-level verification

| Check | Result |
|---|---|
| Crate version | `cc 1.3.0`, `source = registry+https://github.com/rust-lang/crates.io-index` |
| Package checksum in `.cargo-checksum.json` | `c89588d05638b5b4594a3348a2d6c20277e43a7f5c5202b05cc56888475a47b8` |
| Package checksum in `Cargo.lock` | identical — **MATCH** |
| Whole crate vs its checksum manifest, after repair | **26/26 OK, 0 missing, 0 corrupt** |
| Other files in the crate | `diff -rq` against the authoritative copy shows **only** the missing `src/target` directory — **no unexplained differences** |

Only the four missing official files were promoted. Nothing else in the crate was
touched.

## 3. Filter correction

The same defect existed **in this repository**, not only upstream. Before the fix,
`git check-ignore` confirmed all four restored files were ignored by `.gitignore:31`
(`target/`) — the repair would have sat on disk, never been committed, and a fresh
clone would have reproduced B-003 exactly.

| Location | Before | After |
|---|---|---|
| `.gitignore` | `target/` (matches any depth) | `/target/`, `/rust/target/`, `/rust/*/target/` + explicit negations for `**/vendor/**` |
| `tools/create-rust-build-provenance.py:28` | `and "target" not in path.parts` | `and not is_build_output(path.relative_to(workspace).parts)` |

The Python fix also closes a second latent bug: the old test inspected the
**absolute** path, so a checkout under any directory named `target` would have
excluded the entire tree.

A repository-wide search found **no other** packaging filter with this idiom. The
script that produced the original ZIPs is **not present on this host** — the archives
were built in the delivery author's environment — so it could not be corrected here.
That is recorded as a residual item, not as fixed.

### Regression test — `tools/test-packaging-filters.mjs`

Builds a throwaway fixture and asserts both directions against the **real** rules.
Required cases from the specification included:

```text
rust/target/build-output.bin              -> EXCLUDED   PASS
rust/vendor/example/src/target/source.rs  -> PRESERVED  PASS
```

**19/19 cases pass** — 12 against `.gitignore` via real `git check-ignore`, 7 against
the actual Python predicate (imported and called, not reimplemented). Because
`python3` is absent on this host, the Python half runs inside the pinned
`rust:1-bookworm` container; the test reports `PARTIAL` rather than `PASS` if it
cannot verify that half, so it never silently skips.

## 4. Offline validation

Executed in a **fresh, isolated container** with **no network** (`--network=none`,
`crates.io` confirmed `UNREACHABLE`), an **empty `CARGO_HOME`**, `CARGO_NET_OFFLINE=true`,
and the build directory outside the repository (repo mounted read-only).

The container toolchain is `rustc 1.97.1 (8bab26f4f 2026-07-14)` / `cargo 1.97.1
(c980f4866 2026-06-30)` — **identical to the versions recorded in the delivery's
`PROVENANCE.json`**, and the local `rust:1-bookworm` image digest
`sha256:a0635962c16d…c71d1` **matches the image ID recorded there**.

| Gate | Result |
|---|---|
| `cargo metadata --locked --offline` | **PASS** — 125 packages, 12 workspace members, `cc 1.3.0` present |
| `cargo tree --locked --offline` | **PASS** — 252 lines |
| `cargo test --workspace --locked --offline` | **PASS** — exit 0, **5 passed, 0 failed** across 24 test binaries |
| `cargo build --workspace --release --locked --offline` | **PASS** — exit 0, finished in 9.20s, 0 warnings |
| `noesar-authority-daemon` | built — 944,576 bytes |
| `noesar-control-plane` | built — 1,877,568 bytes |

**Stated plainly:** the Rust test suite is thin — 21 of the 24 test binaries contain
zero tests, and only 5 tests exist in total. `OFFLINE_TESTS=PASS` is therefore a true
but weak signal; the substantial suites in this product are the Node ones (the
delivery records 129/129), which are outside this repair's scope.

`--workspace` is not a valid flag for `cargo metadata` (cargo rejects it); the
specification's exact string could not be used, so the correct equivalent
`cargo metadata --locked --offline` was run, which covers the whole workspace by default.

### `cc` reachability — measured, not assumed

The specification warns not to rely on "Linux does not compile that branch". Both
were checked:

- `cargo tree --locked --offline -i cc` on this platform → *nothing to print* (`cc` is
  not in the host build graph);
- `cargo tree --target x86_64-unknown-haiku -i cc` →
  `cc v1.3.0 ← iana-time-zone-haiku ← iana-time-zone ← chrono ← noesar-audit-ledger / noesar-auth`.

So the platform restriction is now **measured**. It was, however, **not** treated as
sufficient: the crate was fully restored and the whole vendor tree re-verified anyway.

## 5. Vendor completeness

| Check | Before | After |
|---|---|---|
| Vendored crates checked against `.cargo-checksum.json` | 5,090 OK, **4 missing** | **5,094 OK, 0 missing, 0 corrupt** (113 crates) |
| Vendor file count | 5,203 | **5,207** — matches the count in the delivered `PROVENANCE.json` |
| Byte-for-byte vs the authoritative build staging | 4 files short | **identical — `diff -rq` → 0 differences** |
| `rust/.cargo/config.toml` active | yes | yes — proven, since the offline build resolved every dependency from `vendor/` with an empty `CARGO_HOME` and no network |

### The aggregate hash still does not match — and that is upstream

`PROVENANCE.json` records `vendorManifestAggregate = fff87295…`. After repair the
tree recomputes to `2d742b1d…` under the documented method. **Seven** plausible path
conventions were tried; none reproduces the recorded value.

Decisively: the recorded value is **not reproducible from the delivery's own build
staging either** — the same tree this repair restored from, which is byte-identical to
the repaired repository. The recorded aggregate is therefore itself unreliable, and
its mismatch is now provably independent of this repair. A second supporting
discrepancy: the method string claims the digest excludes `vendor/`, but the script
that computes it does not exclude `vendor/` at all.

**No attempt was made to make the number match.** The verifiable evidence is
per-crate cargo checksums (5,094/5,094) plus byte-identity with the authoritative
source.

## 6. Manifest updates

`MANIFEST.sha256` was generated from the **already-damaged** tree: it lists 5,203
vendor files and has **zero** entries for `cc-1.3.0/src/target/`. Two authorised
updates were applied:

| Change | Detail |
|---|---|
| 1 hash corrected | `tools/create-rust-build-provenance.py` — `dfe9c0eb…` → `e530f2cf…` (the file this repair fixed) |
| 4 entries added | the restored `cc-1.3.0/src/target/*.rs`, at their official upstream hashes |

Result: **5,610/5,610 OK, 0 failed** (was 5,606), still plain-sorted, diff of exactly
6 lines. No other manifest entry was touched.

## 7. Backup and rollback

Taken before any mutation, outside Git:

```text
/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/backups/pre_b003_repair_20260725T050034Z/
  tracked_head/      full export of git HEAD 290ed5a (every tracked file)
  cc-1.3.0.before/   the crate exactly as it was, missing src/target/
  SHA256SUMS.txt     6,027 entries — self-verified PASS
  HEAD.txt, git_status.txt, ROLLBACK.md
```

6,034 files, 91 MB. `ROLLBACK.md` carries the exact restore commands.

## 8. Blocker status

| Gate | Result |
|---|---|
| `VENDOR_COMPLETENESS` | **PASS** |
| `CARGO_CHECKSUMS` | **PASS** |
| `OFFLINE_METADATA` | **PASS** |
| `OFFLINE_TREE` | **PASS** |
| `OFFLINE_TESTS` | **PASS** (5 passed / 0 failed — thin suite, see §4) |
| `OFFLINE_RELEASE_BUILD` | **PASS** |
| `PACKAGING_FILTER_REGRESSION` | **PASS** (19/19) |

All seven gates pass:

```text
B001  = CLOSED
B-003 = CLOSED
```

## 9. Residual items — recorded, not fixed here

1. **The upstream packaging script is not on this host.** The ZIPs were built in the
   delivery author's environment; the filter that caused B-003 could not be corrected
   at its origin. Any future archive produced by that pipeline may reintroduce the
   defect. Mitigation: `tools/test-packaging-filters.mjs` and the verification in
   `docs/PACKAGING_FILTER_SAFETY_RULES.md` §4 will detect it.
2. **`vendorManifestAggregate` is not reproducible** by its documented method, and the
   method string disagrees with the code that computes it. Phase 5 should either
   correct the method/record or drop the number.
3. **The Rust test suite is thin** (5 tests). Not a defect introduced here, but it
   means `OFFLINE_TESTS=PASS` carries little assurance on its own.
4. **Release binaries are not bit-identical** to the delivered prebuilt ones
   (944,576 vs 944,488; 1,877,568 vs 1,876,960). Expected — different build paths and
   environment; the build is not claimed to be reproducible bit-for-bit.

## 10. Licensing — unchanged

No licence was applied, altered, or removed. `LICENSE_RELICENSING=false` honoured.
The gaps remain registered exactly as before: 12 first-party Rust crates without a
declared licence, 2 first-party Node packages without one, no root `LICENSE`, 86
first-party sources without an SPDX header. These need a decision by the rights
holder and are not an engineering matter.
