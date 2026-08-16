# SESSION HANDOFF — 2026-08-16 (`D-0474`: deep review, items 1-3 of 158)

## ➜ LA PROSSIMA AZIONE

**`D-0469`'s deploy from 2026-08-15 is still what is live and healthy — no code changed this
session.** This session reviewed the first 3 rows of `docs/PAGES_INDEX_2026-08-16.md`, per the
Owner-agreed plan from `D-0473`'s close (3 items/phase, in list order, top-level pages first):

- **`#/home`** (`app.js:973-977`, `index.html:198-236`) — real, working: `renderHome()` reads
  live state, entry/goal actions render from a payload (not hardcoded), e2e-covered. Declared
  gap (not hidden): the "Intent Frame" (goal → Plan) does not exist yet — the product says so
  itself, in `page-help.js` and inline in `index.html:218`.
- **`#/chat`** (`app.js:979-1123`, `index.html:262-327`) — real, working: conversation/branch
  CRUD, work panel, dictation/read-aloud all wired to real handlers, not placeholders. No new
  finding.
- **`#/coden`** (`app.js` terminal wiring, `index.html:330-450`) — real, working: shared WS
  terminal session with the SSH TUI, slash-routing e2e-checked. Missing: `F-SLASH-001` (open,
  root cause confirmed `D-0463`, blocked on an Owner design pick A/B) and 25 legacy bench/agent
  panels still pending "slice 4" removal.

Full findings: `docs/PAGES_INDEX_2026-08-16.md` §8, `docs/DECISION_LOG.md` `D-0474`.
`Checked` flipped to `SI` for these 3 of 55 pages only — the other 52 pages and all 103
tools/modules items are still `NO`, unreviewed.

**Next phase**: items 4-6 of `docs/PAGES_INDEX_2026-08-16.md`, list order — `#/tools`,
`#/coden-tui`, `#/projects`. Same shape: what works / what's missing / what to change, `Checked`
flips to `SI` only for what was actually reviewed. No code changes unless the Owner authorizes a
fix or `HUNT AND FIX` requires one. At 3/phase, ~50 phases remain to cover both inventories once.

The other open items are unchanged, still the Owner's call:

- **`F-SLASH-001`'s actual fix** — pick design (A) drive the terminal, or (B) declare-and-skip
  when the terminal has claimed the surface. See `D-0463`.
- **`cargo publish`** — serve `CARGO_REGISTRY_TOKEN` in `secrets/crates_io_token`, da
  terminale vero.
- **Fase D (WP4)**, or the hover/title fix, or pushing one of the 3 research directions from
  `D-0472` into a real proposal — all three scoped and ready, none started.

## Blockers e finding aperti

| Id | Stato |
|---|---|
| `F-SLASH-001` | **ROOT CAUSE CONFIRMED, not fixed** — needs a test-strategy choice. `D-0463`. |
| ATOM licence | **APPLICATO** — aperto, AGPL, repository separato invariato (ancora vuoto). `D-0468`. |
| Product access control | **DECISO** — registrazione, mai licenza a codice. `D-0467`/`D-0468`. |
| `docs/LICENSE_STRATEGY.md` §5, voci 2-6 | **APERTE per la Fase 5.** |
| `D-0433` | **APERTO.** Stessa condizione già accettata. |
| `cargo publish` | **APERTO** — serve `CARGO_REGISTRY_TOKEN` da terminale vero. |
| `F-I18N-002` | **OPEN**, not re-baselined — catalogue-closable gap rose 607→644. |
| `F-MANIFEST-001` | **OPEN**, pre-existing, out of scope — `MANIFEST.sha256` 5898 vs 6568 tracked files. |
| `F-MODEL-001` | **OPEN**, awaiting Owner choice — `#/models` provenance display. |
| `F-ROT-001` | **OPEN** — `NOESAR_ALLOWED_HOSTS` still names the pre-rotation container IP. |

All others from earlier sessions: **FIXED/DEPLOYED/CLOSED**, listed in full in
`docs/DECISION_LOG.md` — not repeated here (D-0460 through D-0469).

## Verificato IN QUESTA SESSIONE

Read-only review phase — no suite run, no deploy, no container touched. Verification was direct
source reading (`app.js`, `index.html`) cross-checked against existing e2e coverage
(`tools/browser-e2e.mjs`, lines cited in `docs/PAGES_INDEX_2026-08-16.md` §8) — not re-executed
this session, cited as already-proven evidence per `noesar-evolution-engineering-depth` §8.1.

## Cosa NON è stato fatto

- **No test suite run** — nothing changed in `services/`, `apps/`, `rust/`; a doc-only phase per
  the verify skill's change-to-tier map (T0 territory, and even T0 was judged unnecessary since
  zero source files changed).
- **52 of 55 pages, 103 of 103 tools/modules items** — still `Checked: NO`, unreviewed.
- **`F-SLASH-001`'s actual fix** — design decision not taken, deliberately, still the Owner's.
- **`cargo publish`** and the other `docs/LICENSE_STRATEGY.md` §5 questions — invariate.
- **No HUNT AND FIX** — nothing found this pass rose to the level of an unrecorded defect; both
  gaps found (`#/home` Intent Frame, `#/coden` `F-SLASH-001`) were already known and tracked.

## Proposta di miglioramento

**Nuova, da questo giro (`D-0474`, non eseguita)**: `#/home`'s Intent-Frame gap is asserted in
two independent places (`index.html:218` inline copy, `page-help.js:36`) with no single source.
If Intent Frame ships, both need editing together or the two will silently disagree about
whether the gap still exists. Benefit: a shared constant or a test asserting both strings change
together would catch the drift the day it happens instead of leaving stale copy live. Cost: low
— one small regression test, no runtime change.

**Precedenti (`D-0473`-`D-0460`, non eseguite)**: see `docs/DECISION_LOG.md`.
