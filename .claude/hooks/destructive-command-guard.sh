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
# DECLARED LIMIT, unchanged by this repair: obfuscation defeats it, and always did.
# `cat $(echo .env)` hides the literal from any pattern match. This hook is a safety net
# against ACCIDENT, not an adversarial sandbox, and it has never claimed otherwise.
set -u

PROJECT_ROOT="/mnt/cachec/NOESAR_EVOLUTION"
ATOM_ROOT="/mnt/cachec/ATOM_EVOLUTION"

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

case "$TOOL_NAME" in

Bash)
  CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
  [ -z "$CMD" ] && allow_silent

  ASK_REASON=""
  CMD_NAMES_ATOM=false
  if printf '%s' "$CMD" | grep -qF "$ATOM_ROOT" || printf '%s' "$CMD" | grep -qE '(^|[^A-Za-z0-9_])ATOM_EVOLUTION([^A-Za-z0-9_]|$)'; then
    CMD_NAMES_ATOM=true
  fi

  # Split into simple-command segments. `&&` and `||` collapse into empty segments, which
  # are skipped. Redirections are NOT separators: `cat x > y` stays one segment.
  while IFS= read -r SEG; do
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

    # --- rm -rf and equivalent forms (flags of an actual rm, not the words in a string) ---
    if printf '%s' "$CMDWORD" | grep -qE "$REMOVERS_RE"; then
      # Flags are judged as a SET, so the split form `rm -r -f x` is caught too. The
      # pre-repair regex required both letters inside one token and missed it.
      if printf '%s' "$FLAGS" | grep -qE '(^| )(-[a-zA-Z]*r[a-zA-Z]*|--recursive)' \
         && printf '%s' "$FLAGS" | grep -qE '(^| )(-[a-zA-Z]*f[a-zA-Z]*|--force)'; then
        deny "rm -rf (or an equivalent recursive+force form) in: $CMD"
      fi
      # --- deletions outside PROJECT_ROOT ---
      while IFS= read -r OP; do
        [ -z "$OP" ] && continue
        OP="$(strip_token "$OP")"
        case "$OP" in
          /*)
            case "$OP" in
              "$PROJECT_ROOT"*) ;;
              *) deny "rm targets a path outside PROJECT_ROOT ($OP) in: $CMD" ;;
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
      case "$CMDWORD" in
        rm|rmdir|shred|unlink|mv|cp|dd|truncate) MUTATES=true ;;
        sed) printf '%s' "$FLAGS" | grep -qE '(^| )-i' && MUTATES=true ;;
        git) printf '%s' "$OPERANDS" | grep -qE '^(commit|push|add|reset|checkout|clean)$' && MUTATES=true ;;
      esac
      printf '%s' "$SEG" | grep -qE '>{1,2}' && MUTATES=true
      if [ "$MUTATES" = true ]; then
        deny "mutating command targets /mnt/cachec/ATOM_EVOLUTION (separate repo, not authorised this session) in: $CMD"
      fi
    fi

  done <<< "$(printf '%s' "$CMD" | sed 's/[;&|]/\n/g')"

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
    "$ATOM_ROOT"*)
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
