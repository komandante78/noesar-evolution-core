// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The release number, in one place.
//
// It was written as a literal three times in `server.mjs` (`PRODUCT_IDENTITY.version`,
// `PRODUCT.version`, `PRODUCT.releaseVersion`) and twice more outside JavaScript's reach, in
// `package.json` and `package-lock.json`. A number kept in five files is the number that goes
// stale: the product would have gone on announcing one version on `/healthz`, in the About page
// and in the Prometheus `build_info` gauge while the repository had already moved on.
//
// The three inside the code now read this constant. The two outside it cannot, so
// `test/release-version.test.mjs` fails when they stop agreeing with it — the only thing that
// keeps a release number honest across files that no import can reach.
export const RELEASE_VERSION = '0.1.2';
