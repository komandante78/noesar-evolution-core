# NOESAR EVOLUTION — Decision Log

Append-only. Each entry: what was decided, why, what it rules out, and how
reversible it is.

---

## D-0001 — Governance split across `CLAUDE.md` and `CLAUDE10.md`
**Phase:** 0 · **UTC:** 2026-07-25T01:13:11Z · **Status:** adopted

`CLAUDE.md` holds only a short header and `@CLAUDE10.md`. All binding rules live in
`CLAUDE10.md`, which imports the project skill.

*Why:* a single, unambiguous authority file that cannot be diluted by incremental
edits to an entry point. *Reversible:* yes, trivially.

## D-0002 — Rules are scoped exclusively to NOESAR EVOLUTION
**Phase:** 0 · **Status:** adopted

`CLAUDE10.md` applies only to `/mnt/cachec/NOESAR_EVOLUTION` and forbids its own
application to any other project on this host, and equally forbids importing other
projects' conventions into this one.

*Why:* this host carries several unrelated products with their own long-standing
rules; cross-contamination in either direction is a real and previously observed
failure mode. *Reversible:* yes, but should not be.

## D-0003 — Source archives verified but not renamed
**Phase:** 0 · **Status:** adopted

All five archives carry a ` (2)` duplicate-download suffix. Checksums match the
expected values exactly, so content is correct. The files were left untouched.

*Why:* renaming is a mutation of files outside `PROJECT_ROOT` and outside the Phase 0
scope. Content correctness is established by checksum, not by filename.
*Consequence:* Phase 1 must match archives by glob or receive an explicit rename
instruction. *Reversible:* yes.

## D-0004 — Heuristic secret scan, declared as heuristic
**Phase:** 0 · **Status:** adopted

`gitleaks` is not installed. The rules forbid installing new tooling to satisfy the
scan, so a pattern-based heuristic scan was run and is labelled as heuristic
everywhere it is reported.

*Why:* an undeclared weaker check is worse than a declared one. *Consequence:* if a
real scanner becomes available, later phases should re-scan history.
*Reversible:* yes.

## D-0005 — GitHub remote deferred; local repository completed
**Phase:** 0 · **Status:** blocked, deferred to Phase 1 or owner action

`gh` is not installed on this host, so `gh repo create --private` could not run and
no authenticated remote exists. No token was written anywhere. The local repository
was initialised and committed regardless.

*Why:* the phase requires the local repository to be completed even when GitHub is
unavailable, and forbids embedding credentials. *Consequence:* the private remote,
`origin`, the push, and the visibility check remain open.
*Reversible:* yes — it is pending work, not a wrong turn.

## D-0006 — Licensing recorded as a proposal, not a legal decision
**Phase:** 0 · **Status:** adopted as proposal

Open core proposed under AGPL-3.0-or-later, with an additional commercial license
planned. Recorded in `docs/LICENSE_STRATEGY.md` explicitly as a proposal pending
legal review.

*Why:* the phase specification requires proposal status; presenting it as settled
would misrepresent the project's legal posture. *Reversible:* yes, by design.

## D-0007 — ATOM boundary fixed as an invariant from inception
**Phase:** 0 · **Status:** adopted

The FOSS core must be complete and independently useful, must not depend on ATOM to
build, start, test, or deliver its documented functionality, and no proprietary ATOM
implementation may ever enter a public repository. Integration is via public
interfaces only.

*Why:* deciding this at inception is cheap; retrofitting a boundary into a coupled
codebase is not. It is also a precondition for FOSS funding eligibility.
*Reversible:* no — treated as an architectural invariant.

---

## D-0008 — Archives identified by SHA-256 only, never by filename
**Phase:** 1 · **UTC:** 2026-07-25T01:49:50Z · **Status:** adopted

Every archive was matched to its role by hash. Filenames were never used for
identification or dispatch.

*Why:* all five carry a ` (2)` duplicate-download suffix, so name-based matching
would have failed or, worse, silently mismatched a package to the wrong role.
*Reversible:* n/a — this is the correct method regardless.

## D-0009 — Product tree placed at repository root with no wrapper level
**Phase:** 1 · **Status:** adopted, independently confirmed

Package 01's `SOURCE/PRODUCT/` became the repository root. The
`NOESAR_EVOLUTION_01_…_V4_FINAL/` directory appears nowhere.

*Why:* required by the phase specification, and it is what the product itself
expects. *Confirmation:* the product's own `MANIFEST.sha256` verifies **5,606/5,606**
against the repository root — its paths are product-relative and every one resolves.
That is independent proof rather than an assertion. *Reversible:* expensive; the
manifest would stop resolving.

## D-0010 — Package envelopes preserved under `provenance/package-0N/`
**Phase:** 1 · **Status:** adopted

Each package's `README.md`, `PACKAGE_METADATA.json`, `CONTENTS_MANIFEST.tsv`,
`SHA256SUMS.txt` and `LICENSES/` were kept, but namespaced per package.

*Why:* the delivery record is evidence worth keeping, but the envelope files collide
by name with the product's own `README.md` and `LICENSES/`. Namespacing keeps both
without either overwriting the other. This also *caused* two of the four recorded
path conflicts, which is why it is logged as a decision rather than a detail.
*Reversible:* yes.

## D-0011 — Differing files are preserved side by side, never silently chosen
**Phase:** 1 · **Status:** adopted

Where the same path held different content, no variant was discarded:
`FOSS_SCOPE.md` (four role-scoped documents) and `CURRENT_RELEASE_STATUS.md` (a
delivery status and a feature matrix) were all retained under role-distinct names.

*Why:* the phase forbids choosing silently between two different files, and these
turned out not to be versions of one document at all — they are different documents
that happen to share a filename. Renaming is the only resolution that invents no
content and loses nothing. *Reversible:* yes; all originals remain in `$STAGING`.

## D-0012 — The Phase-0 `.gitignore` was fixed, not worked around
**Phase:** 1 · **Status:** adopted · **Classification:** `FIXED_IN_PHASE_1`

Un-anchored patterns (`build/`, `bin/`, `out/`, `cache/`, `.cargo/`, `*.pem`) were
silently excluding real source — including `rust/.cargo/config.toml`, without which
cargo ignores the vendored tree entirely, and a **public** Ed25519 key required by
the signature-verification examples. Patterns were anchored to the repository root,
`.cargo/` was replaced with `**/.cargo/credentials*`, and `*public*.pem` was negated.

*Why:* a `.gitignore` authored before the product was visible encoded guesses. Left
alone it would have produced a repository that looks complete and cannot build —
the worst possible failure mode, because it is invisible until much later.
*Verified:* the product contains zero private-key material, so relaxing `*.pem` for
public keys costs nothing. *Reversible:* yes, but should not be.

## D-0013 — Compiled vendored fragments excluded from Git, preserved outside it
**Phase:** 1 · **Status:** adopted · **Classification:** `DEFERRED_TO_PHASE_2`

Four compiled files in `wit-bindgen-0.57.1` (`.a`, 2×`.o`, `.wasm`) are listed in
cargo's checksum manifest but are binaries, which `CLAUDE10.md` §33 forbids. They
were excluded from Git and preserved byte-identical in
`$ARTIFACT_ROOT/vendor-binary-fragments/` with checksums and a restore procedure.

*Why:* this is a genuine tension between two rules that both matter — no binaries in
the repository, and a vendored tree that must stay verifiable. Overriding the policy
silently would have been wrong; deleting the files would have destroyed evidence.
Excluding while preserving keeps both options open for whoever decides in Phase 2.
*Mitigation:* the crate is reachable only via `wasip2` and is not built for
linux-x86_64. *Reversible:* fully — restoring is a documented `cp`.

## D-0014 — B-003 recorded, deliberately not "fixed"
**Phase:** 1 · **Status:** adopted · **Classification:** `DEFERRED_TO_PHASE_2`

`rust/vendor/cc-1.3.0/src/target.rs` declares four modules whose files ship in none
of the five archives. The packaging filter that strips `target/` build output also
stripped a legitimate source directory.

*Why not fixed:* the only ways to "fix" it here would be to write the four files
(fabricating upstream source — forbidden) or to fetch them from the network (out of
scope this phase, and a supply-chain decision in its own right). Recording it
accurately is the honest action.
*Significance:* it falsifies two of the delivery's own claims — the recorded
`vendorManifestAggregate` (5,207 vs 5,203 files) and the `B001` "complete vendor
snapshot" closure. Those claims should not be relied on downstream without checking.
*Reversible:* n/a — it is an open item, not a change.

## D-0015 — Licensing inventoried, nothing relicensed
**Phase:** 1 · **Status:** adopted

`NO_LICENSE_RELICENSING_IN_PHASE_1=true` was honoured: no licence field, header, or
file was added, changed, or removed anywhere.

*Finding:* all 113 vendored crates are permissive, with zero copyleft-only
dependencies — nothing blocks the proposed AGPL core. The gap is entirely on the
first-party side (no declarations, no root `LICENSE`, 86 sources without SPDX
headers). *Notable:* the delivered licensing matrix independently matches the
Phase-0 proposal, and adds a three-way split (AGPL core / Apache-2.0 SDK /
CC-BY-SA-4.0 docs) that `docs/LICENSE_STRATEGY.md` should adopt in Phase 5.
*Reversible:* n/a — no change was made.

---

## D-0016 — B-003 repaired from local authoritative copies; no network used
**Phase:** 1 (B-003 repair) · **UTC:** 2026-07-25T05:15:00Z · **Status:** adopted

Temporary, limited network access was authorised for recovering Cargo dependencies.
It was **not used**: two independent authoritative copies of `cc-1.3.0` were already
on this server, the primary being the delivery's own build staging
(`RUST_MANIFEST_REMEDIATION_V1`, the phase named in its `PROVENANCE.json`).

*Why:* the authorisation was a fallback, not an instruction. Local recovery is
strictly better — it needs no trust in a network path and the result is provable
against the crates.io-published `.cargo-checksum.json`, which every recovered file
matches exactly. *Reversible:* yes (backup `pre_b003_repair_20260725T050034Z`).

## D-0017 — Only the four official files were promoted, nothing reconstructed
**Phase:** 1 (B-003 repair) · **Status:** adopted

Recovery was accepted only after: the four hashes matched the upstream checksum
manifest, the package checksum matched `Cargo.lock`, and `diff -rq` against the
authoritative copy showed the missing `src/target` directory as the *only* difference.

*Why:* "restore the files" and "make the tree look complete" are different things.
Anything beyond an exactly-matching official file would have been fabrication. The
diff was the check that the damage was exactly what it appeared to be and nothing
else had moved. *Reversible:* yes.

## D-0018 — The identical filter defect was found live in this repository and fixed
**Phase:** 1 (B-003 repair) · **Status:** adopted · **Classification:** `FIXED`

`git check-ignore` proved `.gitignore`'s un-anchored `target/` was ignoring all four
just-restored files. The repair would have sat on disk, never been committed, and a
fresh clone would have reproduced B-003 exactly. The same idiom was then found in
`tools/create-rust-build-provenance.py` (which also tested the *absolute* path, so a
checkout under any directory named `target` would have excluded everything).

*Why:* fixing the data without fixing the rule that destroyed it guarantees the defect
returns. The fix is anchoring — build output only exists at a workspace root — plus a
regression test asserting both directions (19/19).
*Not fixed:* the upstream packaging script that built the ZIPs is not on this host, so
its origin could not be corrected. Recorded as residual, not as done.
*Reversible:* yes, but should not be.

## D-0019 — The unreproducible vendor aggregate was investigated, not papered over
**Phase:** 1 (B-003 repair) · **Status:** adopted

After repair the vendor tree still does not reproduce the recorded
`vendorManifestAggregate`. Seven path conventions were tried. The decisive test:
the recorded value does not reproduce from the **delivery's own build staging**
either — the same tree this repair restored from, now byte-identical to the repository.

*Why:* the honest conclusion is that the recorded number is unreliable, not that the
tree is wrong. Fabricating a matching hash, or quietly adjusting the method until it
matched, would have destroyed the only signal that record carries. A supporting
discrepancy: the method string claims the digest excludes `vendor/`, but the script
computing it does not. *Consequence:* Phase 5 should correct or drop the number.
*Reversible:* n/a — an open finding, not a change.

## D-0020 — `MANIFEST.sha256` updated, and only where the repair required it
**Phase:** 1 (B-003 repair) · **Status:** adopted

The product manifest was generated from the damaged tree: 5,203 vendor entries and
zero for `cc-1.3.0/src/target/`. Two changes: the hash of the one file this repair
legitimately modified, and four new entries at their official upstream hashes.

*Why:* the phase authorises "necessary manifest updates". Leaving it unchanged would
have left the manifest permanently failing and encoding the defect. Touching anything
else would have blurred the audit trail — hence a diff of exactly 6 lines, verified
5,610/5,610, still sorted. *Reversible:* yes.
