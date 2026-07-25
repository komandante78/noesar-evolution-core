# Phase 4 — remediation log

Chronological. The order matters in places: F4-004 had to be fixed mid-phase because it was
killing the harness, and F4-009 was only diagnosable after F4-007 made failures legible.

## 1. Fixes applied, with their evidence

### F4-004 — one malformed request terminated the service · high

Found while a functional suite simply stopped: three harness servers had died with an
identical stack. The request that killed them had one fault — a missing `content` field.

Three things had to be true at once, and all three were:

1. `server.mjs:592` called `return chatOrchestrator.streamToResponse(...)` **without
   `await`**, so the rejection did not enter the handler's `try/catch`; it became an unhandled
   rejection, which Node 22 turns into process exit. It was the *only* un-awaited
   promise-returning route in the file.
2. `chat-orchestrator.mjs` wrote `res.writeHead(200)` and the `run` frame **before** calling
   `graph.addMessage()`, which is what validates `content`. By the time the error existed, no
   status code could be sent.
3. There was no `unhandledRejection` or `uncaughtException` handler anywhere.

Fix, in that order: `await` the call; move message validation and context building ahead of
`writeHead`; make `json()` a no-op when `res.headersSent` (so an error handler cannot throw
`ERR_HTTP_HEADERS_SENT` and turn one bad request into an outage); add process-level guards
with deliberately different policies — a rejection is logged and the service keeps serving, an
uncaught exception is logged and the process exits so the supervisor restarts it and the
crash-loop detector can see it.

Tests: `stream-failure-containment.test.mjs` (4) and `stream-crash-survival.test.mjs` (1).
The latter is the one that matters: it spawns a real server as a child process, sends the
fatal request, and asserts the child is **still running** and still answering. Both files were
run against the pre-fix sources restored from the verified backup, and both failed — the
detector fires.

### F4-006 — streaming chat never worked · high

`streamWithFallback()` used `providerId` in `yield {providerId, delta}` and in its failure
list. The loop variable is `profileId`; `providerId` was never declared. In an ES module that
is a `ReferenceError` on the **first delta of every stream**, and again when the code tried to
report which provider had failed.

So every streaming reply had always returned exactly two SSE frames — `run`, then `error`
carrying "providerId is not defined". The acceptance suite had been passing a weak assertion
(`chunkCount > 1`) that those two frames satisfied. After the fix, the same request returns
**nine** frames with real content.

Fix: `providerId: profileId` in both places. Applied to all three copies of the module —
`services/reference-control-plane/src/ai-workspace/`, `ai-workspace/`,
`ai-workspace/runtime/` — with a timestamped backup, because Phase 3 learned with F-001 that
this file ships three times.

Test: `provider-gateway-success-paths.test.mjs`, 9 tests driving every public gateway method
to completion, including fallback across a dead provider to a working one and a failure
summary that names each provider.

### F4-005 — a reachable provider reported 500 · medium

The same defect class, in `probe()`: `return { status: 'healthy', providerId, … }` where the
parameter is `profileId`. The effect was inverted health reporting — an *unreachable* provider
answered a tidy 502, and a *healthy* one answered 500. Only the failure path had ever run.

Fix: `providerId: profileId`. Test: `provider-health-probe.test.mjs`, 3 tests (healthy,
upstream error, disabled-before-any-network-call), verified to fail against the pre-fix file.

### F4-002 — a TOTP code could be replayed · high

`verifyTotp()` answered only "is this code arithmetically valid for the current ±1 step".
Nothing recorded that a code had been spent, so a code observed once — over a shoulder, in a
screenshot, in a proxy log — authenticated a **second, independent login** for up to 90
seconds. RFC 6238 §5.2 forbids exactly this. AUTH-19 reproduced it: HTTP 200 on the replay.

Fix: `verifyTotpStep()` reports which step matched; `consumeTotp()` refuses any step at or
below the highest already accepted for that user, persisted in the auth store so a restart
does not reopen the window. Wired into all three flows — setup confirmation, login MFA and
step-up reauthentication — each auditing a replay distinctly (`auth.mfa-replayed`,
`auth.reauth-replayed`). `verifyTotp()` kept its old signature for callers that only need
validity.

Test: `totp-replay.test.mjs`, 8 tests, including that a **newer** code is still accepted —
single-use must not become no-use — and that the spent step survives a restart.

Consequence handled honestly: this broke **two delivered unit tests** and three of my own
acceptance suites, all of which reused one code across two consumptions. Those fixtures had
encoded the vulnerable behaviour, so the fixtures moved, not the fix. The acceptance suite now
waits for the authenticator to roll over, because fabricating a future code walks outside the
±1-step window and is simply invalid.

### F4-009 — a stale pooled connection surfaced as an unexplained error · medium

Two security checks failed reproducibly on `fetch failed` while the same fixtures passed in
isolation. The first hypothesis was a stale keep-alive socket after an idle pause; an
8-second-idle probe **refuted it**. The second hypothesis was the payload; a five-case probe
across text, HTML, sizes and counts refuted that too.

Only after F4-007 made the cause visible did the signature appear:
`UND_ERR_SOCKET other side closed`. undici reuses a pooled socket the upstream has already
closed, and does not retry a POST. Every provider closes idle connections, so this is a real
intermittent failure of the product's primary feature, not a harness artefact.

Fix: `fetchOnceRetryingStaleSocket()` retries **once**, only for stale-socket error codes,
only when the request produced no bytes and the caller has not aborted — a request that never
reached the server generated no tokens, so retrying it is safe. Applied to all three copies.

Test: "a connection the upstream has already closed is retried once", against a server with
`keepAliveTimeout = 1`. Result: SEC-27 and SEC-30 both went from FAIL to PASS.

### F4-007 — transport failures were illegible · low

`fetch()` puts the real reason in `error.cause`; the gateway propagated only
`error.message`, so a provider outage read as the single word "fetch failed" in the audit
trail. `describeFetchFailure()` now appends `cause.code` and `cause.message`. This is what
made F4-009 findable, which is the argument for fixing diagnosability defects rather than
filing them.

### F4-008 — two security-matrix rows described behaviour the code lacks · medium

- Row 12 claimed "CORS IMPLEMENTED" and cited `tests/http-security.test.mjs` as evidence.
  That file contains two tests, **neither about CORS**, and there is no CORS code at all. The
  security *outcome* is fine — no `Access-Control-Allow-Origin` is ever emitted, so a browser
  will not expose a cross-origin response, and state changes additionally require
  `SameSite=Strict` cookies plus an `x-noesar-csrf` header — but the claim and its evidence
  pointer were both false.
- Row 33 claimed "user / project isolation IMPLEMENTED". The reference-json data plane has
  **no per-user ownership field anywhere** (`grep` for `ownerId|actorId|userId` in
  `context-graph.mjs` returns nothing), and no route can create a second user. Per-project
  isolation is real and verified; per-user isolation is neither implemented nor reachable.

Fix: both rows rewritten to describe the real mechanism, plus rows for MFA, WebSocket origin,
red-team testing and SBOM brought in line with what this phase actually established. Under
CLAUDE10 §43 a doc that describes behaviour the code does not have is a defect of the same
severity as a code bug, so this is logged as one.

### F4-001 — the analysis container's own layer · informational

Phase 3 stated that starting `noesar-debuglab` produced no modification. True of host data,
over-broad at container level: 25 files in its ephemeral upper layer carry Phase 3 mtimes
(python bytecode caches, `semgrep` settings and log, a `detect-secrets` temp file). Its one
writable host mount is byte-identical, before and after both phases. No code change is
possible — a scanner writes caches — so the wording is corrected instead. In this phase the
same layer was 77 files before and after.

### F4-003 — withdrawn

Reported as "the SSE stream aborts with no terminating error frame". The unit test written to
prove it **passed immediately against unmodified code**: a failure inside the streaming try
block does emit `event: error` and closes cleanly. The abort had a different cause — the
process dying (F4-004). Recorded rather than deleted, because it was reported before it was
verified, and the register should show that.

## 2. Findings accepted and left open

| ID | Why not fixed here |
|---|---|
| F4-010 | A correct fix resolves the hostname and validates every returned address at connect time. That changes the transport layer and needs its own design; a partial mitigation inside an acceptance phase is how a false sense of safety gets shipped. Exploitation requires `provider.manage` or `agent.manage`. |
| F4-011 | Adding magic-byte sniffing changes ingestion behaviour for sources already stored, and belongs with the Phase 5 documentation of supported formats. Not an execution risk: extractors run `shell:false` on a temp path, output is capped, nothing is executed. |
| F4-012 | Both limits are enforced; only their order and the surfaced error differ. No action. |
| F4-013 | Documentation work, and Phase 5 owns the documentation set. Stated now so nobody infers that the product encrypts backups. |

## 3. The rule, not only the instances

F4-005 and F4-006 were the *same mistake twice*, so the class needed addressing.

A static checker was written for it and then **rejected**. Version one collected bindings
per file: it missed both real defects — the same name was a parameter of a *different*
function in the same file — and produced 25 false positives on correct nested destructuring.
Version two tracked bindings on a brace-depth stack: it caught both real defects and still
produced roughly 16 false positives per file. A hand-rolled JavaScript scope analyser without
a parser is not sound, and a checker whose output has to be ignored is worse than none,
because it teaches the reader to skip it. Both versions and this reasoning are preserved at
`$ARTIFACT_ROOT/phase4_evidence/rejected-tooling/`.

What was shipped in its place:

1. **Success-path coverage** of every public `ProviderGateway` method (9 tests). The class
   existed precisely because only failure paths had ever executed.
2. **Process-level guards** in `server.mjs`, which turn this class from a service outage into
   a logged ERROR.
3. **B-006**, recording that the correct tool is a linter with a `no-undef` rule, and that
   installing one is forbidden by CLAUDE10 rule 45 — a gap named rather than papered over.

## 4. Static analysis: dismissals, with evidence

`noesar-debuglab` (semgrep, bandit, ruff, detect-secrets, shellcheck, mypy) was started for
HUNT AND FIX and **stopped in the same phase**.

**0 findings** across `services/`, `ai-workspace/`, `oci/`, `INSTALLATION/`, `deployment/` —
including every module written or changed in this phase.

| Finding | Verdict |
|---|---|
| `detect-non-literal-regexp`, CRITICAL, `tools/generate-inventory.mjs:74` | **Fixed rather than argued with.** The interpolated value was one of three literals from the same file, so there was no ReDoS vector, but pre-compiling three frozen patterns removes the construct and reads better. Re-scan: semgrep 0 findings. |
| `insecure-object-assign`, MEDIUM, `apps/webui-static/app.js:8` | **False positive, mis-anchored.** Line 8 is 1 670 characters of concatenated code; the flagged construct is `{...options.headers}` in the app's own `fetch` helper, where the "user-controlled data" is the caller's own options within the same page. Same dismissal Phase 3 recorded. |
| `B603`/`S603` "subprocess call — check for untrusted input" ×3, and `B607`/`S607` "partial executable path" ×4, in `tools/create-rust-build-provenance.py` and `tools/verify-package.py` | **False positives.** Delivered build tooling invoking a literal argv list with no interpolation of external input, on a controlled host, outside the runtime image. Identical to the class Phase 3 dismissed with the same evidence. |
| `B404` "consider the security implications of subprocess" ×2 | Informational by nature; the module is used deliberately. |
| `F401` `sys` imported but unused, `tools/verify-package.py:9` | **Left alone deliberately.** Phase 3 recorded this as `DEFERRED_TO_PHASE_5`. It is a one-line cosmetic fix, and quietly overriding a recorded deferral is worse than the lint. The deferral stands. |

A clean scan proves the scanner found nothing. It does not prove the code is correct — which
is exactly why the three high findings in this phase were found by running the product, not by
scanning it.

## 5. Image and installation changes

| Step | Detail |
|---|---|
| Build | `noesar-evolution:phase4` from `oci/Dockerfile.phase4`, `--network=none --pull=false` |
| Base | `noesar-evolution:phase3`, so the audited apt layer is inherited unchanged rather than re-resolved |
| Builds | two: the first with F4-004/005/006/007/008, the second adding F4-002 and F4-009 |
| Final image | `sha256:1cf0ada84d2b46abfeb1f4a4826108adf1cfb9d18af4590024671038eac05973` |
| Backup before the swap | `$ARTIFACT_ROOT/backups/pre_phase4_swap_20260725T121648Z`, 7/7 files verified |
| Rollback preserved | `noesar-evolution.rollback-phase3-20260725T121648Z`, both images still on disk |
| Persistence across the swap | setup-token fingerprint, state digest and audit record count all unchanged |
| Health after the swap | `/livez` 200, `/readyz` ready, `/healthz` healthy, 17 components, 0 unhealthy, `RestartCount=0` |
| Verified in the running image | 4 occurrences of `providerId:profileId`, 1 `unhandledRejection` handler, 4 `consumeTotp` call sites |

---

# Phase 4 completion gate — remediation

14 findings raised (`F4C-001`…`F4C-014`): 5 high, 5 medium, 2 low, 2 informational.
**Every high and medium is closed with a regression test.** One informational row is left
open by choice. Full register: `OPEN_FINDINGS.tsv`. Narrative: `PHASE_4_COMPLETION_REPORT.md`.

## Found by running the product, not by reading it

Four of the five high findings were found by execution:

* `F4C-001` — the first real migration run stopped dead at 0012. Static review had passed
  over it for three phases because the SQL is syntactically fine; it is only invalid
  against a cluster that already ran 0010.
* `F4C-002` — the integration exercise *ended* at `restart.scheduled` and exited 0. A
  reader would have seen a restart being scheduled and assumed it happened.
* `F4C-004` — an invited user hit the MFA step of login with no envelope to decrypt. No
  unit test covered it because every fixture bootstrapped an owner, which always has one.
  This is the same shape as the Phase 4 lesson: the untested path was the *success* path.
* `F4C-009` — reproduced by a stress harness that captures output, after Phase 4 had seen
  it once, lost the evidence, and guessed at two unrelated files.

`F4C-006` was found by static analysis — but only because the right tool was finally used.
Three phases of `node --check` could not see it, which is what blocker B-006 said.

## Triage: what was dismissed, and on what evidence

| Reported | Verdict | Evidence |
|---|---|---|
| `no-cond-assign` ×3 | **false positive of my own configuration** | the SSE framing loop uses `while ((split = buffer.indexOf('\n\n')) >= 0)` — parenthesised assignment, explicit comparison, the standard idiom. I had set `'always'`, stricter than ESLint's default `'except-parens'`. The rule was corrected, not the code. |
| 2 parse errors in `apps/webui-static/` | **false positive of my own configuration** | `app.js` imports and `i18n.js` exports; they are ES modules and I had declared the path `sourceType: 'script'`. |
| `no-undef` on `DataTransfer`, `MediaRecorder` | **false positive of my own configuration** | real browser globals missing from my globals list. |
| 14 failures in an intermediate stress run | **invalid run, not a product finding** | all in `user-directory.test.mjs`, runs 1–14, passing from run 15 — I had been editing those files while the run executed. Diagnosed from the pattern, then re-run cleanly. |

A dismissal that cannot be justified is a finding. Each of the above names the specific
evidence, and in every case the fix was to my configuration or my process rather than to
the product.

## Fixing the rule, not only the instance

* `F4C-006` was one instance of "a fix applied to some copies of a duplicated file".
  The instance was repaired by restoring three-way identity; the *rule* was repaired by
  adding a linter that would have caught it, self-testing that linter against the exact
  defect shape, and wiring it into the pre-commit gate.
* `F4C-007` was a blanket `GRANT` in runtime code that silently undid a migration's
  `REVOKE`. The instance was removed; the rule is that privileges now live in a versioned
  migration, where they are reviewable as a diff. Privileges expressed in a loop are not.
* `F4C-009` was one regex matching one identifier shape. The rule is that canonical UUIDs
  are now lifted out before *any* redaction rule runs, so a future rule cannot corrupt an
  identifier either.
* `F4C-012` was one test depending on the wall clock. The rule is `tools/flake-stress.mjs`,
  now committed, which captures the failing output and file order instead of losing them.

## Regression coverage added

| Finding | Test |
|---|---|
| F4C-001 | `postgres-integration.mjs` DB-06/DB-07 — all 16 migrations from an empty data directory, then re-applied |
| F4C-002 | `postgres-integration.mjs` DB-30 — requires a **new** pid after SIGKILL, so a non-restarting supervisor fails |
| F4C-003 | DB-41 append succeeds, DB-42 delete refused |
| F4C-004 | `user-directory.test.mjs` universal-MFA test; `multi-user-isolation.mjs` MU-08b performs a real password+TOTP login |
| F4C-005 | invitation replay and claim-lapse tests |
| F4C-006 | `tools/run-eslint.sh` over the whole tree; `tools/verify-linter-detects.sh` proves the detector fires |
| F4C-007 | DB-08b and DB-42 |
| F4C-009/010/011 | `redaction-identifier-integrity.test.mjs`, 9 tests; **7 of the 9 fail against the pre-fix module**, which was verified by reverting the file and re-running |
| F4C-012 | the test itself, plus the committed stress harness |
