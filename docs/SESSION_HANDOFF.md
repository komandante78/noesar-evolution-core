# SESSION HANDOFF

**Last updated:** 2026-08-17 · **Session closed:** `D-0511` / `D-0512` / `D-0513` / `D-0514`
**Head at close:** see `PROJECT_STATE.json.last_commit` · **Plan of record:** `MASTER_PROJECT/`

---

## ➜ LA PROSSIMA AZIONE

**Nothing is pending, and nothing is half-built.** The phase the last session agreed on is
delivered: rule 12's named exceptions now have one source, the guard reads it, and a suite goes
red when the two disagree.

**Two things need the Owner, and neither blocks anything:**

1. **`CLAUDE10.md` rule 12's third exception names the wrong driver.** It says
   `e2e_retention_prunable()` "is driven by `tools/test-e2e-retention.sh`" — that is the *test*.
   The production driver is `tools/run-browser-e2e.sh`, which is what actually performed the
   `D-0509` sweep. The single source records **both** as authorised callers and the suite passes
   either way, so nothing is broken; amending the authority's own text is the Owner's act.
2. **`D-0513` is a proposal awaiting a yes or no** (see below). Nothing was started.

**Where a next phase would begin, if the Owner says yes to `D-0513`:** `session-close-guard.sh`
already enforces §5a's "exactly two containers survive" by a list held in its own code. Same shape
as rule 12 before this phase: one source, one oracle, and `.claude/hooks/test/run-all.sh` picks the
new suite up without being edited.

---

## OPEN BLOCKERS

**None that block anything, and none opened this phase.** What `PROJECT_STATE.json.blockers` still
carries, stated rather than implied:

| id | severity | what it actually is |
|---|---|---|
| `B-011` | `low-deferred` | the token exposed in chat on 2026-07-30 was removed from git history (`D-0258`, verified via a fresh clone); **rotation was deliberately deferred by the Owner**. Not this session's to close. |
| `B-002` | `stale-premise` | kept for history only — superseded by `B-011`. |
| `B-012` | **closed this session** | its three findings (`F-COMMAND-001`, `F-INTENT-001`, `F-PANEL-001`) were all closed, but the record sat in `blockers` unmarked and as a bare string, which `D-0502` had already noted as stale state. Converted to an object, marked `resolved`, original text preserved verbatim. |

The one item deliberately left open is a **finding**, not a blocker:

| id | severity | why it is not fixed |
|---|---|---|
| `F-HOOK-008` | low | The quote mask added this phase tracks quote state **per line**, so a quoted string spanning newlines (a multi-line `jq` program, a heredoc) still splits. It **over-denies** — never under-denies. The obvious fix (whole-command quote state) turns a fail-safe nuisance into a **fail-open hole**: one apostrophe in prose inside a heredoc masks every real separator after it. The correct repair is real shell tokenisation, with its own adversarial matrix — a phase of its own. Workaround with no loss of protection: pass a long quoted program **by file path**. |

---

## WHAT WAS VERIFIED — measured this session, not quoted

| Check | Result |
|---|---|
| `scripts/test.sh` | **11/11 PASS** — unit **2561 tests** (2560 pass, 1 skipped, 0 fail), source-verify (migrations=19, baseline 12/12), auth-smoke, http-smoke, tls-smoke, packaging, pg-migrations, pg-contract, rust-source, rust-provenance, **governance** |
| new `governance` step | **6 suites / 316 assertions, all pass** — container-baseline 58 · engineering-orchestrator 122 · hook-matcher-enums 9 · **rule12-exceptions 49** · session-lifecycle 69 · tooling-inventory 9 |
| the divergence oracle | **5 fixtures shown RED on demand**: a 4th exception added to the authority · an entry dropped from the source · a stale quote · a mechanism the authority never names · an exception deleted from the authority |
| the runner's own red path | a deliberately failing suite → exit 1 · an empty directory → exit 1 ("no suite found is a failure, not a pass") |
| `F-HOOK-006` / `F-HOOK-007` | **both seen red before the fix** — the grep was really refused, the sibling-path removal was really allowed |
| shellcheck, 4 changed shell files | disposable offline container; only `SC1007` on the `CDPATH= cd` idiom — the dismissal already on record |
| portability (§64) | the exception root is `NOESAR_ARTIFACT_ROOT` with a default, exactly as `tools/run-browser-e2e.sh` resolves it; the suite needs only bash/jq/awk and declares `UNAVAILABLE` otherwise; no host path is acted on |

**What is true now that was not before:** an amendment to `CLAUDE10.md` rule 12 can no longer pass
unnoticed by the program that enforces it, and the guard no longer silently allowed removals under
`…/NOESAR_EVOLUTION_ARTIFACTS`.

---

## WHAT WAS **NOT** DONE — deliberately

- **No product code, no build, no deployment, no install.** This phase touched governance only.
- **No container created, started, stopped or removed** — so §5a cleanup had nothing to remove. The
  closing inventory was still checked and is unchanged: exactly the two containers §5a permits, no
  stray analysis container, **0** e2e image tags, **0** stamped networks. Health confirmed at close:
  `running/healthy`, `RestartCount=0`, `/livez` 200 `alive` and `/readyz` 200 `ready:true` on
  **both** `http:8088` and `https:8443`, read inside the container — the https probe needs
  certificate verification disabled for the self-signed cert, which is the probe's condition and not
  a product fault. e2e artifacts steady at **5 directories / 246 MB**, `/mnt/cachec` **245G** free.
  **No deployment and no bytes-equal-tree check** — nothing this phase
  changed can reach the installation, so there was nothing to install.
- **`docs/INSTALLATION_LEDGER.md` was not touched** — nothing was installed. Not an omission.
- **`F-HOOK-008` was not fixed** (reason above), and **`CLAUDE10.md` was not edited**: the drift in
  its rule-12 wording is reported to the Owner, not corrected by the session that found it.
- **`D-0513` was not executed.** Generating the proposal is mandatory; running it is the Owner's.

---

## FILES THIS PHASE CHANGED

| File | What |
|---|---|
| `.claude/hooks/lib/rule12-exceptions.json` | **new** — the one source: 3 exceptions, each with its authority marker, quote, mechanism, recoverability and filesystem roots |
| `.claude/hooks/destructive-command-guard.sh` | reads that source; quote-aware segmentation (`F-HOOK-006`); path-boundary fix (`F-HOOK-007`); exception-aware refusals that name the only authorised mechanism |
| `.claude/hooks/test/test-rule12-exceptions.sh` | **new** — 49 assertions: structure, alignment, the 5 red fixtures, behaviour in both directions |
| `.claude/hooks/test/run-all.sh` | **new** — every governance suite in one run, discovered by pattern |
| `scripts/test.sh` (+ its `MANIFEST.sha256` line) | one `governance` step, `UNAVAILABLE` and declared where `.claude/` is absent |
| `docs/DECISION_LOG.md`, `PROJECT_STATE.json` | `D-0511`/`D-0512`/`D-0513`; `F-HOOK-006`/`007`/`008` |

---

## THE ONE IMPROVEMENT PROPOSAL — `D-0513`, awaiting the Owner

Extend the `authority → machine source → divergence oracle` shape to the **other** rules a program
already enforces: §5a's keeper list, §3a's deployment sequence, the budget skill's caps. Every
governance defect this project has repaired has one shape — a rule whose executor drifted from it in
silence. Rule 12 is now the only one that cannot. **Cost:** roughly one phase per rule family.
**Funding fit:** "policy-as-data with a divergence oracle" is delimited and reusable outside this
product (traits 1/2/5) — publishable as a small standalone checker, not as a WebUI feature.
