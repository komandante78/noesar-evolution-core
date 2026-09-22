# Changelog

Every entry here names something a reader can check in this repository. A line nobody can
reproduce from the tree is a defect, the same rule `README.md` states for its numbers.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-09-22

A minor release, because it adds things you can now do and could not before: **CodeN turns a
sentence into a new file, a working program or a repaired one**, a model can be taken straight
from a Hugging Face repository, and an automated change can end in a signed receipt of what it
actually touched. Every item below was found or proven by **using the installed product** — the
browser terminal, the Models page, the chat — and the entries say what was measured.

If you are on `0.1.2`, upgrade: two defects fixed here reach every installation. Opening the
Models page stopped the whole server for up to a minute and a half, and downloading a single
large model silently switched CodeN off.

### Added

- **CodeN creates the file you name.** `/plan Create programmi/somma.mjs that adds two numbers`
  used to be grounded by searching the request's words (`create`, `file`, `title`) inside files
  that already existed, so a file that did not exist yet could never be proposed — measured live,
  the plan picked five unrelated files and wrote none. A path the **person** writes in the request
  is now the plan's file: read if it exists, created if it does not, and marked `(new)` before
  anyone approves it. The path comes from the request, never from the model. Engine state
  (credentials, the audit chain, their copies) and paths outside the workspace are refused when
  named. Measured on the live installation, plan → measure → approve, then executed: a Markdown
  note, a Node.js program (`2 3` → `5`, a missing argument → exit 1), and two repairs of a buggy
  program, each changing only the lines at fault.
- **A file named as a reference is read, not rewritten.** "Create `LEGGIMI.txt` that explains how
  to run `somma.mjs`" plans only the new file; the existing one is handed to the author as
  read-only context (`grounding.context`), and the explanation was written from the real program.
- **A third way to get a model: a repository address.** The Models page takes a Hugging Face
  repository, lists its files, and reads the SHA-256 Hugging Face publishes for each one **before**
  a byte moves, so the download is checked against a digest fixed in advance — the same guarantee
  as a signed descriptor, from a different source. A descriptor from this door declares itself
  (`provenance.kind: publisher-api-digest`, `signed: false`) and is refused if it carries no digest.
- **Effect receipts** (prototype, command line). `tools/effect-receipt.mjs` runs an automated step
  in a throw-away copy, compares what it touched with what it declared, and signs the verdict —
  `CLEAN`, `UNDECLARED_EFFECT`, `DECLARED_FAILED`, `NOT_MEASURED` — as an in-toto Statement in a
  DSSE envelope (Ed25519). Verification recomputes the verdict rather than trusting it. Measured
  on a package whose `postinstall` wrote `~/.ssh/authorized_keys`: `UNDECLARED_EFFECT`. See
  `docs/EFFECT_RECEIPTS.md`.
- **The terminals say what is happening and what comes next.** A "working" line while the engine
  is busy (a plan with a model takes 20–40 s, which read as a lost command), and every answer
  about a run ends with its state, its files and the next command to type — `/measure`,
  `/approve` or `/reject`, `/restore` once promoted. In all three shells.
- **The chat shows which tools an answer used**, under the answer ("Tools used:
  engine_coden_benchLists ✓"). The call was recorded; nothing on screen said so.

### Fixed

- **Opening the Models page stopped the whole server for 45–93 seconds.** Every catalogue request
  computed the SHA-256 of every model file present, synchronously — about 45 GiB on the reference
  installation — and nothing else could be answered meanwhile. Present in every release so far,
`0.1.0` included (introduced on 2026-08-26 by `e9ce8eb9`).
  Digests are now remembered per file and computed in the background at start, with the "racy
  git" rule for a file rewritten within the same instant (found by the test itself). Measured: the
  catalogue answers in 21–26 ms.
- **Downloading one model switched CodeN off.** The throw-away copy CodeN measures in has a 2 GiB
  ceiling, and the workspace it copies is also where the product keeps its own state and models:
  one 9 GB download put it at 8.8 GB, and from then on every `/measure` answered
  "Internal request failure". The copy now leaves the product's own state out, using the same list
  the repository scanner keeps, and a copy that cannot be built is a refusal the caller can read
  (422), not a 500. It also means a command run in the copy cannot read the product's credentials.
- **ATOM wrote a file without being told what was asked.** Asked for "one line saying this file
  was written by CodeN during the live test", it wrote `Attribution: PROVA_LIVE_20260922`: it had
  received `interpret`'s one-sentence summary and never the request, which the local model was
  always shown. The request now reaches ATOM too, through the field its contract already has.
- **`Node.js` was planned as a file to create**, on the first program asked for. A new name with
  no folder, shaped like a product (`Node.js`, `ASP.NET`), is no longer a file.
- **The terminal inside the CodeN page had its own rules** — no `/`, no `plan`, raw JSON. It now
  takes a command with or without the slash, plans like the others, and answers like them. In the
  slash terminals, a bare command word is answered "did you mean /status?" instead of "no model
  wired for prose".
- **`approve()` did not return the status it had saved**, so no shell could say `PROMOTED` or
  offer `/restore` in the one answer where it matters.
- **The log redacted a byte count as a phone number** ("the workspace exceeds [REDACTED_PHONE]
  bytes" — the one figure that explained the failure). A number followed by a unit is kept; a
  phone number is still redacted.

### Security

- **`SECURITY.md` no longer names a personal mailbox.** Vulnerabilities are reported through
  GitHub's private vulnerability reporting, enabled on this repository. Earlier commits still
  carry that address as author; rewriting history would move every hash and tag and recall
  nothing already copied, and was not done.

### Changed

- **`CONTRIBUTING.md` stopped promising what the licence strategy leaves open.** It no longer says
  contributors will never be asked for an agreement; code from outside is not merged into the
  core until the contribution mechanism is decided (`D-0709` in `docs/DECISION_LOG.md`). `NOTICE`,
  the licence inventory and three documents stopped describing files this public tree does not
  contain.

### Known limits

Unchanged from `0.1.2` unless said otherwise.

- **CodeN cannot move, rename or delete a file.** Asked to move one, the plan makes an empty copy
  and cannot remove the original: deleting is unwired on purpose. The plan is shown before anything
  happens and can be rejected; nothing is written unless approved.
- **A Markdown file carrying code examples cannot be written by CodeN.** Both ATOM and this side
  accept exactly one fenced block per answer, and a guide with examples has several. New.
- **CodeN works in the product's own workspace directory**, not in a project directory of its own.
  Engine state is excluded from what it can read, copy or plan; a separate project directory is
  not built yet.
- **One request creates, or changes — not both.** "Create X and change Y" now changes only X.
- **macOS has never been executed**, and Windows is checked statically by the installer gate.
  Still true.
- **`deployment/windows/Uninstall-Noesar.ps1` removes nothing.** Still true.
- **`docs/LICENSE_STRATEGY.md` is still marked a proposal.** `LICENSE` (AGPL-3.0) and the SPDX
  header on every source file are what governs this release.

## [0.1.2] — 2026-09-20

A patch release. Every fix below was found by **running something** — a security audit of the
installed product, and this repository's first real continuous integration — rather than by
reading the code.

If you installed `0.1.1`, nothing you created is affected. Three defects are product-facing: the
chat named the wrong model, the Models page opened on an error about a path nobody chose, and two
pieces of the interface rendered unstyled. The rest are defects a contributor would have hit and
nobody here could see.

### Security

- **The secret scanner had been failing, and nothing in this repository ran it.**
  `tools/run-secret-scan.sh` has existed since 2026-07-27 wired to nothing — not to
  `scripts/test.sh`, not to `.githooks/pre-commit`, not to CI — so the eight findings it had been
  reporting went unseen. All eight were investigated one at a time against an **unredacted**
  report, and **none is a credential**: four are the value a capture wrote *instead of* a secret,
  two are `Sec-WebSocket-Key` handshake nonces — which RFC 6455 has the client invent for every
  connection and which authenticate nothing — one is a test fixture shaped like an API key at 24
  characters where a real one is 51, and one is a four-byte PEM placeholder on a commit the
  existing allowlist did not cover, being the sibling of the commit it did cover. Verified two
  ways that do not depend on the scanner: OpenSSL refuses to decode the PEM
  (`DECODER routines::unsupported`), and `git log --diff-filter=A` over the whole history shows
  the only `.pem` ever added to this repository is a **public** key. `.gitleaks.toml` gained four
  entries, one per cause, none scoped to a rule or to a whole file, so a real secret in any of
  those same files is still caught. The scan is now a step of `scripts/test.sh` and of CI, which
  is the part that matters: a check nobody runs is not a check.

### Added

- **Continuous integration over this repository's own code, for the first time.**
  `.github/workflows/gates.yml` runs the unit suite, the manifest check, ESLint and the secret
  scan on every push and every pull request. Until now the only workflow was scoped to a single
  Rust crate, so a contributor's first pull request met almost no automated check. It found three
  real defects on its first three runs — the last three entries below — each one a constant that
  was true only on the machine this project is developed on.

### Fixed

- **The chat named the wrong model.** Asked which model was answering, the product named a model
  that was not loaded, while the header, the Models page and Research all named the right one —
  the one `llama.cpp`'s own `/v1/models` confirmed was serving every answer, including that one.
  `installationSnapshotForChat()` built its answer from a stored profile that nothing kept in sync
  with the model an operator later loads through the Models page. It now asks the same live
  profile `ProviderGateway.route()` already used to decide who answers, so the two can no longer
  disagree.
- **A busy inference slot made authoring degrade where a moment's wait would not have.** On an
  installation whose runtime has one slot, ATOM and a concurrent chat turn contend for it, and
  losing that race raised `MODEL_UNAVAILABLE` almost instantly — an `EAGAIN`, not a timeout, and
  indistinguishable from ATOM being down. `declaredFallbackGenerator()`, the single place every
  authoring call degrades through, now retries once after a short delay before declaring the
  degradation. A second failure still degrades and is still declared exactly as before: the rule
  that nothing falls back in silence is untouched.
- **On Windows the Models page opened on a raw `ENOENT` about `C:\models`.** The GGUF store
  defaulted to `/models`, which is a mount point inside the container image and not a path that
  exists anywhere else; no installer creates it and no one is told about it. The container still
  gets `/models` where it really exists, so an existing installation is unaffected, and every
  other platform now uses the models directory inside the workspace — the one the product already
  creates. `NOESAR_MODEL_STORE` overrides both, as before.
- **The product's Content-Security-Policy blocked two pieces of its own interface.**
  `style-src 'self'` refuses a style attribute parsed from markup: the default-password banner's
  link lost its colour, and — found while fixing that one, and recorded here for the first time —
  every bar of the review-time sparkline had been rendering at the stylesheet's height instead of
  its own. Both now set the property through the CSSOM, which the policy allows and which the
  surrounding code already used. **The policy was not widened.** A new test forbids the whole
  class rather than these two cases, and carries its own oracle so a check that matched nothing
  could not pass it.
- **Two tests failed for anyone who cloned this repository onto Debian or Ubuntu.** Two sshd
  configurations hard-coded `Subsystem sftp /usr/libexec/sftp-server`, which is the path on the
  distribution this project is developed on; Debian and Ubuntu keep it under `/usr/lib/openssh`.
  Since OpenSSH 9, `scp` speaks SFTP, so that subsystem is what `scp` needs — which is why every
  other test in the same files passed on the runner and only the two that move bytes failed. Both
  now use `internal-sftp`, which is implemented inside sshd and has no path on any platform.
- **The linter could not run outside this machine.** `tools/run-eslint.sh` resolved its cache
  through two environment overrides to a final fallback that was an absolute path on the
  development server, so with neither variable set it died on `mkdir` before reading a single
  file. The hard-coded path is still used wherever it works; otherwise the cache now lands in the
  system temporary directory.

### Known limits

Unchanged from `0.1.1` unless said otherwise.

- **macOS has never been executed.** Still true, and still not claimed to work.
- **`deployment/windows/Uninstall-Noesar.ps1` removes nothing.** Still true.
- **Two medium findings are open**, `F4W-005` and `F4W-006`, recorded with their evidence in
  `docs/OPEN_FINDINGS.tsv`. Still true.
- **No gate runs the driven acceptance probes** in `tools/acceptance/`, recorded as `F-CE021-002`.
  Still true, and narrowed rather than closed: the new workflow runs four gates that never ran on
  a push, but the driven probes start real servers on real ports and are still started by hand.
- **Continuous integration now covers the suite, the manifest, the linter and the secret scan**,
  in addition to the Rust crate. It does **not** cover the twenty-odd other steps of
  `scripts/test.sh`, which need a running product.
- **Nine tools under `tools/` still carry this machine's absolute paths**, recorded as
  `F-TOOL-001`. None is on the CI path, so none was measured, and whether each is a defect or a
  deliberate reference to that server is not yet known.
- **`docs/LICENSE_STRATEGY.md` is still marked a proposal.** `LICENSE` (AGPL-3.0) and the SPDX
  header on every source file are what governs this release.

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

[0.2.0]: https://github.com/komandante78/noesar-evolution-core/releases/tag/v0.2.0
[0.1.2]: https://github.com/komandante78/noesar-evolution-core/releases/tag/v0.1.2
[0.1.1]: https://github.com/komandante78/noesar-evolution-core/releases/tag/v0.1.1
[0.1.0]: https://github.com/komandante78/noesar-evolution-core/releases/tag/v0.1.0
