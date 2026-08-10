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
set -u

CBL_SECRET_PATTERN='(TOKEN|SECRET|PASSWORD|PASSPHRASE|PRIVATE_KEY|BEGIN [A-Z ]*PRIVATE KEY|Bearer [A-Za-z0-9._-]{10,}|api[_-]?key)'

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
