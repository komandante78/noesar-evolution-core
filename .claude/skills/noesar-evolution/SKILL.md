---
name: noesar-evolution
description: MANDATORY for every NOESAR EVOLUTION phase. Imposes the fixed 14-step phase cycle (READ STATE → … → HUNT AND FIX → … → STOP), the duty to fix defects as they are found rather than only logging them, atomic phase-scoped commits, and the non-negotiable stop condition. Use before starting, resuming, or closing any phase of the NOESAR EVOLUTION installation, and before any commit or push in /mnt/cachec/NOESAR_EVOLUTION.
---

# NOESAR EVOLUTION — Phase Execution Skill

Applies **only** to NOESAR EVOLUTION (`/mnt/cachec/NOESAR_EVOLUTION`).
Subordinate to `CLAUDE10.md`; where they conflict, `CLAUDE10.md` wins.

## The cycle — mandatory, ordered, no step skipped

Every phase executes exactly these steps, in this order:

```text
READ STATE
VERIFY INPUTS
ASSESS RISKS
BACKUP
EXECUTE MINIMAL SCOPE
TEST
HUNT AND FIX          <- find defects and repair them, do not merely log them
DOCUMENT
SECRET SCAN
GIT DIFF REVIEW
COMMIT
PUSH
WRITE HANDOFF
STOP
```

No step is skipped. A step that cannot be performed is **declared as a blocker**,
never silently omitted and never marked done.

### 1. READ STATE
Read `PROJECT_STATE.json`, `docs/SESSION_HANDOFF.md`, `docs/PHASE_PLAN.md`,
`docs/INSTALLATION_LEDGER.md`, `docs/DECISION_LOG.md`. Confirm `current_phase`
matches the phase you were asked to run. If it does not, stop and report.

### 2. VERIFY INPUTS
Verify every input this phase consumes actually exists and is what it claims:
checksums for archives, paths for directories, versions for tools. Record the
verification result. Never assume an input from a previous phase is still valid.

### 3. ASSESS RISKS
State, before acting: what could be destroyed, what is irreversible, what touches
anything outside `PROJECT_ROOT`, what could leak a secret. Anything forbidden by
`CLAUDE10.md` is raised now, not discovered mid-execution.

### 4. BACKUP
Back up anything a mutation could damage, timestamped, inside the project. If the
phase mutates nothing, state that explicitly — do not silently skip.

### 5. EXECUTE MINIMAL SCOPE
Do only what this phase specifies. Nothing anticipatory, nothing "while we're here".
Out-of-scope findings go to `docs/DECISION_LOG.md` for a later phase.

### 6. TEST
Run the verification appropriate to what changed, and show real output. No test
result is asserted without evidence produced in this session. `[UNVERIFIED]` is a
valid, required label — a fabricated PASS is not.

### 7. HUNT AND FIX
**Do not close a phase without actively looking for defects, and do not merely log
what you find — repair it.** A phase that "found bugs" and left them is not finished.

Hunt with real tools, not by reading alone. On this host that means starting
`noesar-debuglab` (`:8099`, `x-debuglab-token` header, `/api/analyze?kind=code&target=…`),
which carries **semgrep, bandit, ruff, detect-secrets, shellcheck, mypy** — none of
which exist on the host itself. Scan whatever this phase touched, plus the first-party
surface: `services/`, `ai-workspace/`, `capabilities/`, `tools/`, `apps/`,
`rust/crates/`, `oci/`, and the shell installers. **Stop the container again when
done** — it is not part of this product and must not be left running.

Then fix. The order is: reproduce → understand the root cause → fix the cause, not the
symptom → prove the fix.

**Triage every finding before acting on it.** Static analysers are noisy, and a false
positive "fixed" is a real regression introduced for nothing. Verify each hit against
the actual code — real examples already seen on this project: `SC1007` on the correct
`CDPATH= cd` idiom; `insecure-file-permissions` telling you 0o700 is too permissive
when 0o644 is *less* restrictive; a hardcoded-password hit on a test canary literally
named `must-not-leak`; 5,078 "high entropy" hits that were all SHA-256 checksums.
Record what you dismissed and why — a dismissal you cannot justify is a finding.

**Fix inside the phase when** the defect is in scope, understood, repairable without
starting containers or touching the host, and provable by a test. Every fix still obeys
the rest of this cycle: back it up first, test it, document it, commit it atomically.

**Do not fix, record instead, when** the repair would exceed the phase's scope, require
fabricating content you cannot verify (upstream source, a checksum, a licence), demand
a destructive or outward-facing action, or rest on a root cause you have not actually
found. Guessing is not fixing. Say plainly what is left open and why.

**Also fix the rule that produced the defect**, not just the instance. If a filter
deleted real files, correct the filter and add a regression test; if a check was silently
passing, prove the detector fires before trusting a clean result. Both have already
happened here.

A defect that cannot be reached by tooling still counts: configuration, host and design
defects (a weak seccomp profile, a port collision, a missing endpoint) are invisible to
every scanner on this list. **A clean scan is not a verdict of "safe".**

### 8. DOCUMENT
Update the documentation affected by this phase in this phase. At minimum
`docs/INSTALLATION_LEDGER.md`; plus `docs/DECISION_LOG.md` for every decision taken.
Record what was found, what was fixed, what was dismissed as a false positive and on
what evidence, and what remains open.

### 9. SECRET SCAN
Scan the working tree and the staged set for keys, tokens, passwords, cookies,
private keys, and credential-bearing strings. Use tooling already present; if
`gitleaks` is absent, run a heuristic scan and **declare it heuristic**. Confirm no
ZIP, binary, database, backup, or `.env` file is staged.

### 10. GIT DIFF REVIEW
Review `git status --short` and `git diff --staged` in full before committing.
Unexpected content is a stop condition, not a footnote.

### 11. COMMIT
One atomic commit per logical unit, always phase-scoped:

```text
<type>(phase-<N>): <imperative summary>
```

`<type>` ∈ `chore | feat | fix | docs | build | test | refactor | security`.
State updates that land after the main commit get their own atomic commit.

### 12. PUSH
Push when a remote exists and is authenticated. Never force-push. If the remote is
unavailable or unauthenticated, complete the local repository and record the
condition as a blocker.

### 13. WRITE HANDOFF
Rewrite `docs/SESSION_HANDOFF.md` so a cold session can resume with no other
context: what was done, what was verified, what was **not** done, open blockers,
and the exact next action. Update `PROJECT_STATE.json` (`current_phase`,
`phase_status`, `next_phase`, `last_commit`, `last_updated_utc`, `blockers`).

### 14. STOP
Emit the phase output and **stop**. Do not begin, scaffold, or preview the next
phase. Continuation requires a new, explicit instruction from the owner.

## Standing rules

- One phase per invocation.
- Nothing outside `PROJECT_ROOT` is modified.
- **Defects are fixed, not just filed.** Finding a bug and leaving it for "a later
  phase" is only acceptable when step 7 names a reason it cannot be fixed here. The
  default is to repair it, with a backup, a test and an atomic commit.
- No database, network, or external dataset is touched, and no product container is
  created, started or stopped. **One narrow exception:** the read-only analysis
  container `noesar-debuglab` may be started for step 7 and **must be stopped again in
  the same phase**. It mounts the host read-only, is not part of this product, and
  nothing it reports is trusted without triage against the real code.
- No secret is ever written to a tracked file.
- No archive, binary, model, cache, or database is ever committed.
- English is canonical for all artifacts.
- The FOSS core never depends on ATOM; proprietary ATOM code never enters a public repository.
- A blocker is stated plainly and immediately. A false PASS is never acceptable.
- A clean scan proves the scanner found nothing, not that the code is correct.
