---
name: noesar-evolution-verify
description: MANDATORY before running any test, scan, audit or hunt in NOESAR EVOLUTION. Imposes four verification tiers, a change-to-tier map, output discipline (summary lines, never full suite dumps), single-pass execution of expensive suites, and scoping of the HUNT AND FIX step to the phase diff instead of the whole first-party surface. Use before the TEST step, before the HUNT AND FIX step, before any deployment, and whenever tempted to re-run a suite that is already green.
---

# Verification tiers — measure what changed, once

Applies **only** to NOESAR EVOLUTION. Subordinate to `CLAUDE10.md`; where they conflict,
`CLAUDE10.md` wins. Rule 38 is never relaxed by this skill: **no PASS without evidence
produced in this session**, and a tier not run is *declared*, never implied.

What this skill removes is not verification — it is **re-verification of what the change
could not have touched**, and the habit of running the whole battery after every edit.

## The four tiers

| Tier | What | Cost [STIMA] |
|---|---|---|
| **T0 · SMOKE** | `node --test services/reference-control-plane/test/*.test.mjs`<br>`node tools/verify-source.mjs` | seconds |
| **T1 · TARGETED** | T0 + the suites named by the change map below + `tools/run-eslint.sh` | tens of seconds |
| **T2 · FULL BATTERY** | `scripts/test.sh` (9 named steps) + ESLint + `tools/run-browser-e2e.sh` + `tools/accessibility-audit.mjs` + `tools/seeded-defect-proof.mjs` + MANIFEST | minutes — it builds an image and drives two containers |
| **T3 · LIVE INSTALL** | build → prove image bytes equal the tree → stop with grace → backup stopped → preserve predecessor → start with config read back → live verify → §5a cleanup | the whole `CLAUDE10.md` §3a sequence |

**T2 runs once per phase, at its close. T3 runs once, after T2 is green.** Neither is run
after an intermediate edit. During the work, T0/T1 is the loop.

## Change → tier map

| What the phase changed | Run |
|---|---|
| documentation / prose only | T0 (+ MANIFEST if the tracked file set changed) |
| control-plane route, handler, auth gate | T0 + `tools/auth-http-smoke.mjs` + `tools/http-smoke.mjs` |
| markup / DOM structure | T1 + `tools/browser-e2e.mjs` + `tools/accessibility-audit.mjs` |
| CSS tokens, themes, contrast | `tools/computed-style-snapshot.mjs` + `tools/accessibility-audit.mjs` |
| installers, packaging, `.gitignore` | `tools/test-installer-hardening.mjs` + `tools/test-packaging-filters.mjs` + `tools/test-cross-platform-installers.mjs` |
| database schema / migration | `tools/verify-postgres-migrations.py` + `tools/verify-postgres-contract.py` |
| Rust authority crate | `tools/verify-rust-authority-source.py` + `tools/test-rust-build-provenance.py` |
| anything that will be installed | T2, then T3 |

If the change is not in this table, run T1 and **name** the suite you judged relevant and
the one you judged irrelevant. An unnamed skip is a skip nobody can audit.

## Output discipline — the suite result is a summary, not a transcript

The browser suite prints one line per check (315 at last count), ESLint prints per file,
`scripts/test.sh` prints per step. Loading those transcripts costs more than running them.

- Pipe to the summary: `2>&1 | tail -25`, or `grep -E 'FAIL|✗|Error|SUMMARY|pass=|tests '`.
- On green: report **the summary line only**.
- On red: pull the failing case's output *specifically* — never the whole log to "have it".
- Never paste a full suite transcript into the reply to the Owner. The counts and the
  failures are the result; the rest is noise both of us pay for.

## Single-pass rules

1. **Do not re-run a green suite to be sure.** Re-run only what the last edit could have
   broken. "Let me just check everything again" is the single most expensive habit here.
2. **Independent checks run in parallel, in one message.** ESLint, the Python verifiers and
   the unit tests do not depend on each other.
3. **Fix first, then verify once.** Batch several small repairs, then run the tier — not a
   tier per repair.
4. **A tier that was green earlier in the same phase, on code that has not changed since,
   is not re-run at close.** State that, with the reason, instead of paying for it twice.

## HUNT AND FIX — scoped to the diff by default

This **narrows** `CLAUDE10.md` §40a step 7, with the Owner's authorisation of 2026-07-27.
The duty to hunt and to repair is untouched; what changes is the default target.

- **Default target: what this phase changed** — `git diff --name-only` plus the surfaces
  those files reach. A phase that edited two JS files does not need a scan of every
  installer, crate and capability.
- **Full first-party sweep** (`services/`, `ai-workspace/`, `capabilities/`, `tools/`,
  `apps/`, `rust/crates/`, `oci/`, shell installers) is still required when: a new surface
  is introduced; the phase touches security, authority, installers or packaging; the last
  full sweep is more than five phases old; or the Owner asks.
- **Always declare which of the two ran.** "Scoped to the diff (N files)" and "full sweep"
  are different claims and are never reported as the same thing.
- `noesar-debuglab`: started **once**, given the batched target list in one pass, and
  **stopped in the same phase**. Not started at all when the diff carries no code.
- Triage is unchanged and non-negotiable: every hit is checked against the real code and
  every dismissal is recorded with its evidence. A false positive "fixed" is a real
  regression introduced for nothing.
- A clean scan proves the scanner found nothing — never that the code is correct.

## Before claiming a number

- Numbers in `PROJECT_STATE.json` are **declarations by a past phase**, not measurements.
  They have been stale. Re-measure or label `[UNVERIFIED]`.
- A test count that went up is not a pass. Show the summary line.
- When a fix is meant to close a defect, **see the test fail first**. This project has
  found defects in its own measurement three times — an oracle that never failed has not
  been shown to work.
- Live verification never uses a suite that mutates data (§3a 11e). Against the running
  installation: health, the deployed bytes matching the tree, and the surfaces answering.

---

*This skill is deliberately under 140 lines, for the same reason it exists.*
