# Verified Acquisition — specification v1.0.0

What an implementation must do to call itself conformant. Written so it can be implemented in any
language, from this document alone, and then **measured** by
[`conformance/`](./conformance/index.mjs) rather than by reading the reference code.

Each requirement carries the id of the conformance case family that measures it. That mapping is
enforced: `test/conformance.test.mjs` fails if a requirement here has no case, or a case names a
requirement that is not here. A specification and a suite that can drift apart are a specification
nobody can trust.

**Language.** MUST / MUST NOT / MAY are used in the RFC 2119 sense.

**Two operations, two different integrity stories.** An **artefact** is bytes whose publisher
committed to a digest in a document. A **document** is what carries that commitment. An artefact
is therefore verified against its declared digest; a document cannot be — verifying a document
against a digest it carries itself is begging the question — so it is verified against the
publisher's signature. An implementation that verifies documents by digest is not conformant.

---

## VA-001 · Surface

An implementation MUST expose: `fetchArtefact`, `fetchDocument`, `checkSource`,
`verifyModelDescriptor`, `signModelDescriptor`, `publicKeyFingerprint`, and a frozen `REFUSALS`
enumeration. *(cases: `surface:*`)*

## VA-002 · Origin policy

`checkSource(source)` MUST allow `https` for any host, and MUST allow `http` **only** when the
host is loopback — `localhost`, `::1`, or any address in `127.0.0.0/8`. Every other scheme, and
`http` to any non-loopback host, MUST be refused as `SCHEME_NOT_ALLOWED`. A value that is not a URL,
including an empty or absent one, MUST be refused as `NO_SOURCE`.

A hostname that merely *contains* `localhost` (`localhost.attacker.example`) is **not** loopback.
*(cases: `origin:*`, driven by `conformance/vectors.json` → `origin`)*

## VA-003 · Artefact integrity

`fetchArtefact` MUST require a 64-character hex sha256 supplied by the caller and MUST refuse to
run without one — this is a programmer error and MUST throw, not return a refusal. It MUST compute
sha256 over the bytes as they arrive and compare it with the declared value. A mismatch MUST be
returned as `DIGEST_MISMATCH` carrying **both** digests. *(cases: `artefact:*`)*

## VA-004 · Size ceiling

When `maxBytes` is given, an implementation MUST stop the transfer as soon as the **received**
byte count exceeds it and MUST return `SIZE_CAP_EXCEEDED`. It MUST NOT rely on `Content-Length`
for this: that header is a claim by the party being defended against. It MAY use `Content-Length`
to refuse **before** the first byte is written when the declared length already exceeds the cap.
*(cases: `cap:*`)*

## VA-005 · Redirects

Redirects MAY be followed. Every hop MUST be re-checked against VA-002 — a downgrade to plain
`http` on a redirect MUST be refused. The number of hops MUST be bounded and exceeding it MUST
return `REDIRECT_LIMIT`. A 3xx without a `Location` MUST return `REDIRECT_WITHOUT_LOCATION`.
*(cases: `redirect:*`)*

## VA-006 · Liveness

A transfer that receives no byte within a bounded deadline MUST fail as `STALLED`. An
implementation MUST NOT wait indefinitely on a silent connection. *(cases: `liveness:*`)*

## VA-007 · Cancellation

An implementation MUST accept a cancellation signal, MUST stop the transfer when it is raised, and
MUST report `CANCELLED` — never an error. A person changing their mind is not a fault.
*(cases: `control:*`)*

## VA-008 · Failure is returned, not thrown

Every condition in VA-002…VA-010 MUST be returned as a result object carrying a `kind`. Exceptions
are reserved for programmer error: a missing fetch implementation, a missing sink, or a missing
declared digest. An unreachable source MUST be `TRANSPORT_ERROR`; a non-2xx status MUST be
`HTTP_STATUS` carrying the status. *(cases: `failure:*`)*

## VA-009 · Documents

`fetchDocument` MUST fetch under VA-002, VA-004, VA-006 and VA-007 exactly as `fetchArtefact`
does, and MUST NOT require a pre-declared digest. Its integrity comes from VA-010.
*(cases: `document:*`)*

## VA-010 · Authenticity

`verifyModelDescriptor({descriptor, registry})` MUST verify an ed25519 signature over the
canonical JSON encoding of the document **with its own `signature` member removed**, against a key
the registry reports as **active**.

The registry is injected. Anything exposing
`findActiveKey({publisherId, fingerprint}) -> {publicKeyPem, trustLevel} | null` satisfies it, and
it MUST be consulted on **every** verification — never cached — so that a revocation applies to a
document verified a moment earlier.

Refusals, each distinct:

| kind | when |
|---|---|
| `NO_SIGNATURE` | the document carries no signature, or no key fingerprint |
| `NO_PUBLISHER` | the document names no publisher, so a signature cannot be attributed |
| `NO_REGISTRY` | no registry was supplied. **This is a refusal, never a pass** — "we could not check" MUST NOT render as "it is fine" |
| `KEY_NOT_TRUSTED` | the registry has no active key of that publisher with that fingerprint. Unknown, unregistered and revoked are ONE kind on purpose: the answer is identical and the distinction is what an attacker would like reported back |
| `SIGNATURE_INVALID` | the key is trusted and the bytes do not verify under it — including an unsupported algorithm |

The canonical encoding MUST be deterministic and MUST sort object members, so two implementations
signing the same document produce the same bytes.

**The registry is the verifier's trust store, never the document's claim about itself.** An
implementation that looks up the publisher named *in the document* against a store built from that
same name will report `SIGNATURE_INVALID` where it should report `KEY_NOT_TRUSTED`, and will
recognise every forgery that renames itself. *(cases: `authenticity:*`, including the fixed
cross-language vectors in `conformance/vectors.json` → `authenticity`, which carry public key
material and signatures only — no private key is needed to verify, and none is published)*

## VA-011 · Enumerated refusals

Every `kind` an implementation can produce MUST appear in its `REFUSALS` enumeration, and that
enumeration MUST be immutable. A refusal a caller cannot enumerate reaches a person as "something
failed". *(cases: `refusals:*`)*

---

## Running the suite against your implementation

```js
import { runConformance } from '@noesar/verified-acquisition/conformance';

const report = await runConformance(yourImplementation);
console.log(`${report.passed}/${report.total}`);
for (const entry of report.results.filter((r) => !r.ok)) {
  console.log(entry.requirement, entry.id, entry.detail);
}
```

It imports no test runner and returns a plain object. In a language that is not JavaScript, the
`origin` and `authenticity` vector arrays in `conformance/vectors.json` are executable directly:
each carries an input, an expected verdict and, where the verdict is a refusal, the exact `kind`.

**The suite is itself tested against broken implementations** — a missing function, a more
permissive origin policy, an ignored byte ceiling. A conformance suite that has never been seen to
fail has not been shown to measure anything.
