# Capability Token Wire Format — specification v1.0.0

What an implementation must do to encode and verify a NOESAR EVOLUTION capability token's
signature, written so it can be implemented in any language **from this document alone**, and
then **measured** by [`conformance/`](./conformance/index.mjs) rather than by reading the
reference code.

Each requirement carries the id of the conformance case family that measures it. That mapping is
enforced: `test/conformance.test.mjs` fails if a requirement here has no case, or a case names a
requirement that is not here. A specification and a suite that can drift apart are a
specification nobody can trust.

**Language.** MUST / MUST NOT / MAY are used in the RFC 2119 sense.

**What this document is not.** It does not say when a token *should* be issued, what a step, a
plan or an approval are, or what makes an operation destructive. That is authorization **policy**
— product-specific, and it stays in `rust/crates/noesar-capability` and
`services/reference-control-plane/src/capability.mjs`, which mirror each other and answer to
`conformance/capability-vectors.json` for it. This document specifies only the **wire format**:
given a token's field values and a shared secret, how its signature is computed and checked. See
`CT-007`.

---

## CT-001 · Surface

An implementation MUST expose: `sign(token, secret)`, `verify(token, secret)`,
`canonicalLimits(limits)`, `feedField(mac, value)`, a frozen `LIMIT_DIMENSIONS` array of exactly
6 entries, and a frozen `OPERATIONS` array of exactly 4 entries. *(cases: `surface:*`)*

A reference implementation MAY also expose a `parseLimits(raw)` helper that validates untrusted
input into the shape `canonicalLimits` accepts. It is not part of the normative surface: nothing
in `CT-002`–`CT-006` requires it, because the pre-image is computed from a token's `limits`
field directly, however the caller produced it. `parseLimits`'s own validation rules are
therefore a convenience, not a portable guarantee, and are not measured here.

## CT-002 · Canonical field encoding

Every field fed into the signature MUST be encoded as: the UTF-8 bytes of the field's decimal or
literal string form, followed immediately by an **8-byte, little-endian, unsigned** encoding of
the byte length of that UTF-8 text. This length prefix is not optional formatting — without it,
concatenating `"ab"` then `"c"` and concatenating `"a"` then `"bc"` would feed identical bytes to
the hash, and two different tokens would be indistinguishable to the signer. *(cases:
`encoding:*`)*

## CT-003 · Canonical limits string

`canonicalLimits(limits)` MUST produce, for the six dimensions **in this fixed order** —
`memoryBytes`, `cpuSeconds`, `openFiles`, `processes`, `fileSizeBytes`, `coreDumpBytes` — the
string `dimension=value;dimension=value;...` joined by `;`, where an **unset** dimension MUST be
rendered as the single character `-` and a dimension whose value is the integer `0` MUST be
rendered as `0`. When `limits` is absent entirely (`null`/`None`/equivalent), the result MUST be
the literal string `none`.

`0` and unset MUST NOT collide: `coreDumpBytes: 0` is a real and very restrictive limit (it
forbids core dumps), distinct from "this installation places no ceiling on core dumps". An
implementation that renders both the same way makes the two indistinguishable to whatever reads
the signed limits back out. *(cases: `canonicalLimits:*`, driven by the `canonicalLimits` vectors
in `conformance/vectors.json`)*

## CT-004 · The MAC pre-image

Given a token carrying `id`, `planDigest`, `stepId`, `paths` (an ordered list), `operations` (an
ordered list drawn from `OPERATIONS`), `expiresAtUnix` (an integer, Unix seconds),
`usesGranted` (a positive integer) and an optional `limits` object, the pre-image MUST be built
by feeding, **in this exact order**, through `CT-002`'s encoding:

1. `id`
2. `planDigest`
3. `stepId`
4. each entry of `paths`, in list order
5. each entry of `operations`, in list order, **lower-cased**
6. `expiresAtUnix`, as its decimal string form
7. `usesGranted`, as its decimal string form
8. `canonicalLimits(limits)` (`CT-003`)

Every one of the eight items above is signed. Widening any of them after signing — one more path,
one more operation, a later expiry, a higher use count, a larger limit — MUST change the
pre-image and therefore the MAC. *(cases: `mac:*`, driven by the `mac` vectors in
`conformance/vectors.json` — every one of which is a token minted **live**, by the shipped
product's own `TokenMinter`, not hand-constructed; see the vector file's own `note` and
`provenance` fields)*

## CT-005 · MAC algorithm and secret

The MAC MUST be HMAC-SHA256 over the `CT-004` pre-image, rendered as lowercase hexadecimal.
`sign()` and `verify()` MUST refuse — by raising, not by returning a falsy result — a secret
shorter than 32 bytes: a signing key an attacker could exhaust by brute force is not a signing
key, it is an invitation. *(cases: `secret:*`, plus every `mac:*` case, which is this requirement
measured on real inputs)*

## CT-006 · Verification is constant-time and tamper-evident

`verify(token, secret)` MUST recompute the MAC under `CT-004`/`CT-005` and compare it against
`token.mac` in a way that does not leak, through timing, how many leading bytes matched — the
byte-at-a-time alternative tells a forger exactly where its guess diverged. A mismatch MUST
produce `false`, never an exception, never a partial "close enough".

Mutating **any** field the pre-image covers — a path appended, an operation added, the expiry
extended, the use count raised, a limits envelope attached where none was signed, or a single
flipped character of the MAC itself — MUST make `verify()` return `false` against the original
secret. Verifying the same, unmutated token against a **different** secret MUST also return
`false`. *(cases: `tamper:*`, including a mandatory positive control proving the untampered
token still verifies — a suite where every tamper case merely confirms `verify()` always returns
`false` would pass vacuously against a broken implementation)*

## CT-007 · Non-goals — what this surface deliberately excludes

An implementation of this specification MUST NOT need, and a conformant package MUST NOT expose,
any of: which plan a token may descend from, whether a step grants a given path, whether an
operation is destructive, an approval's lifecycle, or a token registry (issued/spent/revoked
bookkeeping). Those are the **authorization policy** — deliberately out of scope, because they are
specific to how NOESAR EVOLUTION structures a Plan and its Steps, not to how a signature is
computed and checked. A second product adopting this wire format is expected to bring its own
policy and reuse only `CT-001`–`CT-006`.

This is checked, not only written: the reference implementation's module surface MUST NOT export
`mint`, `TokenMinter`, `authorizePlan`, `spend`, or `revoke`. *(cases: `nongoals:*`)*

---

## Running the suite against your implementation

```js
import { runConformance } from '@noesar/capability-token/conformance';

const report = await runConformance(yourImplementation);
console.log(`${report.passed}/${report.total}`);
for (const entry of report.results.filter((r) => !r.ok)) {
  console.log(entry.requirement, entry.id, entry.detail);
}
```

It imports no test runner and returns a plain object. In a language that is not JavaScript, the
`canonicalLimits`, `mac` and `tamper` vectors in `conformance/vectors.json` are executable
directly: each carries an input and an exact expected result. **Begin with `canonicalLimits`**: it
needs no secret and no token shape decisions, and every `mac` vector depends on it.
[`conformance/python/`](./conformance/python/) is a worked second implementation, written from
this document rather than translated from the JavaScript — see its own file for what it caught.

**The suite is itself tested against broken implementations** — a missing function, a reordered
pre-image, an ignored short secret, a `verify()` that always returns `false`. A conformance suite
that has never been seen to fail has not been shown to measure anything.
