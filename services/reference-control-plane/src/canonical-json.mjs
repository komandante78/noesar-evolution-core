// SPDX-License-Identifier: AGPL-3.0-or-later
//
// **The implementation moved** — `D-0526`. It now lives in
// `packages/verified-acquisition/src/canonical-json.mjs`, where the signature verification that
// depends on it lives, so an extracted package is self-contained rather than reaching back into
// the product it came from.
//
// This file stays and re-exports. **Nine call sites import this path** — the authority protocol,
// the IPC frame, the update manager, sector modules, the context projector, two suites and two
// tools — and rule 12 forbids deletion. More to the point: a canonical encoder is precisely the
// thing that must never exist twice. `D-0275` found three copies of it in this repository once
// already, each verified only against itself.

export { canonicalJson, canonicalJsonBytes } from '../../../packages/verified-acquisition/src/canonical-json.mjs';
