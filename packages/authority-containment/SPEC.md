# Capability-Minting Containment — specification v1.0.0

What any engine that turns an **approved Plan** into a **capability token** must never trust,
written so the property can be checked against an implementation **from this document alone**,
then **measured** by [`conformance/`](./conformance/index.mjs) rather than by reading the
reference code.

Each requirement carries the id of the conformance case family that measures it. `test/
conformance.test.mjs` fails if a requirement here has no case, or a case names a requirement
that is not here — the same discipline `@noesar/capability-token/SPEC.md` already applies to
itself.

**Language.** MUST / MUST NOT / MAY are used in the RFC 2119 sense.

**What this document is not.** It does not say how a Plan is proposed, hypothesized, decomposed,
constrained or filtered — that is the `ReasoningProvider` contract (`MASTER_PROJECT/02_ATOM.md`
§5, `rust/crates/noesar-reasoning`). It does not say how a token's bytes are signed or verified
— that is `@noesar/capability-token`. This document specifies only the **minting decision**:
given an approved Plan and a request naming a step, a set of paths and a set of operations,
when the minting engine MUST refuse. See `AC-006`.

**Origin.** Every requirement below restates, normatively, a property this repository already
proved twice: once as data (`conformance/capability-vectors.json`, run by both
`rust/crates/noesar-capability` and `services/reference-control-plane/src/capability.mjs`), and
once end-to-end against a real, non-cooperative `ReasoningProvider` implementation whose own
filtering step never runs (`D-0654` JS, `D-0656` Rust). This package does not re-derive that
proof; it names the property the proof measured, so a third engine can hold itself to the same
standard without needing this repository's `ReasoningProvider` or `Plan` types.

---

## AC-001 · Adapter surface

An implementation under test MUST expose a single function, `attempt(vector, context)`, where
`vector` is `{ id, steps, request }` and `context` is `{ nowUnix, approval }`. It MUST return
(synchronously or via a `Promise`) `{ minted: boolean, kind?: string }` — `kind` present and
naming a refusal category when `minted` is `false`, absent when `minted` is `true`. This is the
**only** shape a third party needs to implement: no dependency on this repository's `Plan`,
`PlanStep`, `Approval`, `TokenMinter` or `AuthorizedPlan` types. *(cases: `surface:*`)*

## AC-002 · Positive control

An ordinary, in-scope, non-destructive grant — a step declaring exactly the file the request
names, no escape, no destructive operation — MUST mint. Without this, every refusal required
below would pass vacuously against an implementation that refuses everything. *(case:
`CAP-001`)*

## AC-003 · Step membership is not negotiable

A request naming a path absent from the approved step's own declared files MUST be refused,
regardless of which layer proposed the plan or how confidently it was approved. *(case:
`CAP-002`)*

## AC-004 · An honestly declared escape is never waived by an upstream filtering failure

A step that correctly declares it reaches outside the workspace MUST mint nothing — whether or
not a cooperative, filtering equivalent of `constrain()` ran before approval. This is the
requirement `D-0654`/`D-0656` added end-to-end evidence for: the same static case (`CAP-005`)
holds even when the Plan was produced by an implementation whose own `constrain()` never
refuses anything, proven against the real production engine, not asserted. *(case: `CAP-005`,
extended by the adversarial-`ReasoningProvider` suites in `services/reference-control-plane/
test/reasoning-authority-conformance.test.mjs` and `rust/crates/noesar-capability/tests/
reasoning_authority_conformance.rs` — referenced here, not reproduced, since they require a
real `ReasoningProvider` implementation this package deliberately does not depend on)*

## AC-005 · A declared flag is never trusted over the path itself

A step whose own bookkeeping says it does not escape the workspace, while the path itself does
— a parent-directory traversal or an absolute path — MUST still be refused. A verdict supplied
by whatever built the plan is not a verdict; the minting engine MUST inspect the path itself.
*(cases: `CAP-011`, `CAP-012`)*

## AC-006 · Non-goals — what this surface deliberately excludes

An implementation of this specification MUST NOT need to expose, and this package MUST NOT
require, anything about: how a Plan's steps are hypothesized, decomposed or filtered; how a
token's scope is encoded or signed on the wire (`@noesar/capability-token`'s job); an approval's
governance workflow beyond its expiry; or a live token registry (issued/spent/revoked
bookkeeping). Those are separate concerns with their own contracts, deliberately not duplicated
here.

---

## Running the suite against your implementation

```js
import { runConformance } from '@noesar/authority-containment';
import { adapt } from './your-engine-adapter.mjs'; // implements attempt(vector, context)

const report = await runConformance(adapt);
console.log(`${report.passed}/${report.total}`);
for (const entry of report.results.filter((r) => !r.ok)) {
  console.log(entry.requirement, entry.id, entry.detail);
}
```

**The reference vectors are not bundled as a separate copy.** `runConformance()` reads
`conformance/capability-vectors.json` — the same live file `rust/crates/noesar-capability` and
`services/reference-control-plane/src/capability.mjs` already answer to — filtered to the five
case ids this specification names (`CAP-001`, `CAP-002`, `CAP-005`, `CAP-011`, `CAP-012`). A
second, hand-maintained copy would be exactly the class of drift this project has already been
burned by (`D-0615`'s manifest, `02_ATOM.md`'s `L0`–`L8` collision): two files claiming to say
the same thing, with nothing keeping them in agreement. If a future phase edits `CAP-011`
without knowing this package reads it, this package's own suite reads the new value on its next
run rather than silently going stale — there is nothing else for it to disagree with.

A consumer outside this repository does not have `conformance/capability-vectors.json` and MUST
supply its own vectors matching the `AC-002`–`AC-005` case shapes above; only the property is
portable, not this repository's specific regression fixture — stated here rather than implied.
