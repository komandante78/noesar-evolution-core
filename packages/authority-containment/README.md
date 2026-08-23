# `@noesar/authority-containment`

The capability-minting containment property: what any engine that turns an **approved Plan**
into a **capability token** must never trust — not a step's own declared safety flag, not the
absence of a cooperative filtering pass, not the reasoning backend that proposed the plan.

```js
import { runConformance } from '@noesar/authority-containment';
```

## Why this exists as its own thing

NOESAR EVOLUTION's authorization engine — implemented **twice**, independently, in Rust
(`rust/crates/noesar-capability`) and JavaScript
(`services/reference-control-plane/src/capability.mjs`) — makes one promise: a capability token
never grants more than the step a person approved. That promise is worth nothing if it only
holds when the `ReasoningProvider` proposing the plan happens to be careful. `D-0654` (JS) and
`D-0656` (Rust) proved it end-to-end against a real, adversarial `ReasoningProvider` whose own
`constrain()` never filters anything — the honest way of testing "did we build a check, or did
we build a check the upstream layer usually saves us from needing." This package pulls the
*property* those proofs measured out of test-only fixtures and states it normatively, the same
way `@noesar/capability-token` did for the token's wire format.

## What this guarantees

| | |
|---|---|
| **A minting decision needs no cooperation from upstream** (`SPEC.md` `AC-004`) | A step that reaches outside the workspace mints nothing, whether or not anything upstream tried to filter it out first. |
| **A declared flag is never trusted over the path itself** (`AC-005`) | A step whose own bookkeeping says "safe" while the path itself escapes (`../`, an absolute path) is still refused — the engine inspects the path, not the caller's opinion of it. |
| **Step membership is the ceiling, not a suggestion** (`AC-003`) | A request naming a path the approved step never declared is refused, regardless of confidence or context. |
| **The positive control is mandatory** (`AC-002`) | An ordinary, in-scope grant must still mint — otherwise every refusal above would pass vacuously against an engine that refuses everything. |

## What this deliberately does not do

This is the minting **decision**, not the reasoning that proposes a plan and not the wire
format of the resulting token. It does not say how a `ReasoningProvider` interprets a request,
builds hypotheses, or decomposes a step — that contract is `MASTER_PROJECT/02_ATOM.md` §5,
`rust/crates/noesar-reasoning`. It does not say how a token is signed or verified — that is
`@noesar/capability-token`. `SPEC.md` `AC-006` states this normatively; nothing in this
package's own surface requires either.

## Usage

```js
import { runConformance } from '@noesar/authority-containment';

// Implement one function against your own engine:
async function attempt({ id, steps, request }, { nowUnix, approval }) {
  // ... translate `steps`/`request` into your own Plan/mint call, then:
  return { minted: true };            // or:
  return { minted: false, kind: 'OUT_OF_SCOPE' };
}

const report = await runConformance(attempt);
console.log(`${report.passed}/${report.total}`);
report.results.filter((entry) => !entry.ok).forEach((entry) => console.log(entry.id, entry.detail));
```

`src/reference-adapter.mjs` in this package is the worked example: it wires
`services/reference-control-plane/src/capability.mjs` — the real production engine, nothing
mocked — to exactly this shape, and `test/conformance.test.mjs` proves it passes 6/6 (the
surface check plus the five `AC-002`–`AC-005` cases).

## Conformance

**[`SPEC.md`](./SPEC.md) is the normative document** — six requirements (`AC-001`–`AC-006`),
each naming the conformance case family that measures it, enforced in both directions by the
package's own tests, the same discipline `@noesar/capability-token/SPEC.md` already applies to
itself.

**The reference vectors are not a second copy.** `runConformance()` reads
`conformance/capability-vectors.json` — the same live file this repository's own two minters
already answer to — filtered to the five cases (`CAP-001`, `CAP-002`, `CAP-005`, `CAP-011`,
`CAP-012`) `SPEC.md` names. See `SPEC.md`'s own closing section for why: a hand-maintained
duplicate would be exactly the drift class this project has already been burned by twice
(`D-0615`'s manifest, `MASTER_PROJECT/02_ATOM.md`'s `L0`–`L8` vocabulary collision).

**The suite is tested against broken implementations too** — an `attempt` that is not a
function, one that mints everything, one that refuses everything (catching the positive control
missing), one that reports the wrong refusal `kind`, one that throws instead of returning a
verdict — because a conformance suite that has never been seen to fail has not been shown to
measure anything.

## What this deliberately leaves open

- **The Rust engine's own conformance to this exact package is not wired up here.**
  `rust/crates/noesar-capability/tests/reasoning_authority_conformance.rs` (`D-0656`) already
  proves the same property against the real Rust engine, driven by an adversarial
  `ReasoningProvider` fixture rather than by this package's `runConformance()` — a genuinely
  different, stronger proof (end-to-end through a non-cooperative provider, not only through
  static vectors), referenced from `SPEC.md` `AC-004` rather than reproduced. Whether a Rust
  crate should also import *this* package's vectors, for a second, lighter-weight check, is a
  separate decision, not taken here.
- **Neither production engine imports this package.** Both continue to answer to
  `conformance/capability-vectors.json` directly, as they always have — this package documents
  and specifies a property they already satisfy; it does not (yet) become a dependency of
  either.
- **Publication is a separate decision**, the same open question `@noesar/capability-token` and
  `@noesar/verified-acquisition` already name for themselves: the repository is private until
  its owner decides otherwise, and whether a component meant for external adoption should carry
  a more permissive licence than `AGPL-3.0-or-later` is unresolved.

## Status and provenance

Promoted (`D-0657`) from the adversarial-`ReasoningProvider` proofs built for
`FUNDING/19_WORK_PLAN_TO_BETA.md` Phase E (`D-0654` JS, `D-0656` Rust), which named "promoting
the JS suite to its own versioned, SPEC'd package" as a possible, not-yet-taken next step.
