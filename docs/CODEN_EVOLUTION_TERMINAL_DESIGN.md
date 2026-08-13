# CodeN Evolution — one surface, rendered twice

**Status:** design, authorised by the Owner on 2026-08-13. **Nothing here is built yet.**
Decisions: `D-0404` (architecture), `D-0405` (the two shared sources), `D-0406` (`/`).
Plan of record it serves: `MASTER_PROJECT/16` §4b (`D-0313`, `D-0315`), `17` Fase 3.

---

## 1. What the Owner asked for

> One graphic, not two. The application runs on the server as a TUI, rendered natively over
> `ssh` and in the browser by a terminal emulator over a WebSocket. The two web CodeN
> destinations are removed. The terminal fills **the CodeN Evolution area — not the browser
> viewport** — and is reached from the sidebar entry that exists today. The `/` commands are
> repaired.

Authorised in the same instruction: the four deviations in §4 below.

## 2. Measured state, 2026-08-13 — the facts this design rests on

| Fact | Measure | Status |
|---|---|---|
| The TUI already exists, in Node | `tui-client.mjs` 754 · `tui-screen.mjs` 475 · `tui-fullscreen.mjs` 353 · `coden-address-views.mjs` 201 · `coden-evolution` 366 ≈ **2,150 lines**, 7 test files | VERIFIED |
| Its renderer is already pure and width-parametric | `visibleWidth` / `clipToWidth` / `padToWidth` / `wrapLines` measure **visible columns**, never `String#length` | VERIFIED |
| Address coverage in the terminal | **25 of 25** CodeN addresses render | INFERRED (a past phase's measurement, not re-run) |
| The product has **zero** third-party dependencies | every import is `node:*`; no `node_modules` tracked; even the QR encoder is hand-written (`qr.js`) | VERIFIED |
| Two web destinations are named CodeN | `index.html:157` (`coden`) and `:164` (`coden-tui`); `ROUTES` carries both (`app.js:234`) | VERIFIED |
| `#/coden` still contains the dashboard | 20 `data-bench-panel` + 5 `data-agent-panel` = **25 panels**, 275 lines of markup | VERIFIED |
| **Trap 1** — the browser is the terminal's source of addresses | `parseCodenAddressBook()` regex-scrapes `index.html` for the panels, their `<h3>` and their `declared-empty` paragraphs | VERIFIED |
| **Trap 2** — the terminal imports the command set out of the web folder | `tui-fullscreen.mjs:26` and `tui-client.mjs:37` import `../apps/webui-static/agent-commands.js` | VERIFIED |
| The `/` menu today | two levels, **7 groups** (`w` WORK · `d` DESTINATIONS · `t` TOOLS · `m` MODULES · `a` APPROVALS · `c` CONFIGURE · `s` SESSION) | VERIFIED |
| **Two `/` still exist** | `app.js:1876` binds a bare `/` to the browser's jump box, while `16` §4b.4 decided *«nel prompt comanda: c'è una `/` sola»* | VERIFIED |

**Consequence, stated once:** deleting the web CodeN today would empty the terminal's own
address book and break its command import. **The removal is the last act, never the first.**

## 3. The architecture

```text
[ SSH  ] ── coden_evolution ─────────────────┐
                                             ├──►  CodeN Evolution TUI       ← the ONE graphic
[ WEB  ] ── xterm.js ── WS /ws/coden ────────┘     ANSI frames · 24-bit · mouse
                           │
                           └─ authenticated by the existing session + Origin check + rate limit
                              NO shell: explicit argv, same non-root uid, same authority gates
```

- **No PTY.** The application draws its own ANSI frames, so the bridge needs bytes out, keys
  in and a geometry — exactly what a WebSocket carries. This removes a native module
  (`node-pty`) and, with it, an arbitrary-command surface: there is no shell behind the socket.
- **One session, N viewports.** A PTY has one geometry and two clients fight over it. Our
  renderer is width-parametric, so each viewport gets **its own frame**: `ssh` at 80 columns
  and the browser at 200, live, at the same time. The session survives a page reload and
  reattaches.

## 4. The four deviations the Owner authorised

1. **No Textual/Python, no Bubble Tea/Go, no Ink/React.** The TUI exists, in JavaScript, tested;
   `python3` is measured **absent** on this host and §62 forbids presuming it. Node is the
   branch of the Owner's own list that the stack law already names for what *presents*.
2. **No `node-pty`** — see §3.
3. **`xterm.js` is vendored into the repository** (MIT), plus **one Nerd Font weight as
   `woff2``. No CDN (§31, offline baseline). **The font licence is verified before it ships** —
   it is not asserted here.
4. **Accessibility conformance is scoped, not claimed whole** — see §8.

## 5. The page: full **area**, not full screen

The terminal fills the CodeN Evolution **content region**. The application chrome stays:
sidebar, product top bar, status line. It is not a browser-fullscreen takeover.

```text
┌──────────┬──────────────────────────────────────────────────────────┐
│ sidebar  │ status line  session · git · ctx · cost · atom   NORMAL  │
│          ├──────────────────────────────────────────────────────────┤
│ ⌁ CodeN  │                                                          │
│   Evolu… │   the terminal — 100% of this region, and nothing else   │
│ ▤ (gone) │   transcript · split ≥120 cols · prompt                  │
│ …        │                                                       [/]│
└──────────┴──────────────────────────────────────────────────────────┘
```

- Reached from **the sidebar entry that exists today** (`index.html:157`, `data-view="coden"`).
  The second entry, `coden-tui`, is removed; what it did — minting an attach code — becomes
  `/attach` inside the terminal.
- **Geometry is derived, not fixed:** columns and rows are computed from the region's box and
  sent on resize (debounced), so the frame always matches the space the region actually has.
- **Split at ≥120 columns, single column below.** `16` §4b.2 draws one column; the Owner asked
  for two. The rule honours both and is the only form that survives a narrow `ssh` window.

## 6. `/` — one door

- **Inside CodeN, `/` always reaches the prompt.** The browser's bare-`/` jump binding
  (`app.js:1876`) no longer competes: `Ctrl-K` opens the jump box, which the placeholder
  already advertises. This closes the s319 ambiguity that `16` §4b.4 decided and nothing
  enforced.
- **The menu keeps its two levels** — a bare `/` lists the 7 groups, one letter opens one —
  because folding them took DESTINATIONS to 64 entries once already.
- **One source, two shells, identical entries**, filtered by permission and *declared*
  filtered. The source moves (§7, fetta 1); its content does not change here.

## 7. The four slices — the order is the safety

| | What | Why in this order |
|---|---|---|
| **1** | **Move the two shared sources out of `apps/webui-static/`**: the address declarations and `agent-commands.js` become a shared module the server serves and the TUI imports | without it, slice 4 silently kills the terminal (traps 1 and 2) |
| **2** | **The bridge**: `WS /ws/coden` (RFC 6455 written by hand, ~300 lines, zero-dependency, same posture as `qr.js`) + one session, N viewports, reattach | it is the core and is testable without touching the page |
| **3** | **The page**: vendored `xterm.js` + font, the terminal filling the CodeN region, `/` repaired | the graphic arrives once there is something to show |
| **4** | **Removal**: the 25 panels, the second sidebar entry, the dead routes | removing is the last act |

## 8. Acceptance criteria — measurable, or the criterion does not exist

| # | Criterion | How it is measured |
|---|---|---|
| A | Exactly **one** sidebar entry contains "CodeN" | count in `index.html` |
| B | `data-bench-panel` + `data-agent-panel` occurrences = **0** | `grep -c` |
| C | All **25** addresses open *through the terminal* from the browser and render non-empty | browser e2e, one step per address |
| D | SSH and browser render the **same frame** at the same geometry | byte-for-byte comparison in test |
| E | The session survives a reload and reattaches | e2e: reload, assert transcript continuity |
| F | No path through the bridge can execute a verb outside the product's own set | adversarial test |
| G | The terminal region resizes with the window; no browser-fullscreen takeover | computed-style / bounding-box assertion |
| H | WCAG: the audit still passes on every other surface; CodeN is declared **scoped** | `tools/accessibility-audit.mjs`, unchanged elsewhere |

**Maturity target: L4**, architecture ready for L5 — one versioned frame/event contract, so a
new address or a second viewport transport needs no change to the page.

## 9. Where the honest answer is "worse"

The product reached **27/27 WCAG 2.2 AA** on 2026-08-13. A terminal in a browser is **one
element** to that audit: on this surface the measurable control count collapses from 879 to
about 1, and the focus and target-size rows stop saying anything about it. `xterm.js` has a
screen-reader mode and it will be on, but it is **not equivalent** and this design does not
pretend otherwise. Mitigation: SR mode enabled, `/export` of the transcript as text, and a
conformance claim **scoped to the surfaces it still covers** rather than extended into a lie.

## 10. Risks carried into implementation

- **First third-party dependency in the product's history.** Vendored, licence recorded,
  offline; the supply-chain posture changes the day it lands and must be stated in the ledger.
- **Hand-written RFC 6455.** Cheaper than a dependency and consistent with `qr.js`, but it is
  protocol code: it needs a fuzz/adversarial test, not only a happy path.
- **Removal is irreversible in the working tree** (§4 rule 12 governs it): slice 4 runs only
  after C, D and E are green, and with a backup.
