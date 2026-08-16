# SESSION HANDOFF — 2026-08-16 (`D-0476`: deep review, items 4-9 of 158)

## ➜ LA PROSSIMA AZIONE

**`D-0469`'s deploy from 2026-08-15 is still what is live and healthy — no product code changed
this session.** This session reviewed rows 4-9 of `docs/PAGES_INDEX_2026-08-16.md` (6 items, at
the Owner's request this round — was 3/phase):

- **`#/tools`** — real; consent is enforced **server-side**, default-deny
  (`tool-executor.mjs:36`, `workflow-service.mjs:616`), not just a UI checkbox.
- **`#/coden-tui`** — real; single sign-on via 60s attach code, e2e-covered.
- **`#/projects`** — real; knowledge-mode isolation unit-tested.
- **`#/documents`** — real; versioned, backend-tested. Missing: no in-page version-diff, plain
  textarea only (not built — needs Owner input on whether it's a real bottleneck).
- **`#/knowledge`** — real; hybrid search + local extraction confirmed live.
- **`#/memory`** — real; pending queue with keep/discard, `provenance` already tracked per item.

**`HUNT AND FIX` this phase (`D-0475`)**: `F4-011` (magic-byte sniffing) was recorded `OPEN` in
`PROJECT_STATE.json` but the fix (`sniffContentType()`, `file-extractors.mjs:44`) had already
landed before `D-0362` (2026-08-09) — a **stale record**, found while reading the `#/knowledge`
upload path. Corrected, re-verified: 13/13 tests pass.

**Funding-fit research, explicitly requested this turn (not the routine one-liner)**:
`file-extractors.mjs` (204 lines, zero imports outside Node core) is a strong NLnet-fit
candidate — delimited, reusable, fully local/offline, no model/provider lock-in. Proposal:
publish it as its own small AGPL package. **Not built** — proposed only. Full text:
`docs/PAGES_INDEX_2026-08-16.md` §8 `D-0476`, `docs/DECISION_LOG.md` `D-0476`.

`Checked` is now `SI` for 9 of 55 pages (items 1-9). **Next phase**: items 10-12 —
`#/agents`, `#/workflows`, `#/models` — same method: what works / what's missing / what to
change, cite file:line, `HUNT AND FIX` anything in-scope found stale or broken, one funding-fit
research note if warranted. No code changes without Owner authorization or a `HUNT AND FIX`
requirement.

The other open items are unchanged, still the Owner's call:

- **`F-SLASH-001`'s actual fix** — pick design (A) drive the terminal, or (B) declare-and-skip
  when the terminal has claimed the surface. See `D-0463`.
- **`cargo publish`** — serve `CARGO_REGISTRY_TOKEN` in `secrets/crates_io_token`, da
  terminale vero.
- **Fase D (WP4)**, the hover/title fix, or one of the 3 `D-0472` research directions, or now
  also **the `file-extractors.mjs` packaging proposal (`D-0476`)** — four options scoped and
  ready, none started.

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
| `F4-011` | **CORRECTED** (was a stale `OPEN` record) — actually fixed pre-`D-0362`. `D-0475`. |

All others from earlier sessions: **FIXED/DEPLOYED/CLOSED**, listed in full in
`docs/DECISION_LOG.md` — not repeated here (D-0460 through D-0469).

## Verificato IN QUESTA SESSIONE

Read-only review phase, one targeted re-verification: `node --test services/reference-control-plane/
test/file-extractor-sniffing.test.mjs` → **13/13 pass** (proves `D-0475`'s correction). Everything
else was direct source reading (`app.js`, `index.html`, `tool-executor.mjs`, `workflow-service.mjs`)
cross-checked against existing e2e/unit coverage cited in `docs/PAGES_INDEX_2026-08-16.md` §8 —
not re-executed in full this session, cited as already-proven evidence per
`noesar-evolution-engineering-depth` §8.1.

## Cosa NON è stato fatto

- **No full suite run, no deploy** — only the one targeted test above; nothing else changed in
  `services/`, `apps/`, `rust/`.
- **46 of 55 pages, 103 of 103 tools/modules items** — still `Checked: NO`, unreviewed.
- **`#/documents` version-diff** — gap named, not built; no Owner authorization sought yet.
- **`#/tools` UI-level e2e** — the server-side consent gate is proven, the browser submit path
  through the form itself is not covered by a dedicated e2e check found this pass.
- **`F-SLASH-001`'s actual fix** — design decision not taken, deliberately, still the Owner's.
- **`file-extractors.mjs` packaging** — proposed only, per `noesar-evolution-budget` §5, not
  executed without Owner authorization.

## Proposta di miglioramento

**Questo giro (`D-0476`)**: see "Funding-fit research" above — publish `file-extractors.mjs` as
its own small AGPL package. Full reasoning in `docs/PAGES_INDEX_2026-08-16.md` §8.

**Precedente (`D-0474`, non eseguita)**: `#/home`'s Intent-Frame gap is asserted in two places
(`index.html:218`, `page-help.js:36`) with no single source — a shared constant or a test tying
them together would catch drift if one is edited without the other. Cost: low.

**Precedenti (`D-0473`-`D-0460`, non eseguite)**: see `docs/DECISION_LOG.md`.
