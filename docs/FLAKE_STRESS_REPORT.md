# Test flake — stress, root cause, repair

**Status:** `TEST_SUITE_STRESS=PASS` · `FLAKE_STATUS=REPRODUCED_ROOT_CAUSED_AND_FIXED`

---

## What was inherited

Phase 4 observed 1 failure in 1 run of 352 tests, lost the output before it could be read,
then saw the suite pass 14 consecutive times. It recorded the result honestly as
"352/352 with one observed, unreproduced flake" and named two candidates: the TOTP window
test and the stale-connection retry test, both of which depend on real elapsed time.

**One of those guesses was right and one was wrong**, and the wrong one hid a real product
defect for a whole phase.

## Method

`tools/flake-stress.mjs`, now a committed tool rather than a one-off:

* **250 isolated runs** — 50 each of the five most timing-sensitive files
  (`totp-replay`, `provider-gateway-success-paths`, `auth`, `watchdog`, `update-manager`)
* **20 full-suite runs**, each with a **shuffled file order** from a recorded seed
* every run records seed, order, exit status, pass/fail counts and duration
* on failure the **complete output and the file order are written to disk**, which is
  precisely what Phase 4 could not do

The order is shuffled deliberately: a test that only fails after some other test has run —
shared temp directory, leaked global, a clock already advanced — cannot be found by
repeating a fixed order.

```text
node tools/flake-stress.mjs --isolated 50 --suite 20 --seed 20260725
```

## Result 1 — the flake reproduced, and it was not a flake

```text
FLAKE_STRESS runs=270 failures=2 status=REPRODUCED   (seed 20260725, pre-fix)

  suite run  1  a trace record carries its incident id and scope
  suite run 20  a trace record carries its incident id and scope
                every response carries a correlation id the operator can search on
```

The captured failure:

```text
expected: 'INC-b3a1c78a-2822-4650-ba5d-173000ca98a2'
actual:   'INC-b3a1c78a-[REDACTED_PHONE]-ba5d-173000ca98a2'
```

**Root cause: the log redactor's phone-number rule matches inside a UUID.**

```text
/(?<!\w)(?:\+?\d[\d .()-]{7,}\d)(?!\w)/g
```

`2822-4650` is nine characters of digits and hyphens, preceded and followed by a hyphen —
which is not a word character, so both lookarounds are satisfied. The rule rewrites the
middle of the identifier.

Measured rate, over 200 000 `randomUUID()` values:

```text
corrupted: 13497 of 200000 = 6.75%
```

Every string value in every log record passes through `redactText`. So **roughly one log
record in fifteen carried a corrupted correlation id, incident id, session id, project id
or user id** — and the correlation id is the feature Phase 3 added specifically so that a
user-visible failure could be found in the log. Run 20 broke that test by name.

This was never a timing race. It was a probabilistic product defect whose probability
happened to look like flakiness, and Phase 4's hypothesis pointed at two unrelated files.

Recorded as **F4C-009**. Fixed by lifting canonical UUIDs out before any rule runs and
restoring them afterwards: a UUID is an identifier, never a phone number or a payment card.

Two further findings came out of the same repair:

* **F4C-010** (low) — an IPv4 address was being redacted under the label
  `[REDACTED_PHONE]`, because the phone rule also matches `192.168.1.7` and ran first. The
  data was protected either way; the label contradicted the documentation.
* **F4C-011** (medium) — the NUL-delimited placeholder my own fix introduced could be
  forged from attacker-controlled text, substituting a UUID from elsewhere in the same
  value or the string `"undefined"`. Found by probing the fix, not by a test that expected
  it. Closed by stripping U+0000 before tokenisation.

## Result 2 — a second, genuinely different flake

Re-running the stress after the redaction fix found the *other* Phase 4 candidate:

```text
FAIL isolated totp-replay.test.mjs run 14
  an older code from within the window is refused once a newer one has been spent
  the older code is still arithmetically valid, which is the point
  false !== true
```

The test generates a code, runs a login, then asserts the previous step's code is still
arithmetically valid. `verifyTotp` re-samples `Date.now()`, so if the wall clock crossed a
30-second step boundary during the sequence, the previous step's code became **two** steps
old — outside the ±1 acceptance window — and the assertion failed for a reason the test was
never about. Roughly 1 run in 50.

Recorded as **F4C-012**. Fixed by removing the real-clock dependency: the test anchors
itself inside a step with at least ten seconds of headroom before it starts, and verifies
against that anchor rather than re-sampling. It fails closed either way — a spurious
failure, never a spurious pass.

## Result 3 — clean

```text
FLAKE_STRESS runs=270 failures=0 status=NOT_REPRODUCED   (seed 20260725, both fixes applied)

isolated totp-replay.test.mjs:                    50/50 clean
isolated provider-gateway-success-paths.test.mjs: 50/50 clean
isolated auth.test.mjs:                           50/50 clean
isolated watchdog.test.mjs:                       50/50 clean
isolated update-manager.test.mjs:                 50/50 clean
suite runs 1..20, shuffled order:                 20/20 clean, 444 tests each
suite duration: min 4652 ms, max 11303 ms, mean 5857 ms
```

Reports: `$ARTIFACT_ROOT/flake-stress-prefix/` and `$ARTIFACT_ROOT/flake-stress-final/`.

## A harness mistake, recorded

An intermediate run reported 14 failures, all in `user-directory.test.mjs`. That run is
**invalid and is not counted**: I had started it and then continued editing the very files
it was executing, so runs 1–14 tested a half-applied change and runs 15–20 passed once the
edits landed. Diagnosed from the failure pattern, not assumed. A second overlapping-runs
mistake — starting a new run while an earlier one was still writing to the same output
directory — was found the same way and cleaned up before the definitive run.

Recorded because a stress harness whose own results cannot be trusted is worth less than no
harness, and both mistakes were mine rather than the product's.

## What was checked beyond repetition

| Suspected cause | Finding |
|---|---|
| Races | none found in the failures actually captured |
| Timers | one real dependency on the wall clock (F4C-012), removed |
| Filesystem | each fixture uses its own `mkdtemp` directory; no cross-test sharing observed across 20 shuffled orders |
| Global state | file order shuffled across 20 runs specifically to expose it; nothing surfaced |
| Real-clock dependence | eliminated in the one test that had it; the watchdog tests already inject a clock |

## Limits, stated

* **270 runs is not proof of determinism.** A defect with a rate near 1 in 1000 would be
  unlikely to appear. What can be said is that the two failure modes observed here are
  gone, and that the one with a 6.75% rate was found, explained and fixed rather than
  waited out.
* **The stress runs only the unit suite.** The in-container PostgreSQL exercise and the
  live multi-user acceptance were each run repeatedly by hand during development, not 50
  times under the harness.
* The suite's maximum duration (11.3 s against a 4.7 s mean) reflects contention with other
  work on the host during the run, not variance in the tests.
