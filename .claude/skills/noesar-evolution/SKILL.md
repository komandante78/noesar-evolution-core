---
name: noesar-evolution
description: MANDATORY for every NOESAR EVOLUTION phase. Imposes the fixed 13-step phase cycle (READ STATE → … → STOP), atomic phase-scoped commits, and the non-negotiable stop condition. Use before starting, resuming, or closing any phase of the NOESAR EVOLUTION installation, and before any commit or push in /mnt/cachec/NOESAR_EVOLUTION.
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

### 7. DOCUMENT
Update the documentation affected by this phase in this phase. At minimum
`docs/INSTALLATION_LEDGER.md`; plus `docs/DECISION_LOG.md` for every decision taken.

### 8. SECRET SCAN
Scan the working tree and the staged set for keys, tokens, passwords, cookies,
private keys, and credential-bearing strings. Use tooling already present; if
`gitleaks` is absent, run a heuristic scan and **declare it heuristic**. Confirm no
ZIP, binary, database, backup, or `.env` file is staged.

### 9. GIT DIFF REVIEW
Review `git status --short` and `git diff --staged` in full before committing.
Unexpected content is a stop condition, not a footnote.

### 10. COMMIT
One atomic commit per logical unit, always phase-scoped:

```text
<type>(phase-<N>): <imperative summary>
```

`<type>` ∈ `chore | feat | fix | docs | build | test | refactor | security`.
State updates that land after the main commit get their own atomic commit.

### 11. PUSH
Push when a remote exists and is authenticated. Never force-push. If the remote is
unavailable or unauthenticated, complete the local repository and record the
condition as a blocker.

### 12. WRITE HANDOFF
Rewrite `docs/SESSION_HANDOFF.md` so a cold session can resume with no other
context: what was done, what was verified, what was **not** done, open blockers,
and the exact next action. Update `PROJECT_STATE.json` (`current_phase`,
`phase_status`, `next_phase`, `last_commit`, `last_updated_utc`, `blockers`).

### 13. STOP
Emit the phase output and **stop**. Do not begin, scaffold, or preview the next
phase. Continuation requires a new, explicit instruction from the owner.

## Standing rules

- One phase per invocation.
- Nothing outside `PROJECT_ROOT` is modified.
- No container, database, network, or external dataset is touched.
- No secret is ever written to a tracked file.
- No archive, binary, model, cache, or database is ever committed.
- English is canonical for all artifacts.
- The FOSS core never depends on ATOM; proprietary ATOM code never enters a public repository.
- A blocker is stated plainly and immediately. A false PASS is never acceptable.
