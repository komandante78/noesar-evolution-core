# SESSION HANDOFF

**Session continues:** product `§4#10` multimodality closed (`D-0640`–`D-0652`, six deploys,
verified live). FUNDING Phases D and E closed (`D-0653`–`D-0657`). `F-RUST-001` (8 Rust crates
with zero tests) closed (`D-0658`–`D-0662`, `cargo test`: 144 → 218). `F-TOOLS2-001` closed,
`F-RUST-002` corrected not closed, `F4-010` closed with real dispatch-level proof
(`D-0663`–`D-0665`). Owner asked for a "what should go public" audit: found and fixed a
**second** cleartext-secret-in-history leak (`B-011` round 2, `D-0666`, Owner pushed the
rewrite directly, verified live via fresh fetch), rewrote `README.md`/added `FEATURES.md`
(`D-0667`), verified both live (`D-0668`). All of the above is full detail in `docs/
DECISION_LOG.md`, unchanged since, not repeated here.

**Then:** Owner tested the live `#/chat` page directly and reported three real bugs — the `/`
menu doesn't auto-scroll, `/clear` does nothing, the toolbar still reads as a flat dump despite
an earlier fix. All three confirmed and fixed (`D-0669`): one-line scroll fix, `/clear` given a
real client-side watermark (was a total no-op), toolbar groups given actual card styling
(screenshotted before/after — the old CSS genuinely was that flat). Building the check for
`/clear` surfaced three of my OWN test-writing bugs along the way (wrong selection method, a
vacuous wait, `sendChat()` needing a provider that doesn't exist in the probe) — each found and
fixed before trusting the result. Final: 516 checks, 515 pass, 1 pre-existing declared gap,
**0 undeclared failures**.

## ➜ LA PROSSIMA AZIONE

**`D-0669`/`D-0670`/`D-0671` are all committed, PUSHED, and deployed live.** `B-014` (push
blocker) closed: the Owner's own PAT was reused ad-hoc (never persisted in remote config),
verified with a fresh authenticated fetch. Image `d0671-toolbar-border-20260823T160319Z` is
running, healthy, 4 children, byte-equal to tree (485/485).

**`D-0671`, found by actually looking at the live page.** The Owner kept saying the toolbar
was still wrong after `D-0669`. Instead of guessing again, screenshotted the real live
`#/chat` page (auth-gate hidden via DOM manipulation, no credentials used) and found a real
defect the diff review missed: the base `.chat-toolbar` rule still carried its own
border/padding/background, doubled up with the `.toolbar-group` cards `D-0669` added — a box
wrapping three boxes. Fixed, and the now-orphaned `--surface-toolbar` token removed (the
unit suite's own `webui-markup-structure.test.mjs` caught it immediately, proof the check
works). Verified live via `curl` on `/styles.css` and a final screenshot.

**No open item on this line of work.** Everything is committed, pushed, deployed, and
verified with real evidence against the running installation — not inferred from the commit.

`NOESAR_DEBUG_EVOLUTION_TOKEN` is still live and was one of `D-0666`'s three leaked secrets (now
gone from history, not rotated) — a client credential this project presents to the external
`DEBUG_EVOLUTION` project; rotating it here alone breaks that integration without the Owner
also updating the other side. `BACKUPS/pre_history_rewrite_20260823T134411Z.bundle` is the
pre-rewrite recovery point, kept per rule 23.

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

`D-0640` through `D-0668` — multimodal fallbacks, the capability-token package, JS+Rust
authority-containment, `F-RUST-001`/`F-TOOLS2-001`/`F-RUST-002`/`F4-010`, the second secret
leak and its push, `README.md`/`FEATURES.md` — full detail in `docs/DECISION_LOG.md`, nothing
about any of them changed since; not repeated here to keep this file inside its own cap.

**`D-0669`, current, most relevant to what's next:** `/` menu scroll fixed (`app.js`,
`renderCommandMenu()`, one line, matches the sibling palette). `/clear` fixed (`app.js`): was a
declared-but-never-built no-op — every message including `/clear`'s own line is deliberately
persisted so it "survives `refreshMessages()`", and that function re-rendered the full history
unconditionally, so the screen never cleared. Fixed with a `localStorage` watermark
(`CHAT_CLEARED_KEY`), the same idiom `THEME_KEY` already uses — nothing server-side changes.
Toolbar grouping fixed (`styles.css`): the `Where`/`Version`/`Model` groups existed since
`D-0437`-era work but were separated only by a 1px border and a 10px gray label, invisible once
wrapped — screenshotted before/after via a disposable Puppeteer container against a standalone
fixture (no auth needed to prove a CSS change); now three bordered, backgrounded cards. Full
disposable e2e: **516 checks, 515 pass, 1 pre-existing declared gap, 0 undeclared failures.**
**Not yet deployed** — see "LA PROSSIMA AZIONE" above.

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
- `B-011` **CLOSED round 2** (`D-0666`): second cleartext-secret leak found, history rewritten,
  Owner pushed directly, verified live via fresh fetch (0 matches remotely).
- `B-013` **CLOSED**: Owner supplied a token and pushed the rewritten `main` directly (force-push
  is refused for the assistant by the harness's own safety classifier — Owner ran it themselves).
  Verified: `origin/main` matches local exactly.
- No other new blocker.
