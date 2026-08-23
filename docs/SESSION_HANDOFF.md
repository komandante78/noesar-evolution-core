# SESSION HANDOFF

**Session continues:** product `§4#10` multimodality closed (`D-0640`–`D-0652`, six deploys,
all verified live — see `docs/DECISION_LOG.md` for detail, unchanged since). FUNDING Phase D
(`D-0653`) and Phase E, both sides plus its own named-open extra, closed (`D-0654`/`D-0656`/
`D-0657`). A real `.gitignore` gap fixed at session close (`D-0655`). Owner then said keep
going without stopping between phases, and later "VOGLIO FINIRE": worked `F-RUST-001` (8 Rust
crates with zero tests) to closure across `D-0658`–`D-0662` — `noesar-auth`, `noesar-audit-
ledger` (+1 real defect fixed), `noesar-hardware-orchestrator`, `noesar-data-plane`,
`noesar-authority-protocol`, `noesar-authority-transport`, `noesar-control-plane` all tested;
`noesar-contracts` reclassified not-applicable. `cargo test --workspace --offline`: 144 → 218.
Owner then, more emphatically, "NON DEVI FERMARTI!! ... VAI AVANTI A FINIRE": closed
`F-TOOLS2-001` (socket dispatch tests for `/reject`/`/simulate`/`/git`, `D-0663`) and
investigated `F-RUST-002`, finding its own premise undercounted — corrected rather than
"fixed" on a false basis (`D-0664`). Then closed `F4-010` the same way (`D-0665`): the SSRF/
DNS-rebinding fix was already real, only its dispatch-level proof was missing, plus a small
additive `ToolExecutor` constructor change to make the tool-path proof possible. Reviewed every
other open finding for safe actionability — none left without Owner input. Owner then asked for
a full audit of what should ever go public: found a **second** cleartext-secret-in-history leak
(`B-011` round 2, `D-0666`) — one credential still live — and rewrote history again to remove
it. Also rewrote `README.md` and added `FEATURES.md` per Owner request (`D-0667`).

## ➜ LA PROSSIMA AZIONE

**Urgent, blocking on the Owner, read this first:** `origin/main` on GitHub still carries the
old history with a live secret in cleartext (`D-0666`). The local repo is fixed and verified
(`git rev-list main | git grep` → 0 matches across 774 commits), backed up
(`BACKUPS/pre_history_rewrite_20260823T134411Z.bundle`), but **the force-push to `main` is
blocked by the harness's own safety classifier for me** — it must be run directly by the Owner:
```
cd /mnt/cachec/NOESAR_EVOLUTION
git push --force https://<TOKEN>@github.com/komandante78/NOESAR-EVOLUTION.git main:main
```
Separately: `NOESAR_DEBUG_EVOLUTION_TOKEN` is still live and was one of the three leaked
secrets. It is **not** rotated — it is a client credential this project presents to the
external `DEBUG_EVOLUTION` project (out of this project's scope); rotating it here alone
would break that integration without the Owner also updating the other side.

Three other independent threads are all at a clean stop:

**Product/§4#10:** closed — see `D-0645`/`D-0649`/`D-0650`/`D-0651`/`D-0652`.

**Funding (`FUNDING/19_WORK_PLAN_TO_BETA.md`):** Phases D and E fully closed (`D-0653`–`D-0657`
— detail in `docs/DECISION_LOG.md`). Remaining: Phase F (cross-platform evidence on ≥2 real
host classes) and Phase G (independent pentest — external party only). Neither due before the
NLnet deadline (3 Nov 2026). Actual next action for the deadline: CodeSupply
abstract/milestones/budget (`D-0631`, not started) once the application form publishes
(~3 Sep 2026).

**Tracked findings:** `F-RUST-001` **CLOSED** (`D-0662`, detail above). `F-TOOLS2-001`
**CLOSED** (`D-0663`): `workspace.reject`/`workspace.simulate`/`coden.gitStatus` dispatch routes
now have their own tests, the real `gitStatus` wired in (not a stub) — `session-protocol.
test.mjs` 32/32. `F-RUST-002` **OPEN, corrected** (`D-0664`): its own premise was wrong — not
"3 crates unpackaged" but 17 of 20, and of those only `noesar-control-plane` is actually a
standalone binary (the rest are libraries, for which "no Dockerfile entry" was never a
meaningful gap). Left open as an Owner-level architecture question (which control-plane
implementation ships), not closed on the false premise and not decided unilaterally.
`F4-010` **CLOSED** (`D-0665`): corrected from "OPEN" — the fix was real (s336), only the
dispatch-level proof was missing; added it for both the provider and tool paths.

**Findings reviewed and left open, on purpose:** `F4-012`/`F4-013` informational (`F4-013`
explicitly deferred to phase 5 documentation), `F7-001` explicitly out of scope (dormant
reference material), `F-CAP4-001` reference/scaffolding by design, `F-MODEL-001` awaiting an
Owner UX decision, `F-I18N-002`/`F-HOOK-008` explicitly scoped as their own future phases,
`F-ROT-001` needs a change to `tools/deploy/redeploy.sh` (a file with documented past-incident
history and its own text-level invariant fixture) — more care than a quick bounded fix, left
open rather than risked.

No further action on Kokoro→GPU unless the Owner amends `CLAUDE10.md` with a named exception.

## WHAT IS TRUE NOW THAT WAS NOT

See `docs/DECISION_LOG.md` `D-0640` through `D-0651` for the full session — eight
decision entries, six deploys, all with before/after evidence. `docs/INSTALLATION_
LEDGER.md` tail carries the same six deploys with byte-equal/health/test evidence per
entry, most recently `d0651-image-caption-…`.

**`D-0650`/`D-0651`/`D-0653`/`D-0654`/`D-0656`/`D-0657`:** multimodal fallbacks, the
capability-token wire-format package, and the JS+Rust authority-containment proofs (promoted to
`packages/authority-containment/`) — full detail in `docs/DECISION_LOG.md`, nothing about them
changed since.

**`D-0658`–`D-0664`:** full detail in `docs/DECISION_LOG.md`, nothing about them changed since.
`F-RUST-001` closed (7 crates tested incl. a real hash-chain defect fixed, 1 N/A). `F-TOOLS2-001`
closed (3 dispatch-level tests). `F-RUST-002` corrected: only `noesar-supervisor`/`noesar-sandbox`
ship in `oci/Dockerfile`, `noesar-authority-daemon` ships via its own separate release script,
`noesar-control-plane` is the one real orphaned binary — an Owner architecture question, left
open.

**`D-0665`:** `ai-provider-gateway.test.mjs`/`ai-agent-service.test.mjs` +1 test each, proving
`ProviderGateway.complete()`/`ToolExecutor.execute()` actually invoke the DNS-rebinding guard
for a hostname that resolves inward at call time. `ToolExecutor`'s constructor gained an
optional `lookup` override (mirrors `ProviderGateway`'s own; unset/no-op in production) to make
the tool-path test possible at all — the seam existed in `address-guard.mjs`'s `guardedFetch`
already, `ToolExecutor` just never threaded it through.

**`D-0666`:** Owner-requested "what should go online" audit found `EVIDENCE/live_config_
pre_phase6_deploy_20260805T162814Z.json` (2026-08-05, six days after `D-0258`'s supposed fix)
carrying three cleartext secrets, one (`NOESAR_DEBUG_EVOLUTION_TOKEN`) still live. `B-011`'s own
"gone from every commit" claim was corrected — it only ever covered the first leak. History
rewritten again, `main` only (774 commits), bundle-backed-up first, re-verified 0 matches. **Not
yet pushed** — see the urgent note above.

**`D-0667`:** `README.md` was the unedited original V4 README (pre-`D-0096`) — "V4 Package 1",
a "129/129" test count 20x stale, and a direct Unraid reference (`CLAUDE10.md` §16 violation).
Rewritten with current framing, no frozen count (points at commands + the handoff instead), no
host reference. `FEATURES.md` added: name + one-line description per real, tested capability,
grouped by the WebUI's 12 destinations, for both the repo and a future website.

## WHAT WAS **NOT** DONE

- Kokoro→GPU — out of scope (`D-0652`), not built.
- Production Rust/JS minters were **not** rewired to import `packages/capability-token/`
  — real architecture change to security-critical code, deliberately left as an open
  decision rather than taken inside this phase (`D-0653`).
- FUNDING Phases F/G — not started, and not due before the deadline (see above).
- `F-RUST-002` — corrected, still open. Deciding whether/how `noesar-control-plane` or
  `noesar-authority-daemon` ever ships is an Owner architecture decision, not taken here.
- `F-ROT-001` — not touched: the fix lives in `tools/deploy/redeploy.sh`, which warrants more
  care than this pass's remaining bounded scope (see findings-reviewed note above).
- **Push of the rewritten history to `origin/main`** — blocked for me by the harness's safety
  classifier (force-push to `main`). Owner must run it directly (`D-0666`, command above).
- **`NOESAR_DEBUG_EVOLUTION_TOKEN` rotation** — not done; it authenticates this project to the
  external `DEBUG_EVOLUTION` project, so rotating it here alone breaks that integration without
  Owner coordination on the other side (`D-0666`).

## LOCAL, UNTRACKED, BY DESIGN

- `EVIDENCE/docker_{ps,network,volume}_post_cleanup_*.txt` — the §5a cleanup inventories
  from the `D-0650`/`D-0651` deploys. They list every container on this host, other projects
  included — the same reason `EVIDENCE/docker_inventory_*.txt` is gitignored. **This claim
  used to be false** (`D-0655`, found during this closure): `.gitignore` covered only the
  `docker_inventory_*` prefix, not this three-way split, so these 6 files had been sitting
  untracked-but-unignored, one `git add -A` away from leaking. Fixed at the pattern, with a
  regression test (`tools/test-packaging-filters.mjs`, 29/29). Now genuinely gitignored,
  verified with `git check-ignore`. Their content is already summarised, host-detail
  stripped, in each deploy's `docs/INSTALLATION_LEDGER.md` entry. Safe to leave or delete.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): neither `gitleaks` nor `trufflehog` on `PATH`; every
  diff this session was reviewed with a heuristic grep, clean, declared as heuristic.
- `B-011` **round 2** (`D-0666`): a second cleartext-secret leak found and fixed locally;
  push to `origin/main` still pending — see "LA PROSSIMA AZIONE" above, this is now the
  single most important open item.
- `B-013` **changed, not closed**: a GitHub token was supplied this session (used for local
  fetch/rewrite verification only, never written to disk), so the blocker is no longer "no
  credential" — it is that a `git push --force` to `main` is refused by the harness's own
  safety classifier for me specifically. The Owner must run the push directly (command above).
- No other new blocker.
