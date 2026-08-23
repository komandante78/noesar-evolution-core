# SESSION HANDOFF

**Session continues:** deployed voice hands-free fix + 3 UX gaps (`D-0640/41`), fixed a
WCAG regression (`D-0646`), gave `#/knowledge` and `#/memory` a real identity (`D-0647`),
shipped direct agent-creation from chat (`D-0648`), decomposed `§4#10` multimodality into
three phases (`D-0649`), closed the audio item (`D-0650`), and closed the images item
(`D-0651`) — both `§4#10` gaps D-0649 found are now built. Six deploys this session, all
verified live. Reclassified Kokoro→GPU out of scope (`D-0652`). Built and tested
`packages/capability-token/` — Phase D of the funding work plan (`D-0653`). Built the
authority-conformance fixture and closed Phase E's JS half (`D-0654`). Closing this session
found and fixed a real `.gitignore` gap that had let host-wide evidence files sit untracked
(`D-0655`). Built the Rust-side equivalent of `D-0654` and closed Phase E's remaining half
(`D-0656`). Owner authorised executing `D-0656`'s own improvement proposal: promoted the
containment property to `packages/authority-containment/` (`D-0657`). Owner said keep going
without stopping between phases: picked up `F-RUST-001` and gave `noesar-auth` its first real
tests, 0 → 13, including an independent RFC 6238 vector (`D-0658`), then `noesar-audit-ledger`,
0 → 6, finding and fixing a real hash-chain delimiter-collision weakness (`D-0659`), then
`noesar-hardware-orchestrator`'s memory-sizing formula, 0 → 7 (`D-0660`).

## ➜ LA PROSSIMA AZIONE

No deploy-blocking item is open. Three independent threads are all at a clean stop:

**Product/§4#10:** closed — see `D-0645`/`D-0649`/`D-0650`/`D-0651`/`D-0652`.

**Funding (`FUNDING/19_WORK_PLAN_TO_BETA.md`):** Phase D done (`D-0653`,
`packages/capability-token/`, 32/32 JS + 17/17 Python conformance, byte-identical against the
live `TokenMinter`). **Phase E now fully done, both sides, plus its own named-open extra.** JS
half (`D-0654`): Proof-of-Session was already `RECORDED_MET` (`SESS-001/002/003`); the
authority-conformance suite proves the real `TokenMinter` contains an adversarial,
never-filtering `ReasoningProvider` — 5/5 cases. Rust half (`D-0656`): the same claim against
`rust/crates/noesar-capability`'s real `TokenMinter`/`AuthorizedPlan`, via a test-local
`AdversarialReasoningProvider` — 5/5 new cases, full workspace `cargo test --workspace --offline`
149/149 (was 144 at `D-0497`). `D-0657`: the property promoted to `packages/authority-
containment/` — `SPEC.md` `AC-001`–`AC-006`, adapter-driven `runConformance()` reading the
canonical `conformance/capability-vectors.json` (no duplicated vectors), a reference adapter
proving the real JS engine conforms (8/8, incl. 5 broken-implementation adversarial cases).
Remaining: Phase F (cross-platform evidence on ≥2 real host classes) and Phase G (independent
pentest — external party only, cannot be scheduled by this project alone). Neither is due before
the NLnet deadline (3 Nov 2026) — they are the funded work itself, not a submission
prerequisite. The actual next action for the deadline is writing the CodeSupply
abstract/milestones/budget (`D-0631`, not started) once the application form publishes
(~3 Sep 2026).

**Tracked findings (`F-RUST-001`):** `noesar-auth` (`D-0658`), `noesar-audit-ledger` (`D-0659`,
+1 real defect fixed) and `noesar-hardware-orchestrator` (`D-0660`) now tested.
`noesar-contracts` reclassified not-applicable (pure data shapes, no logic). Still open: 4
crates with real logic (`noesar-authority-protocol`, `noesar-authority-transport`,
`noesar-control-plane`, `noesar-data-plane`) — a reasonable next bounded slice, same shape.

No further action on Kokoro→GPU unless the Owner amends `CLAUDE10.md` with a named exception.

## WHAT IS TRUE NOW THAT WAS NOT

See `docs/DECISION_LOG.md` `D-0640` through `D-0651` for the full session — eight
decision entries, six deploys, all with before/after evidence. `docs/INSTALLATION_
LEDGER.md` tail carries the same six deploys with byte-equal/health/test evidence per
entry, most recently `d0651-image-caption-…`.

**`D-0650`/`D-0651`/`D-0653`:** audio+image multimodal fallbacks and the capability-token
wire-format package — detail in `docs/DECISION_LOG.md`, not repeated here; nothing about
them changed since.

**`D-0654`:** `src/fixtures/adversarial-reasoning-provider.mjs` is a second, real
`ReasoningProvider` implementation — identical to the reference one except `constrain()` never
refuses. `test/reasoning-authority-conformance.test.mjs` drives it through the REAL
`TokenMinter.mint()`/`authorizePlan()` (nothing mocked) and proves workspace-escape and
step-membership containment hold regardless of whether the backend's own filtering ran. One
case found genuinely red first during authoring (a test bug, not a product bug), fixed,
re-verified.

**`D-0656`:** the Rust-side twin of `D-0654`. `AdversarialReasoningProvider`, defined only
inside `rust/crates/noesar-capability/tests/reasoning_authority_conformance.rs` (stronger
isolation than the JS fixture's `src/fixtures/`: a Rust integration test file is already its
own compilation unit), delegates every mandatory surface to `ReferenceReasoningProvider`
except `constrain()`, which never filters. Same 4 cases as JS, plus a 5th that is a Rust-native
form of "not a strawman": coercion to `&dyn ReasoningProvider` would fail to compile if a
surface were missing. Verified in a disposable `rust:1-bookworm` container, offline, vendored
deps — no new crate version pulled in.

**`D-0657`:** `packages/authority-containment/` specifies the property `D-0654`/`D-0656` proved
(`SPEC.md` `AC-001`–`AC-006`) and makes it adapter-driven: `runConformance(attempt)` where
`attempt(vector, context)` is the only shape a third engine implements. Its vectors are the
same live `CAP-001`/`002`/`005`/`011`/`012` cases in `conformance/capability-vectors.json` — read
by relative path, not copied, so there is no second file to drift. `src/reference-adapter.mjs`
proves the real product JS engine conforms (8/8). Not done: wiring either production engine to
import this package, and giving Rust an adapter of its own — both named open in the package's
own `README.md`.

**`D-0658`:** `rust/crates/noesar-auth` (Argon2 password hashing, RFC 6238 TOTP,
`SessionRecord` elevation) had zero tests and zero workspace dependents — real security logic,
unverified. Added 13, including the published RFC 6238 Appendix B SHA-1 vector (not
self-consistency) and a ±1/±2 window boundary check. While verifying, corrected a false claim in
`F-RUST-001`: `noesar-auth` has **no** dependents in the workspace at all, not one — the
finding's original text ("declared as a Cargo dependency of `noesar-authority-daemon`") did not
match `noesar-authority-daemon/Cargo.toml`.

**`D-0659`:** `rust/crates/noesar-audit-ledger` (0 → 6 tests). Found and fixed a real defect
while testing: the hash-chain material was joined with a bare `|`, which collides whenever a
field's own content contains `|` (confirmed against the pre-fix formula, not assumed). Fixed
with the same length-delimited feed this project already uses elsewhere (`CT-002`). Zero
dependents in the workspace — zero reversal cost, and exactly why now was the safe time to fix
the format.

**`D-0660`:** `rust/crates/noesar-hardware-orchestrator`'s `recommend()` — the only real logic
in a crate otherwise made of data shapes — had zero tests for its memory-sizing formula. Added
7, including the estimate checked against the formula recomputed independently in the test.
Skipped `noesar-contracts`: pure enums/structs, no behaviour beyond serde's own derive macros —
testing it would prove nothing this project needs proven.

## WHAT WAS **NOT** DONE

- Kokoro→GPU — out of scope (`D-0652`), not built.
- Production Rust/JS minters were **not** rewired to import `packages/capability-token/`
  — real architecture change to security-critical code, deliberately left as an open
  decision rather than taken inside this phase (`D-0653`).
- FUNDING Phases F/G — not started, and not due before the deadline (see above).
- **No push** — `git push origin main` still fails, no GitHub credential in this
  container (`B-013`, unchanged all session). Commits are complete and correct locally.

## LOCAL, UNTRACKED, BY DESIGN

- `EVIDENCE/docker_{ps,network,volume}_post_cleanup_*.txt` — the §5a cleanup inventories
  from the `D-0650`/`D-0651` deploys. They list every container on this host, other projects
  included — the same reason `EVIDENCE/docker_inventory_*.txt` is gitignored. **This claim
  used to be false** (`D-0655`, found during this closure): `.gitignore` covered only the
  `docker_inventory_*` prefix, not this three-way split, so these 6 files had been sitting
  untracked-but-unignored, one `git add -A` away from leaking. Fixed at the pattern, with a
  regression test (`tools/test-packaging-filters.mjs`, 29/29). Now genuinely gitignored,
  verified with `git check-ignore`. Their content is already summarised, host-detail
  stripped, in each deploy's `docs/INSTALLATION_LEDGER.md` entry. Safe to leave or delete.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): neither `gitleaks` nor `trufflehog` on `PATH`; every
  diff this session was reviewed with a heuristic grep, clean, declared as heuristic.
- `B-011` low/deferred (`D-0258`): git history rewritten on Owner's explicit authorisation.
- `B-013` **still open**: `git push origin main` refused, no GitHub credential stored in
  this container. Commits keep queuing locally, correct and complete.
- No other new blocker.
