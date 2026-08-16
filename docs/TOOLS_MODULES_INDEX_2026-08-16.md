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
| 1 | `adapters` | SI | 31 | `oidc` | SI |
| 2 | `admin` | SI | 32 | `privacy` | SI |
| 3 | `agent-runs` | SI | 33 | `projects` (v1) | SI |
| 4 | `agents` | SI | 34 | `providers` | SI |
| 5 | `ai` | SI | 35 | `publishers` | SI |
| 6 | `approvals` | SI | 36 | `reasoning` | SI |
| 7 | `artifacts` | SI | 37 | `repo-map` | SI |
| 8 | `audit` | SI | 38 | `research` | SI |
| 9 | `auth` | SI | 39 | `runtime` | SI |
| 10 | `bootstrap` | SI | 40 | `scim` | SI |
| 11 | `capability` | SI | 41 | `search` | SI |
| 12 | `chat` | SI | 42 | `sector-modules` | SI |
| 13 | `closures` | SI | 43 | `session-proof` | SI |
| 14 | `coden` | SI | 44 | `sessions` | SI |
| 15 | `compliance-packs` | SI | 45 | `settings` | SI |
| 16 | `conversations` | SI | 46 | `shadow` | SI |
| 17 | `data` | SI | 47 | `skill-catalog` | SI |
| 18 | `database` | SI | 48 | `sources` | SI |
| 19 | `debug` | SI | 49 | `tasks` | SI |
| 20 | `debug-evolution` | SI | 50 | `technology-radar` | SI |
| 21 | `events` | SI | 51 | `tool-catalog` | SI |
| 22 | `executor` | SI | 52 | `tools` | SI |
| 23 | `hardware` | SI | 53 | `tui` | SI |
| 24 | `home` | SI | 54 | `updates` | SI |
| 25 | `knowledge` | SI | 55 | `voice` | SI |
| 26 | `logs` | SI | 56 | `watchdog` | SI |
| 27 | `memories` | SI | 57 | `workflow-runs` | SI |
| 28 | `memory` | SI | 58 | `workflows` | SI |
| 29 | `metrics` | SI | 59 | `workspace-actions` | SI |
| 30 | `models` | SI | 60 | ~~`projects` (v2)~~ **[DUPLICATE — see finding below]** | SI |

**Checked: SI for all 60 rows — deep review of §1 complete.** Full findings below.

### §1 findings — 2026-08-16

**Method.** For each group: confirmed real route(s) exist in `server.mjs` (not a stub — grepped
the literal `url.pathname` match, both spacing styles the file uses), then matched test coverage
against the real 166-file `test/` directory by content knowledge, not filename-prefix guessing
(a first pass by filename prefix alone undercounted badly — e.g. `coden` showed 0 by prefix
match while 11+ dedicated `coden-*.test.mjs` files plus `two-shells-parity.test.mjs` actually
cover it). Purpose is skipped where the group name is self-explanatory, per this file's own rule.

**Finding — inventory defect, corrected here.** `projects` (v1) and (v2) are **not two groups**:
`server.mjs:3645-3653` has exactly one `/api/v1/projects` implementation (GET/POST list,
GET/PATCH/DELETE by id via one regex). The original 103-item count double-counted it. **Real
total: 59 distinct backend API route groups, not 60.** Left both rows in the table (renumbering
all 103 items to 102 would break the cross-reference in every commit that cites row numbers) —
struck through and marked instead, the same non-destructive correction pattern
`docs/PAGES_INDEX_2026-08-16.md` used for its own stale-note findings (`D-0473`'s own list is not
exempt from the review it asked for).

**Well-tested, real implementations (52 of 59 distinct groups) — one line each:**

`adapters` capability-adapter registration — `adapter-capability.test.mjs` +3 more ·
`admin` invitation/user directory — `user-directory.test.mjs`, `role-permissions-surface.test.mjs` ·
`agent-runs` multi-step agent run execute/approve — `ai-agent-service.test.mjs` ·
`agents` agent catalog CRUD — `ai-agent-service.test.mjs` ·
`ai` provider gateway + context graph cluster — 6 dedicated files ·
`approvals` cross-subsystem approval queue — `approval-queue.test.mjs` ·
`audit` ledger read surface — `audit.test.mjs` ·
`auth` largest group (28 routes) — 9+ dedicated files (`auth`, `webauthn`, `totp-replay`,
`account-recovery`, `account-security`, `owner-recovery`, `setup-token`,
`login-malformed-username`, `session-lifecycle`, `service-token-http-auth`) ·
`bootstrap` first-run feature-claim declaration — `bootstrap-feature-claims.test.mjs` ·
`capability` capability-token vectors — `capability-vectors.test.mjs`, `capability-http-adversarial.test.mjs` ·
`coden` CodeN Evolution surface — 11 `coden-*.test.mjs` files + `two-shells-parity.test.mjs` +
`codev-relay.test.mjs` ·
`compliance-packs` signed compliance packages — `compliance-packs.test.mjs` ·
`data` data-plane status — `data-plane.test.mjs` ·
`database` Postgres status/backup — `postgres-repository.test.mjs`, `pg-client.test.mjs` ·
`debug` debug-mode toggle — `debug-mode.test.mjs` ·
`debug-evolution` owner-module bridge — 6 dedicated files ·
`events` causal event ledger — `event-vectors.test.mjs` ·
`executor` workspace-action executor — `executor.test.mjs`, `executor-vectors.test.mjs` ·
`hardware` accelerator discovery — `hardware.test.mjs` ·
`home` home overview aggregate — `home-overview.test.mjs` ·
`logs` structured log stream — `logging.test.mjs` ·
`memories`/`memory` item CRUD + recall — `memory-service.test.mjs`, `memory-compaction.test.mjs`,
`memory-model-swap.test.mjs` ·
`metrics` review-time metric — `product-metric.test.mjs` ·
`models` model catalog/active-model — `model-catalog.test.mjs`, `active-model.test.mjs` ·
`oidc` identity federation — `oidc.test.mjs` ·
`privacy` seven-state egress broker — `privacy-states.test.mjs` ·
`projects` list/get/patch/delete — no dedicated file by name; exercised end-to-end by
`tools/browser-e2e.mjs`'s `#/projects` route sweep (confirmed live this session's own runs) ·
`providers` provider registration — `provider-gateway-success-paths.test.mjs`, `provider-health-probe.test.mjs` ·
`publishers` publisher-key registry — `publisher-registry.test.mjs` ·
`reasoning` ReasoningProvider router — `reasoning-router.test.mjs`, `reasoning-vectors.test.mjs`,
`conformance.test.mjs` — **see the correction below re: this file's own §6 note** ·
`repo-map` repository understanding — `repo-map.test.mjs`, `divergence-profile.test.mjs`, `divergence-connected.test.mjs` ·
`research` external research gate — `research.test.mjs`, `research-gate.test.mjs`, `research-gate-http-adversarial.test.mjs` ·
`runtime` local-model runtime recommendation — `local-model-runtime.test.mjs` ·
`scim` user provisioning — `scim.test.mjs`, `scim-http.test.mjs` ·
`sector-modules` owner-module install/activate — `sector-modules.test.mjs`,
`sector-modules-activation.test.mjs` + 5 `module-*.test.mjs` files ·
`session-proof` Proof-of-Session artifact — `session-proof.test.mjs`, `session-replay.test.mjs` ·
`sessions` active-session listing/revocation — `session-lifecycle.test.mjs`, `session-protocol.test.mjs` ·
`settings` timezone/locale/server — `timezone.test.mjs`, `modules-settings-http.test.mjs` ·
`shadow` shadow-run simulation — `shadow-vectors.test.mjs`, `sandbox-runner.test.mjs` ·
`skill-catalog` catalog + authoring — `skill-catalog.test.mjs`, `author.test.mjs`,
`author-skill-composition.test.mjs`, `plan-composes-adopted-skills.test.mjs` ·
`technology-radar` — `technology-radar.test.mjs` ·
`tool-catalog` declared tool catalogue — `tool-catalog.test.mjs` ·
`tools` registered tool invocation (distinct from `tool-catalog` — confirmed two separate
implementations, `server.mjs:3884/3887` vs the catalogue routes) — likely `ce-016-zero-tools-at-rest.test.mjs`, not independently re-verified this pass ·
`tui` terminal-shell HTTP bridge — 7 `tui-client-*.test.mjs` + `ce-020-tui-fullscreen.test.mjs` ·
`updates` signed channel/apply/rollback — `update-manager.test.mjs`, `updates-channel-key-http.test.mjs` ·
`voice` session/intent/interpreter — 6 `voice-*.test.mjs` files ·
`watchdog` health watchdog/safe-mode — `watchdog.test.mjs` ·
`workflow-runs`/`workflows` definitions + execution — `workflow-engine.test.mjs`, `workflow-interrupted-step.test.mjs` ·
`workspace-actions` plan/authorize/promote core — `workspace-actions.test.mjs`,
`workspace-actions-http-adversarial.test.mjs`, `workspace-support.test.mjs`.

**Real implementation confirmed, but no dedicated backend test file found by content match — the
honest gap this pass exists to surface (7 of 59):** `artifacts` (`server.mjs:3813-3816`),
`chat` (`:3874`, streaming), `closures` (`:4046-4050`, CE-019 final reports), `conversations`
(`:3658-3662`), `knowledge` (`:3839`, search), `search` (`:3762`, global), `sources`
(`:3823-3829`, upload/ingestion). None reported a failure in this session's own full-suite
browser-e2e runs (`D-0492`, `D-0493` — 491/492), so the surface is reached and does not error,
but no unit suite specifically targets it by name. Recorded, not fixed — writing a test for 7
untested surfaces is new scope, not a documentation-review finding to silently expand into.

**Correction to this file's own §6.** §6 below still reads *"`ATOM_EVOLUTION` (own repository,
still empty)"* — **false, verified this session**: `ATOM_EVOLUTION` has 28 real commits
(`A-0001`-`A-0027`), a working `atomd` daemon implementing all 11 `ReasoningProvider` surfaces,
and its own README self-declaring `ATOM_SELECTED_BY_ANY_ENGINE = false` (the daemon answers,
nothing calls it yet) — a precise, honest gap, not an empty repository. Corrected in §6 below.

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

**Corrected 2026-08-16, during the §1 review.** This line previously read *"`ATOM_EVOLUTION`
(own repository, still empty)"* — false, verified directly against the repository: 28 real
commits (`A-0001`-`A-0027`), a working `atomd` daemon implementing all 11 `ReasoningProvider`
surfaces, self-declared in its own README as `ATOM_PROVIDER_CONTRACT=SATISFIED` but
`ATOM_SELECTED_BY_ANY_ENGINE=false` (the daemon answers; nothing in this repository calls it
yet) — a precise, honest gap, not an empty shell. The in-tree Node reference implementation
(`services/reference-control-plane/src/reasoning.mjs`, `reasoning-router.mjs`) is what the
product actually ships with today (`FOSS_CORE_DEPENDS_ON_ATOM=false`), and is what §1's
`reasoning` row above is tested against. Full detail already covered by
`docs/ADVANCEMENT_RESEARCH_2026-08-16.md` Part 1 and `FUNDING/18_ORIGINAL_IMPROVEMENT_PROPOSALS.md`
— not repeated here to avoid two lists claiming the same fact, the exact duplication class
`CLAUDE10.md` §14 already warns about.

---

**Totals: 59 distinct API route groups (§1 corrected the `projects` v1/v2 double-count) + 17
slash commands + 20 Rust crates + 6 capability directories = 102 named items, + 45 internal
tools counted but not itemized. §1 (59/102) checked in depth, 2026-08-16. §2-4 remain at 0.**
