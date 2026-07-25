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
