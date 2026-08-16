# Tools, modules & functionality index — NOESAR EVOLUTION

**2026-08-16. Inventory only, not an audit.** Same method and same purpose as
`docs/PAGES_INDEX_2026-08-16.md`: a base list for a future one-at-a-time deep review — "what
works, what's missing, how to improve." **This list is also the raw material for a future
public feature page** (GitHub / project site) describing what NOESAR EVOLUTION offers — nothing
here is written for that purpose yet, it is simply the same honest inventory both uses need.
**`Checked` is `NO` for every row on purpose.**

---

## 1. Backend API surface (60 route groups) — `services/reference-control-plane/src/server.mjs`

Grouped by top-level path segment (e.g. `/api/v1/auth` covers every route under it) — this is
group-level, not the full per-route list (153 individual routes are catalogued separately in
`docs/security/INDEPENDENT_PENTEST_SCOPE.md` for the pentest scope). Functionality is the
group name itself where self-explanatory; not paraphrased where it would just repeat the name.

| # | Group | Checked | # | Group | Checked |
|---|---|---|---|---|---|
| 1 | `adapters` | NO | 31 | `oidc` | NO |
| 2 | `admin` | NO | 32 | `privacy` | NO |
| 3 | `agent-runs` | NO | 33 | `projects` (v1) | NO |
| 4 | `agents` | NO | 34 | `providers` | NO |
| 5 | `ai` | NO | 35 | `publishers` | NO |
| 6 | `approvals` | NO | 36 | `reasoning` | NO |
| 7 | `artifacts` | NO | 37 | `repo-map` | NO |
| 8 | `audit` | NO | 38 | `research` | NO |
| 9 | `auth` | NO | 39 | `runtime` | NO |
| 10 | `bootstrap` | NO | 40 | `scim` | NO |
| 11 | `capability` | NO | 41 | `search` | NO |
| 12 | `chat` | NO | 42 | `sector-modules` | NO |
| 13 | `closures` | NO | 43 | `session-proof` | NO |
| 14 | `coden` | NO | 44 | `sessions` | NO |
| 15 | `compliance-packs` | NO | 45 | `settings` | NO |
| 16 | `conversations` | NO | 46 | `shadow` | NO |
| 17 | `data` | NO | 47 | `skill-catalog` | NO |
| 18 | `database` | NO | 48 | `sources` | NO |
| 19 | `debug` | NO | 49 | `tasks` | NO |
| 20 | `debug-evolution` | NO | 50 | `technology-radar` | NO |
| 21 | `events` | NO | 51 | `tool-catalog` | NO |
| 22 | `executor` | NO | 52 | `tools` | NO |
| 23 | `hardware` | NO | 53 | `tui` | NO |
| 24 | `home` | NO | 54 | `updates` | NO |
| 25 | `knowledge` | NO | 55 | `voice` | NO |
| 26 | `logs` | NO | 56 | `watchdog` | NO |
| 27 | `memories` | NO | 57 | `workflow-runs` | NO |
| 28 | `memory` | NO | 58 | `workflows` | NO |
| 29 | `metrics` | NO | 59 | `workspace-actions` | NO |
| 30 | `models` | NO | 60 | `projects` (v2) | NO |

## 2. CodeN Evolution slash commands (17) — `apps/shared/coden/agent-commands.js`, same registry both shells share

| # | Command | Checked | # | Command | Checked |
|---|---|---|---|---|---|
| 1 | `/help` | NO | 10 | `/logout` | NO |
| 2 | `/status` | NO | 11 | `/git` | NO |
| 3 | `/plan` | NO | 12 | `/events` | NO |
| 4 | `/approve` | NO | 13 | `/sessions` | NO |
| 5 | `/reject` | NO | 14 | `/simulate` | NO |
| 6 | `/diff` | NO | 15 | `/restore` | NO |
| 7 | `/model` | NO | 16 | `/search` | NO |
| 8 | `/map` | NO | 17 | `/clear` | NO |
| 9 | `/closure` | NO | | | |

## 3. Rust crates (20) — `rust/crates/`, the "decides and confines" half of the stack

| # | Crate | Checked | # | Crate | Checked |
|---|---|---|---|---|---|
| 1 | `noesar-audit-ledger` | NO | 11 | `noesar-data-plane` | NO |
| 2 | `noesar-auth` | NO | 12 | `noesar-events` | NO |
| 3 | `noesar-authority-api` | NO | 13 | `noesar-executor` | NO |
| 4 | `noesar-authority-daemon` | NO | 14 | `noesar-hardware-orchestrator` | NO |
| 5 | `noesar-authority-protocol` | NO | 15 | `noesar-reasoning` | NO |
| 6 | `noesar-authority-transport` | NO | 16 | `noesar-reasoning-reference` | NO |
| 7 | `noesar-canonical-json` | NO | 17 | `noesar-sandbox` *(already extracted, public repo — see `D-0452`)* | NO |
| 8 | `noesar-capability` | NO | 18 | `noesar-security-kernel` | NO |
| 9 | `noesar-contracts` | NO | 19 | `noesar-shadow` | NO |
| 10 | `noesar-control-plane` | NO | 20 | `noesar-supervisor` | NO |

## 4. `capabilities/` — sandboxed capability surface (6 subdirectories)

| # | Directory | Checked |
|---|---|---|
| 1 | `examples/` | NO |
| 2 | `reference/` | NO |
| 3 | `sandbox/` | NO |
| 4 | `security/` | NO |
| 5 | `templates/` | NO |
| 6 | `tools/` | NO |

## 5. `tools/` — repository's own operational/verification tooling (45 scripts)

**Not enumerated one-by-one here** — these are developer/CI instruments (verifiers, e2e
runners, deploy scripts), not end-user product features, so they don't belong on a future
public feature page the way §1-4 do. Counted for completeness; the deep-review pass should
confirm whether any warrant individual review (e.g. `tools/deploy/redeploy.sh`,
`tools/browser-e2e.mjs`, already exercised heavily elsewhere in this project's own history).

## 6. ATOM seam — architecturally separate, referenced not duplicated

`ATOM_EVOLUTION` (own repository, still empty) and the in-tree `ReasoningProvider` reference
implementation are already covered by `docs/ADVANCEMENT_RESEARCH_2026-08-16.md` Part 1 and
`FUNDING/18_ORIGINAL_IMPROVEMENT_PROPOSALS.md` — not repeated here to avoid two lists claiming
the same fact, the exact duplication class `CLAUDE10.md` §14 already warns about.

---

**Totals: 60 API groups + 17 slash commands + 20 Rust crates + 6 capability directories = 103
named items, + 45 internal tools counted but not itemized. 0 of 103 checked in depth.**
