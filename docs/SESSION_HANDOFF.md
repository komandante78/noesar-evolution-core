# SESSION HANDOFF

**Session continues:** product `§4#10` multimodality closed (`D-0640`–`D-0652`, six deploys,
all verified live — see `docs/DECISION_LOG.md` for detail, unchanged since). FUNDING Phase D
(`D-0653`) and Phase E, both sides plus its own named-open extra, closed (`D-0654`/`D-0656`/
`D-0657`). A real `.gitignore` gap fixed at session close (`D-0655`). Owner then said keep
going without stopping between phases: working `F-RUST-001` (8 Rust crates with zero tests),
one bounded crate per phase — `noesar-auth` (`D-0658`), `noesar-audit-ledger` (`D-0659`, +1 real
defect fixed), `noesar-hardware-orchestrator` (`D-0660`), `noesar-data-plane` (`D-0661`).

## ➜ LA PROSSIMA AZIONE

No deploy-blocking item is open. Three independent threads are all at a clean stop:

**Product/§4#10:** closed — see `D-0645`/`D-0649`/`D-0650`/`D-0651`/`D-0652`.

**Funding (`FUNDING/19_WORK_PLAN_TO_BETA.md`):** Phases D and E fully closed (`D-0653`–`D-0657`
— detail in `docs/DECISION_LOG.md`). Remaining: Phase F (cross-platform evidence on ≥2 real
host classes) and Phase G (independent pentest — external party only). Neither due before the
NLnet deadline (3 Nov 2026). Actual next action for the deadline: CodeSupply
abstract/milestones/budget (`D-0631`, not started) once the application form publishes
(~3 Sep 2026).

**Tracked findings (`F-RUST-001`):** 4 of the original 8 zero-test Rust crates now tested
(`noesar-auth` `D-0658`, `noesar-audit-ledger` `D-0659` +1 real defect fixed,
`noesar-hardware-orchestrator` `D-0660`, `noesar-data-plane` `D-0661` with full mutation
coverage on a 13-condition gate). `noesar-contracts` reclassified not-applicable (pure data
shapes, no logic). Still open: `noesar-authority-protocol`, `noesar-authority-transport`,
`noesar-control-plane` — a reasonable next bounded slice, same shape.

No further action on Kokoro→GPU unless the Owner amends `CLAUDE10.md` with a named exception.

## WHAT IS TRUE NOW THAT WAS NOT

See `docs/DECISION_LOG.md` `D-0640` through `D-0651` for the full session — eight
decision entries, six deploys, all with before/after evidence. `docs/INSTALLATION_
LEDGER.md` tail carries the same six deploys with byte-equal/health/test evidence per
entry, most recently `d0651-image-caption-…`.

**`D-0650`/`D-0651`/`D-0653`/`D-0654`/`D-0656`/`D-0657`:** multimodal fallbacks, the
capability-token wire-format package, and the JS+Rust authority-containment proofs (promoted to
`packages/authority-containment/`) — full detail in `docs/DECISION_LOG.md`, nothing about them
changed since.

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

**`D-0661`:** `rust/crates/noesar-data-plane`'s two production-readiness AND-gates (0 → 9
tests), including full mutation coverage on the 13-condition `RepositoryHealth::
production_ready()` — each condition flipped alone, gate confirmed to still refuse. This is the
crate deciding whether the product may run against production PostgreSQL.

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
