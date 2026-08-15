# NOESAR EVOLUTION — ATOM Public/Private Boundary

> **Status: architectural invariant, fixed at inception (Phase 0, decision D-0007),
> amended by the Owner 2026-08-15 (`D-0468`).** The dependency invariant below is still
> not subject to per-phase reinterpretation. What changed is ATOM's licence, not its
> architectural separation: ATOM stays its own repository (`ATOM_EVOLUTION`), and the
> core still must not depend on it. See `CLAUDE10.md` §14 for the full amendment.

---

## The parameters

```text
ATOM_IMPLEMENTATION       = open (AGPL-3.0-or-later) and separate — its own repository
FOSS_CORE_DEPENDS_ON_ATOM = false
```

## 1. The invariant

The FOSS core must be **complete and independently useful**.

Concretely, with no ATOM component present at all, the core must:

- build from source,
- start and run,
- pass its own test suite,
- and deliver the functionality its own documentation claims.

If any of these fails without ATOM, the boundary has been violated and the violation
is a blocker — not a known limitation, not a follow-up item.

## 2. What lives on each side

Both sides are now public and AGPL-3.0-or-later. The split is about **repository and
dependency direction**, not about what may be seen.

**Open core (this repository):**
- the product's own functionality end to end;
- the **public interfaces** through which an advanced capability provider may be
  plugged in — types, contracts, protocol, error semantics, versioning;
- a default behaviour that works without any such provider (a real default, not a
  stub that raises "not implemented");
- documentation of the interface sufficient for an independent third party to write
  their own implementation.

**ATOM (`ATOM_EVOLUTION`, its own public repository):**
- the ATOM implementation itself — algorithms, design documents, benchmark harnesses;
- built from scratch against the public `ReasoningProvider` contract
  (`MASTER_PROJECT/02_ATOM.md`) and Owner direction given in session;
- **never** sourced from the old, separate, still-proprietary ATOM projects on this
  host (`ATOM`, `ATOM_MODEL`, `ATOM_INTERNAL`, `NOESAR-ATOM-PRIVATE`) — those remain
  closed and off-limits regardless of `ATOM_EVOLUTION`'s own licence.

## 3. Integration rule

Integration happens through **public interfaces only**.

The core defines the contract. ATOM satisfies it, as may any other implementation.
The core must never:

- import, link, or vendor ATOM code;
- special-case ATOM by name in control flow;
- assume ATOM's behaviour, performance, or output shape beyond the published
  contract;
- degrade below its documented functionality when ATOM is absent.

Discovery of a provider is configuration-driven and **disabled by default**,
consistent with §8 of `CLAUDE10.md` (external integrations off by default).

## 4. What may never enter either repository

Not proprietary-ATOM material in general any more — `ATOM_EVOLUTION` is itself meant
to be public. What remains prohibited, in **either** repository, is material sourced
from the old, separate, still-closed ATOM projects on this host — `ATOM`,
`ATOM_MODEL`, `ATOM_INTERNAL`, `NOESAR-ATOM-PRIVATE` — in any form:

- source code, in whole or in part;
- vendored or bundled builds, binaries, or libraries;
- model weights, checkpoints, adapters, or embeddings;
- training corpora, generated datasets, or verification suites derived from them;
- internal design documents, specifications, or research notes;
- **test fixtures, sample inputs/outputs, or golden files** derived from their
  behaviour — this route is called out explicitly because it is the easiest one to
  take by accident;
- documentation that discloses their internals rather than describing
  `ATOM_EVOLUTION`'s own, independently-built behaviour.

`ATOM_EVOLUTION` is built from scratch from the public interface and Owner
direction. Those four paths are a different, unrelated, still-proprietary lineage —
opening `ATOM_EVOLUTION`'s licence never authorises drawing from them.

## 5. Why this is fixed now

Deciding the boundary at inception costs nothing. Retrofitting one into a codebase
that has already coupled to a proprietary component is expensive, error-prone, and
frequently ends in either a hollow open core or an accidental disclosure.

The boundary is also a precondition for the licensing posture
(`docs/LICENSE_STRATEGY.md`) and for funding eligibility
(`docs/FUNDING_ALIGNMENT.md`). Those three documents describe one constraint from
three angles.

## 6. Verification obligations in later phases

- **Phase 1** — the repository layout must place the boundary in the directory
  structure; the publishable tree is identifiable by path, not by judgement call.
- **Phase 3** — the build must succeed with no ATOM component available.
- **Phase 4** — acceptance must include an explicit **ATOM-absent run**: core builds,
  starts, passes tests, and delivers documented functionality with nothing
  proprietary present.
- **Phase 5** — a pre-publication sweep of the publishable tree for any proprietary
  material listed in §4, run before any repository is made public.

Until Phase 4 produces that ATOM-absent run, the claim "the core does not depend on
ATOM" is a design commitment, and must be labelled `[UNVERIFIED]` rather than stated
as fact.
