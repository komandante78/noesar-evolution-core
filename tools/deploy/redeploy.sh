#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The §3a deployment sequence, as a tool the repository owns.
#
#   tools/deploy/redeploy.sh --source <container> --check
#   tools/deploy/redeploy.sh --source <container> --apply --authorized-by-owner \
#                            [--rotate-secret VAR[,VAR…]] [--image TAG]
#
# # Why this exists, measured rather than argued
#
# `CLAUDE10.md` §3a describes the sequence in prose: build, prove, stop with grace, back up with
# the service stopped, preserve the predecessor, start the replacement **with the configuration
# read back from the container it replaces**, verify live, clean up. Prose repeated by hand is
# how it was performed, and on 2026-08-12 it cost 43.8 s of production downtime (`D-0390`): a
# read of the source container placed after the rename made `docker run` die with
# `no such object`, with production already stopped and renamed. That was `D-0362`'s fault
# happening a second time, to a different person, for the same structural reason.
#
# The same week proved the other half: driven against a fake Docker with synthetic secrets, the
# sequence gave up two further defects before they reached production — one of which would have
# rolled back a **perfectly successful** deployment, because `grep -c` exits 1 when it counts
# zero and the ERR trap was armed.
#
# So the sequence is subtle enough to defeat an expert and testable enough to be defended. It
# belongs in the repository, with its fixture, not in somebody's terminal history.
#
# # The five properties this tool exists to guarantee
#
#   1. EVERY read of the source happens in ONE block, before the first mutation. Nothing after
#      the rename may name the source container. `tools/deploy/test/redeploy-fixture.sh` asserts
#      this against THIS FILE's own text, so the defect cannot come back quietly.
#   2. The creation recipe is proven COMPLETE before anything is stopped.
#   3. From the rename onwards, every failure — including one nobody anticipated — rolls back.
#   4. No secret is ever printed, and none travels in argv: values reach Docker through a 0600
#      `--env-file` that a trap shreds.
#   5. Nothing presumes this host: no path, no package, no Docker version (`CLAUDE10.md` §60-64).
#
# # What it does NOT do
#
# It does not build, pull, push, or decide anything. It replaces a container with one derived
# from the container it replaces, changing only what was explicitly asked for.

set -eEuo pipefail        # -E so the ERR trap is inherited by functions
umask 077

# ── GUARD 0: never under xtrace ───────────────────────────────────────────────────────────────
# The rotation of 2026-08-12 was needed because an earlier deploy script carried `set -x` and
# printed a token into a session log (`D-0362`). A deployment tool that can echo its own secrets
# is a credential leak with a schedule.
case "$-" in *x*) echo "REFUSED: xtrace is enabled — a deployment must never echo its own secrets" >&2; exit 2 ;; esac
[ -n "${BASH_XTRACEFD:-}" ] && { echo "REFUSED: BASH_XTRACEFD is set" >&2; exit 2; }
set +x

# Portable root: derived from where this file lives, never from a path typed into it.
ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUPS_DIR="${NOESAR_BACKUPS_DIR:-$ROOT/BACKUPS}"
EXPECT_CHILDREN="${NOESAR_EXPECT_CHILDREN:-postgres api codev atom}"
HEALTH_TIMEOUT="${NOESAR_DEPLOY_HEALTH_TIMEOUT:-120}"
HEALTH_INTERVAL="${NOESAR_DEPLOY_HEALTH_INTERVAL:-3}"
STOP_GRACE="${NOESAR_DEPLOY_STOP_GRACE:-30}"

SOURCE=""; MODE="check"; AUTHORIZED=0; ROTATE_VARS=""; NEW_IMAGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="${2:?--source needs a container name}"; shift 2 ;;
    --check) MODE="check"; shift ;;
    --apply) MODE="apply"; shift ;;
    --authorized-by-owner) AUTHORIZED=1; shift ;;
    --rotate-secret) ROTATE_VARS="${2:?--rotate-secret needs VAR[,VAR…]}"; shift 2 ;;
    --image) NEW_IMAGE="${2:?--image needs a tag}"; shift 2 ;;
    -h|--help) sed -n '3,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
# The source is a parameter and never a default: `D-0362`'s script assumed the name, then renamed
# it out of the way, then read from the name it had just removed.
[ -n "$SOURCE" ] || { echo "REFUSED: --source is mandatory" >&2; exit 2; }

say()  { printf '%s\n' "$*"; }      # prose only — a secret is never an argument to this
FAIL=0
ok()   { say "  ok    $*"; }
bad()  { say "  FAIL  $*"; FAIL=1; }
warn() { say "  warn  $*"; }

# ══ PREFLIGHT — READ-ONLY ═════════════════════════════════════════════════════════════════════
# Nothing below this banner writes a file, generates a value or touches a container. It is the
# whole of `--check`, and `--apply` runs it first and refuses on any FAIL. The separation is
# structural, not a late `if`: an earlier revision exited "dry" AFTER generating a secret and
# writing it to disk, which is not a dry run.
preflight() {
  say "PREFLIGHT (read-only) — source: $SOURCE"

  for tool in docker awk sha256sum tar date mktemp; do
    command -v "$tool" >/dev/null 2>&1 && ok "tool present: $tool" || bad "tool missing: $tool"
  done
  if command -v openssl >/dev/null 2>&1; then ok "randomness: openssl"
  elif [ -r /dev/urandom ]; then ok "randomness: /dev/urandom"
  else [ -n "$ROTATE_VARS" ] && bad "no source of randomness and a secret was asked for" || warn "no randomness available (not needed here)"; fi
  command -v shred >/dev/null 2>&1 && ok "shred present" || warn "shred absent — the env file will be removed with rm, which is weaker"

  docker inspect "$SOURCE" >/dev/null 2>&1 || { bad "no container named $SOURCE"; return; }
  local image network restart ro state health workspace
  image="$(docker inspect "$SOURCE" --format '{{.Config.Image}}')"
  network="$(docker inspect "$SOURCE" --format '{{.HostConfig.NetworkMode}}')"
  restart="$(docker inspect "$SOURCE" --format '{{.HostConfig.RestartPolicy.Name}}')"
  ro="$(docker inspect "$SOURCE" --format '{{.HostConfig.ReadonlyRootfs}}')"
  state="$(docker inspect "$SOURCE" --format '{{.State.Status}}')"
  health="$(docker inspect "$SOURCE" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')"
  workspace="$(docker inspect "$SOURCE" --format '{{range .Mounts}}{{if eq .Destination "/workspace"}}{{.Source}}{{end}}{{end}}')"

  local target_image="${NEW_IMAGE:-$image}"
  [ -n "$image" ] && ok "current image: $image" || bad "the container declares no image"
  docker image inspect "$target_image" >/dev/null 2>&1 \
    && ok "target image present locally: $target_image (no pull will be attempted)" \
    || bad "target image $target_image is NOT local — this tool never pulls"

  # §3a 11c's "prove the image's contents equal the repository tree", mechanically — `D-0559`.
  #
  # It was being done by hand, and the hand followed the overlay: the `d0544` entry in the
  # ledger records "byte-equal tree↔image 3/3" because that overlay copied three files, so
  # three is all anyone compared. Measured on 2026-08-19 with the whole surface instead:
  # NINE files in the running image are older than the tree they are supposed to be, because
  # no overlay ever refreshed them. All nine are test files and one `scripts` block — no
  # runtime module was stale — but nothing in the deploy path could have told the difference.
  #
  # Only when a NEW image is being deployed. A `--rotate-secret` run redeploys the image that
  # is already running, which was built from an older tree by construction; refusing that
  # would block a secret rotation for a reason that has nothing to do with secrets.
  if [ -n "$NEW_IMAGE" ]; then
    # `|| prov_rc=$?` and not `; prov_rc=$?`: under `set -e` an assignment carries the exit
    # status of the command substitution, so the plain form killed the script the first time
    # the check found drift — the gate would have been silent in exactly the case it exists for.
    local prov_out prov_rc=0
    prov_out="$("$ROOT/tools/verify-image-provenance.sh" "$target_image" 2>&1)" || prov_rc=$?
    # Only a MEASURED drift is a FAIL. `2` (the image cannot be read) and `3` (no docker) mean
    # the question was not answered, and answering it falsely in either direction would be
    # worse than saying so: the image's presence is already a `bad` of its own two lines above,
    # so a warn here duplicates nothing and hides nothing.
    case "$prov_rc" in
      0) ok "image bytes equal the working tree: $(printf '%s\n' "$prov_out" | awk '/byte-equal to tree/{print $0}' | sed 's/^ *//')" ;;
      2|3) warn "provenance UNMEASURED — $(printf '%s\n' "$prov_out" | grep -E 'UNAVAILABLE|PRECONDITION' | head -1)" ;;
      *) bad "the target image does not match the working tree — see the drift below"
         printf '%s\n' "$prov_out" | grep -E 'differs|not-in-tree|byte-equal to tree' | sed 's/^/      /' ;;
    esac
  fi
  [ -n "$network" ] && docker network inspect "$network" >/dev/null 2>&1 \
    && ok "network exists: $network" || bad "network $network is missing"
  ok "restart=$restart · read-only rootfs=$ro"
  [ "$state" = "running" ] && ok "state: running" || bad "state is '$state', not running"
  # `none` is accepted: an image with no HEALTHCHECK is a fact about that image, not a fault.
  case "$health" in
    healthy) ok "health: healthy" ;;
    none)    warn "this image declares no healthcheck — readiness cannot be proven by Docker" ;;
    *)       bad "health is '$health' — do not redeploy a sick installation" ;;
  esac

  local envcount ports binds
  envcount="$(docker inspect "$SOURCE" --format '{{len .Config.Env}}')"
  ports="$(docker inspect "$SOURCE" --format '{{len .HostConfig.PortBindings}}')"
  binds="$(docker inspect "$SOURCE" --format '{{len .HostConfig.Binds}}')"
  ok "environment: $envcount variables · ports: $ports · binds: $binds"
  [ "$binds" -ge 1 ] || bad "no bind mounts — the workspace would be lost"

  local missing=0
  while IFS= read -r src; do
    [ -z "$src" ] && continue
    [ -e "$src" ] || { bad "bind source does not exist on this host: $src"; missing=1; }
  done < <(docker inspect "$SOURCE" --format '{{range .Mounts}}{{println .Source}}{{end}}')
  [ "$missing" -eq 0 ] && ok "every bind source exists on this host"

  # Secrets being rotated: presence, and — when several are named — that they AGREE today.
  # Rotating from an inconsistent state would hide which side was already wrong.
  if [ -n "$ROTATE_VARS" ]; then
    local env_dump first_hash var value this_hash agree=1
    env_dump="$(docker inspect "$SOURCE" --format '{{range .Config.Env}}{{println .}}{{end}}')"
    first_hash=""
    IFS=',' read -r -a _vars <<< "$ROTATE_VARS"
    for var in "${_vars[@]}"; do
      value="$(printf '%s\n' "$env_dump" | awk -F= -v k="$var" '$1==k{print substr($0,index($0,"=")+1)}')"
      if [ -z "$value" ]; then bad "$var is absent or empty in $SOURCE"; agree=0; continue; fi
      ok "$var is present and non-empty"
      # Hashed IN MEMORY and compared; never printed. A printed hash of a secret is a reusable
      # artefact and a printed length narrows a search, so neither leaves this function.
      this_hash="$(printf '%s' "$value" | sha256sum)"
      [ -z "$first_hash" ] && first_hash="$this_hash"
      [ "$this_hash" = "$first_hash" ] || agree=0
      unset value this_hash
    done
    if [ "${#_vars[@]}" -gt 1 ]; then
      [ "$agree" = "1" ] && ok "the named secrets currently agree (in-memory hashes, none shown)" \
                         || bad "the named secrets DISAGREE — resolve that before rotating"
    fi
    unset first_hash env_dump
  fi

  if [ -n "$workspace" ] && [ -d "$workspace" ]; then
    local need free
    need="$(du -sk "$workspace" 2>/dev/null | awk '{print $1}')"
    free="$(df -Pk "$BACKUPS_DIR" 2>/dev/null || df -Pk "$(dirname "$workspace")" 2>/dev/null)"
    free="$(printf '%s\n' "$free" | awk 'NR==2{print $4}')"
    if [ -n "$need" ] && [ -n "$free" ] && [ "$free" -gt $(( need * 3 )) ]; then
      ok "backup space: workspace $(( need / 1024 )) MiB, free $(( free / 1024 )) MiB"
    else bad "not enough free space for a workspace backup with margin"; fi
  else
    warn "no /workspace bind — the backup step will have nothing to copy"
  fi

  docker inspect "${SOURCE}-pre-$(date -u +%Y%m%d)"* >/dev/null 2>&1 \
    && warn "a predecessor from today already exists — §21b permits one rollback container" \
    || ok "the predecessor name is free"
  ok "rollback: rename the predecessor back and start it — it carries the CURRENT configuration"

  say ""
  [ "$FAIL" -eq 0 ] && say "PREFLIGHT: PASS — nothing written, nothing generated, no container touched." \
                    || say "PREFLIGHT: FAIL — resolve the FAIL lines before deploying."
}

preflight
if [ "$MODE" = "check" ]; then
  say ""
  say "MODE=check. Nothing was mutated."
  [ "$FAIL" -eq 0 ] || exit 1
  exit 0
fi

# ══ THE GATE. Everything past this point mutates the installation. ════════════════════════════
[ "$FAIL" -eq 0 ] || { say "REFUSED: preflight failed — not deploying."; exit 1; }
[ "$AUTHORIZED" -eq 1 ] || { say "REFUSED: --apply requires --authorized-by-owner."; exit 2; }
[ -n "$ROTATE_VARS" ] || [ -n "$NEW_IMAGE" ] || { say "REFUSED: --apply changes nothing — name --rotate-secret or --image."; exit 2; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"; ENVFILE="$WORK/env"
BACKUP_ROOT="$BACKUPS_DIR/redeploy_$STAMP"
PREDECESSOR="${SOURCE}-pre-$STAMP"
cleanup() {
  [ -f "$ENVFILE" ] && { command -v shred >/dev/null 2>&1 && shred -u "$ENVFILE" 2>/dev/null || rm -f "$ENVFILE"; }
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# ── STEP 1 · THE WHOLE RECIPE, READ FROM THE SOURCE, BEFORE THE FIRST MUTATION ────────────────
# Every read of $SOURCE lives in this block. Nothing below the rename may name it — that is
# property 1, and the fixture asserts it against this file's own text.
IMAGE_NOW="$(docker inspect "$SOURCE" --format '{{.Config.Image}}')"
IMAGE="${NEW_IMAGE:-$IMAGE_NOW}"
NETWORK="$(docker inspect "$SOURCE" --format '{{.HostConfig.NetworkMode}}')"
RESTART="$(docker inspect "$SOURCE" --format '{{.HostConfig.RestartPolicy.Name}}')"
RO_ROOTFS="$(docker inspect "$SOURCE" --format '{{.HostConfig.ReadonlyRootfs}}')"
WORKSPACE="$(docker inspect "$SOURCE" --format '{{range .Mounts}}{{if eq .Destination "/workspace"}}{{.Source}}{{end}}{{end}}')"
docker inspect "$SOURCE" --format '{{range .Config.Env}}{{println .}}{{end}}' > "$ENVFILE"
chmod 0600 "$ENVFILE"
ENV_COUNT="$(wc -l < "$ENVFILE")"
mapfile -t PORT_FLAGS < <(docker inspect "$SOURCE" --format \
  '{{range $p,$v := .HostConfig.PortBindings}}{{range $v}}-p
{{.HostIp}}:{{.HostPort}}:{{$p}}
{{end}}{{end}}' | sed 's#/tcp$##' | grep -v '^$' || true)
mapfile -t TMPFS_FLAGS < <(docker inspect "$SOURCE" --format \
  '{{range $d,$o := .HostConfig.Tmpfs}}--tmpfs
{{$d}}{{if $o}}:{{$o}}{{end}}
{{end}}' | grep -v '^$' || true)
mapfile -t BIND_FLAGS < <(docker inspect "$SOURCE" --format \
  '{{range .HostConfig.Binds}}-v
{{.}}
{{end}}' | grep -v '^$' || true)
# Two settings that live on the CONTAINER and not in the image. A recreate loses them silently:
#   --stop-timeout : without it Docker falls back to 10s, and a supervisor with a database under
#                    it needs the grace this installation was given (§3a wants a CLEAN shutdown).
#   --log-opt      : without it the json-file driver reverts to unbounded rotation.
STOP_TIMEOUT="$(docker inspect "$SOURCE" --format '{{if .Config.StopTimeout}}{{.Config.StopTimeout}}{{end}}')"
STOP_FLAG=(); [ -n "$STOP_TIMEOUT" ] && STOP_FLAG=(--stop-timeout "$STOP_TIMEOUT")
# SINGLE quotes: the Go template's `$k`/`$v` must reach Docker, not be expanded by the shell into
# nothing — which produces `{{range , := …}}` and a parse error.
mapfile -t LOG_FLAGS < <(docker inspect "$SOURCE" --format '{{range $k,$v := .HostConfig.LogConfig.Config}}--log-opt
{{$k}}={{$v}}
{{end}}' | grep -v '^$' || true)
LOGDRIVER="$(docker inspect "$SOURCE" --format '{{.HostConfig.LogConfig.Type}}')"
LOGDRIVER_FLAG=(); [ -n "$LOGDRIVER" ] && LOGDRIVER_FLAG=(--log-driver "$LOGDRIVER")

# ── STEP 2 · THE COMPLETENESS GUARD — everything needed to CREATE, before anything is STOPPED ──
# The failure this prevents is not hypothetical: a half-read recipe discovered at `docker run`
# leaves production stopped and renamed with nothing to start.
[ -n "$IMAGE" ] && [ -n "$NETWORK" ] && [ "${#BIND_FLAGS[@]}" -gt 0 ] && [ "$ENV_COUNT" -gt 0 ] \
  || { say "REFUSED: the creation recipe is incomplete — nothing has been stopped or renamed."; exit 6; }
ok "recipe complete: image · network · ${#PORT_FLAGS[@]} port flags · ${#BIND_FLAGS[@]} binds · ${#TMPFS_FLAGS[@]} tmpfs · $ENV_COUNT env · ${#LOG_FLAGS[@]} log opts"

# ── STEP 3 · THE CHANGE ITSELF — generated, never printed, never in argv ──────────────────────
if [ -n "$ROTATE_VARS" ]; then
  if command -v openssl >/dev/null 2>&1; then NEW_SECRET="$(openssl rand -hex 32)"
  else NEW_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"; fi
  [ "${#NEW_SECRET}" -ge 32 ] || { say "REFUSED: generated value is shorter than policy"; exit 5; }
  # Through awk's ENVIRON, never through argv: an argument is readable in `ps` by every user on
  # the host for as long as the process lives.
  NEW_SECRET="$NEW_SECRET" ROTATE_VARS="$ROTATE_VARS" awk -F= '
    BEGIN { n=split(ENVIRON["ROTATE_VARS"], a, ","); for (i=1;i<=n;i++) want[a[i]]=1 }
    $1 in want { print $1 "=" ENVIRON["NEW_SECRET"]; next }
    { print }
  ' "$ENVFILE" > "$ENVFILE.next"
  chmod 0600 "$ENVFILE.next"; mv -f "$ENVFILE.next" "$ENVFILE"
  [ "$(wc -l < "$ENVFILE")" -eq "$ENV_COUNT" ] || { say "REFUSED: the rewrite changed the variable count"; exit 6; }
  ROTATE_VARS="$ROTATE_VARS" awk -F= '
    BEGIN { n=split(ENVIRON["ROTATE_VARS"], a, ","); for (i=1;i<=n;i++) want[a[i]]=1 }
    $1 in want { v=substr($0,index($0,"=")+1); if (seen && v!=first) bad=1; if (!seen) {first=v; seen=1} }
    END { exit (seen && !bad && length(first)>0) ? 0 : 1 }
  ' "$ENVFILE" || { say "REFUSED: the rewrite did not give every named variable the same value"; exit 6; }
  ok "the named secrets were rewritten to one new value (none shown)"
  unset NEW_SECRET
fi
[ -n "$NEW_IMAGE" ] && ok "image will change: $IMAGE_NOW -> $IMAGE"

# ── ROLLBACK, AUTOMATIC ───────────────────────────────────────────────────────────────────────
# Printing rollback instructions and hoping somebody runs them is not a rollback.
ROLLED_BACK=0
rollback() {
  say ""
  say "ROLLBACK (automatic): $1"
  docker inspect "$PREDECESSOR" >/dev/null 2>&1 || { say "  CANNOT ROLL BACK: $PREDECESSOR does not exist"; return 1; }
  if docker inspect "$SOURCE" >/dev/null 2>&1; then
    docker stop --timeout "$STOP_GRACE" "$SOURCE" >/dev/null 2>&1 || true
    docker rm "$SOURCE" >/dev/null 2>&1 || { say "  could not remove the failed replacement"; return 1; }
    say "  the failed replacement was removed"
  fi
  docker rename "$PREDECESSOR" "$SOURCE" || { say "  rename back FAILED"; return 1; }
  docker start "$SOURCE" >/dev/null || { say "  start FAILED"; return 1; }
  local deadline s=""
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    s="$(docker inspect "$SOURCE" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || echo none)"
    case "$s" in healthy|none) break ;; esac
    sleep "$HEALTH_INTERVAL"
  done
  case "$s" in healthy|none) ;; *) say "  rolled back, but health is '$s'"; return 1 ;; esac
  ROLLED_BACK=1
  say "  the installation is back on its predecessor, carrying the configuration it had"
  return 0
}
fail_after_rename() { trap - ERR; if rollback "$1"; then exit 4; else say "ROLLBACK FAILED — manual intervention required."; exit 9; fi; }

# ── STEP 4 · STOP WITH GRACE, AND CONFIRM A CLEAN SHUTDOWN RATHER THAN ASSUMING IT ────────────
# Nothing is renamed yet, so a failure here needs no rollback.
docker stop --timeout "$STOP_GRACE" "$SOURCE" >/dev/null || { say "STOP failed. Nothing was renamed."; exit 7; }
docker inspect "$SOURCE" --format '{{.State.Status}} exit={{.State.ExitCode}}' | grep -q '^exited exit=0$' \
  || { say "STOP: $SOURCE did not exit cleanly. Nothing was renamed — investigate."; exit 7; }
ok "clean exit confirmed"

# ── STEP 5 · BACKUP, WITH THE SERVICE STOPPED (§3a 11c) ───────────────────────────────────────
# The container's CONFIGURATION is deliberately not backed up: it would be a file holding the old
# secrets, and it is not needed — the preserved predecessor IS the rollback and carries that
# configuration inside Docker, where it already lives.
if [ -n "$WORKSPACE" ] && [ -d "$WORKSPACE" ]; then
  mkdir -p "$BACKUP_ROOT"; chmod 0700 "$BACKUP_ROOT"
  tar -C "$(dirname "$WORKSPACE")" -cf "$BACKUP_ROOT/workspace.tar" "$(basename "$WORKSPACE")" \
    || { say "BACKUP FAILED. Nothing was renamed."; exit 7; }
  chmod 0600 "$BACKUP_ROOT/workspace.tar"
  sha256sum "$BACKUP_ROOT/workspace.tar" > "$BACKUP_ROOT/workspace.tar.sha256"
  ok "workspace backed up with the service stopped, 0600 in a 0700 directory, checksum written"
  warn "that archive holds whatever the workspace holds, credentials included — treat it as one"
else
  warn "no workspace to back up — declared, not skipped silently"
fi

# ── STEP 6 · PRESERVE THE PREDECESSOR — this IS the rollback ──────────────────────────────────
docker rename "$SOURCE" "$PREDECESSOR" || { say "RENAME FAILED. Nothing was renamed."; exit 7; }
ok "predecessor preserved as $PREDECESSOR"
trap 'fail_after_rename "an unexpected command failed after the rename"' ERR

# ── STEP 7 · CREATE THE REPLACEMENT FROM THE RECIPE READ BACK ─────────────────────────────────
RO_FLAG=(); [ "$RO_ROOTFS" = "true" ] && RO_FLAG=(--read-only)
docker run -d --name "$SOURCE" --env-file "$ENVFILE" --network "$NETWORK" --restart "$RESTART" \
  "${RO_FLAG[@]}" "${STOP_FLAG[@]}" "${LOGDRIVER_FLAG[@]}" "${LOG_FLAGS[@]}" \
  "${PORT_FLAGS[@]}" "${BIND_FLAGS[@]}" "${TMPFS_FLAGS[@]}" "$IMAGE" >/dev/null \
  || fail_after_rename "the replacement could not be created"
ok "replacement created from $IMAGE"

# ── STEP 8 · HEALTH AND THE SUPERVISED CHILDREN, PROVEN NOT ASSUMED ───────────────────────────
deadline=$(( $(date +%s) + HEALTH_TIMEOUT )); status=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  status="$(docker inspect "$SOURCE" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')"
  case "$status" in healthy|none) break ;; esac
  sleep "$HEALTH_INTERVAL"
done
case "$status" in
  healthy) ok "replacement healthy" ;;
  none)    warn "no healthcheck on this image — readiness is UNVERIFIED, declared" ;;
  *)       fail_after_rename "the replacement did not become healthy in time" ;;
esac
for child in $EXPECT_CHILDREN; do
  docker logs "$SOURCE" 2>&1 | grep -q "\"child\":\"$child\"" && ok "child spawned: $child" \
    || fail_after_rename "supervised child $child never appeared"
done
# `|| true` is load-bearing: `grep -c` exits 1 when the count is ZERO, which is the GOOD outcome.
# Without it, under `set -e` with the ERR trap armed, a deployment that succeeded perfectly rolled
# itself back. Found by the fixture, which is the only reason it was not found in production.
AUTH_FAILURES="$(docker logs "$SOURCE" 2>&1 | grep -icE '401|unauthor|x-atom-token' || true)"
say "  auth-failure lines: $AUTH_FAILURES (expected 0)"
[ "$AUTH_FAILURES" = "0" ] || fail_after_rename "the replacement logged authentication failures"
trap - ERR

say ""
say "DEPLOYED. Predecessor kept as $PREDECESSOR — the one rollback §21b permits."
say "  rollback: docker stop --timeout $STOP_GRACE $SOURCE && docker rm $SOURCE \\"
say "            && docker rename $PREDECESSOR $SOURCE && docker start $SOURCE"
say "  what is NOT proven here: anything needing a signed-in session. Verify the product's own"
say "  surfaces before calling this accepted."
exit 0
