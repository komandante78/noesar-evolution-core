# SESSION HANDOFF — 2026-08-13 (T2 for `D-0404`: sette difetti riparati, immagine pronta, deploy fermo)


## ➜ LA PROSSIMA AZIONE

**Una sola cosa blocca l'installazione, ed è un permesso.** L'immagine `noesar-evolution:d0423-terminal-20260813T132120Z` è costruita
offline, i suoi byte sono **provati uguali all'albero** (7 file su 7, comprese le due nuove
superfici) e `redeploy.sh --check` dà **PREFLIGHT: PASS** con il percorso di rollback nominato.
Il comando di applicazione è stato **rifiutato dal classificatore dei permessi della sessione** —
non dallo strumento, non da un preflight fallito.

```sh
tools/deploy/redeploy.sh --source noesar-evolution --apply --authorized-by-owner \
  --image noesar-evolution:d0423-terminal-20260813T132120Z
```

**Finché non gira, l'installazione serve `d0402-a11y-20260813T060132Z`** — precedente a ogni
riparazione di oggi. È esattamente il motivo per cui nel browser la superficie CodeN è quella di
prima: il lavoro è in git e in quell'immagine, non sul prodotto in esecuzione.

Dopo il deploy: verifica live (`/livez`, `/readyz`, byte serviti = albero), pulizia §5a
(il rollback vecchio va rimosso, la sua immagine resta), poi la slice 4 — che resta subordinata
a C, D ed E della matrice verdi.

## Blockers and open findings

| Id | State |
|---|---|
| `F-TERM-001` | **CLOSED** (`ff448e4`). The product answers; the DRIVER was emptying the prompt with Escape where only Ctrl-U clears unconditionally. |
| deployment | **BLOCKED — permission refused.** Image built and byte-verified, preflight PASS. |
| `F-E2E-001` | OPEN, observed once: the `s327/4b` row flaked in run 17, green in runs 14-16. Recorded, not chased. |
| `F-I18N-002` | OPEN. Ratchet 607 → 644, **deliberately not re-baselined**; the suite now prints its sample. |
| `F-CSP-001` | **CLOSED** by `D-0423`. |
| `D-0415`(a) | **CLOSED.** (b) open by design and announced on the surface; (c) is slice 4. |
| `B-002`, `B-011`, A2 live, `D-0395`, `F-MANIFEST-001` | Unchanged, **not touched**. |

## The seven defects, and how each was proved

The first run against the committed tree produced **1 check, 0 pass** — dead at `bootstrap`.

| # | What was wrong | Proof |
|---|---|---|
| `D-0416` | `let codenTerminal` sat after `initRouter()`. The router calls `detachCodenTerminal()` on the first tick → `Cannot access … before initialization` → **the whole WebUI died at boot**. 2514 unit tests were green against it. | guard seen RED first; ESLint `no-use-before-define` measured and **rejected** — 54 hits, all correct code, **zero on the defect** |
| `D-0417` | `.mjs` served as `application/octet-stream`; browsers **refuse** that as a module. Every `.mjs` slice 3 shipped was refused → the terminal never mounted. | 3 tests seen RED (9/12 → 12/12) |
| `D-0423` | xterm cannot paint under `style-src 'self'` — 72 refusals. **Resolved:** the emulator now runs in its own document, embedded in a sandboxed same-origin iframe; that path alone gets the relaxed policy. | **0 refusals**, 0 emulators in the main document, 5 tests pin the scope both ways |
| `D-0423` (2nd half) | The emulator ignored all nine themes — `span.xterm-dim` at 1.31 on `daylight`. | palette derived from `--surface-code`/`--text-code`/…; audit **27/27** |
| `D-0420` | `menuFrame` returns rows under `groups`; the renderer reads `groupRows`. The terminal shell translated by hand, the browser shell spread the frame — so a typed `/` drew **"nothing to show"** on an owner account. One shaper now, `menuViewModel`, used by both. | 4 tests + the browser row red → green |
| `D-0421` | `planTurn`/`resolveCommand`/`groupMenu` take a LIST; `coden-terminal.js` gave them the menu OBJECT. Every submitted line threw inside an unawaited `submit()` — **no command was runnable in the browser shell at all**. Both shells had an `offered()` returning different types. | 3 tests, one asserting the defect's own signature (object → throws, list → answers) |

## Verified THIS session (evidence produced here)

| Instrument | Result |
|---|---|
| `node --test …/test/*.test.mjs` | **2533 tests, 2532 pass, 0 fail, 1 skip**, 279 suites (+19) |
| `tools/run-eslint.sh` | **405 files, 0 errors, 0 warnings, 0 `no-undef`** |
| `scripts/test.sh` | **pass=10 fail=0 partial=0 unavailable=0** |
| `tools/verify-source.mjs` | PASS — migrations 19, baseline 12/12 |
| `tools/seeded-defect-proof.mjs` | **19/19 CAUGHT** (was 18/19 — the UI-033 miss is repaired) |
| `tools/run-browser-e2e.sh` | **495 checks, 493 pass, 2 FAIL** (`F-I18N-002`, declared; and one flaky `s327/4b` row) |
| `tools/accessibility-audit.mjs` | **27 checks, 27 pass, 0 FAIL** |
| Secret scan | **HEURISTIC** — the `gitleaks` image is absent and pulling it needs the network. 0 credential-shaped hits in the diff; no archive, binary or `.env` staged. |

**The terminal, driven:** one embedded document, `sandbox="allow-scripts allow-same-origin"`,
named · **zero** emulators in the main document · `data-terminal-state="live"` over `WS /ws/coden`
· the parent keeps `role="application"`, the accessible name and the live-region status · palette
from the product theme · **0 inline-style refusals** · a typed `/` draws all seven groups · the
`D-0415`(b) arrow gap announced on the surface · leaving destroys the document (`idle`) ·
returning attaches exactly one, not two.

## State of the tree

11 files changed, 2 new (`coden-terminal.html`, `coden-terminal-frame.js`, `webui-boot-order.test.mjs`).
Backups in `BACKUPS/`. **Committed locally (`ff448e4`). Not pushed. The image is BUILT and byte-verified; no container was created, started or stopped.**
After cleanup: exactly two containers — the installation and one rollback — no probe image, no
stamped tag, only the two stable networks. `noesar-local` (another project) untouched.

### ⚠ For whoever deploys this

`serveStatic` gives **one path** — `/coden-terminal.html` — a different policy (`style-src 'self'
'unsafe-inline'`, `frame-ancestors 'self'`, `x-frame-options: SAMEORIGIN`). A reverse proxy that
rewrites security headers breaks the terminal and nothing else: that is the first thing to check
if the CodeN region shows a blank frame. `oci/Dockerfile` and `oci/Containerfile` still `COPY
apps/shared/` and no longer copy `tools/tui-screen.mjs` or `tools/coden-address-views.mjs`.

## Improvement proposal (`D-0422`)

**Stop waiting for network idle.** An open WebSocket inside an iframe means `networkidle2` may
never arrive; it silently killed 226 checks in one run, 205 in another and two whole steps in a
third, each time reading like a product failure. Both drivers now detach the terminal before
navigating, which is a patch. The proposal is to wait for the **condition each step actually
needs** — a selector, a request, a state. **Benefit:** a suite that cannot be silenced by a
legitimate long-lived connection, and this product will have more of those, not fewer.
**Cost:** ~68 call sites, one at a time, each needing its real condition named.
