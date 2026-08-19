# `@noesar/verified-acquisition`

Fetch a **publisher-signed document** or a **digest-committed artefact**, under a byte ceiling,
and refuse it **by name** when it is not what was promised.

Zero dependencies. No filesystem, no network of its own, no trust store — all three are injected,
which is why every test and the whole conformance suite run offline, on any host, with no
container and no fixture server.

```js
import { fetchArtefact, fetchDocument, verifyModelDescriptor } from '@noesar/verified-acquisition';
```

## Why this exists as its own thing

Every self-hosted AI project eventually has to fetch a model from somewhere and decide whether to
believe it. Most solve it by shelling out to one vendor's CLI, which makes the product depend on
that vendor to own its own weights. The problem is small, general and entirely solvable in the
open: this is that solution, extracted from a product rather than imagined for one.

## What it guarantees

| | |
|---|---|
| **Origin** | `https` only, with one exception: `http` to a **loopback** host, because a mirror on the same machine is not egress — that is the air-gapped and LAN-mirror case, and it is first-class rather than an afterthought. **Every redirect hop is re-checked**: a policy applied only to the first URL is a policy a `302` walks around. |
| **Size** | The ceiling is counted **while streaming**. `Content-Length` is a claim by the party being defended against; it is used to refuse early, never to trust late. A body that declares 2 bytes and sends 9 is still cut off at the cap. |
| **Integrity — artefacts** | sha256 computed over the bytes as they arrive and compared with what the **publisher declared**. A mismatch is a refusal carrying **both** digests, never a warning. |
| **Integrity — documents** | ed25519 over the canonical JSON of the document **without its own signature**, verified against a key the caller's registry says is **active**. A document cannot be verified by a digest it carries itself — that is begging the question, and it is why documents and artefacts take different paths here. |
| **Liveness** | A stalled read fails as `STALLED` on a deadline. A download that hangs for ever holds a slot for ever, and "still downloading" after two days is a lie a UI will faithfully render. |
| **Control** | An `AbortSignal` stops it, reported as `CANCELLED` rather than as an error — a person changing their mind is not a fault. |

## What it deliberately does not do

- **No filesystem.** Where bytes land, what may be overwritten, what must be quarantined: that is
  policy, and policy belongs to the consumer. The transport writes to an injected sink
  (`{ write, close, abort }`).
- **No retry.** A retry loop hides the difference between "the network blinked" and "the publisher
  is gone", and a guess reported as a result is worse than a refusal.
- **No resume.** Range requests need their own integrity story. A partial prefix stored under a
  verified name is exactly what the digest check exists to prevent.
- **No trust store.** Anything exposing
  `findActiveKey({ publisherId, fingerprint }) -> { publicKeyPem, trustLevel } | null` satisfies
  the registry contract, so **revocation stays yours to model** — and revocation works
  retroactively if you consult your registry on every read rather than caching a verdict.

## Usage

```js
import { fetchArtefact, TransportRefusal } from '@noesar/verified-acquisition';

const result = await fetchArtefact({
  source: descriptor.source,             // checked against the origin policy, every hop
  expectedSha256: descriptor.hashes.sha256,
  maxBytes: 64 * 1024 * 1024 * 1024,
  fetchImpl: (...args) => fetch(...args),
  sink,                                  // { write(chunk), close(), abort(reason) }
  signal: controller.signal,
  onProgress: ({ receivedBytes, totalBytes }) => report(receivedBytes, totalBytes),
});

if (!result.ok) {
  // Never "download failed": each kind names a different thing that is wrong.
  if (result.kind === TransportRefusal.DIGEST_MISMATCH) quarantine(result.digest, result.expected);
  else refuse(result.kind, result.reason);
}
```

```js
import { fetchDocument, verifyModelDescriptor, authenticitySummary } from '@noesar/verified-acquisition';

const fetched = await fetchDocument({ source, fetchImpl });           // capped, no digest needed
const document = JSON.parse(fetched.text);
const authenticity = authenticitySummary(verifyModelDescriptor({ descriptor: document, registry }));
if (!authenticity.verified) refuse(authenticity.kind, authenticity.reason);
```

A refusal is always a **returned result**, never a thrown exception. Exceptions are reserved for
programmer error — a missing `fetchImpl`, a missing sink, or attempting an artefact fetch with no
declared digest, which is a state this package refuses to make reachable.

## Publishing a descriptor a NOESAR installation will accept

An installation refuses an unsigned descriptor (`NO_SIGNATURE`) and refuses to start a model from
one. Producing a signed one by hand means reproducing the canonical JSON encoding exactly, knowing
that the signature covers the document with its own `signature` field removed, and that the
fingerprint is a sha256 over the SPKI DER of the public key. `tools/sign-model-descriptor.mjs` is
that procedure, executable:

```sh
node tools/sign-model-descriptor.mjs keygen --publisher acme --out-dir ./keys
node tools/sign-model-descriptor.mjs sign   --descriptor tiny.json --private-key ./keys/acme.private.pem --output tiny.signed.json
node tools/sign-model-descriptor.mjs verify --descriptor tiny.signed.json --public-key ./keys/acme.pub.pem
```

**Three properties, each there for a reason a publisher can feel.** `sign` validates against
[`schemas/model-descriptor.schema.json`](../../schemas/model-descriptor.schema.json) *first* — a
valid signature over a malformed descriptor is refused downstream for a reason that has nothing to
do with authenticity, and the two failures are indistinguishable from the outside. `verify` builds
a one-key registry and calls `verifyModelDescriptor()`, the same function the server calls, so this
tool can never drift into accepting what the product rejects. And nothing here touches the network:
the private key is used where it was made and written nowhere else.

Exit codes are part of the interface — `0` ok · `2` usage · `3` the descriptor does not match the
schema · `4` refused. The validator is exported too (`validateAgainstSchema`, `formatSchemaErrors`),
so a publisher's own pipeline can check shape without shelling out.

The **operator**, not the publisher, completes the chain: until the public half is registered
(`POST /api/v1/publishers/register`, Owner + recent strong reauthentication) a descriptor signed
with that key verifies as `KEY_NOT_TRUSTED` — correctly, since the installation has never been
told who you are.

## Refusals

Every one is enumerated in `REFUSALS`, frozen, so a consumer can assert it handles all of them. A
refusal a caller cannot enumerate reaches a person as "something failed".

**Transport** — `NO_SOURCE` · `SCHEME_NOT_ALLOWED` · `REDIRECT_LIMIT` ·
`REDIRECT_WITHOUT_LOCATION` · `HTTP_STATUS` · `NO_BODY` · `SIZE_CAP_EXCEEDED` · `DIGEST_MISMATCH` ·
`STALLED` · `CANCELLED` · `TRANSPORT_ERROR`

**Authenticity** — `NO_SIGNATURE` · `NO_PUBLISHER` · `NO_REGISTRY` · `KEY_NOT_TRUSTED` ·
`SIGNATURE_INVALID`

`NO_REGISTRY` is a refusal and not a pass: "we could not check" must never render as "it is fine".

## Conformance

**[`SPEC.md`](./SPEC.md) is the normative document** — twelve requirements (`VA-001`…`VA-012`),
each naming the conformance case family that measures it. Implement from that, then run the suite.
The mapping is enforced in both directions: a requirement no case measures, or a case naming a
requirement that does not exist, fails the package's own tests.

**Start with `VA-012`, canonical encoding.** It is the only requirement that can be satisfied
before any key exists, and everything else in the authenticity half depends on it: a signer that
orders object members differently produces a signature valid over bytes nobody else computes, and
downstream that is indistinguishable from tampering. Its vectors carry the input, the exact
expected string **and** its SHA-256, so an implementation in any language is measured against
those bytes rather than against its own encoder agreeing with itself — no key material needed.

**[`conformance/python/`](./conformance/python/) is a worked example of exactly that**: a second
implementation of `VA-012`, written from the specification rather than translated from the
JavaScript, that reads `vectors.json` as data and passes all 16 vectors plus the refusals. It is
a conformance oracle, not a product component — and the six places where Python's defaults differ
from these rules are listed in `SPEC.md` `VA-012`, because they are where your implementation will
differ too. Five were handled while writing it; **the sixth was caught by the vectors**, which is
the entire argument for having them.

The conformance suite is the part of this package worth more than the code. The code is one
implementation; the suite is the **specification made executable**, so a second implementation —
another language, another product, another transport — can be held to the same guarantees instead
of to a second reading of this README.

```js
import { runConformance } from '@noesar/verified-acquisition/conformance';

const report = await runConformance(yourImplementation);
console.log(`${report.passed}/${report.total}`);
report.results.filter((entry) => !entry.ok).forEach((entry) => console.log(entry.id, entry.detail));
```

It imports **no test runner** and returns a plain object, so it can be driven by `node:test`, by
your own harness, or by a script that prints a table. The origin-policy half is declarative
(`conformance/vectors.json`) and executable by a runtime that is not JavaScript at all.

The suite is tested against **broken** implementations as well as the reference one — a missing
function, a more permissive origin policy, an ignored byte ceiling — because a conformance suite
that has never been seen to fail has not been shown to measure anything.

## Contract version

`CONTRACT_VERSION` changes when the shape of an input or of a returned refusal changes. Pinning a
major version pins the meaning of every `kind` string above. Everything outside `src/index.mjs` is
implementation and may be reorganised without notice.

## Status and provenance

Extracted from **NOESAR EVOLUTION**, where it is the transport behind model acquisition. The
extraction is real, not a copy: the product imports this package, so there is exactly one
implementation of these guarantees and it is the one measured here.

Two things are deliberately still open and are named rather than implied:

- **Publication is a separate decision.** This package is not published to any registry, and the
  repository it lives in is private until its owner decides otherwise.
- **The licence follows the product** (`AGPL-3.0-or-later`). Whether a component meant for
  adoption by other projects should carry a more permissive licence — as the sibling
  `@noesar/sdk` does — is an open question for its owner and has not been settled here.
- **Some in-file commentary still cites this project's own decision records** (`D-05xx`, `MC-00x`).
  It is honest provenance, not a dependency: nothing in the code reads them.
