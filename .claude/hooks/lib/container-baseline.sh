#!/usr/bin/env bash
# NOESAR EVOLUTION — shared container-baseline logic (identity-based, not name-only).
#
# Sourced by both session-context.sh (SessionStart: capture) and session-close-guard.sh
# (Stop: compare), so the write side and the read side can never drift into two shapes.
#
# A container is identified by its full Docker ID, not its name — a container removed
# and recreated under the SAME name gets a NEW id, and only id-based comparison catches
# that as "new". The baseline is host-wide (every container docker knows about, not just
# noesar-evolution*), because "is this new" and "is this ours" are two different
# questions; cbl_is_noesar_scoped answers the second one, from labels first and name
# prefix second, so a NOESAR-evolution container that got renamed is still caught.
#
# Test override: if NOESAR_GUARD_FAKE_DOCKER_JSON names a readable file, its contents are
# returned instead of calling the real docker daemon — this is how fixture tests exercise
# cbl_fetch_all_containers without ever creating a real container (see
# .claude/hooks/test/test-container-baseline.sh).
#
# BASELINE LIFECYCLE (F-HOOK-003, D-0383). The baseline is a TRUST ANCHOR: the Stop hook
# decides whether to block a session close by comparing against it. Its lifecycle and its
# file permissions are therefore part of the security surface, not housekeeping.
#
#   SessionStart  create the private runtime dir, write the baseline atomically, prune only
#                 residues PROVEN stale
#   Stop          read and compare on EVERY turn — never delete, on PASS or on BLOCK
#   SessionEnd    delete this session's files, and only this session's
#
# Stop used to delete the baseline on a green verdict. But Stop fires at the end of every
# assistant TURN, not once per session, so the first green turn destroyed the anchor and
# every later turn of the same session blocked on "baseline missing" — a governance gap
# that never existed — while container litter created after that point went unseen. That
# is F-HOOK-003, measured on 2026-08-11.
set -u

CBL_SECRET_PATTERN='(TOKEN|SECRET|PASSWORD|PASSPHRASE|PRIVATE_KEY|BEGIN [A-Z ]*PRIVATE KEY|Bearer [A-Za-z0-9._-]{10,}|api[_-]?key)'
CBL_PREFIX='noesar-evolution-container-baseline-'
# Grace period applied AFTER a session has been PROVEN dead — never instead of that proof.
# Age is not evidence of death (F-HOOK-004): a session idle for a week is still a session.
CBL_DEAD_GRACE_HOURS="${NOESAR_BASELINE_DEAD_GRACE_HOURS:-1}"

# --- portable stat: GNU takes -c, BSD/macOS takes -f. Platform law (CLAUDE10.md §60-64):
# nothing here may presume this host's coreutils. Both return empty on failure, and every
# caller treats empty as "cannot verify" -> refuse, never "assume fine".
cbl_file_uid()  { stat -c %u "$1" 2>/dev/null || stat -f %u "$1" 2>/dev/null || true; }
cbl_file_mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1" 2>/dev/null || true; }
cbl_file_mtime(){ stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || true; }

# A session id is used to BUILD A PATH, so it is validated as an identifier before it ever
# reaches the filesystem. This is what makes it impossible for a payload to steer a delete:
# no slash, no dot, no traversal, nothing but the shape Claude Code actually emits.
# The security property here is the CHARACTER CLASS, not the length: no slash, no dot, no
# `..`, nothing that can leave the directory the caller chose. A minimum length would add no
# safety and would reject the short ids the fixture suites legitimately use.
cbl_valid_session_id() {
  case "${1:-}" in
    *[!A-Za-z0-9_-]*|'') return 1 ;;
  esac
  [ "${#1}" -le 64 ]
}

# The private runtime directory. Overridable for fixtures and probes; otherwise a per-uid
# directory, so two users on a shared host never share a trust anchor. XDG is used when the
# host offers it and ignored when it does not — detected, never presumed.
cbl_runtime_dir() {
  if [ -n "${NOESAR_GUARD_BASELINE_DIR:-}" ]; then
    printf '%s' "$NOESAR_GUARD_BASELINE_DIR"
  elif [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -d "${XDG_RUNTIME_DIR}" ]; then
    printf '%s/noesar-evolution' "$XDG_RUNTIME_DIR"
  else
    printf '%s/noesar-evolution-runtime-%s' "${TMPDIR:-/tmp}" "$(id -u)"
  fi
}

# Create/verify the runtime dir as 0700 and OURS. Prints nothing on success; prints one
# "FAIL:<reason>" line and returns 1 when the directory cannot be trusted.
cbl_ensure_runtime_dir() {
  local dir="$1"
  if [ -L "$dir" ]; then
    echo "FAIL:runtime directory $dir is a symlink — refusing to use it as a trust anchor"
    return 1
  fi
  if [ ! -d "$dir" ]; then
    ( umask 077 && mkdir -p "$dir" ) 2>/dev/null || {
      echo "FAIL:cannot create runtime directory $dir"; return 1; }
  fi
  chmod 700 "$dir" 2>/dev/null || true
  local uid mode
  uid="$(cbl_file_uid "$dir")"; mode="$(cbl_file_mode "$dir")"
  if [ -n "$uid" ] && [ "$uid" != "$(id -u)" ]; then
    echo "FAIL:runtime directory $dir is owned by uid $uid, not $(id -u)"
    return 1
  fi
  if [ -n "$mode" ] && [ "$mode" != "700" ]; then
    echo "FAIL:runtime directory $dir is mode $mode, not 700"
    return 1
  fi
  return 0
}

cbl_baseline_path() {
  cbl_valid_session_id "$2" || return 1
  printf '%s/%s%s.json' "$1" "$CBL_PREFIX" "$2"
}

# Atomic, private write. The JSON is validated BEFORE the rename, so a reader can never
# observe a half-written or malformed trust anchor: the rename is the publish step and it
# is atomic within one directory. Returns 1 and prints FAIL:<reason> on refusal.
cbl_write_baseline() {
  local dir="$1" session_id="$2" json="$3" target tmp
  target="$(cbl_baseline_path "$dir" "$session_id")" || {
    echo "FAIL:refusing to write a baseline for an invalid session id"; return 1; }
  if [ -L "$target" ]; then
    echo "FAIL:baseline path $target is a symlink — refusing to write through it"
    return 1
  fi
  if [ -e "$target" ]; then
    local uid; uid="$(cbl_file_uid "$target")"
    if [ -n "$uid" ] && [ "$uid" != "$(id -u)" ]; then
      echo "FAIL:existing baseline $target is owned by uid $uid — refusing to overwrite"
      return 1
    fi
  fi
  tmp="$(umask 077; mktemp "${dir}/.${CBL_PREFIX}XXXXXX" 2>/dev/null)" || {
    echo "FAIL:cannot create a temporary file in $dir"; return 1; }
  printf '%s' "$json" > "$tmp" 2>/dev/null
  chmod 600 "$tmp" 2>/dev/null || true
  if ! jq -e 'type=="array"' "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp" 2>/dev/null
    echo "FAIL:refusing to publish a baseline that is not a JSON array"
    return 1
  fi
  mv -f "$tmp" "$target" 2>/dev/null || {
    rm -f "$tmp" 2>/dev/null
    echo "FAIL:atomic rename into $target failed"; return 1; }
  return 0
}

# Stop calls this on every turn: it is the heartbeat that keeps this session's baseline out
# of the prune set. Deliberately does NOT rewrite content — the anchor must stay the state
# captured at SessionStart, or a container created mid-session would be absorbed into it.
cbl_touch_baseline() {
  local f="$1"
  [ -f "$f" ] && [ ! -L "$f" ] && touch "$f" 2>/dev/null
  return 0
}

# SessionEnd. Removes ONLY the files of the validated session id, with the path built here
# from that id — never taken from the payload. Prints one line per action or refusal.
cbl_remove_session_files() {
  local dir="$1" session_id="$2" marker="${3:-}" target uid
  if ! cbl_valid_session_id "$session_id"; then
    echo "REFUSED:session id is not a valid identifier — nothing removed"
    return 1
  fi
  target="$(cbl_baseline_path "$dir" "$session_id")"
  if [ -L "$target" ]; then
    echo "REFUSED:$target is a symlink — nothing removed"
  elif [ -f "$target" ]; then
    uid="$(cbl_file_uid "$target")"
    if [ -n "$uid" ] && [ "$uid" != "$(id -u)" ]; then
      echo "REFUSED:$target is owned by uid $uid — nothing removed"
    elif rm -f "$target" 2>/dev/null; then
      echo "REMOVED:baseline for this session"
    else
      echo "FAILED:could not remove the baseline for this session"
    fi
  else
    echo "ABSENT:no baseline for this session"
  fi
  # The owner-identity sidecar (F-HOOK-004) belongs to the same session and dies with it.
  local meta
  if meta="$(cbl_owner_meta_path "$dir" "$session_id" 2>/dev/null)"; then
    if [ -f "$meta" ] && [ ! -L "$meta" ]; then
      uid="$(cbl_file_uid "$meta")"
      if [ -z "$uid" ] || [ "$uid" = "$(id -u)" ]; then
        rm -f "$meta" 2>/dev/null && echo "REMOVED:owner identity for this session"
      else
        echo "REFUSED:owner identity file is owned by another uid — kept"
      fi
    fi
  fi
  if [ -n "$marker" ] && [ -f "$marker" ] && [ ! -L "$marker" ] \
     && [ "$(cat "$marker" 2>/dev/null)" = "$session_id" ]; then
    rm -f "$marker" 2>/dev/null && echo "REMOVED:bootstrap marker for this session"
  fi
  return 0
}

# --- OWNER IDENTITY (F-HOOK-004) ----------------------------------------------------------
#
# Age is not evidence of death. A session idle for a week is still a session, and deleting
# its anchor recreates F-HOOK-003 by another route: the next turn blocks on a gap that never
# existed. So a residue is removed only when the process that owned it is PROVEN gone.
#
# The proof, and why each part is needed:
#   boot_id    a process cannot survive a reboot, so a different boot id is proof of death
#              on its own — the strongest and cheapest signal there is.
#   starttime  /proc/<pid> existing is NOT proof the same process is there: PIDs are reused.
#              Field 22 of /proc/<pid>/stat is the process start time; pid+starttime under
#              one boot id is unique, so a recycled pid reads as dead, never as alive.
#   chain      the hook's immediate parent may be a transient shell. The whole ancestor
#              chain is recorded and the session counts as ALIVE if ANY member is still
#              alive, so a dying wrapper can never be mistaken for a dying session.
#
# Verdicts: ALIVE and UNKNOWN both KEEP. Only DEAD may be removed, and only after a grace
# period on top of the proof.
cbl_owner_meta_path() {
  cbl_valid_session_id "$2" || return 1
  printf '%s/%s%s.owner.json' "$1" "$CBL_PREFIX" "$2"
}

cbl_boot_id() { cat /proc/sys/kernel/random/boot_id 2>/dev/null || true; }

# Field 22 of /proc/<pid>/stat. The comm field (2) may contain spaces and parentheses, so
# the prefix up to the LAST ')' is stripped before counting — a plain $22 is wrong for any
# process whose name has a space in it.
cbl_proc_starttime() {
  local line rest
  line="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  [ -z "$line" ] && return 1
  rest="${line##*) }"
  # shellcheck disable=SC2086 (deliberate word splitting of the stat fields)
  set -- $rest
  [ "$#" -ge 20 ] || return 1
  printf '%s' "${20}"
}

# JSON identity of the processes that own this session. PID 1 is excluded deliberately: it
# is always alive, and including it would make every residue look active for ever.
cbl_capture_owner_identity() {
  local pid ppid st chain="" first=1 i=0
  pid="${PPID:-0}"
  while [ "$i" -lt 12 ] && [ -n "$pid" ] && [ "$pid" != "0" ] && [ "$pid" != "1" ]; do
    st="$(cbl_proc_starttime "$pid" 2>/dev/null || true)"
    [ -z "$st" ] && break
    [ "$first" = 1 ] || chain="$chain,"
    chain="$chain{\"pid\":$pid,\"starttime\":\"$st\"}"
    first=0
    ppid="$(awk '{print $4}' "/proc/$pid/stat" 2>/dev/null || true)"
    [ -z "$ppid" ] && break
    pid="$ppid"; i=$((i+1))
  done
  [ -z "$chain" ] && return 1
  printf '{"schema":1,"boot_id":"%s","uid":%s,"captured_at":%s,"ancestors":[%s]}' \
    "$(cbl_boot_id)" "$(id -u)" "$(date +%s 2>/dev/null || echo 0)" "$chain"
}

cbl_write_owner_meta() {
  local dir="$1" session_id="$2" target tmp json
  target="$(cbl_owner_meta_path "$dir" "$session_id")" || return 1
  [ -L "$target" ] && return 1
  json="$(cbl_capture_owner_identity 2>/dev/null || true)"
  [ -z "$json" ] && return 1
  tmp="$(umask 077; mktemp "${dir}/.${CBL_PREFIX}owner.XXXXXX" 2>/dev/null)" || return 1
  printf '%s' "$json" > "$tmp" 2>/dev/null
  chmod 600 "$tmp" 2>/dev/null || true
  if ! jq -e '.schema==1 and (.ancestors|length)>0' "$tmp" >/dev/null 2>&1; then
    rm -f "$tmp" 2>/dev/null; return 1
  fi
  mv -f "$tmp" "$target" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 1; }
  return 0
}

# ALIVE | DEAD | UNKNOWN — never guesses. Anything it cannot establish is UNKNOWN, and
# UNKNOWN keeps the file.
cbl_liveness_of() {
  local dir="$1" session_id="$2" meta boot now_boot n i pid st cur
  meta="$(cbl_owner_meta_path "$dir" "$session_id" 2>/dev/null)" || { echo UNKNOWN; return 0; }
  # No sidecar at all: a legacy baseline written before this mechanism existed.
  [ -f "$meta" ] && [ ! -L "$meta" ] || { echo UNKNOWN; return 0; }
  jq -e '.schema==1 and (.ancestors|type=="array") and (.ancestors|length)>0' "$meta" >/dev/null 2>&1 \
    || { echo UNKNOWN; return 0; }   # corrupt or incomplete metadata
  boot="$(jq -r '.boot_id // empty' "$meta" 2>/dev/null)"
  now_boot="$(cbl_boot_id)"
  if [ -z "$boot" ] || [ -z "$now_boot" ]; then echo UNKNOWN; return 0; fi
  # A different boot: every process of that boot is gone. Proof, not inference.
  if [ "$boot" != "$now_boot" ]; then echo DEAD; return 0; fi
  # Same boot: /proc is required to say anything at all about a pid.
  [ -d /proc ] || { echo UNKNOWN; return 0; }
  n="$(jq -r '.ancestors|length' "$meta" 2>/dev/null || echo 0)"
  i=0
  while [ "$i" -lt "$n" ]; do
    pid="$(jq -r ".ancestors[$i].pid" "$meta" 2>/dev/null)"
    st="$(jq -r ".ancestors[$i].starttime" "$meta" 2>/dev/null)"
    if [ -n "$pid" ] && [ -n "$st" ] && [ -d "/proc/$pid" ]; then
      cur="$(cbl_proc_starttime "$pid" 2>/dev/null || true)"
      # Equal start time = the same process. Different = the pid was recycled by a new
      # process, which means the original is gone: that is the PID-reuse trap closed.
      [ -n "$cur" ] && [ "$cur" = "$st" ] && { echo ALIVE; return 0; }
    fi
    i=$((i+1))
  done
  echo DEAD
}

# SessionStart crash recovery. SessionEnd cannot run after a crash, a kill -9 or a host
# reset, so residues accumulate. NOTHING is removed on age: a file is removed only when its
# owning session is PROVEN dead and a grace period has passed on top of that proof. Every
# other outcome — alive, unknown, legacy, corrupt, foreign, symlink — KEEPS the file and
# says so. That is F-HOOK-004.
cbl_prune_stale_baselines() {
  local dir="$1" current="$2" now f base sid uid live meta mtime
  local removed=0 alive=0 unknown=0 refused=0
  [ -d "$dir" ] || return 0
  now="$(date +%s 2>/dev/null)" || return 0
  for f in "$dir"/${CBL_PREFIX}*.json; do
    [ -e "$f" ] || continue
    base="${f##*/}"
    case "$base" in
      *.owner.json) continue ;;                       # sidecars are handled with their baseline
      "${CBL_PREFIX}"*) ;;
      *) continue ;;
    esac
    sid="${base#"$CBL_PREFIX"}"; sid="${sid%.json}"
    if [ -L "$f" ] || [ ! -f "$f" ]; then refused=$((refused+1)); continue; fi
    cbl_valid_session_id "$sid" || { refused=$((refused+1)); continue; }
    [ "$sid" = "$current" ] && continue              # never our own, at any age
    uid="$(cbl_file_uid "$f")"
    if [ -z "$uid" ] || [ "$uid" != "$(id -u)" ]; then refused=$((refused+1)); continue; fi
    live="$(cbl_liveness_of "$dir" "$sid")"
    case "$live" in
      ALIVE)   alive=$((alive+1));   continue ;;
      UNKNOWN) unknown=$((unknown+1)); continue ;;
    esac
    # DEAD. The grace period applies only now, on top of the proof — never in place of it.
    mtime="$(cbl_file_mtime "$f")"
    if [ -z "$mtime" ] || [ "$mtime" -gt $(( now - CBL_DEAD_GRACE_HOURS * 3600 )) ] 2>/dev/null; then
      unknown=$((unknown+1)); continue
    fi
    if rm -f "$f" 2>/dev/null; then
      removed=$((removed+1))
      meta="$(cbl_owner_meta_path "$dir" "$sid" 2>/dev/null)" && [ -f "$meta" ] && [ ! -L "$meta" ] \
        && rm -f "$meta" 2>/dev/null
    else
      refused=$((refused+1))
    fi
  done
  [ "$removed" -gt 0 ] && echo "PRUNED:$removed baseline(s) whose owning process is PROVEN dead"
  [ "$alive" -gt 0 ] && echo "KEPT:$alive residue(s) whose owning process is still ALIVE — idle is not dead"
  [ "$unknown" -gt 0 ] && echo "KEPT:$unknown residue(s) of UNKNOWN liveness (legacy, unverifiable or within grace) — declared debt, not deleted"
  [ "$refused" -gt 0 ] && echo "KEPT:$refused residue(s) failing an identity check — never touched"
  return 0
}

# Emits a JSON array of {id,name,created,image_id,labels} for every container docker
# currently knows about (running or stopped, any project) — never filtered to a name
# prefix at capture time, so a rename can't slip a container out of the baseline.
# Label VALUES that look secret-shaped are dropped (keys kept) — defense in depth, no
# secret should ever land in a label, but this baseline is not the place to find out.
cbl_fetch_all_containers() {
  if [ -n "${NOESAR_GUARD_FAKE_DOCKER_JSON:-}" ]; then
    cat "$NOESAR_GUARD_FAKE_DOCKER_JSON" 2>/dev/null || echo '[]'
    return
  fi
  if ! command -v docker >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    echo '[]'
    return
  fi
  local ids
  ids="$(docker ps -aq --no-trunc 2>/dev/null)"
  if [ -z "$ids" ]; then
    echo '[]'
    return
  fi
  # shellcheck disable=SC2086 (word-splitting of $ids into separate docker-inspect args is intended)
  docker inspect $ids 2>/dev/null | jq -c --arg pat "$CBL_SECRET_PATTERN" '
    [.[] | {
      id: .Id,
      name: (.Name | ltrimstr("/")),
      created: .Created,
      image_id: .Image,
      labels: ((.Config.Labels // {}) | with_entries(select(.value | test($pat; "i") | not)))
    }]
  ' 2>/dev/null || echo '[]'
}

# Reads one baseline-shaped JSON object from stdin. Exit 0 (true) if it is in
# NOESAR-evolution scope: name prefix `noesar-evolution`, an `org.noesar.*` label, or the
# product's own opencontainers title label. Everything else is "external" — reported in
# a diff but never blocking, since this project's duty is its own litter only
# (CLAUDE10.md §5a/§21d), not every container on a shared host.
cbl_is_noesar_scoped() {
  jq -e '
    (.name | test("^noesar-evolution($|-)")) or
    ((.labels // {}) | keys | any(startswith("org.noesar."))) or
    ((.labels["org.opencontainers.image.title"] // "") == "NOESAR Evolution")
  ' >/dev/null 2>&1
}

# cbl_check_containers BASELINE_FILE CURRENT_JSON SESSION_ID BOOTSTRAP_MARKER_FILE
#
# Pure function (besides reading the two given files): prints one line per finding,
# prefixed "FAIL:" (blocking) or "DEBT:" (declared, non-blocking). No docker/jq calls of
# its own beyond what CURRENT_JSON already carries — callers fetch CURRENT_JSON via
# cbl_fetch_all_containers (real or fixture) and pass it in, so this function is fully
# exercisable from synthetic fixtures with no real container ever created.
cbl_check_containers() {
  local baseline_file="$1" current_json="$2" session_id="$3" bootstrap_marker="$4"
  local baseline_ok=false baseline_json=""

  if [ -f "$baseline_file" ]; then
    if jq -e 'type=="array"' "$baseline_file" >/dev/null 2>&1; then
      baseline_ok=true
      baseline_json="$(cat "$baseline_file")"
    else
      echo "FAIL:container baseline file $baseline_file exists but is not a valid JSON array — corrupted"
    fi
  elif [ -n "$session_id" ] && [ -f "$bootstrap_marker" ] && [ "$(cat "$bootstrap_marker" 2>/dev/null)" = "$session_id" ]; then
    echo "DEBT:BASELINE_UNAVAILABLE_PREINSTALL: no SessionStart container baseline exists for this session — the baseline mechanism was installed or changed mid-session; no container is attributed to this session as litter"
  elif [ -z "$session_id" ]; then
    echo "DEBT:SESSION_ID_UNAVAILABLE: hook payload carried no session_id — cannot look up or attribute a container baseline"
  else
    echo "FAIL:container baseline missing for this session (expected $baseline_file) — SessionStart should have written it; this is a governance gap and blocks rather than failing open"
  fi

  if [ "$baseline_ok" = true ]; then
    local new_json entry name idshort
    new_json="$(jq -c --argjson base "$baseline_json" '
      ($base | map(.id)) as $baseids
      | map(select(.id as $i | ($baseids | index($i)) == null))
    ' <<<"$current_json" 2>/dev/null)"
    while IFS= read -r entry; do
      [ -z "$entry" ] && continue
      name="$(jq -r '.name' <<<"$entry" 2>/dev/null)"
      idshort="$(jq -r '.id[0:12]' <<<"$entry" 2>/dev/null)"
      if printf '%s' "$entry" | cbl_is_noesar_scoped; then
        echo "FAIL:container created this session and not cleaned up (id absent from the SessionStart baseline): $name ($idshort)"
      else
        echo "DEBT:external container appeared during this session, out of NOESAR-evolution scope, not this project's litter: $name ($idshort)"
      fi
    done <<< "$(jq -c '.[]?' <<<"$new_json" 2>/dev/null)"
  fi

  local rollbacks rollback_count
  rollbacks="$(jq -r '.[] | select(.name | test("^noesar-evolution-old-")) | .name' <<<"$current_json" 2>/dev/null | sort -u)"
  rollback_count="$(printf '%s\n' "$rollbacks" | grep -c . 2>/dev/null || echo 0)"
  if [ "$rollback_count" -gt 1 ] 2>/dev/null; then
    echo "DEBT:B-012, non-blocking: $rollback_count rollback containers exist against the 1 CLAUDE10.md §5a permits ($(printf '%s' "$rollbacks" | tr '\n' ' ')) — pre-existing, not created this session; Owner decides whether to prune or amend §5a"
  fi
}
