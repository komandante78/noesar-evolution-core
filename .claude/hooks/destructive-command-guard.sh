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
set -u

PROJECT_ROOT="/mnt/cachec/NOESAR_EVOLUTION"
ATOM_ROOT="/mnt/cachec/ATOM_EVOLUTION"

deny() {
  # $1 = human-readable reason
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r},systemMessage:("destructive-command-guard DENIED: " + $r)}'
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

case "$TOOL_NAME" in

Bash)
  CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
  [ -z "$CMD" ] && allow_silent

  # --- rm -rf and equivalent forms ---
  if printf '%s' "$CMD" | grep -qE '\brm\b[^|;&]*(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive[^|;&]*--force|--force[^|;&]*--recursive)'; then
    deny "rm -rf (or an equivalent recursive+force form) in: $CMD"
  fi

  # --- docker system/volume prune ---
  if printf '%s' "$CMD" | grep -qE '\bdocker\b[^|;&]*\b(system|volume)\b[^|;&]*\bprune\b'; then
    deny "docker system/volume prune (host-wide, forbidden by CLAUDE10.md §5a) in: $CMD"
  fi

  # --- docker compose down -v ---
  if printf '%s' "$CMD" | grep -qE '\bdocker([ -]compose)\b[^|;&]*\bdown\b[^|;&]*(-v\b|--volumes\b)'; then
    deny "docker compose down -v (destroys volumes) in: $CMD"
  fi

  # --- git push --force (and --force-with-lease, and -f after push) ---
  if printf '%s' "$CMD" | grep -qE '\bgit\b[^|;&]*\bpush\b[^|;&]*(--force\b|--force-with-lease\b|[[:space:]]-f\b)'; then
    deny "git push --force (or -f / --force-with-lease) in: $CMD"
  fi

  # --- reading/printing .env, secrets, tokens, passwords, private keys ---
  if printf '%s' "$CMD" | grep -qE '\b(cat|less|more|head|tail|strings|xxd|od|cp|curl|wget|echo|printf)\b' \
     && printf '%s' "$CMD" | grep -qE '(\.env($|[^A-Za-z])|secrets/|credentials/|\.key($|[^A-Za-z])|\.pem($|[^A-Za-z])|id_rsa|provenance-signing\.key)'; then
    deny "reads a .env/secrets/credentials/key-shaped path in: $CMD"
  fi

  # --- deletions outside PROJECT_ROOT ---
  if printf '%s' "$CMD" | grep -qE '\brm\b'; then
    while read -r tok; do
      case "$tok" in
        /*)
          case "$tok" in
            "$PROJECT_ROOT"*) ;;
            *) deny "rm targets a path outside PROJECT_ROOT ($tok) in: $CMD" ;;
          esac
          ;;
      esac
    done <<< "$(printf '%s' "$CMD" | tr ' ' '\n')"
  fi

  # --- unauthorised mutation of the separate ATOM repository ---
  if printf '%s' "$CMD" | grep -qF "$ATOM_ROOT" || printf '%s' "$CMD" | grep -qE '(^|[^A-Za-z0-9_])ATOM_EVOLUTION([^A-Za-z0-9_]|$)'; then
    if printf '%s' "$CMD" | grep -qE '\b(git[[:space:]]+(commit|push|add|reset|checkout|clean)|rm|mv|sed[[:space:]]+-i|>{1,2})\b'; then
      deny "mutating command targets /mnt/cachec/ATOM_EVOLUTION (separate repo, not authorised this session) in: $CMD"
    fi
  fi

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
