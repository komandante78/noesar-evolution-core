# Changelog

Every entry here names something a reader can check in this repository. A line nobody can
reproduce from the tree is a defect, the same rule `README.md` states for its numbers.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] — 2026-09-18

The first tagged release. The product has run since this source line's first commit on
2026-07-25, and `git tag` was empty until today: what was missing was not the software but a
version a person can install, name and report a defect against. This tag is that name.

It is a `0.x` on purpose. The limits below are the reason, and they are measured, not estimated.

### Added

- `CHANGELOG.md` — this file. Releases before this one have no entry and will not be given one
  after the fact; `git log` is their record.
- `services/reference-control-plane/src/release-version.mjs` — `RELEASE_VERSION`, the single
  place the release number is written in code.
- `services/reference-control-plane/test/release-version.test.mjs` — fails when `package.json`,
  `package-lock.json` and that constant stop agreeing, which is the only thing keeping a release
  number honest across files no import can reach.

### Changed

- The release number was a literal in three places in `server.mjs` — `PRODUCT_IDENTITY.version`,
  `PRODUCT.version` and `PRODUCT.releaseVersion`, the three strings behind `/healthz`, the About
  page and the Prometheus `build_info` gauge. All three now read `RELEASE_VERSION`.
- `package.json` declares `license` (`AGPL-3.0-or-later`, the identifier already at the top of
  every source file and the licence in `LICENSE`) and `repository`. It carried neither.

### Known limits

- **macOS has never been executed.** `deployment/macos/install-portable.sh` and
  `deployment/macos/com.noesar.evolution.plist` are carried, not proven: no one has run them on
  that platform, and this release does not claim they work.
- **`deployment/windows/Uninstall-Noesar.ps1` removes nothing.** It is three lines and prints
  two; uninstalling on Windows is a manual deletion of the installation directory.
- **Three medium findings are open**, recorded with their evidence in `docs/OPEN_FINDINGS.tsv`:
  `F4W-005` (the hand-written QR encoder is verified only for versions 1–6), `F4W-006` (the login
  identity store and the multi-user directory are two different stores), `F-CE021-001` (a driven
  probe asserts an approval flow the engine deliberately no longer has).
- **Continuous integration covers one crate.** `.github/workflows/noesar-sandbox-extraction.yml`
  proves `rust/crates/noesar-sandbox` still builds outside this repository, and it is the only
  workflow. The suite, both manifests and the linter are gated by `.githooks/pre-commit`, which a
  clone has to enable with `git config core.hooksPath .githooks`; nothing runs them on a push.
- **`docs/LICENSE_STRATEGY.md` is still marked a proposal.** `LICENSE` (AGPL-3.0) and the SPDX
  header on every source file are what governs this release; that document records an intended
  direction and has not been reviewed by counsel.

[0.7.0]: https://github.com/komandante78/noesar-evolution-core/releases/tag/v0.7.0
