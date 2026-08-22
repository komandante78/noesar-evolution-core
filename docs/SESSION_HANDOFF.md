# SESSION HANDOFF

**`§4#9` done and verified live**: a chat message that unambiguously asks to create an
agent creates it, no form, no confirmation. Owner said "finiamo il progetto" (NLnet
calls reopen 2026-09-03) — proceeding through the remaining `D-0645` backlog, one phase
at a time, without stopping to re-ask which item is next.

## ➜ LA PROSSIMA AZIONE

Two `D-0645` items remain, each its own phase (rule 9):
1. **Kokoro TTS → GPU move** — infrastructure action on `noesar-voice-speak`, a
   non-`noesar-evolution` container. Needs explicit scoping before execution (outside
   this project's own container authority, `CLAUDE10.md` rule 16).
2. **`§4#10` multimodality** (documents/files, images, audio priority) — large enough
   that it needs decomposition into sub-phases before any implementation; not a single
   vertical slice like `§4#9` was.

Continuing to the next scoping/implementation phase directly.

## WHAT IS TRUE NOW THAT WAS NOT

**`D-0648`, deployed and verified live** (`d0648-agent-directive-…`). Checked first that
this does not collide with CodeN Evolution's own 8-phase plan (`MASTER_PROJECT/17_...`):
the WebUI's "Agents" feature (chat-persona: name+instructions) is unrelated to "L'Autore"
(CodeN's code-generation agent) — confirmed by grep, zero overlap.

Mechanism: the chat system prompt (new `agent-directive.mjs`) instructs the bound model
to emit exactly one tagged fence, `` ```agent-create ``, only when a request is
unambiguous — mirrors `author.mjs`'s established "one fence or refuse, never guess"
shape. Server-side, `chat-orchestrator.mjs` parses the completed answer, calls the SAME
`AgentService.createAgent()` the manual form already uses with zero confirmation, strips
the fence from the stored/shown text, surfaces `agentCreated` on the SSE `complete`
event — the client's existing `refreshWorkspace()` shows the new agent with no extra
plumbing.

**Security checked, not assumed**: the directive is read from the model's own answer,
which untrusted retrieved content could try to manipulate via prompt injection into
emitting a forged fence. Refused — parsed and stripped for display, never executed —
whenever this turn's injection detector already fired. Proven with a hostile-document
fixture, not asserted.

**Verified, not asserted:** 8 new tests against the real `ChatOrchestrator` through a
fake upstream (same harness `prompt-injection-containment.test.mjs` uses): unambiguous
directive creates the agent and is stripped from shown text; no directive creates
nothing; missing name / malformed JSON / two fences (ambiguous) each create nothing; the
injection-refusal path has a real ledger entry. Full suite 3022/3023 (1 pre-existing
skip), ESLint 477/0/0, browser-e2e 510/511 (`F-I18N-002` only), bytes-equal 478/478,
live health 200/200/200.

**Improvement proposal, `D-0648`:** the same tagged-fence pattern generalises to any
other zero-confirmation product action a chat message could name directly (projects,
notes, documents). **Funding fit: Restack, trait 1** (delimited, realisable component)
**and trait 5** (measurable — same red/green fixture shape).

## WHAT WAS **NOT** DONE

- Kokoro→GPU move, `§4#10` multimodality — scoped in `D-0645`, not built.
- **Not proven against a live model** — `§4#9` is proven end-to-end against a scripted
  upstream, not against a real signed-in session with a real model attached. Declared,
  not implicit.
- No `toolIds` binding from chat — the directive only carries name+instructions; binding
  tools is a stated extension point, not built.
- **No push** — `git push origin main` still fails, no GitHub credential in this
  container (`B-013`, unchanged). Commits are complete and correct locally.

## OPEN BLOCKERS

- `B-002` **STALE** (`D-0257`): neither `gitleaks` nor `trufflehog` on `PATH`; this
  session's diff review was a heuristic grep, clean, declared as heuristic.
- `B-011` low/deferred (`D-0258`): git history rewritten on Owner's explicit authorisation.
- `B-013` **still open**: `git push origin main` refused, no GitHub credential stored in
  this container. Commits keep queuing locally, correct and complete.
- No other new blocker.
