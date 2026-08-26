#!/usr/bin/env sh
# verify-image-provenance.sh — does the shipped recipe reproduce the shipped product?
#
# `G-02` in docs/GAP_REGISTER.md: `oci/Dockerfile` is the only build recipe that travels in the
# delivery archives, and until this instrument existed nothing had ever checked that an image
# built from it carries the same product as the image actually running. Eighty-seven
# `oci/Dockerfile.phase4-*` overlays were built `FROM` the previous image and the result was
# flattened, so `docker history` on the live image records one layer and no instructions: the
# only way to connect recipe to artefact is to build the recipe and compare the two.
#
# What it compares, and why each part is here rather than assumed:
#
#   1. APPLICATION BYTES — sha256 of every regular file under /opt/noesar in each image.
#      This is the product. Base-layer differences (apt timestamps, /var/lib/dpkg) are NOT
#      compared, because two images built weeks apart from a moving Debian mirror will always
#      differ there and the difference says nothing about the product.
#   2. FILE MODES AND SYMLINKS under /opt/noesar. The launcher's executable bit is load-bearing
#      (oci/Dockerfile, `chmod 0755 … coden-evolution`) and content hashes do not see it.
#   3. RUNTIME CONFIGURATION — Env, Entrypoint, Cmd, User, WorkingDir, ExposedPorts, Volumes and
#      the healthcheck test, read from `docker image inspect`. An image with identical bytes and
#      a different NOESAR_DATA_PLANE is a different product.
#   4. TREE ↔ IMAGE — every file under /opt/noesar that maps back to a repository path is
#      compared against the working tree, so a build from a dirty tree cannot pass quietly.
#
# Usage
#
#   tools/verify-image-provenance.sh <candidate-image> [reference-image]
#
# With one argument it answers "does this image match the tree it claims to be built from".
# With two it also answers "does the candidate carry the same product as the reference".
#
# Exit codes: 0 equal · 1 drift found · 2 usage/precondition error · 3 docker unavailable
# (declared, never silently skipped — CLAUDE10.md §60-64: the host is not the product).
#
# Containers: one `docker run --rm --network none` per image, read-only work, removed by the
# `--rm` in the same command. Authorised by CLAUDE10.md §16's named exception and cleaned up
# by construction rather than by a later step someone can forget.

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CANDIDATE="${1:-}"
REFERENCE="${2:-}"

if [ -z "$CANDIDATE" ]; then
  echo "usage: tools/verify-image-provenance.sh <candidate-image> [reference-image]" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "UNAVAILABLE: docker is not installed on this host — image provenance cannot be measured here."
  echo "This is a declared gap, not a pass."
  exit 3
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

FAILURES=0
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------------------------
# Read one image's product surface into three files. `sh -c` with an explicit entrypoint, so the
# supervisor is never started: this must not boot the product, only read it.
# ---------------------------------------------------------------------------------------------
read_image() {
  _img="$1"
  _out="$2"
  if ! docker image inspect "$_img" >/dev/null 2>&1; then
    echo "PRECONDITION: image not present locally: $_img" >&2
    exit 2
  fi
  docker run --rm --network none --entrypoint /bin/sh "$_img" -c '
    cd /opt/noesar 2>/dev/null || { echo "MISSING /opt/noesar" >&2; exit 9; }
    find . -type f -exec sha256sum {} + | sed "s|  \./|  |" | LC_ALL=C sort -k2
  ' > "$_out.files" 2>"$_out.files.err" || {
    echo "PRECONDITION: could not read /opt/noesar in $_img" >&2
    cat "$_out.files.err" >&2
    exit 2
  }
  docker run --rm --network none --entrypoint /bin/sh "$_img" -c '
    cd /opt/noesar && find . \( -type f -o -type l \) -printf "%y %m %p %l\n" | LC_ALL=C sort -k3
  ' > "$_out.modes" 2>/dev/null || : > "$_out.modes"
  docker image inspect "$_img" --format '{{json .Config.Env}}
{{json .Config.Entrypoint}}
{{json .Config.Cmd}}
{{json .Config.User}}
{{json .Config.WorkingDir}}
{{json .Config.ExposedPorts}}
{{json .Config.Volumes}}
{{json .Config.Healthcheck.Test}}' > "$_out.config"
}

echo "===== IMAGE PROVENANCE ====="
echo "root      : $ROOT"
echo "candidate : $CANDIDATE"
echo "reference : ${REFERENCE:-<none — tree comparison only>}"
echo

read_image "$CANDIDATE" "$WORK/cand"
CAND_N="$(wc -l < "$WORK/cand.files" | tr -d ' ')"
echo "candidate /opt/noesar: $CAND_N files"

# ---------------------------------------------------------------------------------------------
# 4. TREE <-> IMAGE. The mapping is explicit because three copies are renamed by the Dockerfile
# and one directory is built rather than copied; anything not covered here is reported as
# "not from the tree" instead of being silently ignored.
# ---------------------------------------------------------------------------------------------
tree_path_for() {
  case "$1" in
    tools/install-coden-cli.sh)   echo "deployment/container/install-coden-cli.sh" ;;
    tools/Install-CodenCli.ps1)   echo "deployment/container/Install-CodenCli.ps1" ;;
    bin/atomd)                    echo "oci/vendor/atom/atomd" ;;
    bin/atomd.provenance.json)    echo "oci/vendor/atom/atomd.provenance.json" ;;
    bin/noesar-supervisord)       echo "" ;;   # built by the rust stage, no tree counterpart
    bin/noesar-sandbox)           echo "" ;;   # built by the rust stage, no tree counterpart
    llama-runtime/*)              echo "" ;;   # COPY --from=llama-runtime (oci/Dockerfile), a
                                                # digest-pinned public image — no tree counterpart
                                                # by design, see oci/Dockerfile's comment there
    *)                            echo "$1" ;;
  esac
}

echo
echo "----- 4. TREE <-> IMAGE (candidate) -----"
MATCH=0; DIFFER=0; NOTREE=0; BUILT=0
while IFS= read -r line; do
  hash="${line%% *}"
  rel="${line#* }"
  rel="${rel# }"
  mapped="$(tree_path_for "$rel")"
  if [ -z "$mapped" ]; then
    BUILT=$((BUILT + 1))
    continue
  fi
  if [ ! -f "$ROOT/$mapped" ]; then
    NOTREE=$((NOTREE + 1))
    echo "  not-in-tree: $rel"
    continue
  fi
  treehash="$(sha256sum "$ROOT/$mapped" | cut -d' ' -f1)"
  if [ "$treehash" = "$hash" ]; then
    MATCH=$((MATCH + 1))
  else
    DIFFER=$((DIFFER + 1))
    echo "  differs: $rel  (image $hash != tree $treehash)"
  fi
done < "$WORK/cand.files"
echo "  byte-equal to tree: $MATCH · differing: $DIFFER · absent from tree: $NOTREE · built in image: $BUILT"
[ "$DIFFER" -eq 0 ] || fail "$DIFFER file(s) in the image differ from the working tree"
[ "$NOTREE" -eq 0 ] || fail "$NOTREE file(s) in the image have no counterpart in the working tree"

# ---------------------------------------------------------------------------------------------
# 4b. THE OTHER DIRECTION — `D-0568`, found by this tool failing to find something.
#
# Everything above walks the IMAGE and asks the tree about it. That can never see a file the
# recipe forgot to copy, which is precisely the defect `D-0559` repaired
# (`schemas/model-descriptor.schema.json`) — caught then only because a second image happened to
# have it. A one-image run would have said `PASS`.
#
# So: for every `COPY <dir>/ /opt/noesar/<dir>/` in the Dockerfile, every file the tree holds
# under that directory must be in the image. Only directory copies are checked — a single-file
# `COPY` names its own source and cannot silently omit anything, and a directory the recipe never
# copies is not a promise it broke.
# ---------------------------------------------------------------------------------------------
echo
echo "----- 4b. TREE -> IMAGE (nothing the recipe copies is missing) -----"
DOCKERFILE="$ROOT/oci/Dockerfile"
MISSING=0; CHECKED=0
if [ ! -f "$DOCKERFILE" ]; then
  echo "  UNMEASURED: oci/Dockerfile not found at $DOCKERFILE"
else
  awk '{ print $2 }' "$WORK/cand.files" | LC_ALL=C sort > "$WORK/cand.paths"
  # `COPY [--chown=x:y] src/ /opt/noesar/dst/` — directory form only, and never `--from=`.
  grep -E '^COPY ' "$DOCKERFILE" | grep -v -- '--from=' | while IFS= read -r line; do
    src="$(printf '%s\n' "$line" | awk '{ for (i = 2; i <= NF; i++) if ($i !~ /^--/) { print $i; exit } }')"
    dst="$(printf '%s\n' "$line" | awk '{ print $NF }')"
    case "$src" in */) ;; *) continue ;; esac
    case "$dst" in /opt/noesar/*) ;; *) continue ;; esac
    [ -d "$ROOT/$src" ] || continue
    rel="${dst#/opt/noesar/}"
    ( cd "$ROOT/$src" && find . -type f | sed "s|^\./|${rel}|" )
    # Sorted once, at the end: `comm` needs ONE ordered stream, and sorting each COPY's own
    # output leaves the concatenation unordered — which `comm` reports rather than mis-answers.
  done | LC_ALL=C sort -u > "$WORK/expected.paths"
  CHECKED="$(wc -l < "$WORK/expected.paths" | tr -d ' ')"
  comm -23 "$WORK/expected.paths" "$WORK/cand.paths" > "$WORK/missing.paths"
  MISSING="$(wc -l < "$WORK/missing.paths" | tr -d ' ')"
  echo "  expected from directory COPYs: $CHECKED · missing from the image: $MISSING"
  [ "$MISSING" -eq 0 ] || { sed -n '1,20p' "$WORK/missing.paths" | sed 's/^/    missing: /'; }
fi
[ "$MISSING" -eq 0 ] || fail "$MISSING file(s) the recipe copies are absent from the image"

if [ -z "$REFERENCE" ]; then
  echo
  if [ "$FAILURES" -eq 0 ]; then
    echo "RESULT: candidate matches the working tree. No reference image given, so whether it"
    echo "        reproduces a deployed image is UNVERIFIED by this run."
    exit 0
  fi
  echo "RESULT: DRIFT — $FAILURES check(s) failed."
  exit 1
fi

read_image "$REFERENCE" "$WORK/ref"
REF_N="$(wc -l < "$WORK/ref.files" | tr -d ' ')"
echo "reference /opt/noesar: $REF_N files"

echo
echo "----- 1. APPLICATION BYTES (candidate <-> reference) -----"
if diff -u "$WORK/ref.files" "$WORK/cand.files" > "$WORK/files.diff" 2>&1; then
  echo "  identical: $CAND_N files, every sha256 equal"
else
  ONLY_REF="$(grep -c '^-[0-9a-f]' "$WORK/files.diff" || true)"
  ONLY_CAND="$(grep -c '^+[0-9a-f]' "$WORK/files.diff" || true)"
  echo "  differing lines: reference-only $ONLY_REF · candidate-only $ONLY_CAND"
  sed -n '1,80p' "$WORK/files.diff" | sed 's/^/  /'
  fail "application bytes differ between candidate and reference"
fi

echo
echo "----- 2. MODES AND SYMLINKS -----"
if diff -u "$WORK/ref.modes" "$WORK/cand.modes" > "$WORK/modes.diff" 2>&1; then
  echo "  identical"
else
  sed -n '1,40p' "$WORK/modes.diff" | sed 's/^/  /'
  fail "file modes or symlinks differ between candidate and reference"
fi

echo
echo "----- 3. RUNTIME CONFIGURATION -----"
if diff -u "$WORK/ref.config" "$WORK/cand.config" > "$WORK/config.diff" 2>&1; then
  echo "  identical: Env, Entrypoint, Cmd, User, WorkingDir, ExposedPorts, Volumes, Healthcheck"
else
  sed -n '1,60p' "$WORK/config.diff" | sed 's/^/  /'
  fail "runtime configuration differs between candidate and reference"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "RESULT: oci/Dockerfile reproduces $REFERENCE — same product bytes, same modes, same"
  echo "        runtime configuration, and byte-equal to the working tree."
  exit 0
fi
echo "RESULT: DRIFT — $FAILURES check(s) failed. The shipped recipe does not reproduce the"
echo "        shipped product; see the diffs above."
exit 1
