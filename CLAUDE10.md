# CLAUDE10.md — NOESAR EVOLUTION Operating Authority

**Status:** permanent and binding.
**Scope:** `/mnt/cachec/NOESAR_EVOLUTION` and the `NOESAR-EVOLUTION` repository only.

This file is the sole authority for Claude Code when working on NOESAR EVOLUTION.
It supersedes habit, prior sessions, and any convention inherited from other projects.

---

## 1. Applicability

1. These rules apply **exclusively** to the NOESAR EVOLUTION project.
2. These rules **must never** be applied to, exported to, or invoked for any other
   project, repository, container, or workspace on this host — including NOESAR V3,
   CodeN Ultra, ATOM, EvalBench, BrainLab, DataFactory, or any other system.
3. Conversely, rules and habits from those projects have **no authority here**.
   Where they conflict with this file, this file wins.
4. Work performed under this authority stays inside `PROJECT_ROOT`. Anything outside
   it is read-only unless the phase specification names the path explicitly.

## 2. State and handoff — read before operating

5. Before any action in a new session or a new phase, read **in this order**:
   `PROJECT_STATE.json`, `docs/SESSION_HANDOFF.md`, `docs/PHASE_PLAN.md`,
   `docs/INSTALLATION_LEDGER.md`, `docs/DECISION_LOG.md`.
6. Never infer project state from memory, from a summary, or from a previous
   conversation. The files on disk are the only source of truth.
7. If state files are missing, inconsistent, or contradict observable reality,
   stop and declare a blocker. Do not "repair" state by guessing.

## 3. One phase at a time

8. The project has **6 phases (0–5)**, defined in `docs/PHASE_PLAN.md`.
9. Execute **one and only one** phase per invocation. Never start the next phase,
   never "prepare" it, never partially anticipate it.
10. A phase ends with: state updated, handoff written, commit made, and a full stop.
11. Scope creep is a violation. Work outside the current phase's stated objective
    is not performed — it is recorded in `docs/DECISION_LOG.md` for a later phase.

## 4. Non-destructive operation

12. **No deletion.** Do not delete files, directories, containers, images, volumes,
    branches, or history. Not with `rm -rf`, not with `git clean`, not implicitly.
13. **No destructive modification by implication.** Overwriting, truncating,
    renaming, moving, or replacing an existing artifact requires that the phase
    specification explicitly asks for it, and requires a backup first (§6).
14. Never `git push --force`, `git reset --hard` on shared history, or rewrite
    published commits.
15. Existing directories are inventoried and verified as belonging to NOESAR
    EVOLUTION before any write.

## 5. External systems are off-limits

16. Do not create, start, stop, restart, remove, or exec into any Docker container.
    **One named exception**, added by the owner so that defect hunting is possible at
    all: the read-only analysis container `noesar-debuglab` may be started for the
    `HUNT AND FIX` step of the phase cycle and **must be stopped again within the same
    phase**. It is not part of this product, it mounts the host read-only, and it is
    the only place on this host carrying semgrep / bandit / ruff / detect-secrets /
    shellcheck / mypy. No other container may be touched, and no product container may
    be created or started outside an authorised installation phase.
17. Do not modify Docker networks, volumes, `docker-compose` files, or `.env` files
    belonging to any system.
18. Do not read, write, migrate, or mutate any database, vector store, or queue
    outside this project (Postgres, Qdrant, SQLite of other products, etc.).
19. Do not touch production services, GPU allocation, or any running workload.
20. Host-level changes (packages, services, cron, firewall) are out of scope.
21. Actions the phase requires but these rules forbid are raised as blockers, not
    performed "just this once".

## 6. Backups before mutation

22. Any non-trivial mutation of an existing file or dataset is preceded by a
    timestamped backup inside the project (e.g. `BACKUPS/<name>.<UTC-timestamp>`).
23. Backups are never deleted within a phase. Retention decisions are separate and
    explicit.
24. Git is not a substitute for a backup of uncommitted or ignored content.

## 7. Secrets

25. **No secret in any tracked artifact.** No API key, token, password, cookie,
    session, private key, certificate key, connection string with credentials, or
    canary/owner token in code, configuration, documentation, comments, commit
    messages, log files, test fixtures, or Git history.
26. Credentials are supplied **only** through a secret store or runtime environment
    variables that are never versioned. Reference them by name, never by value.
27. `.env`, `.env.*`, `secrets/`, and `credentials/` are always ignored by Git.
28. Any secret that reaches a tracked file is a blocker: stop, rotate, record.
29. Absolute host paths, internal hostnames, and infrastructure details are
    published only when technically necessary.

## 8. External APIs disabled by default

30. All outbound/external API integrations ship **disabled by default**. Enabling
    one is an explicit, documented, opt-in configuration choice by the operator.
31. No network call is introduced as a silent side effect of a build, test, or
    start-up path.
32. Offline operation is the baseline: the core must be usable with no external
    service reachable.

## 9. Repository hygiene

33. The repository never contains: `*.zip`, `*.tar`, `*.tar.gz`, `*.7z`, compiled
    binaries (`*.exe`, `*.dll`, `*.so`, `*.dylib`), build output (`target/`,
    `build/`, `dist/`), caches, model weights, databases (`*.sqlite*`), backups, or
    build artifacts.
34. The five source ZIP archives are **never** added to the repository.
35. The repository stays **private** until an explicit, recorded decision to publish.

## 10. Verification and honesty

36. Every modification is followed by the tests appropriate to what changed.
    "It should work" is not a test result.
37. Report outcomes faithfully: if a test fails, show the output; if a step was
    skipped, say so; if something is unverified, label it `[UNVERIFIED]`.
38. **Never declare PASS, DONE, COMPLETE, or PRODUCTION-READY without evidence
    produced in this session.** A false PASS is the most serious violation in this
    file.
39. Errors, gaps, and blockers are declared explicitly and immediately, in the
    phase output and in `PROJECT_STATE.json.blockers`.
40. Do not fabricate state, checksums, test counts, or command output.
40a. **Defects are hunted and repaired, not merely reported.** Every phase runs the
    `HUNT AND FIX` step of the skill cycle before it closes. Finding a defect and
    leaving it for "a later phase" is acceptable only for the reasons that step names:
    out of scope, unverifiable without fabricating content, requiring a destructive or
    outward-facing action, or resting on a root cause not yet found. Otherwise it is
    fixed here — with a backup, a test, and an atomic commit.
40b. **Triage before repairing.** A false positive "fixed" is a real regression
    introduced for nothing. Every finding is checked against the actual code, and
    every dismissal is recorded with its evidence.
40c. **Fix the rule, not only the instance.** When a filter, ignore rule, or check
    caused the defect, correct it and add a regression test. A clean scan proves the
    scanner found nothing — never that the code is correct.

## 11. Documentation duty

41. Documentation is updated **in the same phase** as the change it describes —
    never deferred to "later".
42. Every phase updates: `PROJECT_STATE.json`, `docs/SESSION_HANDOFF.md`,
    `docs/INSTALLATION_LEDGER.md`, and `docs/DECISION_LOG.md` where a decision was made.
43. Documentation claims must match the code. A doc that describes behavior the
    code does not have is a defect of the same severity as a code bug.

## 12. Git discipline

44. Before **every** commit: run a secret scan (§7), review the staged file list,
    and review `git diff --staged` in full.
45. If `gitleaks` is unavailable, perform a heuristic scan and **declare** that it
    was heuristic. Do not install new tooling to satisfy this rule.
46. Commits are atomic and reference their phase, e.g. `chore(phase-0): …`.
47. Each phase concludes with a commit and, when a remote is available and
    authenticated, a push.
48. When the remote is unavailable, the local repository is still completed and the
    condition is recorded as a blocker.

## 13. Language

49. **English is canonical** for source code, identifiers, API surfaces, log
    messages, error strings, commit messages, and technical documentation.
50. UI localization is a **separate layer** (translation catalogs/resources). No
    non-English string is hardcoded outside that layer.
51. Operator-facing conversation may be in any language; artifacts may not.

## 14. Open core and the ATOM boundary

52. The **FOSS core must be complete and independently useful** on its own. A user
    with only the open core gets a working product, not a demo.
53. **ATOM is proprietary and separate.** The core must not require ATOM to build,
    start, pass its tests, or deliver its documented functionality.
54. `FOSS_CORE_DEPENDS_ON_ATOM = false` is an invariant, not an aspiration.
55. Integration happens through **public interfaces only** — a stable, documented
    boundary the open core defines and any implementation may satisfy.
56. **No proprietary ATOM implementation, algorithm, weight, corpus, or internal
    document may ever be copied into the future public repository** — not as code,
    not as vendored files, not as test fixtures, not as documentation detail.
57. Work funded under public/FOSS funding programs must itself be FOSS. Anything
    that cannot be released as FOSS is not funded work and stays outside that scope.

## 15. Licensing posture (proposal, not settled law)

58. Proposed open-core license: **AGPL-3.0-or-later**. An additional commercial
    license is **planned**.
59. These are **proposals**, recorded in `docs/LICENSE_STRATEGY.md`. They are not a
    final legal determination and must not be presented as one.

---

@.claude/skills/noesar-evolution/SKILL.md
