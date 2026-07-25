# JavaScript static analysis

**Status:** `NO_UNDEF_LINTER=PASS` — 136 files, **0 errors, 0 warnings, 0 `no-undef`**.
**Closes:** blocker **B-006**.

---

## Why this exists

Phase 4 found the same defect twice. `ProviderGateway.probe()` and
`streamWithFallback()` both used `providerId`, an identifier not declared in their scope —
the parameter is `profileId`. In an ES module that is a `ReferenceError`, and one of the
two meant that **streaming chat had never worked at all**: the error fired on the first
delta of every stream, so every streaming reply in every release had been exactly two SSE
frames, `run` then `error`.

`node --check` cannot see it. It is valid syntax. The class survived because every
delivered test exercised the *failure* path of those functions, so the successful lines had
never been executed.

Phase 4 wrote a homegrown checker for the class **twice** and rejected it both times as
unsound — v1 missed both real defects and produced 25 false positives, v2 caught them but
still produced ~16 per file. That was the right call, recorded as decision D-0034: a
checker whose output has to be ignored is worse than no checker, because it teaches people
to skip it. The blocker named the correct tool instead.

## The tool

| Item | Value |
|---|---|
| Tool | ESLint |
| Version | **9.39.5**, pinned; `NOESAR_ESLINT_VERSION` overrides for a deliberate upgrade |
| Runs in | `node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3` |
| Installed to | `$ARTIFACT_ROOT/lint`, **outside** the repository |
| Config | `eslint.config.mjs` (flat config) |
| Runner | `tools/run-eslint.sh` |
| Self-test | `tools/verify-linter-detects.sh` |

Nothing is installed on this host, which CLAUDE10 rule 45 forbids. The repository is
mounted **read-only** into the container, so a lint run cannot modify the source it is
judging, and `node_modules` never appears in the working tree.

## Coverage

Every area the gate names:

| Area | Pattern |
|---|---|
| runtime | `**/*.mjs`, `**/*.js`, `**/*.cjs` |
| WebUI | `apps/webui-static/**/*.js` (browser globals, same rules) |
| tools | covered by the repository-wide pattern |
| tests | covered by the repository-wide pattern |
| workers | covered by the repository-wide pattern |
| Node installers | covered by the repository-wide pattern |

Ignored: `rust/vendor/**`, `node_modules/**`, `BACKUPS/**`, `provenance/**`,
`MASTER_REFERENCE/**`, `private-boundary/**`, `apps/webui-react/dist/**` — vendored,
generated, or not source. `services/`, `tools/`, `apps/webui-static/`, `tests/` and
`ai-workspace/` are **never** ignored, and a unit test asserts that, because widening the
ignore list is the easiest way to make a gate stop finding things.

`no-undef` is `error` in every block. Nothing downgrades it and no file is exempt;
`test/static-analysis-config.test.mjs` fails if that changes.

## Proving the detector fires

A clean scan proves the scanner found nothing, never that the code is correct — and this
project has already been bitten by a check that was silently passing. So the detector is
tested against canaries reproducing the exact defect class, held **outside** the repository
so one can never be committed by accident:

```text
DETECTED canary-shorthand.mjs     -> providerId                    (the F4-005 / F4-006 shape)
DETECTED canary-renamed-call.mjs  -> fetchOnceRetryingStaleSocket  (the shape found below)
DETECTED canary-browser.js        -> undeclaredState               (browser-side)
LINTER_SELF_TEST=PASS 3/3
```

## What the first run found

20 errors across the 131 files present at that point, including **six `no-undef`**.

### The real defect: F4C-006

`ai-workspace/provider-gateway.mjs` and `ai-workspace/runtime/provider-gateway.mjs` both
called `fetchOnceRetryingStaleSocket(...)` — three call sites each — and **neither file
defined it**.

Git history makes the cause unambiguous. All three copies of this module were byte-identical
at the end of Phase 3 (sha256 `a07d385b…`). The Phase 4 remediation commit `04878c4`
applied the F4-006 / F4-007 / F4-009 fixes to the shipped copy in full, and to these two
copies **partially**: the call sites were renamed, the helper definitions were not added.

The result is the very defect class Phase 4 was fixing, reintroduced by the fix, into the
copies nobody runs. Neither file is shipped — the Dockerfile copies only
`services/reference-control-plane/` — so no release was affected. But it is exactly what
B-006 predicted would keep happening, and the tool B-006 asked for found it on its first
run.

Repaired by restoring three-way identity from the corrected shipped copy; all three now
hash to `9e3bd86f…`.

### Findings dismissed, with evidence

| Finding | Verdict | Evidence |
|---|---|---|
| `no-cond-assign` ×3 | **false positive, my configuration** | The SSE framing loop uses `while ((split = buffer.indexOf('\n\n')) >= 0)` — the standard idiom, assignment parenthesised, comparison explicit. I had set `'always'`, which is stricter than ESLint's default. Corrected to `'except-parens'`; a rule that flags correct code is a rule people learn to ignore. |
| parse errors ×2 in `apps/webui-static/` | **false positive, my configuration** | `app.js` imports and `i18n.js` exports, so they are ES modules; I had declared that path `sourceType: 'script'`. Corrected. |
| `no-undef` `DataTransfer`, `MediaRecorder` | **false positive, my configuration** | Legitimate browser globals absent from my globals list. Added. |

### Real findings fixed

| File | Finding |
|---|---|
| `ai-workspace/provider-gateway.mjs`, `ai-workspace/runtime/provider-gateway.mjs` | `no-undef` ×6 — F4C-006 above |
| `src/auth.mjs` | unused import `verifyTotp`, left behind when F4-002 moved the login path to `verifyTotpStep` |
| `src/update-manager.mjs` | `const result =` bound but never read; the call is made for its throw, now stated instead of implied |
| `test/provider-gateway-success-paths.test.mjs` | a stale `eslint-disable-next-line no-empty` suppressing nothing |
| `tests/runtime/secure-runtime-smoke.mjs` | unused import `chmodSync` |
| `tools/acceptance/a3-security.mjs` | unused imports `chmodSync`, `createHash`; three values bound but never read |

### And one regression the linter caught in my own fix

Correcting `a3-security.mjs`, I renamed the wrong occurrence of `res` — the one at
`SEC-17`, where it is read five times — instead of the unread one at `SEC-33`. The next
run reported five fresh `no-undef` errors. That is the tool doing precisely the job it was
added for, on the person who added it, within ten minutes.

## Integration

```text
npm run lint             tools/run-eslint.sh
npm run lint:self-test   tools/verify-linter-detects.sh
```

The pre-commit hook (`.githooks/pre-commit`, enabled with
`git config core.hooksPath .githooks`) runs the unit suite, the migration-manifest check
and ESLint. If Docker is unavailable it **blocks** rather than skipping — a gate that
cannot run must say so, not pass quietly.

`test/static-analysis-config.test.mjs` (8 tests) guards the configuration itself: that
`no-undef` is an error everywhere, that first-party directories are never ignored, that
unused suppressions are reported, that the version and image are pinned rather than
floating, and that the hook blocks when it cannot run.

## Limits, stated

* **This is not a type checker.** It finds undeclared identifiers, not wrong ones. A
  property misspelled on an object that exists is invisible to it.
* **`no-unused-vars` uses `args: 'none'`**, so an unused function parameter is not
  reported — that would be noise on handler signatures.
* **The Rust surface is not covered.** `cargo clippy` is a separate concern and no Rust
  toolchain ran in this gate.
* **Nothing checks the linter is actually run.** The pre-commit hook is opt-in per clone;
  a contributor who never enables it never runs the gate.
