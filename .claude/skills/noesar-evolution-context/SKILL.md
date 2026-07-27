---
name: noesar-evolution-context
description: MANDATORY at the opening of every NOESAR EVOLUTION session or phase, and before reading any state or documentation file in /mnt/cachec/NOESAR_EVOLUTION. Replaces bulk reading of PROJECT_STATE.json, DECISION_LOG.md and INSTALLATION_LEDGER.md with a measured digest, caps which files may be read whole, and imposes append-only writing so the state files stop growing. Use before the first Read of a session, whenever tempted to open a capped file, and before writing to any state file.
---

# Context economy — read the state, do not load it

Applies **only** to NOESAR EVOLUTION. Subordinate to `CLAUDE10.md`.
Owner instruction, 2026-07-27: *"skill che ti aiutano a risparmiare, controllare e lavorare
meglio senza spendere sessioni di 1 ora e passa di token"*.

## The measurement this skill exists for

Measured on 2026-07-27, in this repository:

| File | Size | Lines | May it be read whole? |
|---|---|---|---|
| `PROJECT_STATE.json` | 80 KB | 1,258 (~120 top-level keys) | **NO — jq only** |
| `docs/DECISION_LOG.md` | 160 KB | 2,371 | **NO — tail/grep only** |
| `docs/INSTALLATION_LEDGER.md` | 116 KB | 2,271 | **NO — last entry only** |
| `MANIFEST.sha256` | 675 KB | 5,739 | **NO — grep/count only** |
| `MASTER_PROJECT/*.md` | 204 KB total | 14 documents | **NO — named document only** |
| `docs/SESSION_HANDOFF.md` | 19 KB | 293 | yes — it is sized to be read |
| `docs/WORK_PLAN_V5_REWRITE.md` | 14 KB | 202 | yes, when the phase needs the plan |
| `MASTER_PROJECT/09_PIANO.md` | 10 KB | 169 | yes, when the phase needs the plan |
| `CLAUDE10.md` | 17 KB | 277 | yes — it is the authority |

**Executing the mandated read order literally costs ~400 KB ≈ 100k tokens before a single
line of work.** That is the largest avoidable cost in this project, it is paid every
session, and almost all of it is history no phase needs.

`state-digest.sh` returns the same operative facts in **6.3 KB — 64× less**, measured.

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
  describe *now*. Its cap lives in the budget skill.

## Rule 6 — the digest reports declarations, not measurements

`product_test_suite` in `PROJECT_STATE.json` records what **a past phase claimed**. It has
been stale before — on the first run of this digest it read `524/524` unit and `178/178`
browser while the most recent session had produced `745` and `315`. Never quote those
numbers as a current result. Rule 38 (`CLAUDE10.md`): no PASS without evidence produced in
**this** session.

---

*This skill is deliberately under 130 lines, for exactly the reason it exists.*
