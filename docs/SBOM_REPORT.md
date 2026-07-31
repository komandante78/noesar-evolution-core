# SBOM report

**Status:** `SBOM_CYCLONEDX=PASS` · `SBOM_SPDX=PASS`
**Supersedes:** `SBOM_STATUS.md`, whose verdict was `SBOM_CONFORMANCE=PARTIAL`.

---

## Provenance

| Field | Value |
|---|---|
| Tool | `syft` |
| Version | **1.49.0** |
| Container | `anchore/syft@sha256:13b53ebabe3d215268c90cf8fb9b875f0183908245f376fd4b3a2cb69d21d484` |
| Target image | `noesar-evolution:phase4-complete` |
| Target image id | `sha256:ec2ac8bd45510c782041ae3970d860faa6f5a5bfe48b0a3f8d4822077c5caa05` |
| Base image | `node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3` |
| Generated (UTC) | 2026-07-25T14:11:45Z |
| Image command | `syft scan docker-archive:image.tar -o <format>` |
| Source command | `syft scan dir:/src -o <format>` |
| Generator | `tools/generate-sbom.sh` |

Two decisions worth recording:

* **syft runs from a container pinned by digest, never installed on this host.** CLAUDE10
  rule 45 forbids installing tooling, and "whatever `:latest` is today" would make the
  output unreproducible.
* **The image is exported with `docker save` and scanned as a tar archive**, not through
  the Docker daemon. The SBOM container therefore never receives the Docker socket — the
  socket this product's own threat model refuses to mount anywhere.

The repository is mounted read-only at `/src`, so recorded paths are repository-relative
and carry no host path.

## Documents

| Document | Format | Bytes | sha256 |
|---|---|---|---|
| `image.cyclonedx-json.json` | CycloneDX 1.7 | 3 237 561 | `842f1b14b069becda1bfed57e1afd4f5e2d65406ec39052220755848d620deb4` |
| `image.spdx-json.json` | SPDX 2.3 | 7 178 783 | `5b2a760510df74cb88eff2099cb7d418b31fbda9efdf3be9a9253f03e6f125a1` |
| `source.cyclonedx-json.json` | CycloneDX 1.7 | 4 308 223 | `431891b092b4ed0d2f7652877927406e816e0272f4178db79a8cdae79b9567aa` |
| `source.spdx-json.json` | SPDX 2.3 | 7 386 983 | `aa28cf443cca284631288a83958ad9bd658a566c61feebf568504ab02822fdd2` |

Location: `$ARTIFACT_ROOT/sbom/`, with `SHA256SUMS.txt` and `PROVENANCE.txt` alongside.

## Coverage against the requirement

| Required | Covered |
|---|---|
| OCI image | yes — image id, layers, labels, base digest |
| OS packages | **333** Debian packages from the image's own dpkg database |
| Node dependencies | **199** npm components (see the note below) |
| Rust workspace | first-party crates, in the source scan |
| Vendored crates | **3 586** cargo entries, 1 394 distinct name@version, 603 distinct names |
| First-party files | **7 942** files in the image with hashes; 129 in the source scan |
| Declared licences | 311 distinct in the image CycloneDX; 165 declared in the image SPDX |
| Image hash | recorded above |
| Base image digest | recorded above |

Totals: image CycloneDX **8 476** components (532 libraries, 1 application, 1 operating
system, 7 942 files); image SPDX **534** packages, 7 942 files, **10 207** relationships.
Source SPDX **3 773** packages with **14 334** relationships.

## A correction to a Phase 4 statement

Phase 4's inventory recorded "Node: **0** third-party dependencies in the image". syft
finds 199 npm components in the same image. Both numbers are right about different things,
and the distinction matters enough to state:

```text
197  /usr/local/lib/node_modules   npm's own bundled dependency tree, from the base image
  1  /opt/noesar/package.json      the product manifest — declares no dependencies
  1  /opt/yarn-v1.22.22/package.json   yarn, from the base image
```

**The product** has no third-party npm dependency; that claim stands. **The image as
shipped** carries npm and yarn with 197 bundled packages, and those are real components in
the delivered artefact even though nothing the product imports touches them. A vulnerability
matcher run against this image will report on them, correctly.

This is not a defect, but it is a discrepancy between an existing document and reality, so
it is recorded as informational finding **F4C-008**.

## The two Rust numbers

`vendor_file_count` elsewhere in this repository says **113 vendored crates**. syft reports
3 586 cargo entries. Neither is wrong:

* **113** is the number of crate directories under `rust/vendor/` — the vendored snapshot.
* **3 586** is every cargo component syft resolves across all `Cargo.toml` files in the
  tree, including dependency declarations and multiple versions of the same crate; 1 394
  distinct `name@version`, 603 distinct names.

Stated because the two figures look contradictory and a reader is entitled to know which
question each answers.

## Gaps that remain

* **The source scan reports 0 declared licences.** syft reads licences from package
  metadata; `Cargo.toml` licence fields in the vendored tree are not being surfaced by the
  directory scan the way they are for image packages. The image scan's 311/165 figures are
  the usable ones. Licence conclusions for the Rust surface remain a Phase 5 task, and the
  Phase 1 finding still stands: **no first-party component declares a licence** — 12 Rust
  crates and 2 Node packages, no root `LICENSE`, 86 sources without an SPDX header.
* **No signature over any SBOM.** They are checksummed, not signed.
* **Not reproducible bit-for-bit.** The image build is not reproducible, so a second SBOM
  from a second build will differ. The documents record what *this* image contains.
* **No VEX document**, so every reported component is "present", with no statement about
  exploitability.
* **`apps/webui-react` is declared but never built or shipped** — six dependencies, no
  lockfile, never installed. It appears in the source SBOM and not in the image SBOM, which
  is correct and is the reason both scans exist.

## Reproducing

```bash
tools/generate-sbom.sh noesar-evolution:phase4-complete
```

## Re-run 2026-07-28, and a correction

D-0208 (this same day, an earlier phase) built `tools/cbom.mjs` / `tools/generate-mlbom.mjs`
and stated that no SBOM tooling was available on this host beyond the declared-PARTIAL
`tools/generate-inventory.mjs`. **That was wrong** — `tools/generate-sbom.sh` and this
document already existed, `anchore/syft@sha256:13b53eb…` was already cached locally, and
running it needs no network and installs nothing on the host (the exact constraint D-0208
believed it could not satisfy). Found only because the Owner asked, mid-session, to always
check the latest documents in this project before building — this file predates D-0208 by
three days and was not read before it.

Re-run against the then-current production image:

| Field | Value |
|---|---|
| Target image | `noesar-evolution:phase4-recompute-verifier` |
| Target image id | `sha256:acf2e7382f14430f333261be6cb633dc5fe9c2956691020e1e4b71d0c9f3f9f0` |
| syft version | `1.49.0` (unchanged) |
| Generated (UTC) | `2026-07-28T13:31:10Z` |
| Image CycloneDX components | 8 476 (532 libraries, 1 application, 1 OS, 7 942 files) — unchanged from the 07-25 run: no third-party dependency was added by any phase-7 or CodeN-Evolution step |
| `apps/webui-react` | absent from the source scan, as expected — removed entirely in `D-0195`/`D-0196` (2026-07-28), not merely unbuilt as this document previously described |

**A gap this document itself named is now closeable, demonstrated not just stated**: "No
signature over any SBOM" — `tools/sign-release-artifact.mjs` (D-0208, generic Ed25519
signer already reused three times) signs a real ~3.2 MB CycloneDX document in 165 ms,
verified PASS, tamper-rejected. Not run against all four documents in this pass (the
artefacts live in `$ARTIFACT_ROOT/sbom/`, regenerated per image, not committed — signing
them is a release-time step, not something this correction needed to complete to prove
the capability is real).

Artefacts and `SHA256SUMS.txt`/`PROVENANCE.txt` for this run: `$ARTIFACT_ROOT/sbom/`
(default `/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS/sbom/`), overwriting the 07-25 set — the
image only, since a fresh production tag exists after every phase-7 deploy this session
and keeping every historical SBOM was never this document's design.

Re-running against the same image with the same pinned syft digest yields the same
component set; the documents carry a generation timestamp, so their checksums differ.

## Re-run 2026-07-31, and the signing gap actually closed on all four documents

Deferred debt item (`PROJECT_STATE.json.deferred_items`, carried since the 07-28 entry
above): "no signature on the SBOM documents themselves — demonstrated closeable with
`sign-release-artifact.mjs`, not yet run against all four." Closed in full this pass, as
part of Block E+F (debt+packaging) following Block D's completion.

Re-run against the current production image:

| Field | Value |
|---|---|
| Target image | `noesar-evolution:phase4-voice-control` |
| Target image id | `sha256:d935a1ccf919919a25d12cfce963649df098721f8b0dbe219e6f9d9410abc78e` |
| syft version | `1.49.0` (unchanged) |
| Generated (UTC) | `2026-07-31T07:02:41Z` |
| Image CycloneDX components | **8 476** (532 libraries, 1 application, 1 OS, 7 942 files) — unchanged since 07-25: Block D (Research/sessions-TUI/panels/hotkeys/Voice) added zero third-party dependencies, browser-native APIs and existing wire methods only |
| Image SPDX | 534 packages, 10 207 relationships — unchanged |
| Source SPDX | 3 781 packages, 14 388 relationships (+8 packages since 07-28 — the new files this session: `voice-control.js`/`voice-control.test.mjs`/`tui-client-function-keys.test.mjs`/`Dockerfile.phase4-voice-control`/`Dockerfile.phase4-panels-tui`/`Dockerfile.phase4-sessions-tui`, no new dependency) |

**All four documents signed and verified, tamper-rejection proven**:

| Document | Signed file | Verify |
|---|---|---|
| `image.cyclonedx-json.json` | `image.cyclonedx-json.signed.json` | `PASS` |
| `image.spdx-json.json` | `image.spdx-json.signed.json` | `PASS` |
| `source.cyclonedx-json.json` | `source.cyclonedx-json.signed.json` | `PASS` |
| `source.spdx-json.json` | `source.spdx-json.signed.json` | `PASS` |

Fingerprint (all four, same key): `79aba4927f3ee42c0480e5f361b114d177ccac4a882048308d1e8e47e425aa69`

Public key (Ed25519, SPKI PEM — safe to publish, verifies signatures, cannot forge one):

```
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0YmoRcxgbTIlQwY7ZClfbulSuTg92/inyR8Kf4mZK4A=
-----END PUBLIC KEY-----
```

A hostile actor tampering with a signed document after the fact (one byte flipped in
`bomFormat`) was verified to fail: `verify-release-artifact.mjs` reports `FAIL signature
does not verify against the given public key`, not a silent pass.

**⚠️ This key is a demonstration/session key, not a durable release-signing key.** It was
generated fresh for this operation, the private key exists only in this session's own
throwaway scratch directory (never inside this repository, never committed), and will not
survive past this session. Signing these four documents proves the mechanism end to end —
regeneration, signing, and tamper-detecting verification all work on real ~3–7 MB
documents, not a toy example — but it does **not** establish a trustworthy release-signing
identity: nothing links this particular keypair to "NOESAR EVOLUTION, the project" the way
a key held in an HSM, a hardware token, or a secrets manager with recorded custody would.
**Before this becomes a real release gate, the Owner needs to decide where a persistent
signing private key is generated and held** (own machine, HSM, CI secret store, offline
cold storage) — the same class of decision as `EXECUTE`/egress being a per-installation
client choice (`D-0250`/`D-0266`), not something to invent unilaterally here. Once that
key exists, re-signing all four documents with it is the same two commands used above.

Artefacts for this run (unsigned + signed, `SHA256SUMS.txt`/`PROVENANCE.txt` covering all
eight files): `$ARTIFACT_ROOT/sbom/`, overwriting the 07-28 set — same design as before,
image tag changes every phase, historical SBOMs were never kept.
