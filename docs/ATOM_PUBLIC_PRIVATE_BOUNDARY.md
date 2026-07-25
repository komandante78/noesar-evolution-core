# NOESAR EVOLUTION — ATOM Public/Private Boundary

> **Status: architectural invariant, fixed at inception (Phase 0, decision D-0007).**
> Not subject to per-phase reinterpretation.

---

## The parameters

```text
ATOM_IMPLEMENTATION       = proprietary and separate
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

**Open core (public, FOSS):**
- the product's own functionality end to end;
- the **public interfaces** through which an advanced capability provider may be
  plugged in — types, contracts, protocol, error semantics, versioning;
- a default behaviour that works without any such provider (a real default, not a
  stub that raises "not implemented");
- documentation of the interface sufficient for an independent third party to write
  their own implementation.

**ATOM (private, proprietary):**
- the ATOM implementation itself;
- its algorithms, training corpora, weights, and internal design documents;
- benchmark harnesses, fixtures, and results that would disclose the above.

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

## 4. What may never enter a public repository

No proprietary ATOM material — **in any form**:

- source code, in whole or in part;
- vendored or bundled builds, binaries, or libraries;
- model weights, checkpoints, adapters, or embeddings;
- training corpora, generated datasets, or verification suites derived from them;
- internal design documents, specifications, or research notes;
- **test fixtures, sample inputs/outputs, or golden files** derived from
  proprietary behaviour — this route is called out explicitly because it is the
  easiest one to take by accident;
- documentation that discloses proprietary internals rather than the public
  contract.

Publishing the *interface* is required. Publishing anything that reveals *how ATOM
satisfies it* is prohibited.

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
