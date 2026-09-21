# NOESAR EVOLUTION — Dual-Licence Readiness

Assessment of how ready the repository is for the proposed dual-licence model.
Phase 1 is an **inventory**, not a legal determination.

```text
AGPL_PROPOSAL_ONLY=true
COMMERCIAL_LICENSE_PROPOSAL_ONLY=true
NO_LICENSE_RELICENSING_IN_PHASE_1=true
```

**Verdict: NOT READY.** The dependency position is favourable; the first-party
licensing position is not yet established. No blocking obstacle was found.

---

## 1. The proposal, and the product's agreement with it

This project proposed in Phase 0: open core under `AGPL-3.0-or-later`, additional
commercial licence planned, ATOM proprietary and separate.

The delivered product states the same intent independently, in
`LICENSES/README.md` and `docs/governance/licensing-matrix.csv`:

| Artefact | Primary | Alternative | Publication |
|---|---|---|---|
| Open core | `AGPL-3.0-or-later` | NOESAR Commercial License | public |
| SDK / contracts / schemas | `Apache-2.0` | commercial support agreement | public |
| Public documentation | `CC-BY-SA-4.0` | commercial docs terms | public |
| ATOM implementation | NOESAR Proprietary | commercial agreement | **private** |
| Owner issuer, official industry modules | NOESAR Proprietary | — | **private** |

The product also states that final texts "require specialist legal review before
public release" — matching this project's proposal-only posture. **The two agree;
nothing had to be reconciled.**

This is richer than the Phase-0 proposal in one respect: it splits SDK/schemas to
`Apache-2.0` and documentation to `CC-BY-SA-4.0`, rather than a single core licence.
`docs/LICENSE_STRATEGY.md` should adopt that three-way split when the proposal is
next revised.

## 2. Readiness by criterion

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | No copyleft-only dependency blocking AGPL distribution | **PASS** | all 113 vendored crates permissive; zero GPL/AGPL-only |
| 2 | Dependency licences enumerated | **PASS** | `docs/LICENSE_INVENTORY.tsv`, 130 rows |
| 3 | Core independently useful without proprietary parts | **PASS** | `docs/ATOM_BOUNDARY_AUDIT.md` |
| 4 | No proprietary implementation in the tree | **PASS** | ATOM audit: contract + docs only |
| 5 | Root `LICENSE` file present | **FAIL** | none; `LICENSES/` holds only a boundary README |
| 6 | First-party components declare a licence | **FAIL** | 12 crates + 2 Node packages declare none |
| 7 | SPDX headers on first-party sources | **PARTIAL** | 113 with, 86 without |
| 8 | Contribution mechanism enabling dual licensing | **NOT STARTED** | no CLA/DCO in the tree |
| 9 | Commercial licence text | **NOT STARTED** | named, never drafted |
| 10 | Verbatim third-party notices | **NOT STARTED** | draft only |
| 11 | Trademark policy for "NOESAR" / "ATOM" | **NOT STARTED** | — |

## 3. Why criterion 6 matters most

Dual licensing requires the project to hold sufficient rights over all first-party
code. Today no first-party component declares a licence at all, so:

- there is no licence to dual-licence *from*;
- external contributions cannot be accepted safely, because no inbound licence
  terms are stated;
- the AGPL obligations the model depends on are not yet asserted anywhere.

The order matters: **decide the licence → apply headers → establish the inbound
mechanism → then accept contributions.** Doing this after contributions arrive
requires relicensing consent from every contributor.

## 4. Funding interaction

`FUNDED_WORK_MUST_BE_FOSS=true`. Criteria 1, 3 and 4 pass, so the core is
technically capable of standing alone as FOSS. Criteria 5–7 mean it is not yet
*licensed* as FOSS.

The open question recorded in `docs/FUNDING_ALIGNMENT.md` is unchanged: programmes
that require the funded work to be open source *in its entirety* may not accept an
open-core model where a meaningful component is permanently reserved. That is a
strategic decision for the project owner, not one to settle inside a phase.

## 5. Required before publication (Phase 5)

1. Confirm `AGPL-3.0-or-later` for the core; adopt the Apache-2.0 (SDK) and
   CC-BY-SA-4.0 (docs) split in `docs/LICENSE_STRATEGY.md`.
2. Add the root `LICENSE` file(s) and populate `LICENSES/`.
3. Add `license` fields to all 12 first-party crates and both Node packages.
4. Apply `SPDX-License-Identifier` headers to the remaining 86 sources.
5. Choose and document the inbound mechanism (CLA / DCO + assignment).
6. Draft the commercial licence terms.
7. Produce verbatim third-party notices, recording the selected option for every
   disjunctive expression (notably `r-efi`).
8. Legal review of the whole set, including trademark policy.

Until every item is closed and recorded, the licensing status stays **proposed**.

---

## 6. Status after the B-003 vendor repair (2026-07-25)

**Unchanged. No licence was applied, altered, or removed** — `LICENSE_RELICENSING=false`
and `NO_LICENSE_RELICENSING_IN_PHASE_1=true` were both honoured. The verdict stays
**NOT READY, no blocking obstacle**.

The four gaps remain registered and require a decision by the rights holder, not an
engineering change:

```text
12 first-party Rust crates without declared license
2 first-party Node packages without declared license
root LICENSE missing
86 first-party source files without SPDX header
```

One data point strengthened: the vendored dependency position is now fully verified
rather than merely inventoried — all 113 crates pass their own checksum manifests
(5,094 files, 0 missing, 0 corrupt), and all remain permissive with zero copyleft-only
dependencies. Criterion 1 ("no copyleft-only dependency blocking AGPL distribution")
is therefore evidence-backed. Criteria 5–11 are untouched.

The repair added `rust/vendor/cc-1.3.0/src/target/*.rs` — official upstream MIT OR
Apache-2.0 material, already covered by the existing `cc-1.3.0` inventory row; it adds
no new licence obligation.

---

## 7. Re-measured 2026-09-21 (at `e611cf2a`)

Sections 1–6 are left as written: they record what was true when they were written. This section
records what is true now. Every figure below is reproducible from the repository root with the
command beside it.

| # | Criterion | 2026-07-25 | 2026-09-21 | Reproduce |
|---|---|---|---|---|
| 1 | No copyleft-only dependency | PASS | **PASS** — one expression needs a decision, see below | `grep -h '^license = ' rust/vendor/*/Cargo.toml \| sort \| uniq -c` |
| 2 | Dependency licences enumerated | PASS | **PASS** — 113 vendored crates, 113 rows in `LICENSE_INVENTORY.tsv`; the non-crate rows were stale and are rewritten (`D-0709`) | `ls rust/vendor \| wc -l` |
| 5 | Root `LICENSE` | FAIL | **PASS** since `D-0453` | `head -2 LICENSE` |
| 6 | First-party components declare a licence | FAIL | **PASS** — 20/20 crates, 5/5 Node packages, the Python SDK | `git ls-files 'rust/crates/*/Cargo.toml' \| wc -l` |
| 7 | SPDX headers on first-party sources | PARTIAL (113/86) | **PARTIAL — 564 with, 98 without**, of 662. Not comparable with July: the definition below is wider | see below |
| 8 | Contribution mechanism | NOT STARTED | **NOT DECIDED** — and until it is, code is not merged (`CONTRIBUTING.md`, `D-0709`) | — |
| 9 | Commercial licence text | NOT STARTED | **NOT DRAFTED** | `NOTICE` |
| 10 | Verbatim third-party notices | NOT STARTED | **DRAFT** — and it omits `@xterm/xterm` (MIT, vendored in `apps/webui-static/vendor/xterm`) | `grep -ci xterm docs/THIRD_PARTY_NOTICES_DRAFT.md` |
| 11 | Trademark policy | NOT STARTED | **NOT STARTED** — the name is not registered | — |

SPDX count — source files are `mjs js cjs ts rs py sh ps1`, excluding vendored and historical trees:

```sh
git ls-files | grep -E '\.(mjs|js|cjs|ts|rs|py|sh|ps1)$' \
  | grep -vE '^(rust/vendor|apps/webui-static/vendor|evidence/history|provenance)/|/node_modules/' \
  | while read f; do head -6 "$f" | grep -q 'SPDX-License-Identifier:' && echo with || echo without; done \
  | sort | uniq -c
```

**The one vendored expression outside the policy:** `unicode-ident-1.0.24` declares
`(MIT OR Apache-2.0) AND Unicode-3.0`. `Unicode-3.0` is not in
`capabilities/security/license-policy.json`, whose default is `deny`. It is **not** a copyleft
licence, so criterion 1 holds; whether to add it to the policy is a decision for the rights holder,
not an edit made here. Eight further crates offer a branch outside the policy (`Unlicense`,
`LGPL-2.1-or-later`, `BSL-1.0`, `Apache-2.0 WITH LLVM-exception`) and an approved one beside it;
the branch taken must be recorded in the verbatim notices (item 7 of §5).

**Not re-measured:** the OS packages of the image (`docs/SBOM_STATUS.md`), models and
programs used at runtime but not in this repository, and ATOM. The verdict stays **NOT READY, no
blocking obstacle**.
