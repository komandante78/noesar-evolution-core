# SESSION HANDOFF — 2026-08-13

## ➜ LA PROSSIMA AZIONE

**Slices 1, 2 and 3 are in the working tree, staged, NOT committed and NOT installed.**

1. **Close `D-0415`(a) before anything else.** Slice 3 changed markup and CSS, which makes T2
   mandatory, and **T2 was not run**. Run `tools/run-browser-e2e.sh` and
   `tools/accessibility-audit.mjs` against this tree, and drive the terminal in a real browser.
   **Until that happens the CodeN terminal surface is `L2/L3`, not `L4`, and must not be
   described as working.** Unit tests cover the client's three *pure* decisions and nothing else.
2. **Then ask the Owner to authorise the commit** — three commits, one per slice.
3. **Then slice 4** (removal), and only after criteria C, D and E of the design are green — the
   design's §10 makes that conditional explicit, and removal is irreversible in the tree.

> Read `docs/CODEN_EVOLUTION_TERMINAL_DESIGN.md` first. `D-0404`…`D-0406` are the decisions it
> serves; `D-0407`…`D-0415` are this session's.

### ⚠ For whoever builds the image

`oci/Dockerfile` and `oci/Containerfile` changed twice. They now `COPY apps/shared/`, and they no
longer copy `tools/tui-screen.mjs` or `tools/coden-address-views.mjs` — **those files moved**, so
an older recipe fails the build on a missing path and a newer tree built with an older recipe
ships a terminal that throws on its first import.

## Blockers

| Id | State |
|---|---|
| `D-0415`(a) | **T2 not run — the terminal has never executed in a browser.** New, open. |
| `B-002` | STALE (`D-0257`). Unchanged. |
| `B-011` | low, deferred (`D-0258`). Unchanged. |
| A2 on the live installation | open — needs a signed-in session. **Not touched.** |
| `D-0395` `#/models` in-use lane | open — an Owner choice. **Not touched.** |

## What the three slices did

**Slice 1 (`D-0405`/`D-0407`)** — `agent-commands.js` → `apps/shared/coden/`, served at
`/shared/coden/`; the 25 CodeN panels became a *declaration* instead of a regex over
`index.html`. Address book **byte-identical before and after**, 54 entries.

**Slice 2 (`D-0410`)** — `WS /ws/coden`: hand-written RFC 6455 (`src/websocket.mjs`) plus the
bridge (`src/coden-bridge.mjs`), on both listeners. Same `sessionDispatch`, same policy, same
`can` — **a transport, and no authority**. All six terminal auth methods refused by name: on the
unix socket the filesystem answers "who may knock" (0600, one uid), and a 90-day token must never
be presentable from a network. No PTY, so no shell.

**Slice 3 (`D-0413`/`D-0414`)** — `@xterm/xterm@6.0.0` vendored; the CodeN region hosts the
terminal; `tui-screen.mjs` and `coden-address-views.mjs` moved to `apps/shared/coden/` (**trap 3,
which the design did not name**: the browser must run the same renderer and cannot import from
`tools/`); `D-0406` applied — the bare `/` no longer opens the jump box.

**No font ships (`D-0414`)**, against the design's §4.3, and the reason is a measurement: the
renderer's whole non-ASCII repertoire is `§·è—…›⋯⎿⏎⏺─│╭╮╯╰▍▸◈○◐⚑⚠✓✕` — standard Unicode, **not one
private-use codepoint**, which is the only thing a Nerd Font adds.

## Verified THIS session (evidence, not assertion)

| Check | Result |
|---|---|
| `node --test …/test/*.test.mjs` | **2514 tests, 2513 pass, 0 fail**, 1 skip, 276 suites |
| `tools/run-eslint.sh` | **403 files, 0 errors, 0 warnings, 0 no-undef** |
| `node tools/verify-source.mjs` | **PASS** migrations=19 baseline=12/12 |
| xterm.js integrity | **recomputed from the bytes, identical to the registry's `dist.integrity`** |
| xterm.js licence | MIT, LICENSE read in full — grant, attribution condition, disclaimer |
| address book before/after slice 1 | byte-identical, 54 entries |
| framing suite | 36 tests, incl. a 10,000-case fuzz and every truncated prefix of a frame |
| bridge suite | 31 tests against a real listener with a real session cookie |
| secret scan | heuristic (**no gitleaks/trufflehog on PATH — declared**), nothing found |

**Sixteen planted-defect proofs** across the session; every new oracle was made to fail before
being trusted. **Two refused to fail and are recorded rather than smoothed over:** removing the
static containment guard (the WHATWG URL parser normalises `..` before any route matches, so that
guard is defence in depth, not the active defence), and removing `broadcastChange` (the test was
branchy over a call that always failed — repaired, and it now fails in both directions).

## Defects found and fixed this session

| # | Defect |
|---|---|
| 1 | Neither image recipe copied `apps/shared/`; later, both still copied two files that had moved |
| 2 | The shared tree inherited Node's globals — flat config **merges** `globals` |
| 3 | The lint gate could not tell a scoped `ignores` from a global one |
| 4 | `mutates()` claimed the engine policy as its source and used a hand-typed set |
| 5 | The broadcast test's branch meant the broadcast was never exercised |
| 6 | `encodeClose` truncated by UTF-16 units, emitting an illegal 180-byte control frame |
| 7 | The browser client called four shared functions with the wrong signatures — `say`, `promptKeys`, `menuFrame`, `planTurn` — and `promptKeys` is not a key handler at all |
| 8 | `/logout` closed the socket and the close handler immediately reconnected it |
| 9 | Arrow keys decoded to intents nothing acted on (now declared, `D-0415`b) |

## What was NOT done — read before claiming anything

- **NOT committed. NOT pushed. NOT built. NOT installed.** No container created or touched.
- **T2 WAS NOT RUN** — no browser e2e, no accessibility audit, though slice 3 changed markup and
  CSS and the change map makes T2 mandatory for exactly that. This is the session's largest gap.
- **The terminal has never run in a browser.** `mountCodenTerminal` — sockets, ResizeObserver,
  timers, xterm itself — is `[UNVERIFIED]`. Only `decodeInput`, `geometryFor` and `bridgeUrl` are
  tested, and they are tested because they were split into `apps/shared/coden/terminal-input.mjs`
  for that purpose.
- **Arrow keys move nothing in the browser shell.** `tui-fullscreen.mjs` walks the `/` menu with
  ↑↓; that selection state lives in its keypress loop, not in the shared view model. The browser
  says so once per attachment rather than failing silently.
- **The 25 panels are still in the markup**, so the CodeN region currently shows the terminal
  **above** them, not instead of them. Slice 4 removes them — deliberately last.
- **T3 not run. The live installation is behind all three slices.**
- Hunt scoped to the diff. Portability: the new server files import only `node:crypto`,
  `node:net`, `node:http`; the browser files presume no host. **VERIFIED by reading imports.**
- `docs/INSTALLATION_LEDGER.md` not updated — correctly: nothing was installed. **It must be
  updated when this ships**, because the supply-chain posture changed (`D-0413`).

## Improvement proposals awaiting the Owner

- **`D-0409`** — a versioned contract for the address declaration (~40 lines, one test file).
- **`D-0412`** — let the bridge carry **engine** events, not just replies. Today a run finishing
  inside the engine reaches nobody until someone calls something: on `ssh` a stale screen, in a
  browser a screen that looks live and is not. Needs an engine seam, so it stops for a decision.
