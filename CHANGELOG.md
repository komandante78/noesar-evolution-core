# Changelog

Every entry here names something a reader can check in this repository. A line nobody can
reproduce from the tree is a defect, the same rule `README.md` states for its numbers.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-09-18

**A fresh installation of `0.1.0` answered 500 on its own home page.** If you installed `0.1.0`,
install this instead. Nothing you created is affected: the defect was in what the installers
copied, not in what the product stores.

### Fixed

- **No installer shipped the data the product reads from its own installation.** The control plane
  opens `schemas/`, `capabilities/` and `docs/governance/` at runtime, and no installer on any
  platform carried them; `apps/shared` and `packages/` were carried on Windows and not by the
  Linux and macOS portable installers, which never received the repair Windows got on 2026-08-31.
  A fresh installation answered `GET /api/v1/sector-modules/catalog` with 500, because
  `sector-modules.mjs` opens `schemas/industry-module-manifest.schema.json` and it was not there.
  All five are shipped now, under 1 MB in total.
- **The check could not have caught it, so the check changed too.**
  `tools/test-cross-platform-installers.mjs` scanned imports, and a `readFileSync` is not an
  import. It now derives the list from the code — every `join(repoRoot, '…')` literal under
  `src/` — and requires each installer to carry what it finds. Those checks fail on the
  installers exactly as they shipped in 0.1.0.
- **The Linux uninstaller removed one of the two commands it had installed**, leaving
  `coden_evolution` on the PATH pointing at a program tree the person believed was gone. It now
  removes both, and prints where the tree and the workspace remain instead of leaving them behind
  in silence.

### Added

- **An installation guide**, [`INSTALLATION/README.md`](INSTALLATION/README.md): every platform,
  what the installers deliberately do not do to a machine, the four answers that prove the product
  really came up, where your data lives, and what each uninstaller does — including the ones that
  do nothing. Before this there were twelve lines about Unraid.
- `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.
- An issue form for ideas beside the one for defects, because "this should work differently" had
  nowhere to go but the defect form.
- Two screenshots of a real installation in the README. Neither could have been taken before this
  release: on 0.1.0 that same page carried a red error toast.

### Known limits

Everything named under 0.1.0 still holds. Two more were found today and are recorded with their
evidence in `docs/OPEN_FINDINGS.tsv`: `F-UI-001` (the product's own Content-Security-Policy
blocks the styling of the link in its own default-password banner) and `F-WIN-002` (the model
store defaults to a container path, so the Models page opens with an ENOENT on Windows).

## [0.1.0] — 2026-09-18

The first tagged release. The product has run since this source line's first commit on
2026-07-25, and `git tag` was empty until today: what was missing was not the software but a
version a person can install, name and report a defect against. This tag is that name.

It is `0.1.0`, and the number is not modesty: nothing has been released before this, so a
higher one would tell a reader about versions that never existed. The limits below are the rest
of the reason, and they are measured, not estimated.

It is published as a **pre-release**. Install it expecting to find defects, and say what you
find — `README.md` has the two forms, one for something broken and one for something that
should be different.

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

### Fixed

- **A Windows installation made anywhere but the default directory started a different one.**
  `Install-Noesar.ps1` copies `Start-Noesar.ps1` and `Show-FirstOwnerToken.ps1` into its
  `-Destination`, and both took their default from one fixed directory under the user profile.
  Measured on 2026-09-18: an install into a second directory, started with the launcher sitting
  in that second directory, brought up the older tree in the first one — it printed an address,
  it answered, and nothing in the output said it was the wrong product. Both now default to
  `$PSScriptRoot`, and the launcher refuses, naming the path it looked at, when no installation
  is there. `tools/test-cross-platform-installers.mjs` gained five checks; they fail on the
  files as they stood before this release.

- **A from-source installation never showed the installation notices.** `INSTALLATION/WELCOME.txt`
  — five points, among them that this product answers with a language model that can be
  confidently wrong, and that the password it starts with is the same on every installation in
  the world — was printed by `deployment/docker/run.sh` and by nothing else; the call graph has
  one caller for `noesar_install_intro`. The three from-source installers (Linux, macOS, Windows)
  now print that same file, record whether a person acknowledged it in
  `<workspace>/config/install-consent.json`, and end by saying how to sign in. No installer keeps
  a copy of the text or of the default credentials: both are read from the file that owns them,
  and a check fails if a copy ever appears.

- **The macOS installer sent people to a port nothing listens on.** It ended by offering
  `http://localhost:8100/` — the port the Unraid container publishes — after a from-source
  installation that listens on 8088, and it never named `portable-start.sh`, the script it had
  just written to start the server. The same defect was fixed on Windows on 2026-08-31 and was
  still alive here. A check now reads the server's own default port and fails on any address an
  installer prints that disagrees with it.

### Known limits

- **macOS has never been executed.** `deployment/macos/install-portable.sh` and
  `deployment/macos/com.noesar.evolution.plist` are carried, not proven: no one has run them on
  that platform, and this release does not claim they work.
- **`deployment/windows/Uninstall-Noesar.ps1` removes nothing.** It is three lines and prints
  two; uninstalling on Windows is a manual deletion of the installation directory.
- **Two medium findings are open**, recorded with their evidence in `docs/OPEN_FINDINGS.tsv`:
  `F4W-005` (the hand-written QR encoder is verified only for versions 1–6, so a username longer
  than 25 characters is refused a QR code and has to enrol with the manual key) and `F4W-006`
  (the login identity store and the multi-user directory are two different stores).
- **No gate runs the driven acceptance probes** in `tools/acceptance/`, recorded as `F-CE021-002`.
  One of them was wrong for eleven days before a hand run found it.
- **Continuous integration covers one crate.** `.github/workflows/noesar-sandbox-extraction.yml`
  proves `rust/crates/noesar-sandbox` still builds outside this repository, and it is the only
  workflow. The suite, both manifests and the linter are gated by `.githooks/pre-commit`, which a
  clone has to enable with `git config core.hooksPath .githooks`; nothing runs them on a push.
- **`docs/LICENSE_STRATEGY.md` is still marked a proposal.** `LICENSE` (AGPL-3.0) and the SPDX
  header on every source file are what governs this release; that document records an intended
  direction and has not been reviewed by counsel.

[0.1.1]: https://github.com/komandante78/noesar-evolution-core/releases/tag/v0.1.1
[0.1.0]: https://github.com/komandante78/noesar-evolution-core/releases/tag/v0.1.0
