#!/usr/bin/env bash
# NOESAR EVOLUTION — PreToolUse hook (matcher: Bash|Read|Grep|Write|Edit).
#
# Denies specific, named-dangerous classes of tool calls. This is a pattern-match guard,
# not a general static analyser: it catches the literal command/path shapes named below
# and declares that scope rather than implying broader coverage. All decisions are made
# from fields extracted with `jq`, never from a raw grep over the whole stdin JSON blob
# (JSON escaping would make that unreliable in both directions).
#
# Fails OPEN on any internal error (missing jq, unparseable input): a broken guard must
# not silently deny everything, and must not silently allow everything without saying so.
#
# OPERAND SCOPING (F-HOOK-001, fixed 2026-08-11, D-0382).
# Every Bash check used to be a substring match over the WHOLE command string: a command
# was denied when a dangerous word appeared anywhere in it and a dangerous shape appeared
# anywhere else in it, regardless of whether the two had anything to do with each other.
# Mentioning a path inside a jq filter, a grep pattern, a quoted string or a comment was
# enough. Measured twice in one session: `jq -r '... | .key' file` was denied as "reads a
# key-shaped path", and so was a jq program containing the word "secret". A guard that
# cries wolf on read-only inspection is a guard people learn to work around.
#
# The repair keeps the patterns and the reader list byte-identical and changes only the
# SUBJECT they are matched against: the parsed operands of one simple command, never the
# raw string. The command is split into segments on `; & | && ||`, each segment's command
# word is resolved past env-assignments and wrappers (sudo/env/nohup/…), and only that
# segment's own operands are tested.
#
# Two tiers, so that no case moves from "deny" to "silent allow":
#   DENY  a sensitive path is an operand of a reading command — the real, precise case.
#   ASK   a sensitive path-shaped token appears somewhere else in the command. This is the
#         residual of the old fuzzy rule; the Owner decides instead of the hook guessing.
#
# The reader list is deliberately NOT extended to grep/sed/awk. Their first operand is a
# PATTERN, not a path, so `grep -qE 'secrets/' f` would deny — which is precisely the bug
# being fixed here. Extending coverage to those tools needs per-tool operand knowledge.
#
# QUOTE-AWARE SEGMENTATION (F-HOOK-006, fixed 2026-08-17).
# Segments were split with `sed 's/[;&|]/\n/g'` over the raw string, which split INSIDE quotes
# too. Measured live this session, on a read-only inspection:
#   grep -nE "RETAIN\|rm -rf" tools/run-browser-e2e.sh   -> DENIED as "rm -rf"
# The `\|` inside the quoted regex became a segment boundary, and the text after it — `rm -rf`
# — became a command word with flags. This is F-HOOK-001's class surviving one layer below the
# operand scoping that fixed it: the operands were parsed correctly, out of segments that were
# wrong. Separators are now masked while inside `'…'` or `"…"` and restored afterwards, so no
# operand changes by a byte. Declared limit, and it is fail-safe: on unbalanced quotes the line
# is left exactly as it was, so an ambiguous command still splits everywhere and still denies.
#
# RULE 12 EXCEPTIONS COME FROM ONE SOURCE (D-0511).
# `CLAUDE10.md` §4 rule 12 forbids deletion and names its exceptions in prose; this guard
# enforces it. The two drifted: the rule gained a third named exception (the e2e probe's own
# run directories, OUTSIDE `PROJECT_ROOT`) that the guard had never heard of, so the guard
# denied — with a reason that stated a rule the authority no longer states flatly — what the
# authority permits. Hand-copying the list here would only reproduce the drift, so both read
# `lib/rule12-exceptions.json`, and `test/test-rule12-exceptions.sh` fails when the file and
# `CLAUDE10.md` stop agreeing. This guard never widens the authority: an unreadable source
# means NO exception is recognised — the strictest reading — and it is declared in the reason.
#
# DECLARED LIMIT, unchanged by this repair: obfuscation defeats it, and always did.
# `cat $(echo .env)` hides the literal from any pattern match. This hook is a safety net
# against ACCIDENT, not an adversarial sandbox, and it has never claimed otherwise.
set -u

PROJECT_ROOT="/mnt/cachec/NOESAR_EVOLUTION"
ATOM_ROOT="/mnt/cachec/ATOM_EVOLUTION"
# Overridable so the test can drive the missing/garbled-source paths without moving the real one.
RULE12_SOURCE="${NOESAR_RULE12_SOURCE:-$PROJECT_ROOT/.claude/hooks/lib/rule12-exceptions.json}"

# The sensitive-path patterns. IDENTICAL to the pre-repair version — only the subject
# changed, from the whole command string to a single parsed operand.
SENSITIVE_RE='(\.env($|[^A-Za-z])|secrets/|credentials/|\.key($|[^A-Za-z])|\.pem($|[^A-Za-z])|id_rsa|provenance-signing\.key)'
# Commands whose operands are file paths. See the header for why grep/sed/awk are not in it.
# `echo` and `printf` were in the pre-repair list and are deliberately NOT here: they read
# no file, so with operand scoping their only effect was to deny prose that happens to name
# a path (`echo "see secrets/README"`). They now reach the ASK tier instead of the DENY tier
# — a declared deny->ask move, never a deny->silent-allow one.
READERS_RE='^(cat|less|more|head|tail|strings|xxd|od|cp|curl|wget)$'
REMOVERS_RE='^(rm|rmdir|shred|unlink)$'
WRAPPERS_RE='^(sudo|doas|env|nohup|time|command|builtin|xargs|stdbuf|ionice|nice)$'

deny() {
  # $1 = human-readable reason
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r},systemMessage:("destructive-command-guard DENIED: " + $r)}'
  exit 0
}

ask() {
  # $1 = human-readable reason. Used only where the pre-repair guard would have denied on a
  # fuzzy whole-string match: the Owner decides rather than the hook guessing wrong.
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r},systemMessage:("destructive-command-guard ASKS: " + $r)}'
  exit 0
}

allow_silent() {
  printf '{}\n'
  exit 0
}

if ! command -v jq >/dev/null 2>&1; then
  # Cannot parse input safely — do not pretend to have checked anything.
  printf '{"systemMessage":"destructive-command-guard: jq unavailable, guard skipped (no opinion, not a pass)."}\n'
  exit 0
fi

INPUT="$(cat 2>/dev/null || true)"
[ -z "$INPUT" ] && allow_silent

TOOL_NAME="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)"
[ -z "$TOOL_NAME" ] && allow_silent

# --- operand parsing helpers -------------------------------------------------------------

# Strip one layer of surrounding quotes, and any leading redirection punctuation, so that
# `<file`, `>"file"` and `'file'` all reduce to `file`.
strip_token() {
  local t="$1"
  t="${t#[<>]}"
  t="${t#[<>]}"
  case "$t" in
    \"*\") t="${t#\"}"; t="${t%\"}" ;;
    \'*\') t="${t#\'}"; t="${t%\'}" ;;
  esac
  printf '%s' "$t"
}

# True when a token could be a filesystem operand rather than a fragment of a program.
# Excluding brackets, parentheses, quotes, commas and semicolons is what keeps a jq filter
# (`to_entries[]`, `.key)`, `select($p;"i")`) from being mistaken for a path — the whole
# point of F-HOOK-001. Paths using a variable (`$ROOT/secrets/x`) stay in scope.
is_path_shaped() {
  printf '%s' "$1" | grep -qE '^[A-Za-z0-9_./~*?@:+={}$-]+$'
}

is_sensitive_operand() {
  local t
  t="$(strip_token "$1")"
  case "$t" in
    ''|-) return 1 ;;
    --*=*) t="${t#*=}" ;;
    -*) return 1 ;;
  esac
  is_path_shaped "$t" || return 1
  printf '%s' "$t" | grep -qE "$SENSITIVE_RE"
}

# Mask `; & |` that sit INSIDE quotes, so they cannot become segment boundaries. Operands are
# preserved byte for byte — only the separators move out of the way, and are restored per
# segment after the split. A line whose quotes do not balance is emitted UNCHANGED: it then
# splits everywhere, exactly as before this repair, which is the safe direction. (F-HOOK-006)
mask_quoted_separators() {
  awk '{
    out = ""; q = ""; n = length($0)
    for (i = 1; i <= n; i++) {
      c = substr($0, i, 1)
      if (q == "") {
        if (c == "\047" || c == "\"") { q = c }
        out = out c
      } else if (c == q) {
        q = ""; out = out c
      } else if (c == ";") { out = out "\001"
      } else if (c == "&") { out = out "\002"
      } else if (c == "|") { out = out "\003"
      } else { out = out c }
    }
    if (q != "") { print $0 } else { print out }
  }'
}

# --- rule 12 exceptions, read from the single source ------------------------------------------
# RULE12_SOURCE_OK=false means "no exception is recognised": the guard falls back to the
# strictest reading and says so, rather than inventing a permission or hiding a gap.
RULE12_SOURCE_OK=false
[ -r "$RULE12_SOURCE" ] && jq -e '.exceptions | type == "array"' "$RULE12_SOURCE" >/dev/null 2>&1 \
  && RULE12_SOURCE_OK=true

RULE12_ID=""
RULE12_MECHANISM=""
RULE12_RECOVERABLE=""

# rule12_match <absolute path>
# True when CLAUDE10.md rule 12, as recorded in the single source, names this path as removable.
# It matches a run directory UNDER an exception root, never the root itself: removing the whole
# artifact root is not what any exception authorises. `..` anywhere is never a match.
rule12_match() {
  RULE12_ID=""; RULE12_MECHANISM=""; RULE12_RECOVERABLE=""
  [ "$RULE12_SOURCE_OK" = true ] || return 1

  local target="$1"
  case "$target" in
    *..*) return 1 ;;
  esac
  while [ "${target}" != "/" ] && [ "${target%/}" != "${target}" ]; do target="${target%/}"; done

  local id envname default suffix pattern mech recov root child
  while IFS=$'\t' read -r id envname default suffix pattern mech recov; do
    [ -n "$id" ] || continue
    root="$default"
    if [ -n "$envname" ]; then
      local from_env
      from_env="$(printenv "$envname" 2>/dev/null || true)"
      [ -n "$from_env" ] && root="$from_env"
    fi
    root="${root}${suffix}"
    while [ "${root}" != "/" ] && [ "${root%/}" != "${root}" ]; do root="${root%/}"; done

    case "$target" in
      "$root"/*) child="${target#"$root"/}" ;;
      *) continue ;;
    esac

    if [ -n "$pattern" ]; then
      # Exactly one level below the root, and the name must match the authority's pattern.
      case "$child" in */*) continue ;; esac
      printf '%s' "$child" | grep -qE "$pattern" || continue
    fi

    RULE12_ID="$id"; RULE12_MECHANISM="$mech"; RULE12_RECOVERABLE="$recov"
    return 0
  done <<< "$(jq -r '
    .exceptions[] as $e
    | $e.filesystem_roots[]?
    | [ $e.id, (.env // ""), (.default // ""), (.suffix // ""), (.child_pattern // ""),
        ($e.mechanism.summary // "no mechanism recorded"),
        (if $e.recoverable then "recoverable" else "IRREVERSIBLE" end) ]
    | @tsv' "$RULE12_SOURCE" 2>/dev/null)"

  return 1
}

# What to append to a denial when the guard could not read the authority it enforces.
rule12_note() {
  [ "$RULE12_SOURCE_OK" = true ] && return 0
  printf ' [rule 12 exception source unreadable (%s): strictest reading applied, no exception recognised]' "$RULE12_SOURCE"
}

case "$TOOL_NAME" in

Bash)
  CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
  [ -z "$CMD" ] && allow_silent

  ASK_REASON=""
  RULE12_ASK_REASON=""
  CMD_NAMES_ATOM=false
  if printf '%s' "$CMD" | grep -qF "$ATOM_ROOT" || printf '%s' "$CMD" | grep -qE '(^|[^A-Za-z0-9_])ATOM_EVOLUTION([^A-Za-z0-9_]|$)'; then
    CMD_NAMES_ATOM=true
  fi

  # Does this command open a FILE for writing? (F-ATOM-001, D-0387.)
  # The ATOM tier used to mark a segment mutating on `grep -qE '>{1,2}'` — any '>' at all.
  # So a read-only inspection of the separate repository was denied for carrying `2>&1`:
  #   git -C /mnt/cachec/ATOM_EVOLUTION status --porcelain 2>&1 | head -3   -> DENIED
  # `2>&1` duplicates a descriptor and `2>/dev/null` discards; neither can modify a byte.
  # This is F-HOOK-001's mistake surviving at the one tier D-0382 did not re-derive from
  # operands: a SHAPE was matched without asking what it does.
  #
  # The probe erases exactly the three forms that write no file — fd duplication, the
  # null/std device sinks, and arrows in prose — and then asks whether any '>' is left.
  # Everything else still counts, including `2> real.log`: stderr sent to a real file IS a
  # write. Whole-command rather than per-segment, deliberately, matching how the repository
  # name is already recognised: `cd ATOM && cmd > f` puts the two in different segments.
  CMD_WRITES_FILE=false
  if printf '%s' "$CMD" \
       | sed -E 's/[0-9]*>&[0-9-]+//g' \
       | sed -E 's/[0-9]*&?>>?[[:space:]]*\/dev\/(null|stdout|stderr|fd\/[0-9]+)//g' \
       | sed -E 's/[-=]>|>=//g' \
       | grep -q '>'; then
    CMD_WRITES_FILE=true
  fi

  # Split into simple-command segments. `&&` and `||` collapse into empty segments, which
  # are skipped. Redirections are NOT separators: `cat x > y` stays one segment.
  while IFS= read -r SEG; do
    # Restore the separators that were masked inside quotes (F-HOOK-006): the operands the
    # checks below see are byte-identical to what the Owner typed.
    SEG="$(printf '%s' "$SEG" | tr '\001\002\003' ';&|')"
    [ -z "${SEG//[[:space:]]/}" ] && continue

    CMDWORD=""
    OPERANDS=""
    FLAGS=""
    while IFS= read -r TOK; do
      [ -z "$TOK" ] && continue
      if [ -z "$CMDWORD" ]; then
        # env-assignment prefix (`FOO=bar cmd …`) and wrappers (`sudo cmd …`) are not the
        # command word. Skipping them is what stops `sudo cat .env` from evading the check.
        case "$TOK" in
          [A-Za-z_]*=*) continue ;;
        esac
        BASE="${TOK##*/}"
        BASE="$(strip_token "$BASE")"
        printf '%s' "$BASE" | grep -qE "$WRAPPERS_RE" && continue
        CMDWORD="$BASE"
        continue
      fi
      case "$TOK" in
        -*) FLAGS="$FLAGS $TOK" ;;
      esac
      OPERANDS="$OPERANDS
$TOK"
    done <<< "$(printf '%s' "$SEG" | tr ' \t' '\n')"

    [ -z "$CMDWORD" ] && continue

    # --- find that removes (F-HOOK-009, found 2026-08-24) -------------------------------------
    # `find <path> -exec rm -rf {} +` and `find <path> -delete` remove exactly what `rm -rf`
    # removes, and this guard saw neither: it judges the COMMAND WORD, and the command word was
    # `find` — `rm` was merely an operand. Measured the day it was found, during D-0680: 89 GB
    # outside PROJECT_ROOT was removed through this hook without a single check firing, by a
    # command written for no reason other than that a 296k-entry glob overflows ARG_MAX.
    # `xargs` never had the gap — it is in WRAPPERS_RE, so `xargs rm -rf` already resolves to rm.
    # The command word is not the act. Normalise the act, then let the checks below judge it
    # against the path operands they have already collected.
    if [ "$CMDWORD" = "find" ]; then
      FIND_ACTION=""; SEEN_EXEC=0
      while IFS= read -r TOK; do
        [ -z "$TOK" ] && continue
        T="$(strip_token "$TOK")"
        case "$T" in
          -exec|-execdir|-ok|-okdir) SEEN_EXEC=1; continue ;;
          # -delete is the removal itself, and it recurses and never prompts.
          -delete) FIND_ACTION="rm"; FLAGS="$FLAGS -r -f"; continue ;;
        esac
        # Only a word in the -exec position counts. `find . -name rm` names a file and removes
        # nothing; treating it as a removal would deny a search, which is its own defect.
        if [ "$SEEN_EXEC" = "1" ] && printf '%s' "${T##*/}" | grep -qE "$REMOVERS_RE"; then
          FIND_ACTION="${T##*/}"
        fi
      done <<< "$OPERANDS"
      [ -n "$FIND_ACTION" ] && CMDWORD="$FIND_ACTION"
    fi

    # --- rm -rf and equivalent forms (flags of an actual rm, not the words in a string) ---
    if printf '%s' "$CMDWORD" | grep -qE "$REMOVERS_RE"; then
      # Does any operand fall inside a path rule 12 names as removable? Computed BEFORE the
      # flag check so a denial can name the exception and the one mechanism authorised to act,
      # instead of a generic message the reader has to go and reconstruct (D-0511).
      R12_PATH=""; R12_HIT_ID=""; R12_HIT_MECH=""; R12_HIT_RECOV=""
      while IFS= read -r OP; do
        [ -z "$OP" ] && continue
        OP="$(strip_token "$OP")"
        case "$OP" in /*) ;; *) continue ;; esac
        if rule12_match "$OP"; then
          R12_PATH="$OP"; R12_HIT_ID="$RULE12_ID"
          R12_HIT_MECH="$RULE12_MECHANISM"; R12_HIT_RECOV="$RULE12_RECOVERABLE"
          break
        fi
      done <<< "$OPERANDS"

      # Flags are judged as a SET, so the split form `rm -r -f x` is caught too. The
      # pre-repair regex required both letters inside one token and missed it.
      if printf '%s' "$FLAGS" | grep -qE '(^| )(-[a-zA-Z]*r[a-zA-Z]*|--recursive)' \
         && printf '%s' "$FLAGS" | grep -qE '(^| )(-[a-zA-Z]*f[a-zA-Z]*|--force)'; then
        # DENY either way — this is not a decision change, only a reason the reader can act on.
        if [ -n "$R12_HIT_ID" ]; then
          deny "recursive+force removal of $R12_PATH: CLAUDE10.md rule 12 exception $R12_HIT_ID ($R12_HIT_RECOV) does cover this path, but authorises removal ONLY through: $R12_HIT_MECH. An ad-hoc rm is not that mechanism. In: $CMD"
        fi
        deny "rm -rf (or an equivalent recursive+force form) in: $CMD"
      fi
      # --- deletions outside PROJECT_ROOT ---
      while IFS= read -r OP; do
        [ -z "$OP" ] && continue
        OP="$(strip_token "$OP")"
        case "$OP" in
          /*)
            case "$OP" in
              # The boundary is deliberate (F-HOOK-007, found 2026-08-17 driving this matrix).
              # `"$PROJECT_ROOT"*` is a bare string prefix, and this host has a SIBLING path
              # whose name begins with the root's: /mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS. Every
              # `rm` under it — 7.3 GB of e2e workspaces, outside the repository, outside git —
              # was read as "inside PROJECT_ROOT" and silently allowed. A prefix is not a path.
              "$PROJECT_ROOT"|"$PROJECT_ROOT"/*) ;;
              *)
                if rule12_match "$OP"; then
                  # The authority permits removal here, through a named mechanism only. Deferred
                  # to an ASK after the whole command is scanned, so a deny elsewhere still wins.
                  RULE12_ASK_REASON="rm targets $OP, which CLAUDE10.md rule 12 exception $RULE12_ID ($RULE12_RECOVERABLE) covers — but that exception authorises removal ONLY through: $RULE12_MECHANISM. An ad-hoc rm is not that mechanism, so the Owner decides, not this hook. In: $CMD"
                else
                  deny "rm targets a path outside PROJECT_ROOT ($OP) that no CLAUDE10.md rule 12 named exception covers, in: $CMD$(rule12_note)"
                fi
                ;;
            esac
            ;;
        esac
      done <<< "$OPERANDS"
    fi

    # --- docker system/volume prune, docker compose down -v ---
    case "$CMDWORD" in
      docker|docker-compose)
        if printf '%s' "$OPERANDS" | grep -qE '^(system|volume)$' && printf '%s' "$OPERANDS" | grep -qE '^prune$'; then
          deny "docker system/volume prune (host-wide, forbidden by CLAUDE10.md §5a) in: $CMD"
        fi
        if printf '%s' "$OPERANDS" | grep -qE '^down$' && printf '%s' "$OPERANDS" | grep -qE '^(-v|--volumes)$'; then
          deny "docker compose down -v (destroys volumes) in: $CMD"
        fi
        ;;
      git)
        if printf '%s' "$OPERANDS" | grep -qE '^push$' && printf '%s' "$OPERANDS" | grep -qE '^(--force|--force-with-lease|-f)$'; then
          deny "git push --force (or -f / --force-with-lease) in: $CMD"
        fi
        ;;
    esac

    # --- reading/printing .env, secrets, tokens, passwords, private keys ---
    if printf '%s' "$CMDWORD" | grep -qE "$READERS_RE"; then
      while IFS= read -r OP; do
        [ -z "$OP" ] && continue
        if is_sensitive_operand "$OP"; then
          deny "reads a .env/secrets/credentials/key-shaped path ($(strip_token "$OP")) in: $CMD"
        fi
      done <<< "$OPERANDS"
    fi

    # --- unauthorised mutation of the separate ATOM repository ---
    # The repository is named ONCE for the whole command and the mutating verb is judged
    # per segment, because the two are routinely in different segments:
    # `cd /mnt/cachec/ATOM_EVOLUTION && git commit -m x` names it in segment 1 and mutates
    # in segment 2. Scoping the name to the segment let exactly that form through.
    if [ "$CMD_NAMES_ATOM" = true ]; then
      MUTATES=false
      # Widened 2026-08-11 (D-0387). The differential that built the redirection fix showed
      # six commands that really do mutate ATOM and were allowed by the pre-repair guard too:
      # tee, touch, ln, chmod, install, patch. They were invisible because the blanket '>'
      # rule caught the COMMON write forms by accident, so nobody looked at the verb list.
      # Fixing only the redirection would have left the gap open and looked like a repair.
      case "$CMDWORD" in
        rm|rmdir|shred|unlink|mv|cp|dd|truncate) MUTATES=true ;;
        tee|touch|ln|chmod|chown|chgrp|install|patch|mkdir) MUTATES=true ;;
        tar|unzip|rsync) MUTATES=true ;;
        sed) printf '%s' "$FLAGS" | grep -qE '(^| )-i' && MUTATES=true ;;
        git) printf '%s' "$OPERANDS" | grep -qE '^(commit|push|add|reset|checkout|clean)$' && MUTATES=true ;;
      esac
      [ "$CMD_WRITES_FILE" = true ] && MUTATES=true
      if [ "$MUTATES" = true ]; then
        deny "mutating command targets /mnt/cachec/ATOM_EVOLUTION (separate repo, not authorised this session) in: $CMD"
      fi
    fi

  done <<< "$(printf '%s' "$CMD" | mask_quoted_separators | sed 's/[;&|]/\n/g')"

  # A path the authority DOES name as removable, reached by a form that is not the authorised
  # mechanism. The hook does not decide this one: it names the exception, its recoverability and
  # the only mechanism that may act, and the Owner decides. Asked before the fuzzy signal below
  # because it is the specific reason.
  [ -n "$RULE12_ASK_REASON" ] && ask "$RULE12_ASK_REASON"

  # --- residual fuzzy signal: a sensitive path that is NOT a reader's operand ---
  # The pre-repair guard hard-denied this whole class on a substring match. It now reaches
  # the Owner as a question instead of being decided wrongly by the hook. The scan covers
  # EVERY token, command words and env-assignments included, so `V=.env; wc -l $V` is seen:
  # scoping this to operands alone let the assignment form through silently.
  while IFS= read -r TOK; do
    [ -z "$TOK" ] && continue
    case "$TOK" in
      [A-Za-z_]*=*) TOK="${TOK#*=}" ;;
    esac
    if is_sensitive_operand "$TOK"; then
      ASK_REASON="a .env/secrets/credentials/key-shaped path ($(strip_token "$TOK")) appears in a command this guard cannot classify as a plain read: $CMD"
      break
    fi
  done <<< "$(printf '%s' "$CMD" | tr ' \t;&|' '\n')"

  [ -n "$ASK_REASON" ] && ask "$ASK_REASON"

  allow_silent
  ;;

Read|Grep)
  PATH_VAL="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)"
  [ -z "$PATH_VAL" ] && allow_silent
  if printf '%s' "$PATH_VAL" | grep -qE '(^|/)(\.env($|\.)|secrets/|credentials/|[A-Za-z0-9_.-]+\.key$|[A-Za-z0-9_.-]+\.pem$|id_rsa|provenance-signing\.key)'; then
    deny "$TOOL_NAME targets a .env/secrets/credentials/key-shaped path: $PATH_VAL"
  fi
  allow_silent
  ;;

Write|Edit)
  PATH_VAL="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
  [ -z "$PATH_VAL" ] && allow_silent
  case "$PATH_VAL" in
    # Same boundary as F-HOOK-007: `"$ATOM_ROOT"*` also claimed any sibling whose name merely
    # starts with it (`…/ATOM_EVOLUTION_NOTES/x`), which is a different path and not this repo's
    # to deny. The Bash tier still recognises the repository by name, so nothing is lost.
    "$ATOM_ROOT"|"$ATOM_ROOT"/*)
      deny "$TOOL_NAME targets /mnt/cachec/ATOM_EVOLUTION (separate repo, not authorised this session): $PATH_VAL"
      ;;
  esac
  if printf '%s' "$PATH_VAL" | grep -qE '(^|/)(\.env($|\.)|secrets/|credentials/|[A-Za-z0-9_.-]+\.key$|[A-Za-z0-9_.-]+\.pem$|id_rsa|provenance-signing\.key)'; then
    deny "$TOOL_NAME targets a .env/secrets/credentials/key-shaped path: $PATH_VAL"
  fi
  allow_silent
  ;;

*)
  allow_silent
  ;;
esac
