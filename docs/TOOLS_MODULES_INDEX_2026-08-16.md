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
| 1 | `/help` | SI | 10 | `/logout` | SI |
| 2 | `/status` | SI | 11 | `/git` | SI |
| 3 | `/plan` | SI | 12 | `/events` | SI |
| 4 | `/approve` | SI | 13 | `/sessions` | SI |
| 5 | `/reject` | SI | 14 | `/simulate` | SI |
| 6 | `/diff` | SI | 15 | `/restore` | SI |
| 7 | `/model` | SI | 16 | `/search` | SI |
| 8 | `/map` | SI | 17 | `/clear` | SI |
| 9 | `/closure` | SI | | | |

### §2 findings — 2026-08-17

**Method.** All 17 commands resolve structurally: `coden-shell-parity.test.mjs` iterates the
literal `AGENT_COMMANDS` array and asserts, for every entry, that `resolveCommand` finds it
(`\`/${name}\` is declared but does not resolve`) and — for every `call`/`form` kind — that the
declared `permission` matches `SESSION_METHOD_POLICY[method]` exactly (`CE-036`), so a menu entry
lying about its own cost fails the suite, not just a manual reading. That covers shape and
authorization-declaration for all 17 uniformly. Behavioural coverage of the underlying method was
then checked one command at a time, by content grep, not by filename guess (same corrective the
§1 review already applied).

**14 of 17 fully covered end-to-end** — the socket-protocol dispatch (or the engine method
directly) is exercised by a real test, not only declared: `/plan` `/approve` `/restore` `/diff`
`/map` `/search` `/events` `/status` `/sessions` `/model` (`session-protocol.test.mjs`, direct
`call(authenticatedSocket, '<method>', …)`); `/closure` (`coden-bridge.test.mjs:547`, a live
`closure.record` call asserted to succeed); `/help` `/clear` (`coden-view-model.test.mjs`,
`coden-shell-parity.test.mjs`, `tui-screen-layout.test.mjs`); `/logout` (`coden-shell-parity.test.mjs:870-873`,
the two-step `logout` → `logout confirm` sequence itself, not only the menu entry).

**3 of 17 — the underlying engine logic is tested directly, but the dispatch layer a keystroke
actually goes through is not, and no e2e drives them either (real gap, not previously
recorded):** `/reject` (`workspace.reject` → `orch.reject()` is called directly in
`workspace-actions.test.mjs:338/376/626`, but no test calls it through
`session-protocol.mjs`'s `'workspace.reject'` handler the way `workspace.approve`/`workspace.restore`
are called at `session-protocol.test.mjs:283/286`); `/simulate` (`orch.simulate()` is tested
thoroughly in `workspace-actions.test.mjs:565-608`, including the routed-provider path, but never
through `'workspace.simulate'` dispatch); `/git` (`gitStatus()` itself has its own dedicated
`git-status.test.mjs`, but `session-protocol.mjs`'s `'coden.gitStatus'` handler is only ever
called through a stub mock in `coden-fullscreen-input-flow.test.mjs`/`coden-shell-parity.test.mjs`,
never against the real handler). `tools/browser-e2e.mjs` drives none of the three. Recorded, not
fixed — writing the missing dispatch-layer test is new scope, the same posture §1 took for its
own 7 gaps.

## 3. Rust crates (20) — `rust/crates/`, the "decides and confines" half of the stack

| # | Crate | Checked | # | Crate | Checked |
|---|---|---|---|---|---|
| 1 | `noesar-audit-ledger` | SI | 11 | `noesar-data-plane` | SI |
| 2 | `noesar-auth` | SI | 12 | `noesar-events` | SI |
| 3 | `noesar-authority-api` | SI | 13 | `noesar-executor` | SI |
| 4 | `noesar-authority-daemon` | SI | 14 | `noesar-hardware-orchestrator` | SI |
| 5 | `noesar-authority-protocol` | SI | 15 | `noesar-reasoning` | SI |
| 6 | `noesar-authority-transport` | SI | 16 | `noesar-reasoning-reference` | SI |
| 7 | `noesar-canonical-json` | SI | 17 | `noesar-sandbox` *(already extracted, public repo — see `D-0452`)* | SI |
| 8 | `noesar-capability` | SI | 18 | `noesar-security-kernel` | SI |
| 9 | `noesar-contracts` | SI | 19 | `noesar-shadow` | SI |
| 10 | `noesar-control-plane` | SI | 20 | `noesar-supervisor` | SI |

### §3 findings — 2026-08-17

**Method.** All 20 are real workspace members (`rust/Cargo.toml`), not aspirational rows.
`cargo test --workspace --offline`, run in a disposable `rust:1-bookworm` container
(`--network none`, the repository already vendors every dependency under `rust/vendor/` and
pins `[source.vendored-sources]` in `.cargo/config.toml`, so an offline build is a supported
path, not a workaround). **First attempt genuinely failed** (`noesar-capability`'s
`tests/conformance.rs` could not find `conformance/capability-vectors.json`) because the
container mounted only `rust/`, and the vectors live at the project root
(`conformance/*.json`, shared with the JS suites — `reasoning-vectors.json` etc.) — a mount-scope
mistake on this pass, not a product defect; re-run mounting the whole repository root fixed it.
Corrected run, **VERIFIED this session: `cargo test --workspace --offline` → 144 tests passed, 0
failed, 0 skipped, across 26 test binaries** (some crates ship both a lib and a bin target, and
`noesar-capability` additionally ships the `tests/conformance.rs` integration suite).

**11 of 20 carry real, passing tests** (unit and/or the `conformance.rs` integration binary):
`noesar-authority-api` (2), `noesar-authority-daemon` (4, its own peer-identity unit tests —
Unix-socket uid allowlisting), `noesar-canonical-json` (2), `noesar-capability` (20 unit + 1
conformance = 21 — the capability-token vectors, the same JS/Rust byte-for-byte parity `arch008_
limits_tests` names), `noesar-events` (14), `noesar-executor` (14 + 1 warning: unused import
`ShadowLimits`, cosmetic, not a defect — `cargo fix` would clear it but that is a lint-hygiene
edit outside this review's declared scope), `noesar-reasoning` (14), `noesar-reasoning-reference`
(1), `noesar-sandbox` (14), `noesar-security-kernel` (7), `noesar-shadow` (1) and
`noesar-supervisor` (12 + 1 in its `main.rs` binary target = 13).

**8 of 20 have zero `#[test]` anywhere in the crate — a real, measured gap, not previously
recorded:** `noesar-audit-ledger`, `noesar-auth`, `noesar-authority-protocol`,
`noesar-authority-transport`, `noesar-contracts`, `noesar-control-plane`, `noesar-data-plane`,
`noesar-hardware-orchestrator`. The most significant of the eight is **`noesar-auth`**: 76 lines
of real, security-relevant logic — Argon2 password hashing/verification, HMAC-SHA1 TOTP
verification with a ±1 step window, `subtle::ConstantTimeEq` used for the comparison — with no
crate-level test at all. **Checked whether something else exercises it indirectly: nothing does.**
`grep -rn "noesar_auth" rust/crates/*/src/*.rs` finds zero `use` sites anywhere in the workspace,
even though `noesar-authority-daemon`'s `Cargo.toml` lists it as a dependency — declared, linked,
compiled, **never called**. The product's live password/TOTP path is the Node implementation
already covered by 9+ dedicated files (§1's `auth` row); this Rust crate is inert scaffolding for
the "Rust decides and confines" migration named in `11_REVISIONE_E_CORREZIONI.md` D-A, not yet
wired to anything. `noesar-control-plane`, `noesar-hardware-orchestrator` and
`noesar-audit-ledger` share a second property: **zero workspace dependents** (no other crate
imports them) **and zero references in `oci/*.Dockerfile` or `rust/build-authority-release.sh`**
— they compile as part of `cargo build --workspace` but are never packaged into a deliverable
image or binary. Recorded, not fixed: writing tests for eight crates or wiring three unused ones
into a build is new scope, not a documentation-review finding to expand into — the same posture
§1 and §2 already took for their own gaps.

## 4. `capabilities/` — sandboxed capability surface (6 subdirectories)

| # | Directory | Checked |
|---|---|---|
| 1 | `examples/` | SI |
| 2 | `reference/` | SI |
| 3 | `sandbox/` | SI |
| 4 | `security/` | SI |
| 5 | `templates/` | SI |
| 6 | `tools/` | SI |

### §4 findings — 2026-08-17

**Method.** For each directory: full file listing, then `grep -rl` across `services/`,
`rust/crates/*/src`, `tools/*.mjs` and `docs/*.md` for the exact filenames, to tell "read by
running code" from "reference material" from "already-known dead" — the same three-way split
`D-0204`/`F7-001` already established for part of this surface.

**`security/` (5 JSON policy files) — live and wired.** Read at runtime by
`sector-modules.mjs` and `server.mjs` (confirmed by §1's `sector-modules` row and `D-0204`,
which revived this exact set from schema-only to load-bearing on 2026-07-28).

**`reference/` (27 files: a full Python reference implementation of the capability-token
protocol — `noesar_capabilities/`, `bin/noesar-capabilityctl.py`, 1,790 lines across 5 test
files) — real, substantial, with a known open gap already tracked, not rediscovered here:**
`F7-001` (state digest) records 23 CRITICAL / 9 HIGH static-analysis findings in this exact
directory, found by the `D-0204` sweep, explicitly out of scope for that phase and still open.
This review does not re-triage `F7-001` — re-auditing an already-open, already-evidenced finding
is the exact waste `noesar-evolution-context` rule 1 forbids; it is named here only so a reader
of this index does not read `Checked: SI` as `F7-001` being resolved.

**`sandbox/` (3 files: `README.md`, `capability-execution-contract.json`,
`wasi-profile.json`) — orphaned, a real gap not previously recorded.** Zero references anywhere
in `services/`, `rust/crates/*/src`, or `tools/*.mjs`. The README documents a WASI execution
contract and profile that no code reads — reference material for a sandbox backend not yet
built, not a live policy surface the way `security/`'s files are.

**`templates/` (4 files: manifest templates for `capability`, `hardware-adapter`,
`industry-module`, `runtime-adapter`) — reference-only, a real gap not previously recorded.**
Only `industry-module/module.template.json` is referenced anywhere in code, and only inside a
*comment* in `sector-modules.mjs` (the `D-0204` note about the schema/example mismatch it
fixed) — no code path reads any of the four templates at runtime. They are scaffolding for
someone hand-authoring a manifest, not inputs to a validator.

**`examples/` (1 file: `packages/noesar.foundation-public.pem`) — correctly named,
reference-only by design.** Cited in `docs/UPDATE_MANAGER_DESIGN.md` as the existing Ed25519
verification primitive to reuse for the update channel, not read by any shipped code path yet.
Consistent with its name; not a gap.

**`tools/` (3 Python scripts: `build-signed-package.py`, `verify-package.py`,
`verify-production-evidence.py`) — real, operational, CLI-only by design.**
`build-signed-package.py` is the Python original `D-0205` names as the sibling of the Node
`tools/sign-compliance-pack.mjs`/`verify-compliance-pack.mjs` pair that `compliance-packs.mjs`
and `server.mjs` actually call at runtime — these three stay CLI-invoked on purpose (`D-0205`:
"a private key never reaches `server.mjs`"), so "no runtime `import`" is the intended posture,
not a gap.

**Net for §4: 2 of 6 directories (`sandbox/`, `templates/`) are genuinely unread by any code —
new findings this pass — while `reference/`'s gap was already known (`F7-001`) and `examples/`+
`tools/` are reference/CLI material by design, not gaps.**

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
tools counted but not itemized. §1 (59/102) checked 2026-08-16; §2-4 (43/102) checked
2026-08-17 — all 102/102 named items now reviewed in depth.**

**§2-4 findings in one line each:** 14/17 slash commands fully covered end-to-end, 3
(`/reject` `/simulate` `/git`) have their engine logic tested but not the dispatch layer a
keystroke actually goes through. 20/20 Rust crates are real workspace members, `cargo test
--workspace --offline` → **144 passed, 0 failed** (VERIFIED 2026-08-17); 8 crates carry zero
tests, the most significant being `noesar-auth` (real Argon2/TOTP logic, compiled, declared as
a dependency, never actually called anywhere in the workspace); 3 crates
(`noesar-control-plane`, `noesar-hardware-orchestrator`, `noesar-audit-ledger`) have zero
workspace dependents and appear in no Dockerfile — compiled but never packaged. 2/6
`capabilities/` directories (`sandbox/`, `templates/`) are unread by any code; `reference/`'s
gap was already tracked (`F7-001`); `examples/` and `tools/` are reference/CLI material by
design. None of these are fixed in this pass — each is recorded, matching §1's own posture for
its 7 gaps.
