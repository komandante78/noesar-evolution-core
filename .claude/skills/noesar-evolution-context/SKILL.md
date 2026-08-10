---
name: noesar-evolution-context
description: MANDATORY at the opening of every NOESAR EVOLUTION session or phase, and before reading any state or documentation file in /mnt/cachec/NOESAR_EVOLUTION. Replaces bulk reading of PROJECT_STATE.json, DECISION_LOG.md and INSTALLATION_LEDGER.md with a measured digest, caps which files may be read whole, and imposes append-only writing so the state files stop growing. Use before the first Read of a session, whenever tempted to open a capped file, and before writing to any state file.
---

# Context economy — read the state, do not load it

Applies **only** to NOESAR EVOLUTION. Subordinate to `CLAUDE10.md`.
Owner instruction, 2026-07-27: *"skill che ti aiutano a risparmiare, controllare e lavorare
meglio senza spendere sessioni di 1 ora e passa di token"*.

## The measurement this skill exists for

**Re-measured 2026-08-10** (previous figures were from 2026-07-30; `docs/DECISION_LOG.md` has
**more than doubled again**, and `docs/SESSION_HANDOFF.md` is back under its cap after a
governance session cut it from 382 lines to 91):

| File | Size | Lines | 07-30 | May it be read whole? |
|---|---|---|---|---|
| `MANIFEST.sha256` | **678 KB** | 5,898 | 688 KB | **NO — grep/count only** |
| `docs/DECISION_LOG.md` | **846 KB** | 9,179 | 367 KB ⚠ **+131%** | **NO — tail/grep only** |
| `docs/INSTALLATION_LEDGER.md` | **278 KB** | 4,517 | 182 KB | **NO — last entry only** |
| `MASTER_PROJECT/*.md` | **305 KB** | **18** documents | 217 KB / 16 | **NO — named document only** |
| `PROJECT_STATE.json` | **138 KB** | 1,412 | 102 KB | **NO — jq only** |
| `docs/SESSION_HANDOFF.md` | **5 KB** | **91** | 26 KB / 382 | yes — **back under its 150-line cap** |
| `docs/WORK_PLAN_V5_REWRITE.md` | 14 KB | 213 | 14 KB / 202 | yes, when the phase needs the plan |
| `MASTER_PROJECT/09_PIANO.md` | 9.5 KB | 169 | = | yes, when the phase needs the plan |
| `CLAUDE10.md` | 23 KB | 373 | 20 KB | yes — it is the authority |

**Executing the mandated read order literally now costs well over 1 MB** — `DECISION_LOG.md`
alone is 846 KB. The old figure of "~700 KB" **understated** it again. It is the largest
avoidable cost in this project, paid every session, and almost all of it is history no phase
needs.

> **`python3` re-checked 2026-08-10, unchanged**: still absent on this host (`command -v
> python3` finds nothing; `node v22.18.0` and `docker 29.5.3` are present). The verify skill's
> guidance to go through `scripts/test.sh` rather than calling the `.py` files directly still
> holds.

`state-digest.sh` returns the same operative facts in **10.3 KB**, measured 2026-07-30 after
the repair below.

> **Defect found and repaired 2026-07-30 — in this skill's own instrument.** The digest had
> grown to **18.5 KB**, not the 6.3 KB claimed here: `product_test_suite` reached **39 entries
> / 11.4 KB** and the digest printed all of it verbatim — **62% of the whole output**. Rule 5
> froze the *top-level* key count but nothing capped growth *inside* a key, so the tool built
> to save context had become the largest thing in it. Repaired at the source: newest 12
> entries, each truncated to the 200 chars carrying the counts, with the full text still
> reachable (`jq -r '.product_test_suite."<key>"'`) and `DIGEST_SUITE_ENTRIES=0` to print
> everything. **10.3 KB, −44.5%.** Lesson to keep: an economy measure needs its own
> measurement re-taken, or it silently becomes the cost it was built to remove.

## Rule 1 — open with the digest, never with Read

```sh
.claude/skills/noesar-evolution-context/state-digest.sh
```

One call. It prints: git head/dirty/remote, `current_phase`, `phase_status`, `next_action`
verbatim, every blocker, every open finding, the declared test suite, the last four
decisions **with line numbers**, the last installation **with line numbers**, the handoff's
heading map **with line numbers**, and the project's containers. It mutates nothing.

Then read `docs/SESSION_HANDOFF.md` — by offset, using the map the digest printed. Its
"LA PROSSIMA AZIONE" section is usually the only part needed.

Everything else is read **on demand, by line range**, when the phase actually needs it.

## Rule 2 — the capped files have an access pattern, not a Read

| Need | Do this, not a Read |
|---|---|
| a state field | `jq -r '.<key>' PROJECT_STATE.json` |
| why a decision was taken | digest gives the line number → `Read` with `offset`/`limit` |
| the current installation | last `## ` heading of the ledger → `Read` that range |
| is file X in the manifest | `grep -c` / `grep -n` on `MANIFEST.sha256` |
| a rule from the rewrite | name the document; never load `MASTER_PROJECT/` as a bundle |
| anything in `docs/` (80 files) | `grep -rn` for the term first, then read the hit range |

Source files over ~300 lines follow the same rule: `grep -n` for the target, then read that
range with `offset`/`limit`.

## Rule 3 — read once, in parallel, and never again

- Independent reads go in **one message**, not one per turn.
- A file already read in this session is **not re-read**. A fact already established is not
  re-derived. If it was true 20 minutes ago and nothing wrote to it, it is still true.
- After an `Edit`, do not re-read the file to confirm — the edit would have failed loudly.
- Nothing outside `PROJECT_ROOT` is opened, and no other project's memory file is ever
  opened (REGOLA ZERO).

## Rule 4 — declare the read budget, and notice when it breaks

State at the opening of the phase, in one line: *"digest + handoff §<n> + <file> lines a-b
= ~X KB read"*. If a step wants a full read of a capped file, say **why** before doing it.
An unexplained bulk read is a defect of this skill, not a shortcut.

## Rule 5 — writing to state is append-only, and the key count is frozen

The state files are 80–160 KB **because every phase added to them and none ever pruned**.
`PROJECT_STATE.json` grew a new top-level key per session — `webui_design_v3`, `_v4`, `_v5`,
`phase_3`, `phase_4`, `wcag_2_2_aa` — until it reached ~120 keys, and every future session
pays for that in tokens. Rewriting a 160 KB file to add a paragraph costs output tokens
twice over.

- **`docs/DECISION_LOG.md` and `docs/INSTALLATION_LEDGER.md`: append only.** Never rewrite
  the file, never reflow an old entry, never "tidy" the history.
- **`PROJECT_STATE.json`: edit the live keys, do not add new ones.** The live set is
  `current_phase`, `phase_status`, `next_phase`, `next_action`, `last_commit`,
  `last_updated_utc`, `blockers`, `open_findings`, `product_test_suite`, `deferred_items`.
  A phase's narrative belongs in the handoff and the decision log — not in a new key that
  every later session must scroll past. Adding a top-level key requires a stated reason.
- **`docs/SESSION_HANDOFF.md` is rewritten** each phase — it is the one file that must
  describe *now*. Its cap lives in the budget skill, and **it is currently breached**: 382
  lines against a cap of 150, because each phase prepended its own section and none ever cut
  the tail. The cap is enforced mechanically, not by intention — see the budget skill §3.
- **A key that grows per phase is capped where it is *printed*, not only where it is
  written.** `product_test_suite` reached 39 entries and 11.4 KB before anyone noticed,
  because the cost was paid by the digest and not by the writer. Any accumulating key must
  say how it is truncated at read time.

## Rule 6 — the digest reports declarations, not measurements

`product_test_suite` in `PROJECT_STATE.json` records what **a past phase claimed**. It has
been stale before — on the first run of this digest it read `524/524` unit and `178/178`
browser while the most recent session had produced `745` and `315`. Never quote those
numbers as a current result. Rule 38 (`CLAUDE10.md`): no PASS without evidence produced in
**this** session.

---

*This skill is deliberately under 130 lines, for exactly the reason it exists.*
