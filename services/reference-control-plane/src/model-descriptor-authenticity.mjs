// SPDX-License-Identifier: AGPL-3.0-or-later
//
// **The implementation moved** — `D-0526`. It now lives in
// `packages/verified-acquisition/src/authenticity.mjs`, behind that package's public entry point.
//
// This file stays and re-exports: rule 12 forbids deletion, the existing call sites and suites
// import this path, and one implementation checked by one conformance suite is the whole point of
// the extraction. See `model-transport.mjs`'s note and the package README.

export {
  DescriptorAuthenticity,
  canonicalDescriptorBytes,
  publicKeyFingerprint,
  signModelDescriptor,
  verifyModelDescriptor,
  authenticitySummary,
} from '../../../packages/verified-acquisition/src/authenticity.mjs';
