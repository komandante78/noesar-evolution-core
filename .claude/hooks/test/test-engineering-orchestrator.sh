#!/usr/bin/env bash
# NOESAR EVOLUTION — synthetic fixture tests for the UserPromptSubmit hook
# (.claude/hooks/engineering-orchestrator.sh), the mechanical half of the Automatic
# Advanced Engineering Orchestrator (CLAUDE10.md section 18).
#
# Every input here is a literal JSON fixture piped into the real hook. Nothing is mocked
# away: the script under test is the exact file the harness runs. No container is created,
# no network call is made, no file outside a private mktemp -d is written, and the tests
# never invoke Claude Code itself.
#
# Usage: ./test-engineering-orchestrator.sh   (exit 0 = all pass, exit 1 = a failure)
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../engineering-orchestrator.sh"
SESSION_CONTEXT="$HERE/../session-context.sh"
GUARD="$HERE/../destructive-command-guard.sh"
SETTINGS="$HERE/../../settings.json"

TMPDIR="$(mktemp -d /tmp/noesar-orchestrator-test.XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

PASS=0
FAIL=0
CAP=2048

ok()   { echo "  ok   - $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL - $1"; [ $# -gt 1 ] && printf '         %s\n' "$2"; FAIL=$((FAIL+1)); }

# run_hook JSON -> stdout of the hook
run_hook() { printf '%s' "$1" | "$HOOK" 2>/dev/null; }

# ctx_of OUTPUT -> the injected additionalContext, decoded
ctx_of() { printf '%s' "$1" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null; }

# assert_never_blocks OUTPUT DESC — the single most important invariant in this file.
assert_never_blocks() {
  local out="$1" desc="$2" verdict=""
  printf '%s' "$out" | jq -e '(.decision // "") == "block"'   >/dev/null 2>&1 && verdict="decision=block"
  printf '%s' "$out" | jq -e '(.continue // true) == false'   >/dev/null 2>&1 && verdict="$verdict continue=false"
  printf '%s' "$out" | jq -e 'has("stopReason")'              >/dev/null 2>&1 && verdict="$verdict stopReason"
  printf '%s' "$out" | jq -e '(.hookSpecificOutput.permissionDecision // "") == "deny"' >/dev/null 2>&1 \
    && verdict="$verdict permissionDecision=deny"
  if [ -z "$verdict" ]; then ok "$desc"; else bad "$desc" "found: $verdict"; fi
}

# assert_valid OUTPUT DESC — valid JSON, right event name, non-empty context, within cap,
# ASCII-only (the cap is a BYTE cap; ASCII makes truncation safe by construction).
assert_valid() {
  local out="$1" desc="$2" ctx bytes
  if ! printf '%s' "$out" | jq empty >/dev/null 2>&1; then bad "$desc" "not valid JSON: $out"; return; fi
  if ! printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "UserPromptSubmit"' >/dev/null 2>&1; then
    bad "$desc" "hookEventName is not UserPromptSubmit"; return; fi
  ctx="$(ctx_of "$out")"
  [ -z "$ctx" ] && { bad "$desc" "additionalContext is empty"; return; }
  bytes="$(printf '%s' "$ctx" | wc -c | tr -d ' ')"
  [ "$bytes" -gt "$CAP" ] && { bad "$desc" "additionalContext is $bytes bytes, over the $CAP cap"; return; }
  if LC_ALL=C printf '%s' "$ctx" | grep -qP '[^\x00-\x7F]' 2>/dev/null; then
    bad "$desc" "additionalContext is not ASCII-only"; return; fi
  ok "$desc ($bytes bytes)"
}

assert_ctx_has()    { if printf '%s' "$1" | grep -qF "$2"; then ok "$3"; else bad "$3" "missing: $2"; fi; }
assert_ctx_lacks()  { if printf '%s' "$1" | grep -qF "$2"; then bad "$3" "unexpectedly present: $2"; else ok "$3"; fi; }
assert_mode() {  # OUTPUT EXPECTED_SUBSTRING_IN_SYSTEMMESSAGE DESC
  local sys; sys="$(printf '%s' "$1" | jq -r '.systemMessage // ""' 2>/dev/null)"
  if printf '%s' "$sys" | grep -qF "$2"; then ok "$3"; else bad "$3" "systemMessage was: $sys"; fi
}

payload() {  # payload PROMPT_JSON_STRING
  printf '{"session_id":"fixture-0001","transcript_path":"/dev/null","cwd":"/mnt/cachec/NOESAR_EVOLUTION","hook_event_name":"UserPromptSubmit","prompt":%s}' "$1"
}
jstr() { printf '%s' "$1" | jq -Rs .; }

echo "=== 1-2 · new substantive requests (short and complex) open the full standard ==="
for pair in "Controlla e rielabora la sezione Chat.|short natural request" \
            "Voglio rifare completamente il sistema di memoria: deve reggere dieci volte i dati, avere contratti versionati, migrazione e rollback, e la WebUI deve mostrarne lo stato reale.|complex request"; do
  P="${pair%%|*}"; D="${pair##*|}"
  OUT="$(run_hook "$(payload "$(jstr "$P")")")"
  assert_valid "$OUT" "$D: valid, capped, ASCII"
  assert_never_blocks "$OUT" "$D: never blocks"
  assert_mode "$OUT" "no bare control form recognised" "$D: classified as contract candidate"
  assert_ctx_has "$(ctx_of "$OUT")" "ENGINEERING CONTRACT" "$D: contract is demanded"
  assert_ctx_has "$(ctx_of "$OUT")" "L4" "$D: L4 maturity target is stated"
done

echo
echo "=== 3-7 · control words, answers and authorizations: never blocked, no new contract ==="
while IFS='|' read -r prompt desc marker; do
  OUT="$(run_hook "$(payload "$(jstr "$prompt")")")"
  assert_valid "$OUT" "$desc: valid, capped, ASCII"
  assert_never_blocks "$OUT" "$desc: NEVER blocked"
  assert_mode "$OUT" "$marker" "$desc: recognised as a control/authorization form"
  assert_ctx_has "$(ctx_of "$OUT")" "opens NO new engineering contract" "$desc: no contract opened"
done <<'FIXTURES'
procedi|"procedi"|control form recognised
continua|"continua"|control form recognised
sì|answer "si" (accented)|control form recognised
no|answer "no"|control form recognised
AUTORIZZO COMMIT AUTOMATIC ADVANCED ENGINEERING ORCHESTRATOR|authorization sentence|authorization form recognised
FIXTURES

echo
echo "=== 8 · informational question: answered, not turned into a contract ==="
OUT="$(run_hook "$(payload "$(jstr 'Quanti test unitari ci sono nella suite del prodotto?')")")"
assert_valid "$OUT" "informational question: valid, capped, ASCII"
assert_never_blocks "$OUT" "informational question: never blocks"
assert_ctx_has "$(ctx_of "$OUT")" "read-only or informational" "informational carve-out is injected"

echo
echo "=== 9-10 · multi-line prompt and special characters ==="
OUT="$(run_hook "$(payload "$(jstr 'Rivedi la chat.
Poi il backend.
Poi la WebUI.')")")"
assert_valid "$OUT" "multi-line prompt: valid, capped, ASCII"
assert_never_blocks "$OUT" "multi-line prompt: never blocks"
assert_mode "$OUT" "multi-line prompt, not a control form" "multi-line is never a control form"

SPECIAL='"quotes" \backslash\ $VAR `cmd` ${x} ;|&<>*?[]{}!#% ünïcödé 日本語 <script>alert(1)</script>'
OUT="$(run_hook "$(payload "$(jstr "$SPECIAL")")")"
assert_valid "$OUT" "special characters: valid, capped, ASCII"
assert_never_blocks "$OUT" "special characters: never blocks"
assert_ctx_lacks "$(ctx_of "$OUT")" "alert(1)" "no byte of the prompt is echoed back"
assert_ctx_lacks "$(ctx_of "$OUT")" "backslash" "no byte of the prompt is echoed back (2)"

echo
echo "=== 11-12 · malformed JSON and empty input degrade explicitly, never silently ==="
OUT="$(printf '%s' '{"prompt": "unterminated' | "$HOOK" 2>/dev/null)"
assert_valid "$OUT" "malformed JSON: still emits valid, capped output"
assert_never_blocks "$OUT" "malformed JSON: never blocks"
assert_mode "$OUT" "not valid JSON" "malformed JSON: degradation is DECLARED"

OUT="$(printf '' | "$HOOK" 2>/dev/null)"
assert_valid "$OUT" "empty input: still emits valid, capped output"
assert_never_blocks "$OUT" "empty input: never blocks"
assert_mode "$OUT" "empty hook payload" "empty input: degradation is DECLARED"

OUT="$(run_hook '{"session_id":"x","hook_event_name":"UserPromptSubmit"}')"
assert_valid "$OUT" "payload with no .prompt: still emits valid output"
assert_mode "$OUT" "carried no prompt" "missing prompt: degradation is DECLARED"

echo
echo "=== 13-15 · startup / resume / compact reinjection via SessionStart ==="
for src in startup resume compact; do
  # NOESAR_GUARD_BASELINE_DIR is pinned to this run's scratch dir, or SessionStart writes a
  # fixture baseline into the REAL runtime directory — test litter landing in the very
  # directory that holds the trust anchors. Found 2026-08-11 by inspecting that directory
  # after a run: three fixture-* baselines were sitting in it.
  OUT="$(printf '{"session_id":"fixture-%s","source":"%s"}' "$src" "$src" \
         | NOESAR_GUARD_BASELINE_DIR="$TMPDIR/baselines" "$SESSION_CONTEXT" 2>/dev/null)"
  CTX="$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)"
  if printf '%s' "$CTX" | grep -qF "Automatic Advanced Engineering Orchestrator is ACTIVE"; then
    ok "SessionStart source=$src reinjects the orchestrator rule"
  else
    bad "SessionStart source=$src reinjects the orchestrator rule" "context was: $(printf '%s' "$CTX" | head -c 200)"
  fi
  # The digest's own 6144-byte cap must still hold with the added block.
  B="$(printf '%s' "$CTX" | wc -c | tr -d ' ')"
  if [ "$B" -le 6144 ]; then ok "SessionStart source=$src stays within its 6144-byte cap ($B bytes)"
  else bad "SessionStart source=$src stays within its 6144-byte cap" "$B bytes"; fi
  # The digest applies a defensive credential-shaped line filter; a dropped line would
  # silently delete the reminder. Proving the block SURVIVES that filter is the point.
  if printf '%s' "$CTX" | grep -qF "engineering-depth/SKILL.md"; then
    ok "SessionStart source=$src: the reminder survives the digest's defensive line filter"
  else
    bad "SessionStart source=$src: the reminder survives the digest's defensive line filter"
  fi
  rm -f "/tmp/noesar-evolution-container-baseline-fixture-${src}.json" 2>/dev/null
done

echo
echo "=== 16 · the 2048-byte cap is mechanical, not intentional ==="
LONG="$(head -c 20000 /dev/zero | tr '\0' 'a')"
OUT="$(run_hook "$(payload "$(jstr "$LONG")")")"
assert_valid "$OUT" "20 KB prompt: output still within the cap"
assert_ctx_lacks "$(ctx_of "$OUT")" "aaaaaaaaaa" "20 KB prompt: no prompt content reaches the context"
OUT="$(NOESAR_ORCHESTRATOR_MAX_BYTES=120 run_hook "$(payload "$(jstr 'rifai la chat')")")"
B="$(ctx_of "$OUT" | wc -c | tr -d ' ')"
if [ "$B" -le 121 ]; then ok "the cap actually truncates when lowered to 120 ($B bytes) — it is enforced, not assumed"
else bad "the cap actually truncates when lowered to 120" "$B bytes"; fi

echo
echo "=== 17 · no credential-shaped value is stored, echoed or persisted ==="
# The canary is ASSEMBLED AT RUNTIME from fragments, deliberately. A literal
# credential-shaped string in a tracked file is a hit in every future secret scan of this
# repository, and "it is only a fixture" is an exemption somebody has to re-argue every
# single time — CLAUDE10.md rule 25 admits no test-fixture exception, and rule 40b warns
# that a dismissal you have to keep repeating is how real findings get waved through.
#
# The test is NOT weakened. What reaches the hook still carries provider-key, password and
# bearer SHAPE, and the assertion immediately below PROVES it does — so this can never
# silently degrade into a harmless string that makes the non-echo checks prove nothing.
# Only the bytes on disk are clean.
K='k'; W='word'; R='er'
# The marker is made UNIQUE PER RUN, not fixed. With a constant marker the `grep -rlF … /tmp`
# below matched this very file whenever a copy of it happened to live under /tmp — a CI job
# checking out into /tmp, or anyone inspecting the suite from a scratch directory — and
# reported the hook as having written the prompt to disk. It never had. A per-run suffix
# means only a file created DURING this run can possibly carry it, which is the thing the
# check was always trying to prove. (Found 2026-08-11 by exactly that false positive.)
MARK="NOESAR-CANARY-DO-NOT-ECHO-A1B2C3-$$-$(date +%s%N 2>/dev/null || echo 0)"
CANARY="s${K}-ant-api03-${MARK}-0000000000 pass${W}=hunt${R}2 Bear${R} ${MARK}-bearer-part"
if printf '%s' "$CANARY" | grep -qE "s${K}-ant-api03-[A-Za-z0-9-]{8,}" \
   && printf '%s' "$CANARY" | grep -qE "pass${W}=[A-Za-z0-9]{4,}" \
   && printf '%s' "$CANARY" | grep -qE "Bear${R} [A-Za-z0-9-]{8,}"; then
  ok "the assembled canary really carries provider-key, password and bearer shape"
else
  bad "the assembled canary really carries provider-key, password and bearer shape" \
      "it degraded into a harmless string — the non-echo checks below would prove nothing"
fi
OUT="$(run_hook "$(payload "$(jstr "$CANARY")")")"
assert_ctx_lacks "$OUT" "$MARK" "canary marker absent from the whole hook output"
assert_ctx_lacks "$OUT" "hunt${R}2" "canary password value absent from the whole hook output"
if grep -rlF "$MARK" /tmp 2>/dev/null | head -1 | grep -q .; then
  bad "the hook wrote no file containing the prompt" "a /tmp file contains the canary"
else
  ok "the hook wrote no file containing the prompt"
fi
# A crude `grep '>'` is not a file-write detector: it fires on `>/dev/null`, on `2>&1` and
# on the `->` arrows inside the injected text. This strips those three forms first, then
# asserts that no redirection to an actual path survives, alongside the obvious writers.
HOOK_STRIPPED="$(sed -e 's/2>&1//g' -e 's/[0-9]*>[[:space:]]*\/dev\/null//g' -e 's/->//g' "$HOOK")"
WRITERS="$(printf '%s' "$HOOK_STRIPPED" | grep -nE '>>|>|[^a-z_](tee|mktemp|touch|dd|cp|mv|install)[[:space:]]' || true)"
if [ -n "$WRITERS" ]; then
  bad "the hook contains no file-writing construct" "$(printf '%s' "$WRITERS" | head -3)"
else
  ok "the hook contains no file-writing construct (no redirection to a path, no tee/mktemp/touch/dd/cp/mv)"
fi
if grep -qE '\b(curl|wget|nc|ssh|python|node)\b' "$HOOK"; then
  bad "the hook makes no network or interpreter call"
else
  ok "the hook makes no network or interpreter call (no curl/wget/nc/ssh/python/node)"
fi

echo
echo "=== 18 · compatibility with the hooks already installed ==="
if jq -e '.hooks.UserPromptSubmit[0].hooks[0].command | endswith("engineering-orchestrator.sh")' "$SETTINGS" >/dev/null 2>&1; then
  ok "settings.json registers the UserPromptSubmit hook"
else
  bad "settings.json registers the UserPromptSubmit hook"
fi
for ev in SessionStart Stop PreToolUse; do
  if jq -e --arg e "$ev" '.hooks[$e] | length > 0' "$SETTINGS" >/dev/null 2>&1; then
    ok "pre-existing $ev hook still registered in settings.json"
  else
    bad "pre-existing $ev hook still registered in settings.json"
  fi
done
if jq empty "$SETTINGS" >/dev/null 2>&1; then ok "settings.json is valid JSON"; else bad "settings.json is valid JSON"; fi

echo
echo "=== 19 · no regression in the destructive-command guard ==="
D1="$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"rm -rf /mnt/cachec/NOESAR_EVOLUTION/docs"}}' | "$GUARD" 2>/dev/null)"
if printf '%s' "$D1" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then
  ok "destructive-command-guard still denies rm -rf"; else bad "destructive-command-guard still denies rm -rf" "$D1"; fi
D2="$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | "$GUARD" 2>/dev/null)"
if printf '%s' "$D2" | jq -e 'has("hookSpecificOutput") | not' >/dev/null 2>&1; then
  ok "destructive-command-guard still allows a plain read command"; else bad "destructive-command-guard still allows a plain read command" "$D2"; fi
D3="$(printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"/mnt/cachec/ATOM_EVOLUTION/x.rs"}}' | "$GUARD" 2>/dev/null)"
if printf '%s' "$D3" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then
  ok "destructive-command-guard still denies writes into ATOM_EVOLUTION"; else bad "destructive-command-guard still denies writes into ATOM_EVOLUTION" "$D3"; fi
D4="$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"docker system prune -af"}}' | "$GUARD" 2>/dev/null)"
if printf '%s' "$D4" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then
  ok "destructive-command-guard still denies docker system prune"; else bad "destructive-command-guard still denies docker system prune" "$D4"; fi

echo
echo "=== 20 · the run leaves no temporary resource behind ==="
BEFORE="$(ls -1 "$TMPDIR" 2>/dev/null | wc -l | tr -d ' ')"
run_hook "$(payload "$(jstr 'una richiesta qualunque')")" >/dev/null
AFTER="$(ls -1 "$TMPDIR" 2>/dev/null | wc -l | tr -d ' ')"
if [ "$BEFORE" = "$AFTER" ]; then ok "no temporary file created by a hook run ($BEFORE before, $AFTER after)"
else bad "no temporary file created by a hook run" "$BEFORE -> $AFTER"; fi
if ls /tmp/noesar-orchestrator-* >/dev/null 2>&1 && [ "$(ls -1d /tmp/noesar-orchestrator-* | grep -vcF "$TMPDIR")" != "0" ]; then
  bad "no stray /tmp/noesar-orchestrator-* directory survives outside this run's own TMPDIR"
else
  ok "no stray /tmp/noesar-orchestrator-* directory survives outside this run's own TMPDIR"
fi

echo
echo "=== extra · the classifier's boundaries, in both directions ==="
# A control word is only a control word when it is the WHOLE message.
OUT="$(run_hook "$(payload "$(jstr 'no, rifai completamente la sezione Chat')")")"
assert_mode "$OUT" "no bare control form recognised" "'no, rifai...' is a request, not the word 'no'"
OUT="$(run_hook "$(payload "$(jstr 'continua a leggere il file e dimmi cosa manca alla WebUI della memoria')")")"
assert_mode "$OUT" "no bare control form recognised" "a long sentence starting with 'continua' is not a control word"
OUT="$(run_hook "$(payload "$(jstr '  PROCEDI.  ')")")"
assert_mode "$OUT" "control form recognised" "control matching survives case, padding and punctuation"
OUT="$(run_hook "$(payload "$(jstr 'ok')")")"
assert_mode "$OUT" "control form recognised" "'ok' is a control form"

echo
echo "=== 21 · F-HOOK-001 · the guard decides from operands, not from substrings ==="
# Before this repair every Bash check was a substring match over the whole command string:
# a command was denied when a dangerous word appeared anywhere in it and a dangerous shape
# appeared anywhere else, related or not. Measured twice in one session: `jq -r '… | .key'`
# was denied as "reads a key-shaped path". The two directions below are equally important —
# the false positives must stop, and NOT ONE true positive may become a silent allow.

# guard_decision CMD -> allow | deny | ask     (tool_name defaults to Bash)
guard_decision() {
  local tool="${2:-Bash}" out
  if [ "$tool" = "Bash" ]; then
    out="$(jq -n --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c}}' | "$GUARD" 2>/dev/null)"
  else
    out="$(jq -n --arg t "$tool" --arg p "$1" '{tool_name:$t,tool_input:{file_path:$p}}' | "$GUARD" 2>/dev/null)"
  fi
  printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null
}
assert_decision() { # $1=cmd $2=want $3=desc [$4=tool]
  local got; got="$(guard_decision "$1" "${4:-Bash}")"
  if [ "$got" = "$2" ]; then ok "$3"; else bad "$3" "wanted $2, got $got — for: $1"; fi
}

# --- direction 1: a sensitive path as a real operand of a real reader still DENIES ---
assert_decision 'cat .env'                          deny  "a dotenv file as cat's operand is denied"
assert_decision 'head -5 config/secrets/db.txt'     deny  "a path under secrets/ is denied"
assert_decision 'cp ~/.ssh/id_rsa /tmp/x'           deny  "copying a private key is denied"
assert_decision 'sudo cat .env'                     deny  "a wrapper (sudo) does not hide the reader"
assert_decision 'FOO=1 cat .env'                    deny  "an env-assignment prefix does not hide the reader"
assert_decision 'cat < .env'                        deny  "a redirection operand is still an operand"
assert_decision 'echo hi && cat .env'               deny  "the check reaches the second segment"
assert_decision 'rm -rf /tmp/foo'                   deny  "rm -rf is still denied"
# Inside PROJECT_ROOT on purpose: the outside-root rule must not be what denies this, or the
# case would prove nothing about the flags. The pre-repair regex required both letters in one
# token, so it read this as a plain rm and allowed it.
assert_decision 'rm -r -f /mnt/cachec/NOESAR_EVOLUTION/BUILD_TMP' deny \
  "rm -r -f (split flags, inside the root) is denied on the flag SET"
assert_decision 'rm /etc/hosts'                     deny  "rm outside PROJECT_ROOT is still denied"
assert_decision 'docker compose down -v'            deny  "docker compose down -v is still denied"
assert_decision 'git push -f origin main'           deny  "git push -f is still denied"
assert_decision 'cd /mnt/cachec/ATOM_EVOLUTION && git commit -m x' deny \
  "the ATOM repo is named in one segment and mutated in another — still denied"

# --- direction 2: the same words, not as operands, are no longer denied ---
# The pipeline is the point: the reader word (`head`) and the `.key` text were in DIFFERENT
# commands, and the old whole-string match ANDed them together. This is the exact shape that
# was denied twice in one session while inspecting a container baseline.
assert_decision "jq -r '.[] | .key' f.json | head -3" allow "a jq accessor named .key is not a key-shaped path"
assert_decision "grep -n 'rm -rf' docs/NOTES.md"    allow "searching the documentation for 'rm -rf' is not an rm"
assert_decision "grep -rn 'docker system prune' docs/" allow "searching for a forbidden command is not running it"
assert_decision "grep -n 'git push --force' CLAUDE10.md" allow "quoting a force-push in a grep pattern is not a push"

# --- direction 3: the residual fuzzy signal ASKS — it never silently allows ---
assert_decision 'ls -l secrets/'                    ask   "a sensitive path under an unclassified verb asks the Owner"
assert_decision 'V=.env; wc -l $V'                  ask   "a sensitive path held in an assignment asks the Owner"
# The pre-repair guard denied the two above by accident of substring matching. Downgrading
# them to a question is deliberate; downgrading them to silence would not be.

echo
echo "=== 22 · F-ATOM-001 · a redirection that writes NO file is not a mutation ==="
# Found live on 2026-08-11, during the commit pass that followed D-0386. The ATOM tier
# marked a segment mutating on `grep -qE '>{1,2}'` — ANY '>' anywhere. So a read-only
# inspection of the separate ATOM repository was denied for carrying `2>&1`:
#
#   git -C /mnt/cachec/ATOM_EVOLUTION status --porcelain 2>&1 | head -3   -> DENIED
#
# `2>&1` duplicates a file descriptor and `2>/dev/null` discards; neither can modify a
# byte of ATOM. This is the same class as F-HOOK-001 — a shape matched without asking what
# it actually does — surviving at the one tier D-0382 did not re-derive from operands.
#
# Both directions are asserted. The false positives must stop, and every redirection that
# really does write a file must still DENY.
ATOM=/mnt/cachec/ATOM_EVOLUTION

# --- direction 1: read-only inspection of ATOM is allowed again ---
assert_decision "git -C $ATOM status --porcelain 2>&1 | head -3" allow \
  "the exact command denied live: 2>&1 is an fd dup, not a write"
assert_decision "ls -d $ATOM 2>/dev/null"                        allow \
  "2>/dev/null discards stderr — it writes nothing into ATOM"
assert_decision "git -C $ATOM log --oneline -1 2>/dev/null"      allow \
  "reading ATOM's log with stderr discarded is not a mutation"
assert_decision "cat $ATOM/README.md >&2"                        allow \
  ">&2 duplicates a descriptor — no file is opened for writing"
assert_decision "git -C $ATOM status >/dev/null 2>&1"            allow \
  "both streams discarded at once is still no file write"
assert_decision "echo 'SessionStart -> Stop' && ls $ATOM"        allow \
  "an arrow in prose is not a redirection operator"

# --- direction 2: NOT ONE true positive may become a silent allow ---
assert_decision "echo x > $ATOM/f.txt"                           deny \
  "writing a file inside ATOM is still denied"
assert_decision "echo x >> $ATOM/f.txt"                          deny \
  "appending to a file inside ATOM is still denied"
assert_decision "cat foo 2> $ATOM/err.log"                       deny \
  "stderr sent to a REAL file is a write — still denied"
assert_decision "rm $ATOM/x"                                     deny \
  "removing a file in ATOM is still denied"
assert_decision "sed -i s/a/b/ $ATOM/x"                          deny \
  "an in-place edit of an ATOM file is still denied"
assert_decision "mv a $ATOM/b"                                   deny \
  "moving a file into ATOM is still denied"
assert_decision "cd $ATOM && git push"                           deny \
  "pushing the ATOM repository is still denied"

# --- direction 3: write paths the verb list never covered (found by the D-0387 differential) ---
# Building the redirection fix meant running old and new guards over the same ATOM matrix.
# That differential also showed six commands that MUTATE ATOM and were allowed by BOTH —
# a pre-existing gap, invisible because the '>' rule was catching the common cases by
# accident. Fixing the instance without fixing the verb list would have left it open.
assert_decision "tee $ATOM/x"                                    deny \
  "tee writes its operand — denied inside ATOM"
assert_decision "touch $ATOM/x"                                  deny \
  "touch creates or restamps a file — denied inside ATOM"
assert_decision "ln -s /etc/passwd $ATOM/x"                      deny \
  "a symlink planted inside ATOM is a mutation"
assert_decision "chmod 777 $ATOM/x"                              deny \
  "changing a mode inside ATOM is a mutation"
assert_decision "install -m0644 a $ATOM/x"                       deny \
  "install copies a file into place — denied inside ATOM"
assert_decision "patch -p1 -d $ATOM"                             deny \
  "patch rewrites files in the directory it is pointed at"
# The reads must stay reads: widening the verb list must not deny inspection.
assert_decision "git -C $ATOM log --oneline"                     allow \
  "reading ATOM's log is still allowed after the verb list widened"
assert_decision "tail -20 $ATOM/README.md"                       allow \
  "reading a file in ATOM is still allowed"
assert_decision "ls -la $ATOM"                                   allow \
  "listing ATOM is still allowed"

echo
echo "================================================================"
echo "engineering-orchestrator fixture tests: $PASS passed, $FAIL failed"
echo "================================================================"
[ "$FAIL" -eq 0 ]
