// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who says this model is this model — `D-0521`, built.
//
// `D-0520` gave the product a transport that will not make an artefact startable unless its
// bytes match the sha256 **the publisher declared**. That guarantee rests entirely on the
// descriptor: it names the source, and it names the digest. Until this file, a descriptor was
// a JSON file an operator dropped into `models/catalog/`, believed because it was there.
//
// So the strongest link guarded the bytes while the metadata deciding *which* bytes to fetch —
// and what they must hash to — arrived unsigned. This closes that, and it is the precondition
// for discovery being anything better than "trust a URL".
//
// # Nothing new is invented, deliberately
//
// The signature is the shape `sector-modules.mjs` already uses for high-risk module manifests:
// ed25519 over `canonicalJsonBytes(document without its own signature)`, carrying the signing
// key's fingerprint so the verifier can look up **which** key, in the registry that already
// holds revocation. A second signature format in one product is a second thing to get wrong,
// and `D-0275` already found this project growing three copies of one canonicaliser.
//
// # The refusals, and why each is separate
//
//   NO_SIGNATURE        nobody signed it. Absent and wrong are different failures.
//   NO_PUBLISHER        it names no origin, so there is nothing to look up.
//   NO_REGISTRY         this installation has no registry wired — cannot verify, never "fine".
//   KEY_NOT_TRUSTED     unknown publisher, unknown fingerprint, or a key that IS registered and
//                       has been REVOKED. One kind, because the answer is the same and the
//                       distinction is exactly what an attacker would like reported back.
//   SIGNATURE_INVALID   the key is trusted and the bytes do not verify under it.
//
// # What this file does not do
//
// **No filesystem, no network, no policy.** It answers "is this document authentic", and the
// caller decides what an inauthentic one is allowed to do. Keeping the decision out of here is
// what lets the catalogue SHOW an unsigned descriptor while refusing to acquire from it —
// hiding it would teach nobody anything, and `MC-002` already refuses that habit for lanes.

import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { canonicalJsonBytes } from './canonical-json.mjs';

export const DescriptorAuthenticity = Object.freeze({
  VERIFIED: 'VERIFIED',
  NO_SIGNATURE: 'NO_SIGNATURE',
  NO_PUBLISHER: 'NO_PUBLISHER',
  NO_REGISTRY: 'NO_REGISTRY',
  KEY_NOT_TRUSTED: 'KEY_NOT_TRUSTED',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
});

/** The bytes that are signed: the descriptor without its own signature, canonically encoded. */
export function canonicalDescriptorBytes(descriptor) {
  const { signature: _signature, authenticity: _authenticity, ...rest } = descriptor ?? {};
  return canonicalJsonBytes(rest);
}

/** Same fingerprint `sector-modules.mjs` computes, so one key has one identity product-wide. */
export function publicKeyFingerprint(key) {
  const publicKey = key.type === 'private' ? createPublicKey(key) : key;
  return createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
}

/**
 * Sign a descriptor. Exported because a product that requires signed descriptors and ships no
 * way to make one is a product that requires nothing — the Owner's own publisher signs through
 * this, and so does every test that proves the chain end to end.
 */
export function signModelDescriptor(descriptor, privateKeyPem, { signedAt = null } = {}) {
  const privateKey = createPrivateKey(privateKeyPem);
  const value = cryptoSign(null, canonicalDescriptorBytes(descriptor), privateKey);
  return {
    ...descriptor,
    signature: {
      algorithm: 'ed25519',
      value: value.toString('base64'),
      publicKeyFingerprint: publicKeyFingerprint(privateKey),
      signedAt: signedAt ?? new Date().toISOString(),
    },
  };
}

const refusal = (kind, reason) => ({ verified: false, kind, reason });

/**
 * Is this descriptor what the publisher it names actually published?
 *
 * @param {object} options
 * @param {object} options.descriptor  the descriptor as read, signature included
 * @param {object} options.registry    a `PublisherRegistry` — consulted HERE and not cached
 *                                     upstream, so a revocation applies to this read and not
 *                                     only to future ones (the posture `MC-001` already takes)
 * @returns {{verified:true,publisherId:string,fingerprint:string,trustLevel:string}
 *          |{verified:false,kind:string,reason:string}}
 */
export function verifyModelDescriptor({ descriptor, registry = null } = {}) {
  const signature = descriptor?.signature;
  if (!signature || typeof signature.value !== 'string' || !signature.publicKeyFingerprint) {
    return refusal(DescriptorAuthenticity.NO_SIGNATURE, 'this descriptor carries no publisher signature, so nothing states where it came from');
  }
  if (signature.algorithm && String(signature.algorithm).toLowerCase() !== 'ed25519') {
    return refusal(DescriptorAuthenticity.SIGNATURE_INVALID, `"${signature.algorithm}" is not a signature algorithm this installation verifies`);
  }
  const publisherId = descriptor?.publisher;
  if (!publisherId) return refusal(DescriptorAuthenticity.NO_PUBLISHER, 'the descriptor names no publisher, so its signature cannot be attributed');
  if (!registry?.findActiveKey) return refusal(DescriptorAuthenticity.NO_REGISTRY, 'no publisher registry is available, so no origin can be verified');

  // `declaredTrustLevel` is deliberately not passed: a descriptor declares no trust level, and
  // inventing one here would compare a field against itself. The registry still refuses a key
  // that is unknown or revoked, which is the question being asked.
  const keyRecord = registry.findActiveKey({ publisherId, fingerprint: signature.publicKeyFingerprint });
  if (!keyRecord) {
    return refusal(DescriptorAuthenticity.KEY_NOT_TRUSTED, `no active key of "${publisherId}" matches the fingerprint this descriptor was signed with`);
  }

  let verified = false;
  try {
    verified = cryptoVerify(null, canonicalDescriptorBytes(descriptor), createPublicKey(keyRecord.publicKeyPem), Buffer.from(signature.value, 'base64'));
  } catch (error) {
    return refusal(DescriptorAuthenticity.SIGNATURE_INVALID, `the signature could not be checked: ${error.message}`);
  }
  if (!verified) {
    return refusal(DescriptorAuthenticity.SIGNATURE_INVALID, 'the signature does not verify against the registered key of this publisher — the descriptor has been altered since it was signed');
  }
  return {
    verified: true,
    kind: DescriptorAuthenticity.VERIFIED,
    publisherId,
    fingerprint: signature.publicKeyFingerprint,
    trustLevel: keyRecord.trustLevel ?? null,
    signedAt: signature.signedAt ?? null,
  };
}

/**
 * The summary the catalogue and the page carry per descriptor.
 *
 * Never `null` and never absent: an unverifiable descriptor gets a summary that SAYS so, so a
 * missing field can never be read as "fine". That is the same reason `undeclared` is a visible
 * category in `model-catalog.mjs` rather than an empty space.
 */
export function authenticitySummary(result) {
  if (result?.verified) {
    return { verified: true, kind: DescriptorAuthenticity.VERIFIED, signedBy: result.publisherId, fingerprint: result.fingerprint, trustLevel: result.trustLevel ?? null, reason: null };
  }
  return {
    verified: false,
    kind: result?.kind ?? DescriptorAuthenticity.NO_SIGNATURE,
    signedBy: null,
    fingerprint: null,
    trustLevel: null,
    reason: result?.reason ?? 'this descriptor has not been verified against a registered publisher',
  };
}
