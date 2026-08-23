# `@noesar/capability-token`

The wire format behind a NOESAR EVOLUTION capability token's signature: canonical field
encoding, the HMAC-SHA256 pre-image, the canonical limits string, and constant-time
verification.

Zero dependencies. No clock, no filesystem, no network — every exported function is pure.

```js
import { sign, verify, canonicalLimits } from '@noesar/capability-token';
```

## Why this exists as its own thing

Any system that lets an autonomous agent touch real files needs an answer to "prove this
specific action was actually granted, to this specific caller, and nothing wider." NOESAR
EVOLUTION's answer is a signed, scoped, single-use token — implemented **twice**, independently,
in Rust (`rust/crates/noesar-capability`) and JavaScript
(`services/reference-control-plane/src/capability.mjs`), because neither is allowed to be the
other's oracle. Both already agree, byte-for-byte, on how a token is signed. This package is
that agreement, pulled out and specified so a third project — or a third language — can hold
itself to the same bytes without reading either implementation's source.

## What this guarantees

| | |
|---|---|
| **The pre-image is fully specified** (`SPEC.md` `CT-002`/`CT-004`) | `id`, `planDigest`, `stepId`, every path, every operation (lower-cased), `expiresAtUnix`, `usesGranted`, and the canonical limits string, each length-delimited and fed in a fixed order. Two implementations that follow this order sign the same bytes for the same token. |
| **Widening is unsigable** (`CT-006`) | Append a path, add an operation, extend the expiry, raise the use count, attach a limits envelope that was not there at signing time — any one of these changes the MAC. `verify()` catches it against the original secret. |
| **`0` and unset never collide** (`CT-003`) | `coreDumpBytes: 0` forbids core dumps; an unset `coreDumpBytes` inherits whatever the container allows. Rendering both the same way would make a real restriction indistinguishable from no opinion at all. |
| **Verification does not leak by timing** (`CT-006`) | `verify()` compares in constant time, the same property `node:crypto.timingSafeEqual` and Python's `hmac.compare_digest` both give for free. |

## What this deliberately does not do

This is the wire format, not the authorization engine. It does **not** decide, and **cannot be
asked**, whether a step grants a path, whether an operation is destructive, when an approval
lapses, or what a live token registry currently holds — `SPEC.md` `CT-007` states this
normatively, and the conformance suite checks that `mint`, `TokenMinter`, `authorizePlan`,
`spend` and `revoke` are **not** part of this package's surface. That policy is
product-specific: it lives in `rust/crates/noesar-capability` and
`services/reference-control-plane/src/capability.mjs`, stays there, and is where it belongs — a
second product adopting this wire format brings its own notion of what a "step" or a "plan" is.

## Usage

```js
import { sign, verify } from '@noesar/capability-token';

const secret = crypto.randomBytes(32); // >= 32 bytes, or sign()/verify() throw
const token = {
  id: 'a1b2c3...',
  planDigest: 'sha256-of-the-approved-plan',
  stepId: 'step-3',
  paths: ['src/app.mjs'],
  operations: ['WRITE'],
  expiresAtUnix: Math.floor(Date.now() / 1000) + 600,
  usesGranted: 1,
  limits: { memoryBytes: 67108864 }, // or omit/null for no envelope
};

token.mac = sign(token, secret);
// ... later, at the point of use:
if (!verify(token, secret)) refuse('token does not verify');
```

A refusal from `sign()`/`verify()` for a malformed input (a secret under 32 bytes, an unknown
operation, an unknown limit dimension) is thrown as `CapabilityTokenFormatError`, carrying a
`kind` from the frozen `TokenFormatError` enumeration — never silently coerced. `verify()`
itself returns `false` for a mismatched MAC; that is an expected outcome, not an error.

## Conformance

**[`SPEC.md`](./SPEC.md) is the normative document** — seven requirements (`CT-001`…`CT-007`),
each naming the conformance case family that measures it, enforced in both directions by the
package's own tests.

**Every `mac` vector in `conformance/vectors.json` was minted live**, this repository's own
`TokenMinter`, at generation time — not hand-built — and this package's `sign()` was checked
against the real MAC before the vector was frozen. Passing the suite therefore means: an
implementation reproduces bytes the shipped product actually produced, not bytes invented for
the occasion.

**[`conformance/python/`](./conformance/python/) is a worked second implementation**, written
from `SPEC.md` rather than translated from the JavaScript, run offline through
`docker run --rm --network none -v "$PWD:/repo:ro" -w /repo python:3-slim python3
packages/capability-token/conformance/python/run_vectors.py`. `scripts/test.sh` runs it through
`pyrun`, the same portable pattern `packages/verified-acquisition` already uses.

```js
import { runConformance } from '@noesar/capability-token/conformance';

const report = await runConformance(yourImplementation);
console.log(`${report.passed}/${report.total}`);
report.results.filter((entry) => !entry.ok).forEach((entry) => console.log(entry.id, entry.detail));
```

The suite is tested against **broken** implementations too — a missing function, a pre-image
that drops the operations list, a `verify()` that always returns `false`, an implementation
that ignores the caller's secret, one that leaks authorization policy onto its surface —
because a conformance suite that has never been seen to fail has not been shown to measure
anything.

## Contract version

`CONTRACT_VERSION` changes when the pre-image shape, the canonical limits format, or the MAC
algorithm changes. Everything outside `src/index.mjs`'s exported surface is implementation and
may be reorganised without notice.

## Status and provenance

Extracted from **NOESAR EVOLUTION**'s Phase 1 authority backbone
(`MASTER_PROJECT/09_PIANO.md` §2, step 3), where the wire format is exercised behind two
independent minters. This package does not (yet) replace either production call site — that is
a separate, larger decision (touching the authority daemon's own imports) left open below, not
taken silently here.

Two things are deliberately still open and are named rather than implied:

- **Neither production minter imports this package yet.** Both continue to carry their own
  copy of this exact algorithm, cross-checked against `conformance/capability-vectors.json` as
  they always have. Wiring the security-critical authority code to depend on a freshly
  extracted package is a real architecture change and stays a proposal, not something this
  extraction did on its own authority.
- **Publication is a separate decision.** This package is not published to any registry, and
  the repository it lives in is private until its owner decides otherwise. The licence follows
  the product (`AGPL-3.0-or-later`); whether a component meant for external adoption should
  carry a more permissive licence is open, the same open question `@noesar/verified-acquisition`
  already names for itself.
