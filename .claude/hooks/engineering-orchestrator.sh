#!/usr/bin/env bash
# NOESAR EVOLUTION — UserPromptSubmit hook.
#
# The mechanical half of the Automatic Advanced Engineering Orchestrator (CLAUDE10.md
# section 18). It injects ONE constant reminder that a new substantive Owner request is
# answered with a full ENGINEERING CONTRACT, not a local edit. It decides nothing else.
#
# What this hook does NOT do, deliberately:
#   - it never blocks. No "decision":"block", no "continue":false, on any input. A control
#     word, an answer, or an authorization must always reach the model untouched.
#   - it never writes a file, never keeps the prompt, never echoes any byte of the prompt
#     into its output. The prompt lives in one shell variable for the length of one
#     classification test and is never persisted, logged or transmitted.
#   - it never calls a model, an API, or the network. Everything here is local string work.
#   - it does not pretend to classify "substantive vs not". That classification is
#     semantic and a keyword list cannot do it honestly. What it does is far narrower and
#     provable: recognise a CLOSED SET of bare control/authorization forms and say so as a
#     HINT. Both failure directions are benign — a missed control word just gets the long
#     reminder (harmless, the text itself says control words open no contract), and a
#     missed substantive request still faces CLAUDE10.md section 18 and the skill, which
#     are in context on every turn regardless of this hook.
#
# Enforcement split, stated so nobody mistakes one for the other:
#   MECHANICAL  — this hook runs on every prompt OF A SESSION WHOSE WORKSPACE ROOT IS
#                 /mnt/cachec/NOESAR_EVOLUTION, is capped at MAX_BYTES, is ASCII-only,
#                 leaks nothing, and cannot block.
#
# The workspace-root condition is not a caveat, it is the activation boundary. This hook is
# registered in THIS project's .claude/settings.json, which Claude Code loads only for a
# session opened at this repository. A session started from the umbrella directory
# /mnt/cachec/NOESAR, from a parent path, or from anywhere else, loads different settings
# and none of these four hooks fire — no orchestrator reminder, no state digest, no
# destructive-command guard, no close guard. "Always on" is therefore true PER SESSION
# OPENED HERE, and false as a statement about the machine. Verified 2026-08-11 (D-0380).
#   INSTRUCTED  — what a contract contains, when one is opened, and the L4/L5 maturity
#                 bar live in .claude/skills/noesar-evolution-engineering-depth/SKILL.md.
#
# Fails EXPLICITLY: any degradation (no jq, unparseable payload, empty stdin) still injects
# the rule and says in systemMessage exactly what was degraded. It never fails silently and
# never fails closed.
#
# Input  (stdin, Claude Code 2.1.219): {"session_id":…,"hook_event_name":"UserPromptSubmit",
#         "prompt":"…", …}
# Output (stdout): {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit",
#         "additionalContext":"…"},"systemMessage":"…"}
set -u

MAX_BYTES="${NOESAR_ORCHESTRATOR_MAX_BYTES:-2048}"

SKILL_REF=".claude/skills/noesar-evolution-engineering-depth/SKILL.md"

# --- JSON string escaping without jq -------------------------------------------------
# Every string this hook emits is authored here and is pure ASCII with no quote and no
# backslash, so the escaper is defence in depth rather than a load-bearing part. It is
# still applied, because "the input can never contain X" is exactly the assumption that
# stops being true later.
json_escape() {
  printf '%s' "$1" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | tr -d '\r' \
    | sed -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g'
}

emit() {
  # $1 = additionalContext text, $2 = systemMessage text
  local ctx sys
  ctx="$(printf '%s' "$1" | head -c "$MAX_BYTES")"
  ctx="$(json_escape "$ctx")"
  sys="$(json_escape "$2")"
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"},"systemMessage":"%s"}\n' \
    "$ctx" "$sys"
  exit 0
}

# --- the two constant reminders ------------------------------------------------------
# ASCII only, on purpose: MAX_BYTES is a BYTE cap, and a byte cap can split a multi-byte
# character. Keeping the payload ASCII makes truncation safe by construction rather than
# by hoping the text stays short.

RULE_FULL="NOESAR EVOLUTION - Automatic Advanced Engineering Orchestrator (always on, CLAUDE10.md section 18).
Local hook hint: this message is not a bare control word. The hook classifies nothing more; you do, semantically, per $SKILL_REF.

If this IS a new substantive request - however short or casual - it is never a cosmetic or local edit. Before touching a file:
1. rebuild the component's real state from disk, never from memory;
2. name the user's end goal and the whole end-to-end path;
3. name every layer involved: UI, backend, API, data, memory, agents, tools, identity, security, runtime;
4. write the ENGINEERING CONTRACT yourself - ROLE / TASK / CONTEXT / REASONING & VERIFICATION / STOP CONDITIONS / OUTPUT - the Owner never fills those in;
5. set measurable acceptance criteria; target maturity L4, architecture ready for L5;
6. deliver the smallest production-grade vertical slice that is whole - never a button, a mock, a placeholder, an unreachable endpoint or a screen with no backend;
7. implement only the authorized scope, verify with evidence, clean up temporary resources, update state at close.

If this is a CONTINUATION, an ANSWER to your own question, an AUTHORIZATION, or a control word (procedi / continua / si / no), it opens NO new contract - carry the active one forward.
If it is read-only or informational, just answer it; do not open a contract.
Label every claim VERIFIED / INFERRED / UNVERIFIED / BLOCKED."

RULE_CONTROL="NOESAR EVOLUTION - Automatic Advanced Engineering Orchestrator (always on, CLAUDE10.md section 18).
Local hook hint: this message reads as a control, continuation or authorization form. It opens NO new engineering contract and is never refused - continue the contract already active, or answer the question that was asked.
If it is in fact a new substantive request, the full standard still applies: $SKILL_REF."

# --- read the payload ----------------------------------------------------------------
INPUT="$(cat 2>/dev/null || true)"

if [ -z "$INPUT" ]; then
  emit "$RULE_FULL" "engineering-orchestrator: empty hook payload - rule injected, control-word hint unavailable (degraded, not blocking)."
fi

if ! command -v jq >/dev/null 2>&1; then
  emit "$RULE_FULL" "engineering-orchestrator: jq unavailable - rule injected, control-word hint unavailable (degraded, not blocking)."
fi

if ! printf '%s' "$INPUT" | jq empty >/dev/null 2>&1; then
  emit "$RULE_FULL" "engineering-orchestrator: hook payload is not valid JSON - rule injected, control-word hint unavailable (degraded, not blocking)."
fi

PROMPT="$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)"

if [ -z "$PROMPT" ]; then
  emit "$RULE_FULL" "engineering-orchestrator: payload carried no prompt - rule injected, control-word hint unavailable (degraded, not blocking)."
fi

# --- the narrow, closed-set control-form test ----------------------------------------
# A multi-line message is never a bare control word; testing that first keeps the rest of
# the matching single-line and anchorable.
#
# The newline is held in a variable with a literal line break, NOT written inline as
# *"$(printf '\n')"* — command substitution strips trailing newlines, so that form expands
# to the empty string and the pattern becomes `**`, which matches EVERY prompt. That exact
# defect shipped in the first draft of this file and the fixture suite caught it: all four
# control-word cases were being reported as "multi-line".
NL='
'
case "$PROMPT" in
  *"$NL"*) emit "$RULE_FULL" "engineering-orchestrator: rule injected (multi-line prompt, not a control form)." ;;
esac

# Trim surrounding whitespace, quotes and trailing sentence punctuation, then fold case.
NORM="$(printf '%s' "$PROMPT" \
  | sed -e 's/^[[:space:]"'"'"']*//' -e 's/[[:space:]"'"'"'.!?,;:]*$//' \
  | tr '[:upper:]' '[:lower:]')"

# Branch 1 - the whole message is one of a closed set of bare control words.
# The accented forms are listed LITERALLY rather than as `s.` — a dot is one byte to grep in
# the C locale while `ì` is two, so a wildcard would match "sa"/"so"/"su" and miss the very
# word it was written for.
CONTROL_SET='^(procedi|prosegui|continua|continuiamo|proceed|continue|go|go on|avanti|vai|vai pure|procedi pure|ok|okay|k|va bene|d.accordo|conferma|confermo|certo|esatto|corretto|giusto|perfetto|bene|grazie|thanks|fatto|done|si|sì|sí|sÌ|sÍ|yes|yep|y|no|nope|n|stop|basta|aspetta|attendi|wait|riprova|ripeti|annulla|chiudi)$'
# Branch 2 - an authorization, which may legitimately be a long sentence
# ("AUTORIZZO COMMIT AUTOMATIC ADVANCED ENGINEERING ORCHESTRATOR").
AUTH_SET='^(autorizzo|autorizzato|autorizzata|autorizzazione|approvo|approvato|acconsento|authorize|authorized|i authorize|i approve|approved|permesso accordato)([^a-z]|$)'

if [ "${#NORM}" -le 40 ] && printf '%s' "$NORM" | grep -qE "$CONTROL_SET"; then
  emit "$RULE_CONTROL" "engineering-orchestrator: control form recognised - no contract opened, nothing blocked."
fi

if printf '%s' "$NORM" | grep -qE "$AUTH_SET"; then
  emit "$RULE_CONTROL" "engineering-orchestrator: authorization form recognised - no contract opened, nothing blocked."
fi

emit "$RULE_FULL" "engineering-orchestrator: rule injected (no bare control form recognised)."
