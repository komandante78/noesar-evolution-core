// SPDX-License-Identifier: AGPL-3.0-or-later
//
// **The implementation moved** — `D-0526`. It now lives in
// `packages/verified-acquisition/src/transport.mjs`, behind that package's public entry point.
//
// This file stays, and re-exports, for a reason that is not politeness: `CLAUDE10.md` rule 12
// forbids deletion, and eleven call sites and suites import this path. Re-exporting keeps **one**
// implementation — the failure mode a copy would produce is the one `D-0275` already found in
// this repository, where three modules had each grown their own copy of one canonical-JSON
// encoder and no two could be checked against each other.
//
// New code should import from the package, not from here:
//
//     import { fetchArtefact } from '../../../packages/verified-acquisition/src/index.mjs';
//
// The package is dependency-free, injects its filesystem, its network and its trust store, and
// carries the conformance suite that says what these guarantees mean. See its README.

export {
  TransportRefusal,
  ModelTransportError,
  checkSource,
  fetchArtefact,
  fetchDocument,
} from '../../../packages/verified-acquisition/src/transport.mjs';
