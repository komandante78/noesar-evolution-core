# NOESAR EVOLUTION — Source Provenance

Where every file in this repository came from, and what was verified about it.
Written in Phase 1. Machine-readable companions: `docs/SOURCE_ARCHIVE_MAP.tsv`,
`docs/PACKAGE_CONTENT_MAPPING.tsv`, `docs/PATH_CONFLICTS.tsv`.

---

## 1. Origin

Every tracked file originates from exactly one of five sealed archives delivered at
`/mnt/user/downloads/NOESAR_EVOLUTION_FINAL`. Nothing in this repository was
authored by the extraction process except the Phase-0 governance files and the
Phase-1 documentation set listed in §7.

Archives were identified **by SHA-256 only**, never by filename — all five carry a
` (2)` duplicate-download suffix that does not match the declared names.

| Role | SHA-256 (abbrev) | Size | Entries |
|---|---|---|---|
| PACKAGE_01_SOURCE | `0b128b16…a033c` | 18,186,438 | 5,663 |
| PACKAGE_02_RUNTIME | `c15193ee…d5ffb` | 1,232,478 | 134 |
| PACKAGE_03_SDK | `e6a68bf1…2de76` | 196,014 | 176 |
| PACKAGE_04_SECURITY | `4ffb0d4f…1ed72` | 160,315 | 129 |
| PACKAGE_05_OPERATIONS | `7a58bdda…424c5` | 1,616,521 | 203 |

All five matched the expected checksums exactly, and matched them a second time at
the start of Phase 1 (the Phase-0 result was not taken on trust).

## 2. Pre-extraction safety

Each archive was inspected **before** being unpacked:

| Check | Result (all five archives) |
|---|---|
| `unzip -t` integrity | PASS |
| Absolute paths (`/…`) | 0 |
| Path traversal (`../`) | 0 |
| Symlinks / devices / FIFOs / sockets | 0 |
| Nested archives | 0 |
| Case-insensitive filename collisions | 0 |
| Single internal root directory | confirmed for each |

Extraction went to `/mnt/cachec/NOESAR_EVOLUTION_STAGING/PHASE_1/<package>/`, one
directory per package, never into the Git root. A post-extraction sweep confirmed
0 non-regular files on disk. 6,305 files were extracted, reconciling exactly with
the sum of ZIP entries.

## 3. Independent integrity evidence

Three independent verifications, all passing:

1. **Per-package manifests** — each archive ships its own `SHA256SUMS.txt`.
   Verified: 5,662 + 133 + 175 + 128 + 202 = **6,300 / 6,300 OK**.
2. **Product manifest** — `MANIFEST.sha256` shipped inside package 01 verifies
   **5,606 / 5,606 OK** against this repository's root. Because its paths are
   product-relative and every one resolves, this is independent proof that the
   canonical placement (product tree at repository root) is correct.
3. **Vendored Rust tree** — every one of the 113 vendored crates was checked
   against its own `.cargo-checksum.json`: **5,090 files verified, 0 corrupt,
   4 missing** (see §6, blocker B-003).

`rust/Cargo.lock` also matches the hash recorded in the vendor's own
`PROVENANCE.json` (`6cbc6d32…`) byte for byte.

## 4. Package metadata consistency

All five packages declare the same `releaseIdentity`
(`NOESAR_EVOLUTION_V4_COMPLETE_AI_WORKSPACE_2026-07-24`) and the same
`sourceHandoffSha256` (`0e410cd4…`), and all five declare:

```text
preview=false  draft=false  skeleton=false  releaseCandidate=false
finalDelivery=true  productionReady=false  targetServerInstallationValidated=false
```

`productionReady=false` is consistent with this project's own state. No package
claims production readiness, and neither does this repository.

## 5. Canonical construction

Package 01 is the authoritative product base: its `SOURCE/PRODUCT/` tree was placed
at the repository root with **no artificial directory level** — the
`NOESAR_EVOLUTION_01_…_V4_FINAL/` wrapper does not appear anywhere.

Packages 02–05 contributed only content additional to, or more specific than, their
role. Their payload roots (`RUNTIME_SOURCE/`, `CAPABILITIES_AND_SDK/`,
`SECURITY_SOURCE/`, `SECURITY_AND_ACCEPTANCE/`, `OPERATIONS/`) map onto the same
product-relative paths; their role material (`INSTALLATION/`, `PROJECT_GOVERNANCE/`,
`RELEASE/`, `FUNDING/`, `MASTER_REFERENCE/`, `EVIDENCE/`) is preserved under its own
top-level name.

Each package's envelope files (`README.md`, `PACKAGE_METADATA.json`,
`CONTENTS_MANIFEST.tsv`, `SHA256SUMS.txt`, `LICENSES/`) are preserved under
`provenance/package-0N/` so the delivery record survives without colliding with the
product's own files.

Outcome over 6,305 file instances:

| Outcome | Count |
|---|---|
| Unique canonical destinations written | 5,989 |
| Identical duplicates collapsed (`SAME_PATH_SAME_HASH`) | 281 destinations |
| Differing paths (`SAME_PATH_DIFFERENT_HASH`) | 4, all explicitly resolved |
| Excluded from Git (compiled binaries) | 5 → `$ARTIFACT_ROOT` |
| Unmapped (would have been silently dropped) | **0** |
| Collisions with Phase-0 protected paths | **0** |

No file was silently chosen over a different file. Every differing path is recorded
in `docs/PATH_CONFLICTS.tsv` with its analysis, resolution and evidence.

## 6. Findings that are not ours

Two integrity issues were found in the delivery itself. Neither was introduced by
this phase, and neither was "fixed" by fabricating content:

- **B-003 — `rust/vendor/cc-1.3.0/src/target/` is missing 4 source files.**
  `src/target.rs` declares `mod apple; mod generated; mod llvm; mod parser;` and all
  four files are absent from every shipped archive. The packaging filter that strips
  Rust build output (`target/`) also stripped this legitimate source directory —
  there are **zero** `/target/` paths anywhere in the ZIP. This contradicts the
  vendor's own `vendorManifestAggregate` (which records 5,207 files where 5,203
  ship) and the `B001 closure evidence` claim of a "complete vendor snapshot".
  Impact is limited: `cc` is reachable only through `iana-time-zone-haiku`, which is
  not built for linux-x86_64.

- **Vendor aggregate hash mismatch.** Recomputing the documented method over the
  shipped tree gives `898f6fbb…` against the recorded `fff87295…`. The delta is
  exactly the 4 files above.

## 7. Files not from the archives

Authored by this project, not by the delivery:

- Phase 0: `CLAUDE.md`, `CLAUDE10.md`, `.claude/skills/noesar-evolution/SKILL.md`,
  `.gitignore`, `PROJECT_STATE.json`, and the governance documents in `docs/`.
- Phase 1: `docs/SOURCE_ARCHIVE_MAP.tsv`, `docs/PACKAGE_CONTENT_MAPPING.tsv`,
  `docs/PATH_CONFLICTS.tsv`, `docs/SOURCE_PROVENANCE.md`,
  `docs/REPOSITORY_LAYOUT.md`, `docs/INSTALLABLE_ARTIFACT_MAP.md`,
  `docs/LICENSE_INVENTORY.tsv`, `docs/THIRD_PARTY_NOTICES_DRAFT.md`,
  `docs/DUAL_LICENSE_READINESS.md`, `docs/ATOM_BOUNDARY_AUDIT.md`,
  `docs/PHASE_1_CANONICAL_EXTRACTION_REPORT.md`.

The original archives were never modified, renamed, or repackaged.
