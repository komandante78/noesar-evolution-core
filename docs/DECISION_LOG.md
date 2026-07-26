# NOESAR EVOLUTION — Decision Log

Append-only. Each entry: what was decided, why, what it rules out, and how
reversible it is.

---

## D-0001 — Governance split across `CLAUDE.md` and `CLAUDE10.md`
**Phase:** 0 · **UTC:** 2026-07-25T01:13:11Z · **Status:** adopted

`CLAUDE.md` holds only a short header and `@CLAUDE10.md`. All binding rules live in
`CLAUDE10.md`, which imports the project skill.

*Why:* a single, unambiguous authority file that cannot be diluted by incremental
edits to an entry point. *Reversible:* yes, trivially.

## D-0002 — Rules are scoped exclusively to NOESAR EVOLUTION
**Phase:** 0 · **Status:** adopted

`CLAUDE10.md` applies only to `/mnt/cachec/NOESAR_EVOLUTION` and forbids its own
application to any other project on this host, and equally forbids importing other
projects' conventions into this one.

*Why:* this host carries several unrelated products with their own long-standing
rules; cross-contamination in either direction is a real and previously observed
failure mode. *Reversible:* yes, but should not be.

## D-0003 — Source archives verified but not renamed
**Phase:** 0 · **Status:** adopted

All five archives carry a ` (2)` duplicate-download suffix. Checksums match the
expected values exactly, so content is correct. The files were left untouched.

*Why:* renaming is a mutation of files outside `PROJECT_ROOT` and outside the Phase 0
scope. Content correctness is established by checksum, not by filename.
*Consequence:* Phase 1 must match archives by glob or receive an explicit rename
instruction. *Reversible:* yes.

## D-0004 — Heuristic secret scan, declared as heuristic
**Phase:** 0 · **Status:** adopted

`gitleaks` is not installed. The rules forbid installing new tooling to satisfy the
scan, so a pattern-based heuristic scan was run and is labelled as heuristic
everywhere it is reported.

*Why:* an undeclared weaker check is worse than a declared one. *Consequence:* if a
real scanner becomes available, later phases should re-scan history.
*Reversible:* yes.

## D-0005 — GitHub remote deferred; local repository completed
**Phase:** 0 · **Status:** blocked, deferred to Phase 1 or owner action

`gh` is not installed on this host, so `gh repo create --private` could not run and
no authenticated remote exists. No token was written anywhere. The local repository
was initialised and committed regardless.

*Why:* the phase requires the local repository to be completed even when GitHub is
unavailable, and forbids embedding credentials. *Consequence:* the private remote,
`origin`, the push, and the visibility check remain open.
*Reversible:* yes — it is pending work, not a wrong turn.

## D-0006 — Licensing recorded as a proposal, not a legal decision
**Phase:** 0 · **Status:** adopted as proposal

Open core proposed under AGPL-3.0-or-later, with an additional commercial license
planned. Recorded in `docs/LICENSE_STRATEGY.md` explicitly as a proposal pending
legal review.

*Why:* the phase specification requires proposal status; presenting it as settled
would misrepresent the project's legal posture. *Reversible:* yes, by design.

## D-0007 — ATOM boundary fixed as an invariant from inception
**Phase:** 0 · **Status:** adopted

The FOSS core must be complete and independently useful, must not depend on ATOM to
build, start, test, or deliver its documented functionality, and no proprietary ATOM
implementation may ever enter a public repository. Integration is via public
interfaces only.

*Why:* deciding this at inception is cheap; retrofitting a boundary into a coupled
codebase is not. It is also a precondition for FOSS funding eligibility.
*Reversible:* no — treated as an architectural invariant.

---

## D-0008 — Archives identified by SHA-256 only, never by filename
**Phase:** 1 · **UTC:** 2026-07-25T01:49:50Z · **Status:** adopted

Every archive was matched to its role by hash. Filenames were never used for
identification or dispatch.

*Why:* all five carry a ` (2)` duplicate-download suffix, so name-based matching
would have failed or, worse, silently mismatched a package to the wrong role.
*Reversible:* n/a — this is the correct method regardless.

## D-0009 — Product tree placed at repository root with no wrapper level
**Phase:** 1 · **Status:** adopted, independently confirmed

Package 01's `SOURCE/PRODUCT/` became the repository root. The
`NOESAR_EVOLUTION_01_…_V4_FINAL/` directory appears nowhere.

*Why:* required by the phase specification, and it is what the product itself
expects. *Confirmation:* the product's own `MANIFEST.sha256` verifies **5,606/5,606**
against the repository root — its paths are product-relative and every one resolves.
That is independent proof rather than an assertion. *Reversible:* expensive; the
manifest would stop resolving.

## D-0010 — Package envelopes preserved under `provenance/package-0N/`
**Phase:** 1 · **Status:** adopted

Each package's `README.md`, `PACKAGE_METADATA.json`, `CONTENTS_MANIFEST.tsv`,
`SHA256SUMS.txt` and `LICENSES/` were kept, but namespaced per package.

*Why:* the delivery record is evidence worth keeping, but the envelope files collide
by name with the product's own `README.md` and `LICENSES/`. Namespacing keeps both
without either overwriting the other. This also *caused* two of the four recorded
path conflicts, which is why it is logged as a decision rather than a detail.
*Reversible:* yes.

## D-0011 — Differing files are preserved side by side, never silently chosen
**Phase:** 1 · **Status:** adopted

Where the same path held different content, no variant was discarded:
`FOSS_SCOPE.md` (four role-scoped documents) and `CURRENT_RELEASE_STATUS.md` (a
delivery status and a feature matrix) were all retained under role-distinct names.

*Why:* the phase forbids choosing silently between two different files, and these
turned out not to be versions of one document at all — they are different documents
that happen to share a filename. Renaming is the only resolution that invents no
content and loses nothing. *Reversible:* yes; all originals remain in `$STAGING`.

## D-0012 — The Phase-0 `.gitignore` was fixed, not worked around
**Phase:** 1 · **Status:** adopted · **Classification:** `FIXED_IN_PHASE_1`

Un-anchored patterns (`build/`, `bin/`, `out/`, `cache/`, `.cargo/`, `*.pem`) were
silently excluding real source — including `rust/.cargo/config.toml`, without which
cargo ignores the vendored tree entirely, and a **public** Ed25519 key required by
the signature-verification examples. Patterns were anchored to the repository root,
`.cargo/` was replaced with `**/.cargo/credentials*`, and `*public*.pem` was negated.

*Why:* a `.gitignore` authored before the product was visible encoded guesses. Left
alone it would have produced a repository that looks complete and cannot build —
the worst possible failure mode, because it is invisible until much later.
*Verified:* the product contains zero private-key material, so relaxing `*.pem` for
public keys costs nothing. *Reversible:* yes, but should not be.

## D-0013 — Compiled vendored fragments excluded from Git, preserved outside it
**Phase:** 1 · **Status:** adopted · **Classification:** `DEFERRED_TO_PHASE_2`

Four compiled files in `wit-bindgen-0.57.1` (`.a`, 2×`.o`, `.wasm`) are listed in
cargo's checksum manifest but are binaries, which `CLAUDE10.md` §33 forbids. They
were excluded from Git and preserved byte-identical in
`$ARTIFACT_ROOT/vendor-binary-fragments/` with checksums and a restore procedure.

*Why:* this is a genuine tension between two rules that both matter — no binaries in
the repository, and a vendored tree that must stay verifiable. Overriding the policy
silently would have been wrong; deleting the files would have destroyed evidence.
Excluding while preserving keeps both options open for whoever decides in Phase 2.
*Mitigation:* the crate is reachable only via `wasip2` and is not built for
linux-x86_64. *Reversible:* fully — restoring is a documented `cp`.

## D-0014 — B-003 recorded, deliberately not "fixed"
**Phase:** 1 · **Status:** adopted · **Classification:** `DEFERRED_TO_PHASE_2`

`rust/vendor/cc-1.3.0/src/target.rs` declares four modules whose files ship in none
of the five archives. The packaging filter that strips `target/` build output also
stripped a legitimate source directory.

*Why not fixed:* the only ways to "fix" it here would be to write the four files
(fabricating upstream source — forbidden) or to fetch them from the network (out of
scope this phase, and a supply-chain decision in its own right). Recording it
accurately is the honest action.
*Significance:* it falsifies two of the delivery's own claims — the recorded
`vendorManifestAggregate` (5,207 vs 5,203 files) and the `B001` "complete vendor
snapshot" closure. Those claims should not be relied on downstream without checking.
*Reversible:* n/a — it is an open item, not a change.

## D-0015 — Licensing inventoried, nothing relicensed
**Phase:** 1 · **Status:** adopted

`NO_LICENSE_RELICENSING_IN_PHASE_1=true` was honoured: no licence field, header, or
file was added, changed, or removed anywhere.

*Finding:* all 113 vendored crates are permissive, with zero copyleft-only
dependencies — nothing blocks the proposed AGPL core. The gap is entirely on the
first-party side (no declarations, no root `LICENSE`, 86 sources without SPDX
headers). *Notable:* the delivered licensing matrix independently matches the
Phase-0 proposal, and adds a three-way split (AGPL core / Apache-2.0 SDK /
CC-BY-SA-4.0 docs) that `docs/LICENSE_STRATEGY.md` should adopt in Phase 5.
*Reversible:* n/a — no change was made.

---

## D-0016 — B-003 repaired from local authoritative copies; no network used
**Phase:** 1 (B-003 repair) · **UTC:** 2026-07-25T05:15:00Z · **Status:** adopted

Temporary, limited network access was authorised for recovering Cargo dependencies.
It was **not used**: two independent authoritative copies of `cc-1.3.0` were already
on this server, the primary being the delivery's own build staging
(`RUST_MANIFEST_REMEDIATION_V1`, the phase named in its `PROVENANCE.json`).

*Why:* the authorisation was a fallback, not an instruction. Local recovery is
strictly better — it needs no trust in a network path and the result is provable
against the crates.io-published `.cargo-checksum.json`, which every recovered file
matches exactly. *Reversible:* yes (backup `pre_b003_repair_20260725T050034Z`).

## D-0017 — Only the four official files were promoted, nothing reconstructed
**Phase:** 1 (B-003 repair) · **Status:** adopted

Recovery was accepted only after: the four hashes matched the upstream checksum
manifest, the package checksum matched `Cargo.lock`, and `diff -rq` against the
authoritative copy showed the missing `src/target` directory as the *only* difference.

*Why:* "restore the files" and "make the tree look complete" are different things.
Anything beyond an exactly-matching official file would have been fabrication. The
diff was the check that the damage was exactly what it appeared to be and nothing
else had moved. *Reversible:* yes.

## D-0018 — The identical filter defect was found live in this repository and fixed
**Phase:** 1 (B-003 repair) · **Status:** adopted · **Classification:** `FIXED`

`git check-ignore` proved `.gitignore`'s un-anchored `target/` was ignoring all four
just-restored files. The repair would have sat on disk, never been committed, and a
fresh clone would have reproduced B-003 exactly. The same idiom was then found in
`tools/create-rust-build-provenance.py` (which also tested the *absolute* path, so a
checkout under any directory named `target` would have excluded everything).

*Why:* fixing the data without fixing the rule that destroyed it guarantees the defect
returns. The fix is anchoring — build output only exists at a workspace root — plus a
regression test asserting both directions (19/19).
*Not fixed:* the upstream packaging script that built the ZIPs is not on this host, so
its origin could not be corrected. Recorded as residual, not as done.
*Reversible:* yes, but should not be.

## D-0019 — The unreproducible vendor aggregate was investigated, not papered over
**Phase:** 1 (B-003 repair) · **Status:** adopted

After repair the vendor tree still does not reproduce the recorded
`vendorManifestAggregate`. Seven path conventions were tried. The decisive test:
the recorded value does not reproduce from the **delivery's own build staging**
either — the same tree this repair restored from, now byte-identical to the repository.

*Why:* the honest conclusion is that the recorded number is unreliable, not that the
tree is wrong. Fabricating a matching hash, or quietly adjusting the method until it
matched, would have destroyed the only signal that record carries. A supporting
discrepancy: the method string claims the digest excludes `vendor/`, but the script
computing it does not. *Consequence:* Phase 5 should correct or drop the number.
*Reversible:* n/a — an open finding, not a change.

## D-0020 — `MANIFEST.sha256` updated, and only where the repair required it
**Phase:** 1 (B-003 repair) · **Status:** adopted

The product manifest was generated from the damaged tree: 5,203 vendor entries and
zero for `cc-1.3.0/src/target/`. Two changes: the hash of the one file this repair
legitimately modified, and four new entries at their official upstream hashes.

*Why:* the phase authorises "necessary manifest updates". Leaving it unchanged would
have left the manifest permanently failing and encoding the defect. Touching anything
else would have blurred the audit trail — hence a diff of exactly 6 lines, verified
5,610/5,610, still sorted. *Reversible:* yes.

---

## D-0021 — Host port 8100, loopback-only
**Phase:** 2 · **UTC:** 2026-07-25T06:30:00Z · **Status:** adopted

The product's default host port 8088 is already claimed on this host by two containers
(`fridayn-model-factory` and `nova-ai` — themselves a pre-existing double allocation).
Port 8100 is free and sits outside the existing NOESAR 8080–8099 band. Binding is
`127.0.0.1` only.

*Why:* found by enumerating `docker inspect` port bindings rather than live listeners —
with all 37 containers stopped, a port scan would have shown 8088 as free and the
conflict would have surfaced only when something restarted. *Reversible:* yes.

## D-0022 — Dedicated network, not the installer default `noesar-local`
**Phase:** 2 · **Status:** adopted

`noesar-evolution-net` will be created instead of joining `noesar-local`.

*Why:* `noesar-local` already belongs to the unrelated NOESAR V3 stack on this host,
where network binding is load-bearing (moving `noesar-webui` off it breaks login with a
502). Sharing it would couple two products that must stay independent, for no benefit,
and would blur the boundary egress control needs. *Reversible:* yes.

## D-0023 — Runtime root on `/mnt/cachec`, and not created in this phase
**Phase:** 2 · **Status:** adopted

Runtime goes to `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME`, not the delivered default
`/mnt/user/appdata/noesar-evolution`.

*Why:* `/mnt/user` is a FUSE (`shfs`) overlay with weaker fsync semantics for a
stateful workload; `/mnt/cachec` is direct XFS-on-NVMe with 324 G free and already
hosts the project, so source, artifacts and runtime back up and roll back as one
consistent unit. The directory was deliberately **not** created — the phase says design
only. *Reversible:* yes.

## D-0024 — Use Docker's builtin seccomp profile, not the shipped one
**Phase:** 2 · **Status:** adopted · **Classification:** configuration, no source change

`security/seccomp-noesar.json` is `defaultAction: SCMP_ACT_ALLOW` with a 24-syscall
denylist. Passing it replaces Docker's builtin profile, which is deny-by-default with a
~350-syscall allowlist and already blocks all 24 of those and more. The shipped profile
is therefore strictly weaker than the one it displaces.

*Why it matters here specifically:* this host has **no AppArmor and no SELinux**, so
seccomp is the only mandatory-access-control layer left. *Decision:* omit
`--security-opt seccomp=` in Phase 3. The file is left untouched and the reasoning
recorded; if a builtin-blocked syscall is ever genuinely needed, the fix is a
deny-by-default profile derived from Docker's, never an allow-by-default one.
*Reversible:* fully — it is a run flag.

## D-0025 — Postgres/pgvector deliberately excluded from Phase 3
**Phase:** 2 · **Status:** adopted

Phase 3 installs the `reference-json` data plane only.

*Why:* it needs no external service, so the first installation has zero external
dependencies and `DATABASE_MUTATION=false` holds by construction. The Postgres schema
(`0001–0007`, pgvector, RLS) and its acceptance plan already exist and deserve their own
installation with their own credentials and acceptance, not a side effect of the first
install. *Reversible:* yes — switching data planes later is a configuration change plus
a migration.

## D-0026 — The installer fix was in scope; the other gaps were not
**Phase:** 2 · **Status:** adopted · **Classification:** `FIXED_IN_PHASE_2`

`INSTALLATION/install-unraid.sh` was fixed because it *certainly* blocked installation
from the canonical layout and could be corrected statically — exactly the test the phase
specification sets. The missing health endpoints, the absent update manager and the
seccomp profile were **not** fixed.

*Why not:* none of them certainly blocks installation, and the specification forbids
fixing hypothetical problems. They are designed and scheduled instead, with Phase-4
acceptance tests. *Reversible:* yes (backup `pre_phase2_fix_20260725T060825Z`).

---

## D-0027 — Defects are hunted and fixed inside the phase, not filed for later
**Phase:** cross-cutting (owner instruction) · **UTC:** 2026-07-25T07:00:00Z · **Status:** adopted

The phase cycle gains a 7th step, `HUNT AND FIX`, between `TEST` and `DOCUMENT`. Every
phase must now actively look for defects with real tooling and repair what it finds,
rather than closing with a list of known problems.

*Why:* the previous cycle rewarded discovery and was silent about repair, so a phase
could end "successfully" while leaving working defects behind. Phases 1 and 2 both
ended that way by design — B-003 and the seccomp finding were correctly recorded, but
recording is not fixing.

*Guardrails kept deliberately:* fixing is still refused when it would exceed scope,
require fabricating unverifiable content, demand a destructive or outward-facing
action, or rest on a root cause not yet found — the same reasoning that made *not*
recreating the four `cc-1.3.0` files the right call. Triage before repair is mandatory,
because a false positive "fixed" is a real regression introduced for nothing.

*Consequence:* two governance rules had to be amended, or the new step would have been
unusable — `CLAUDE10.md` §16 and the skill's standing rules both forbade touching any
container, and the only analysis tooling on this host lives inside `noesar-debuglab`.
Both now carry a narrow, named exception: that one read-only container, started for
step 7 and stopped again in the same phase. Nothing else was loosened.
*Reversible:* yes.

## D-0028 — First `HUNT AND FIX` sweep: one real defect, the rest triaged as noise
**Phase:** post-Phase-2 (owner-requested scan) · **Status:** recorded; fix pending authorisation

`noesar-debuglab` (`project-scanner-v7`: semgrep, bandit, ruff, detect-secrets,
shellcheck, mypy — none present on the host) was started, used, and stopped again.

**Real defect — `gcm-no-tag-length`, 4 sites.** `createDecipheriv('aes-256-gcm', …)`
is called without `{ authTagLength: 16 }`, then `setAuthTag()` is applied to a stored,
attacker-influenceable value, in `services/reference-control-plane/src/ai-workspace/credential-vault.mjs:28`,
`src/auth-crypto.mjs:128`, and the two `ai-workspace/` copies. Node accepts GCM tags of
4–16 bytes, so a truncated tag drops authentication from 128 to 32 bits. Contextual
severity is **medium, not critical**: exploitation requires prior write access to the
workspace store. It is defence-in-depth in the credential vault, cheap to fix, and not
urgent — the product is neither installed nor running.

**Dismissed after triage, with evidence:** `SC1007` ×5 on the correct `CDPATH= cd`
idiom; `insecure-file-permissions` ×2 where semgrep recommends 0o644 over 0o700, which
is *less* restrictive; `B105` on a test canary literally named `must-not-leak`;
`insecure-object-assign` where the keys are literals on a freshly created `Error`;
`B603/B607/S603/S607` ×34 in tests and build tooling.

**Secret scan — materially strengthens B-002.** `detect-secrets` (27 plugins) over the
whole repository: 5,148 raw hits across 303 files, of which 5,078 are SHA-256 checksums
in manifests. **Zero real secrets**: no private key, AWS/GitHub/Slack/Stripe/JWT/OpenAI
token anywhere. Two of the seven `Basic Auth Credentials` hits were this project's own
documentation of the scan pattern. Independent corroboration of every heuristic scan
run in Phases 0–2.

**Also confirmed clean:** `rust/crates/` (12 first-party crates) 0 findings; `oci/`
0 findings; shellcheck clean on `INSTALLATION/` including the `install-unraid.sh`
fixed in Phase 2 — verified with a canary self-test that fired 3 issues, so the clean
result is meaningful.

**Upgrade to the Phase-2 security matrix:** `apps/webui-static/app.js` uses an
`x-noesar-csrf` header with `credentials:'same-origin'` and an `escapeHtml` helper, so
the `CSRF = PARTIAL` and `CSP/XSS = UNVERIFIED` rows have more support than recorded.
To be settled by the Phase-4 runtime tests, not by reading.

**Limit stated plainly:** none of this reaches the weak seccomp profile, the port 8088
collision, the missing endpoints, or prompt injection. Those are configuration, host
and semantic defects, invisible to every scanner used.

---

## D-0025 — Do not replace the shipped seccomp profile; mark it and remove it from the installers

*Context:* Phase 2 (D-0024) decided not to pass `security/seccomp-noesar.json` in the
manual `docker run`. Phase 3 found that all three delivered installers **were** passing
it, so the decision had no force where it mattered.

*Options:* (a) leave it and rely on documentation; (b) replace it with a derived
allowlist profile; (c) mark it `NOT_FOR_USE`, remove the flag from the installers, and
lock it with a regression test.

*Decision:* **(c)**. Docker's builtin is already a tested deny-by-default allowlist;
writing a substitute would be strictly more risk for no gain, and a wrong allowlist breaks
the container in ways that are hard to diagnose. The file stays, marked in its own body
with `x-noesar-status: NOT_FOR_USE` (Docker's JSON decoder ignores unknown fields, so it
remains loadable if anyone ever does). `tools/test-installer-hardening.mjs` fails if the
flag returns.

*Consequence:* the profile is no longer `BROKEN` in the matrix — it is
`MITIGATED BY CONFIGURATION`, with the mitigation enforced by a test rather than by prose.

## D-0026 — Installers bind to loopback by default

*Context:* both Unraid installers used `--publish "${PORT}:8088"` with no bind address,
which Docker resolves to `0.0.0.0`. The security matrix claimed the port was not reachable
from the LAN.

*Decision:* `BIND_ADDRESS="${NOESAR_BIND_ADDRESS:-127.0.0.1}"`, used in the publish and in
the printed URL. Exposure beyond loopback becomes a deliberate, named choice.

*Consequence:* an operator who wants LAN access must set `NOESAR_BIND_ADDRESS` and, by
implication, think about TLS and `NOESAR_SECURE_COOKIES` first.

## D-0027 — The bootstrap token lives in a file, not in the environment

*Context:* `NOESAR_SETUP_TOKEN_FILE` was declared in `oci/Dockerfile` and described in the
Phase 3 plan and the security matrix, but no code read it. The only working path was
`NOESAR_SETUP_TOKEN`, an environment variable — visible in `docker inspect` and
`/proc/<pid>/environ`.

*Decision:* implement `src/setup-token.mjs`. A 32-byte CSPRNG token is generated on first
run, written `0600`, mode-repaired if it drifts, rotated after a TTL (72 h default), and
never logged — only a 12-hex fingerprint. The environment variable still wins when set, so
the smoke tooling and tests keep working.

*Rejected:* generating a new token on every boot. It would invalidate a token an operator
had already copied, for no security gain once the file is `0600`.

## D-0028 — Untrusted content is contained structurally, not by detection

*Context:* `chat-orchestrator.mjs` concatenated retrieved document passages into the
`system` message — the highest-trust position available. The matrix recorded prompt
injection as `PARTIAL`, pointing at code that contained no injection handling at all.

*Decision:* three layers, in order of how much each is worth.
1. **Structural** — retrieved passages move to their own non-`system` message, fenced,
   behind an explicit "this is data, not instruction" policy.
2. **Non-forgeable boundary** — fence markers are stripped from the untrusted text, so a
   document cannot close the fence, and an attempt is itself a detection signal.
3. **Authority** — tool scope is the intersection of granted and requested. Nothing in the
   content can widen it.

The nine-signal detector is **advisory**: it feeds the audit ledger and the operator, and
is deliberately not a gate. A heuristic that can be evaded must not be the thing standing
between a document and a tool call.

*Consequence:* the matrix moves to `IMPLEMENTED (structural)` with the residual risk
stated rather than hidden. Adversarial evaluation stays Phase 4.

## D-0029 — Inside a container, tier 3 of the timezone chain reports itself unavailable

*Context:* the installed container reported `Etc/UTC` at tier 3 despite `TZ=Europe/Berlin`.
`/etc/localtime` inside a container describes the **image**, not the host, so tier 3 was
shadowing the operator's explicit setting with a base-image default.

*Options:* (a) reorder the chain so `TZ` outranks the host; (b) bind-mount the host's
`/etc/localtime`; (c) make tier 3 report honestly that it cannot see the host.

*Decision:* **(c)**. (a) contradicts the Phase 2 design without cause; (b) would add a host
mount the phase specification does not permit. When `/.dockerenv` is present, tier 3 is
unavailable unless the host zoneinfo is deliberately exposed via `NOESAR_HOST_LOCALTIME`.

*Consequence:* the documented tier order is unchanged; the effective zone is now
`Europe/Berlin` at tier 4, which is what the operator asked for.

## D-0030 — No Owner account was created on the real installation

*Context:* §10 of the phase specification requires running the first-run procedure but
forbids creating definitive credentials on the Owner's behalf when the product requires an
interactive choice. NOESAR requires the Owner to choose a username, a password and to
enrol TOTP.

*Decision:* verify the **mechanism** on the real installation — the token file's mode and
ownership, its fingerprint matching the log, refusal without a token, refusal with a wrong
token, both audited — and prove the **full flow**, including single-use and MFA
enforcement, in a disposable probe container on a throwaway workspace.

*Consequence:* the installation is running and un-bootstrapped. `OWNER_BOOTSTRAP.md`
carries the exact steps. The probe container was removed; its audit evidence is kept.

## D-0031 — Comments never go inside a shell line continuation

*Context:* the first attempt at D-0025 placed the explanatory comment between
`--security-opt no-new-privileges:true \` and `--pids-limit 512 \`. That is syntactically
valid, `bash -n` passes, and it **truncates** the `docker run` command — silently
discarding every flag after it, including all the hardening.

*Decision:* explanations go above the command. And, because the class of defect is
invisible to syntax checking, `tools/test-installer-hardening.mjs` now runs every installer
against a stub `docker` and asserts the image argument still arrives.

*Consequence:* a whole class of "the script looks right and does the wrong thing" is now
caught by a test rather than by luck.

---

## Phase 4 decisions

### D-0031 — the real installation stays un-bootstrapped; the flow is proven on throwaway instances

The Owner chose this when asked. The installation is loopback-only, so an interactive
bootstrap needs the Owner at the host or an SSH tunnel, and inventing a password on their
behalf would defeat what an interactive bootstrap is for. The complete flow — single-use
token, TOTP enrolment, replay rejection, lockout, session lifecycle, step-up — was proven on
throwaway instances instead (27/27). The exact tunnel command and steps are in
`docs/PHASE_4_ACCEPTANCE_REPORT.md` §2.

### D-0032 — GPU validation not attempted, because there is no GPU workload

Also the Owner's choice: attempt it only if a real backend exists. It does not — every GPU
reference is inventory and planning, and inference is delegated to an HTTP provider. Recording
`GPU_RUNTIME=NOT_IMPLEMENTED` is the honest outcome; claiming GPU support because `nvidia-smi`
is visible would not be.

### D-0033 — the Phase 4 image is an overlay on the Phase 3 image, not a rebuild

`oci/Dockerfile` runs `apt-get install` for five packages, which needs network. Re-running it
now would silently re-resolve those packages to whatever the Debian archive currently serves,
discarding the set Phase 3 audited and recorded. Building `FROM noesar-evolution:phase3`
inherits that layer unchanged and keeps the build fully offline (`--network=none --pull=false`).
Trade-off stated in `oci/Dockerfile.phase4` and in the inventory: the lineage is
`node:22-bookworm-slim -> phase3 -> phase4`, and Phase 5 packaging should rebuild from
`oci/Dockerfile` with a recorded network step when a fresh package set is genuinely wanted.

### D-0034 — the homegrown undeclared-identifier checker was rejected, not shipped

Two findings (F4-005, F4-006) were the same class: an object-literal shorthand naming an
identifier not in scope. Two checkers were written. The file-scoped one missed both real
defects and produced 25 false positives; the scope-aware one caught both and still produced
~16 false positives per file. A hand-rolled JS scope analyser without a parser is not sound,
and a checker whose output must be ignored trains the reader to skip it. Both are preserved
with this reasoning in `$ARTIFACT_ROOT/phase4_evidence/rejected-tooling/`. The duty was
discharged with success-path coverage, process-level guards, and blocker **B-006** naming the
real tool (a `no-undef` linter) that rule 45 forbids installing.

### D-0035 — `unhandledRejection` logs and continues; `uncaughtException` logs and exits

Different policies on purpose. A rejection reaching the top level is a defect and is reported
as one, but a self-hosted single-process product should not die because one request threw —
that was F4-004's blast radius. An uncaught exception may leave inconsistent state, so the
process exits non-zero and lets the supervisor restart it, where the crash-loop detector and
safe mode can see it. Neither is a substitute for handling errors where they happen.

### D-0036 — two delivered unit tests were changed, because their fixtures encoded the bug

Fixing TOTP replay (F4-002) broke `auth.test.mjs` tests 21 and 23, which reused one code
across two consumptions. The fixtures were asserting the vulnerable behaviour, so the fixtures
moved and the fix stayed. Both now spend distinct time steps, with a comment saying why, so a
future reader does not "restore" them.

### D-0037 — no end-to-end update apply against the installation

The 37 unit tests already cover the whole matrix with generated test keys, including automatic
rollback on both migration and health failure. Driving a real promotion against the live
instance would mutate `current/` and add risk without adding evidence. The live checks confirm
what matters about the deployed state: owner-only, notify-only, four slots present, no channel
key pinned, so nothing can be verified and therefore nothing can be applied.

### D-0038 — retry a stale upstream connection exactly once (F4-009)

A pooled keep-alive socket the upstream has already closed fails a request that never reached
the server, so no tokens were generated and nothing was charged; retrying once is safe.
Narrowly scoped: only stale-socket error codes, only when no bytes arrived, never when the
caller has aborted. Not a general retry policy — a general one would risk duplicating a
generation that had already started.

### D-0039 — `F401` in `tools/verify-package.py` left as Phase 3 deferred it

A one-line unused import, already recorded as `DEFERRED_TO_PHASE_5`. Quietly overriding a
recorded deferral is worse than the lint, so it stands.

### D-0040 — a mock provider bound to the Docker bridge gateway, not to `0.0.0.0`

Running the security suite in-container needed the product to reach the mock, and loopback is
not shared with a container. Binding to `0.0.0.0` would have exposed the mock on the LAN for
the duration; binding to the bridge gateway (`172.22.0.1`) reaches the container and nothing
else. Two addresses for one mock process: the suite inspects it on loopback, the product dials
it on the bridge.

---

## Phase 4 completion gate

### D-0040 — PostgreSQL runs as a supervised child process, not a second container
The gate requires one external container and forbids a second PostgreSQL container or a
mandatory external database. The cluster is therefore created and supervised by the control
plane itself, under `/workspace/postgresql`, owned by the same unprivileged uid.
**Trade-off, stated:** the runtime process now owns a database lifecycle, so a bug in the
supervisor can take the database down. Mitigated by bounded restarts with backoff, by
`/livez` never touching the database, and by `/readyz` withholding readiness instead.

### D-0041 — a PostgreSQL wire-protocol client is written in-tree
Rejected: depending on `pg` (seven transitive packages, a network step in an otherwise
offline build, a security-relevant surface outside this repository's audit) and shelling
out to `psql` (cannot express the extended query protocol, so every value would be
interpolated into SQL text — precisely the injection surface RLS exists to close).
Scope is deliberately narrow: unix and TCP sockets, SCRAM-SHA-256 only, text results, one
statement in flight. Correctness is pinned to the published RFC 7677 test vector.

### D-0042 — the PGDG signing key is committed, the archive is not trusted on first use
`oci/keys/apt.postgresql.org.asc` is a **public** key; it verifies the archive signature
and can verify nothing else. Shipping it in-tree makes the trust anchor reviewable in the
repository instead of being fetched — and implicitly trusted — during the build. Its
checksum was confirmed from two independent fetches before committing.
This build needs network access, unlike the Phase 4 overlay. Stated, not hidden: the
PostgreSQL 18 packages do not exist in the archives Phase 3 recorded.

### D-0043 — per-user RLS policies are RESTRICTIVE, not permissive
PostgreSQL combines permissive policies with `OR`, so a second permissive policy would have
*widened* access. Declaring the ownership rules `AS RESTRICTIVE` combines them with `AND`:
the inherited tenancy policy from migration 0007 still has to pass, and the new rule has to
pass as well. Nothing 0007 allowed becomes more permissive.

### D-0044 — every interactive account enrols MFA, not only owner and admin
The requirement names owner and admin as a floor. Going further was forced by the code:
`completeLogin()` decrypts `user.totp` unconditionally, so an account created without one
could never log in (`F4C-004`). Of the two ways out, this is the safer — the alternative
adds a login branch that issues a session after the password step alone, and a code path
that can skip a factor is a code path that can be reached by mistake.
**Consequence, stated:** a `client_restricted` or `user` account cannot opt out of MFA.

### D-0045 — administrators do not gain read access to user content
Account administration is a privileged operation with its own permission and its own audit
record. It does **not** grant a blanket `SELECT` over the identity table or over anyone's
conversations. An administrator can disable an account; they cannot read its chats through
the data plane. Recorded because a reader may reasonably expect the opposite.

### D-0046 — credentials stay in the auth store and are never written to SQL
Password verifiers and TOTP envelopes remain in `state/auth.json` (0600). Only id,
username, role and status are projected into `noesar_identity.users`, with
`password_scheme='external-auth-store'` and a single zero byte in the salt and hash columns.
The database is dumped for backup and restored into probe databases; a dump that cannot
contain a verifier cannot leak one. This narrows what Phase 4 finding F4-013 is about.
**Trade-off:** two stores, and a projection that must be kept current. A projection failure
is reported rather than swallowed.

### D-0047 — the local model runtime is disabled by default and queries nothing when disabled
"No GPU access without configuration" is implemented as a property rather than a policy:
in `disabled` mode nothing runs `nvidia-smi`, spawns a process or opens a socket, and
`detect()` returns `inspected: false` so the claim is checkable. The environment can only
make the runtime more restrictive, never less. A local endpoint must be on loopback — a
"local model runtime" that can be pointed at a remote host is an exfiltration path wearing
a local name.

### D-0048 — the GPU inference test is labelled BLOCKED, not PARTIAL
Everything around the model was exercised end to end against a stub OpenAI-compatible
server. A stub is not a model. No weights and no inference runtime exist on this host that
this gate may use, and the only ones present belong to another project's container, which
the gate forbids starting. `GPU_LOCAL_MODEL_RUNTIME.md` records the exact minimum needed.

### D-0049 — ESLint runs from a pinned container; nothing is installed on this host
CLAUDE10 rule 45 forbids installing tooling. ESLint 9.39.5 runs inside
`node:22-bookworm-slim` pinned by digest, installed into a scratch directory outside the
repository, with the repository mounted read-only so a lint run cannot modify what it
judges. The detector is self-tested against canaries reproducing the real defect shapes,
because a clean scan proves only that the scanner found nothing.
This supersedes D-0034's conclusion that no sound tool was available: one was, it just
could not be *installed*. Running it in a container was the missing step.

### D-0050 — SBOMs are generated from a `docker save` archive, never through the daemon
syft is pinned by digest and scans a tar export, so the SBOM container never receives the
Docker socket — the socket this product's own threat model refuses to mount anywhere.
The SBOM documents live under `$ARTIFACT_ROOT/sbom/` with checksums recorded in
`SBOM_REPORT.md`, rather than in the repository: they total ~22 MB of generated JSON,
reproducible from a pinned tool and a pinned image.

### D-0051 — the restore verification database is left in place rather than dropped
`noesar_restore_check` exists on the installed cluster. Dropping it would be a deletion,
and nothing in this phase deletes anything. Recorded so a future reader does not mistake it
for stray state.

### D-0052 — the `postgres.ready` log field is left as it is
It reports migrations applied *by that start*, so it reads `0` on a restart of a fully
migrated cluster (`F4C-013`). Renaming it means rebuilding and reinstalling the image for a
log label, and the adjacent `data-plane.ready` line already carries the unambiguous total.
Recorded rather than changed.

### D-0053 — the LAN fix is deployed through an offline overlay image, a declared deviation
The gate specified "use the same image, `noesar-evolution:phase4-complete`". The fix for
`F4L-001` is source-only, and the container executes the code baked into its image, so
the fix could not reach the installation without a new one. Confirmed rather than
assumed: after the first recreation `/metrics` still answered `200` over the LAN, the
`server.mjs` inside the container hashed differently from the repository's, and the only
mount is `/workspace`.

That left three options, none of them free, and they were put to the Owner rather than
chosen here: accept a LAN-readable `/metrics` until Phase 5 rebuilds, rebuild now, or
roll back to loopback. The Owner authorised the rebuild.

`noesar-evolution:phase4-complete-lan` is an overlay built `--network=none --pull=false`
over the audited image, copying exactly two files. Same pattern and same reasoning as
`D-0033`/`Dockerfile.phase4`: rebuilding from `oci/Dockerfile` would re-run `apt-get`
and silently re-resolve the OS package set. The lineage is now five images deep and is
stated in the Dockerfile itself rather than hidden. Phase 5 packaging should still
rebuild from `oci/Dockerfile` with a recorded network step.

### D-0054 — the exposure scope is a declaration, not something the runtime detects
A process cannot observe the address its container was published on: inside the network
namespace it sees `NOESAR_HOST=0.0.0.0` whether Docker forwards from `127.0.0.1` or from
a LAN address. Worse, behind a published port every external caller arrives from the
bridge gateway — an RFC1918 address — so peer-address inspection cannot distinguish a
LAN browser from a host-local process either.

So `NOESAR_BIND_ADDRESS` is declared by whoever published the port, and
`NOESAR_BIND_SCOPE` is derived from it. Unset means `loopback`. The alternative —
inferring exposure from the peer — is precisely the reasoning that produced `F4L-001`.

### D-0055 — `0.0.0.0` is refused rather than offered
The installers will not publish on a wildcard without `NOESAR_ALLOW_PUBLIC_BIND=true`,
and will not auto-select a public, VPN or Docker-bridge address for "local network".
An installer cannot tell from inside the host which of its interfaces face the internet,
and NOESAR ships without TLS, so it refuses the guess instead of making it. `F-003` was
this defect in its original form: both Unraid installers published with no bind address
at all, which Docker resolves to `0.0.0.0`.

### D-0056 — the bootstrap endpoint is not restricted by source address
`/api/v1/auth/setup` is protected by the one-time token, not by the network. A
source-IP restriction was considered and rejected as unimplementable-and-untrustworthy
here: behind Docker's published port the peer address is the bridge gateway for every
caller, so such a check would either pass everything or block everything, while
appearing to do something. Stated in `LAN_ACCESS_CONFIGURATION.md` rather than
approximated in code.

### D-0057 — no CORS layer is added for LAN access
The WebUI is same-origin with its API, so a browser on the LAN needs no cross-origin
grant. No `Access-Control-Allow-Origin` is emitted on any route — there is no wildcard
because there is no CORS at all — and `SameSite=Strict` stays correct precisely because
all access is same-origin. A regression test asserts the absence positively, so that
"no CORS" cannot later be mistaken for "nobody configured CORS".

### D-0058 — the drafted WebUI sections were withdrawn rather than shipped unwired
Markup for Settings, Security, Users, Tools, Providers, System Health, Updates, Logs,
Backups and About was written in this phase. Their data loaders were not. Shipping them
would have produced twelve nav entries whose panels never finish loading — the exact
defect the phase exists to remove — while presenting as progress. They were removed
before the commit and the router was restricted to routes with a working page. The
backend they will consume is implemented and tested, so the remaining work is interface
work against a known-good surface.

### D-0059 — the QR encoder is bounded at version 6 instead of being shipped unproven
Versions 1-6 match libqrencode module-for-module; 7-10 do not, after a version-
information block was implemented and two real bugs were fixed. Rather than emit a
symbol that renders and may not decode, `chooseVersion` refuses above version 6 with an
explicit error. This bounds enrolment QR codes to usernames of 25 characters or fewer.
The alternative — shipping and hoping — is the failure mode this project has a standing
rule against.

### D-0060 — no rebuild and no deployment in this phase
`CONTAINER_REBUILD` was authorised, but there was nothing safe to deploy: the only
user-visible change ready was the CSRF fix, and shipping it alongside half-built
navigation would have been worse than the current state. The live installation still
runs `noesar-evolution:phase4-complete-lan` with the Owner account intact.

### D-0061 — the Owner's TOTP secret is still not rotated
The replacement flow is implemented and tested, but it requires the Owner's own password
and two consecutive live codes, and this phase forbids rotating on their behalf. The
Security page that would expose it is not built, so the only route today is the API.
`OWNER_MFA_ROTATION=AWAITING_OWNER_INTERACTION`, and the original enrolment secret —
which must be treated as compromised — remains in force.

### D-0062 — Tools and Providers were moved out of their combined pages, not rewritten
Both surfaces already existed and worked: tool registration, credential and consent
lived inside "Agents & Tools", and provider profiles inside "Models & External APIs".
The reported gap was that there was no Tools entry to click at all. Writing new pages
against the same endpoints would have produced two renderers for one dataset, which
drift. The markup was relocated with its element ids unchanged, so every existing
handler continues to work untouched and nothing is duplicated. "Models & External APIs"
keeps the parallel-comparison surface.

### D-0063 — role gating is derived from the server, never restated in the browser
The interface must decide whether to offer a section, because a nav entry whose every
request answers 403 is the same defect as a panel that never loads. The obvious
implementation — a copy of the role/permission matrix in `app.js` — is one refactor away
from disagreeing with the server that enforces it, and the disagreement would be
invisible in both directions. `AuthService.permissionsFor(role)` exposes the single
`ROLE_PERMISSIONS` definition instead; `/api/v1/auth/me` and the session response carry
it, and `/api/v1/admin/users` carries the role vocabulary for the same reason. This is a
description, not a grant: every route still checks for itself, and a test asserts that
what the server reports and what it enforces agree in both directions for every role.

### D-0064 — the browser suite asserts a rendered box, not an active class
The first version of the route check tested `classList.contains('active')` and the
length of `innerText`, and passed on all 21 routes while nine of them were inside a
`display:none` ancestor: `innerText` falls back to `textContent` for an element that is
not rendered, so the text was there to measure. The previous phase reached the same false
conclusion by the same route, reporting that "navigation is not broken" from the class
alone. The check now requires `offsetParent` and a non-zero bounding box. A check that
cannot fail on the defect it is aimed at is not evidence.

### D-0065 — the denied path is exercised with a real second account
As the Owner, `may()` returns true for everything, so an error in role gating is
invisible from the only account that exists. This project has twice shipped a defect
because only one side of a branch was ever executed — most recently accounts that could
not log in at all, because every fixture bootstrapped an owner and the *success* path of
the other case was never run. The suite therefore creates a second account through the
real invitation flow, signs in as it, and asserts what it is offered and what it is
refused.

### D-0066 — probe containers, images and networks are preserved, not removed
Rule 12 forbids deleting containers, images and networks, and the host inventory already
keeps stopped probes from earlier gates. Eleven probe containers, eleven images and
eleven `noesar-e2e-*` networks accumulated while the suite was being iterated, because
the first version stamped the network name too. The script now reuses one stable network
(`noesar-e2e-net`); isolation still holds because the probe and runner names carry the
stamp. Disposing of what already exists is a separate, explicit decision and was not
taken here.

### D-0067 — the privacy banner reports UNVERIFIED rather than keeping its claim
`refreshPrivacy()` swallowed every failure in an empty `catch{}`, so an unreachable
privacy check left the hardcoded "LOCAL-ONLY VERIFIED" chip on screen looking confirmed.
A banner that asserts a privacy guarantee must never assert one it has not just been
told. It now says so plainly and marks itself external. The `.external` class — added to
the stylesheet in the previous phase and applied by nothing — is driven from
`banner.external`, the server's own verdict, rather than from a state-string comparison:
the first attempt compared against `LOCAL_ONLY`, which this server never emits.

### D-0068 — throwaway containers, tags and networks are removed; D-0066 is superseded
Owner instruction, 2026-07-26: *"devi lavorare pulito"* — always delete the containers
this project created that serve no purpose, keeping the rollback and the one that is
needed. D-0066 preserved eleven probe containers, eleven images and eleven `noesar-e2e-*`
networks on the reading that rule 12 forbade deleting them, and recorded that disposing
of them would be a separate explicit decision. That decision has now been taken.

Rule 12 was written in Phase 0, before this project created any container of its own. It
protects artifacts; a stopped e2e runner is not an artifact, it is litter, and what makes
a run reproducible is the image plus the evidence file, not the corpse of the container.
`CLAUDE10.md` now carries §5a with the boundary spelled out, and the skill cycle has a
`CLEAN UP` step (13 of 15) between `PUSH` and `WRITE HANDOFF`.

Two containers survive a phase: the running installation and **one** rollback, the
immediate predecessor of what is running. Older rollback containers go — their images
stay on disk, so every rollback path in `docs/INSTALLATION_LEDGER.md` still works.

The networks were the part nearly missed, and they were the more damaging omission. Each
bridge takes a subnet from Docker's finite address pool; eleven abandoned ones are eleven
subnets denied to **every** project on this host, and exhaustion breaks network creation
globally, not just here. The rule therefore names networks explicitly.

Host-wide `prune` in any form is forbidden without exception: removal names its targets,
scoped by name prefix, or it does not happen.

### D-0069 — the master specification's measuring instruments are in the repository
`F4W-011` recorded that the product had never been measured against
`NOESAR_EVOLUTION_MASTER_PROJECT_V4.zip` because the 46 files that define "done" were
never brought in. They are now: 44 into `MASTER_REFERENCE/`, and the two nested
`REFERENCES/*.zip` archives to `$ARTIFACT_ROOT` under §9 rule 33, with their checksums
recorded and matching their tracked sidecars exactly.

Verification, not assumption: the package hash matches its sidecar, its internal
`MANIFEST.sha256` verifies 120/120, the 75 files already present were confirmed
**byte-identical** rather than trusted, and all 119 tracked files were re-compared after
the copy. Nothing was edited on the way in.

What they turned out to be is itself the finding, and it changes what WP-0 is worth.
The instruments total **80 lines**: `acceptance-matrix.yaml` is 11 one-line test names
with severities, `IMPLEMENTATION_GATES.yaml` 9 gate names, `TRACEABILITY_MATRIX.csv` 14
requirement rows, `OWNER_REVIEW_CHECKLIST.md` 14 unticked boxes. They name **what** must
be true; they do not say how it is measured or what counts as passing. So WP-0 delivers a
canonical vocabulary and a set of acceptance IDs to report against — real value, and the
reason SEC-003 could be worked next — but it does **not** deliver an executable
definition of done. Claiming otherwise would repeat the error the plan was written to
correct.

`IMPLEMENTATION_GATES.yaml` also records `current_gate: GATE_0_OWNER_REVIEW`. By the
master's own gate model the Owner has never approved the master specification, and the
14 checklist items are the approval. That is an Owner action, not an engineering one.

### D-0070 — the authorization endpoint recomputes the plan instead of believing it
`SEC-003` ("Owner bypass cannot disable invariants", severity **blocker**) had no test
anywhere. Writing one found that the requirement was not merely unproven but false.

`/api/v1/coden/authorize` read `request.plan` straight from the request body and never
recomputed it. Every field the plan carries — `blocked`, `canonicalPath`, `mode`,
`nonBypassableInvariants` — was an assertion the caller made about itself, and nothing
obliged the caller to have called `/api/v1/coden/path-plan` at all. Proven by execution
against the unfixed code, three of five attacks landed:

```text
hand-written plan declaring /etc/... unblocked   -> 201, approval stored   (expected 403)
nonBypassableInvariants stripped to []           -> approval recorded []
canonicalPath rewritten to /etc/passwd           -> approval recorded /etc/passwd
mode raised to OWNER_BYPASS without elevation    -> 403  (this gate held)
ordinary in-workspace path (negative control)    -> 201  (correct)
```

Reach: `coden.authorize` is held by `developer` and `admin` as well as `owner`, while
`coden.owner-bypass` is owner-only — so a caller two roles below Owner could mint an
approval naming any path and carrying an empty invariant list. Host mutation is disabled
today (`executionEnabled:false`), which bounds the impact now but not the defect: the
approval record *is* the artifact that authorizes action, and it was forgeable.

The fix recomputes the plan server-side from the operands the submission names (path,
operation, mode, recursive, and the command/dependency/network/secret flags) and uses
only the recomputation thereafter. This is the rule the projection-verifier experiments
state for any checked answer: **recalculate from the original operands, never read the
verdict back off the answer's own path.** A disagreement between what was submitted and
what the server computes is recorded as `coden.plan-mismatch` rather than silently
normalised, so tampering stays visible.

Regression suite: `test/coden-path-authorization.test.mjs`, six tests including a
negative control — a closure that also breaks the working path is not a closure. Suite
507 -> 513, 0 failures; ESLint 147 files, 0 errors.

`SEC-003` is not therefore closed. The matrix item is broader than this endpoint: seven
invariants are declared and none of the other six has an enforcement mechanism anywhere
in the code. What is closed is that the authorization record can no longer be forged.

### D-0071 — an invariant declares where it is enforced, or it is not a claim this layer makes

`SEC-003` asks whether Owner Bypass can disable the declared invariants. Answering it
required first establishing what "declared" meant. `createPathPlan` returned seven
strings under `nonBypassableInvariants`, and a search of the whole tree found those names
in exactly one place — the list itself. Nothing read them, enforced them, or tested them.

The adversarial suite ran one attempt per invariant from inside a genuinely elevated
Owner Bypass session (owner role, password, unreplayed authenticator code, so the
elevation gate was open and the invariant, not the gate, was what answered). Three of the
seven held; one failed outright; three had no mechanism to attack at all.

Two repairs were possible for the last three and only one is honest. A denylist over
`commands` would let the planner claim it prevents malware and cyberattack, and this
project's own round-3 experiment already established that a textual denylist is defeated
by any indirection — `psql -f x.sql` never contains the forbidden verb. Shipping one
would convert an honest gap into a false assurance, which is worse than the gap.

So the declaration became a contract instead. Each invariant now carries `status` and
`enforcedBy`: `ACTIVE` names the code that enforces it on every request through this
layer; `NOT_ENFORCED_AT_THIS_LAYER` names the layer that owns it. Malware, illegal
cyberattack and physical harm prevention are commitments about what is *executed* or
*produced*, not properties of a filesystem path, and this layer has no execution surface
at all (`executionEnabled:false`). They remain declared — they are real product
commitments — but they no longer appear as something path authorization guarantees.

A test asserts every declared invariant resolves to an enforcement entry with a
recognised status and a named point, so a future invariant cannot be added as a bare
string again.

### D-0072 — the consent scope is enforced against the plan, not copied from the request

Found by execution, not by reading. `/api/v1/coden/authorize` took `consentScope`
straight from the request body and wrote it onto the stored approval without ever
checking it against the plan's own `consentOptions`. Three attacks from inside Owner
Bypass, all of which returned `201` with a stored approval:

```text
recursive delete + PERSISTENT_FOLDER   -> 201  a standing licence to destroy, issued once
consentScope: "DENY"                   -> 201  the plan's own refusal minted an approval
consentScope: "UNLIMITED_FOREVER"      -> 201  an invented scope stored verbatim
```

The second is the sharpest: `DENY` is listed in `consentOptions` as the refusal, and
submitting the refusal produced an approval. `destructive_action_confirmation` cannot
mean anything if the confirmation may be spent once and then reused unattended, or if
declining produces the same artifact as consenting.

`checkConsentScope` now runs against the **recomputed** plan, so Owner Bypass does not
relax it either: the scope must be one the plan offered (`400` otherwise), `DENY` never
produces an approval (`403`), and a destructive operation — `delete`, or anything
recursive — may only be granted a per-operation or per-file scope, never
`FOLDER_FOR_SESSION` or `PERSISTENT_FOLDER` (`403`). Every refusal is appended to the
ledger with the scope that was requested, so a rejected attempt is visible rather than
silent.

### D-0073 — the invariant panel is rendered from the server's declaration

The WebUI stated the invariants as five hardcoded `<li>` elements. They matched neither
the seven the planner declares nor each other: the panel listed "Scoped approvals and
rollback", which is not an invariant in the code, and omitted illegal cyberattack and
physical harm prevention, which are. Two independent claims, neither derived from the
other, with no mechanism that could ever bring them back into agreement.

The declaration now travels on `/api/v1/bootstrap` and the panel renders from it, each
row showing whether this layer enforces the invariant or naming the layer that does.
Verified in a real browser rather than by class inspection — the lesson `F4W-010`
recorded — with four checks in the browser suite asserting seven rows, four enforced
here, three elsewhere, each naming a layer.

### D-0074 — MANIFEST drift is repaired, and its scope is stated rather than widened

`sha256sum -c MANIFEST.sha256` did not pass on entry to this phase, while the handoff
reported it as `5690/5690`. `tools/run-browser-e2e.sh` was changed by `7597a54` in s261
and the manifest was last refreshed at the earlier `5e4dbef`, so one entry had been
failing for a session. Separately, `test/coden-path-authorization.test.mjs`, created by
s262, was never appended. Both are repaired here: 7 hashes refreshed (6 changed by this
phase, 1 stale since s261), 2 entries appended, **5692/5692 OK, 0 failed, 0 duplicates**.

Noted and deliberately **not** acted on: the manifest covers the delivered product tree
and does not cover `MASTER_REFERENCE/` — 0 of its 119 tracked files are listed. That
means the measuring instruments WP-0 imported are not integrity-protected, and the
acceptance matrix on which the whole plan depends could be altered without the manifest
noticing. Widening the manifest's scope changes what the artifact means, which is the
Owner's decision and not a side effect of a security fix. Recorded as an open finding.
