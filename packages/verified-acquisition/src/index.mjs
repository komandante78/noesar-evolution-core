// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `@noesar/verified-acquisition` — the public contract.
//
// One problem, solved once: **fetch a document or an artefact that a publisher signed or
// committed to, under a ceiling, and refuse it by name when it is not what was promised.**
//
// Everything a consumer is allowed to depend on is re-exported here. Nothing else in this
// package is contract: `src/transport.mjs` and `src/authenticity.mjs` may be reorganised at any
// time, and reaching past this file is reaching into an implementation.
//
// # What this package guarantees
//
//   ORIGIN     `https` only, with ONE exception: `http` to a loopback host, because a mirror on
//              the same machine is not egress. Every redirect hop is re-checked — a policy
//              applied only to the first URL is a policy a `302` walks around.
//   SIZE       counted WHILE STREAMING. `Content-Length` is a claim by the party being defended
//              against; it is used to refuse early, never to trust late.
//   INTEGRITY  an ARTEFACT is verified against a digest its publisher declared. A DOCUMENT is
//              verified against the publisher's ed25519 signature, because the digest for an
//              artefact is a field of the document — verifying a document by a digest it carries
//              itself would be begging the question.
//   LIVENESS   a stalled connection fails with a name. A download that hangs for ever holds a
//              slot for ever, and "still downloading" after two days is a lie.
//   CONTROL    an `AbortSignal` stops it, reported as `CANCELLED` rather than as an error.
//
// # What it deliberately does NOT do
//
// **No filesystem.** Where bytes land, what may be overwritten and what must be quarantined are
// policy, and policy belongs to the consumer. The transport writes to an injected sink.
//
// **No network of its own.** `fetchImpl` is injected. That is what makes this package's tests —
// and the conformance suite — runnable on any host, offline, with no container.
//
// **No retry, no resume.** A retry loop hides the difference between "the network blinked" and
// "the publisher is gone". Range requests need their own integrity story: a partial prefix under
// a verified name is exactly what the digest check exists to prevent.
//
// **No trust store.** The publisher registry is injected too — anything exposing
// `findActiveKey({publisherId, fingerprint}) -> {publicKeyPem, trustLevel} | null` satisfies it,
// so revocation stays the consumer's to model.
//
// # Contract version
//
// `CONTRACT_VERSION` changes when the shape of an input or a returned refusal changes. A
// consumer pinning a major version is pinning the meaning of every `kind` string below.

export const CONTRACT_VERSION = '1.0.0';

export {
  fetchArtefact,
  fetchDocument,
  checkSource,
  TransportRefusal,
  ModelTransportError,
} from './transport.mjs';

export {
  verifyModelDescriptor,
  signModelDescriptor,
  authenticitySummary,
  canonicalDescriptorBytes,
  publicKeyFingerprint,
  DescriptorAuthenticity,
} from './authenticity.mjs';

export { canonicalJson, canonicalJsonBytes } from './canonical-json.mjs';

/**
 * Every refusal this package can return, in one frozen list.
 *
 * Exported so a consumer can assert it handles all of them — and so the conformance suite can
 * fail an implementation that invents a refusal nobody downstream knows how to render. A
 * refusal a caller cannot enumerate is a refusal that reaches a person as "something failed".
 */
export const REFUSALS = Object.freeze({
  transport: Object.freeze([
    'NO_SOURCE', 'SCHEME_NOT_ALLOWED', 'REDIRECT_LIMIT', 'REDIRECT_WITHOUT_LOCATION',
    'HTTP_STATUS', 'NO_BODY', 'SIZE_CAP_EXCEEDED', 'DIGEST_MISMATCH', 'STALLED',
    'CANCELLED', 'TRANSPORT_ERROR',
  ]),
  authenticity: Object.freeze([
    'NO_SIGNATURE', 'NO_PUBLISHER', 'NO_REGISTRY', 'KEY_NOT_TRUSTED', 'SIGNATURE_INVALID',
  ]),
});
