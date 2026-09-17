#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The SWE half of HiL-Bench: proves the chain on ONE task, with no model in it.
#
# Their image archive, their gold patch, their verifier. A chain that cannot return 1 on the gold
# patch measures nothing, so this runs before any agent does, and it is what fails loudly when the
# chain rots. It also prints what a task costs: disk inside docker.img, and seconds.
#
# THE IMAGES ARE NOT PINNED, AND THIS SAYS SO INSTEAD OF PRETENDING.
#   Measured 16/09/2026: for ALL 100 tasks the `artifact_bytes`/`artifact_sha256` in their pinned
#   repository disagree with what their bucket serves (swe_0: they name 737300725 / d65f06b0…, the
#   bucket serves 457602550 / d1be766e…, and Hugging Face itself reports the smaller size, so this
#   is their rebuild, not a truncated download). The `image_id` differs too (2134ad94… against their
#   67d6d2dc…): the images were rebuilt, not merely recompressed. Their own warmup_images.sh checks
#   neither, so their pipeline accepts whatever the bucket serves that day without a word.
#   A gate that can never pass is a wall, not a gate. So what an archive IS gets recorded in
#   provenance.json beside the run, and only two things fail here: an archive that does not
#   decompress, and a gold patch that does not score 1.
#   ==> Any SWE number produced this way names the date its images were fetched, the way the SQL
#       half names its judge and its context window.
#
# The archive tree is the one their warmup_images.sh reads, so nothing here forks theirs:
#   $HIL_SWE_ARCH/images/<attempt_id>.tar.zst  ==  HILBENCH_SWE_IMAGE_ARCHIVE_ROOT
#
# Required:
#   HIL_BENCH     their repository (the clone the SQL half uses)
#   HIL_SWE_ARCH  where archives are kept (on a volume with room; NOT inside docker.img)
#   HIL_WORK      where runs are written
#
# usage: HIL_BENCH=<dir> HIL_SWE_ARCH=<dir> HIL_WORK=<dir> sh swe-pipeline-check.sh <N> [--drop]
#        --drop removes the loaded image at the end (a batch does this; a single check keeps it)
set -eu

N=${1:?usage: sh swe-pipeline-check.sh <N> [--drop]}
DROP=${2:-}
HIL_BENCH=${HIL_BENCH:?HIL_BENCH: their repository, the clone the SQL half uses}
HIL_SWE_ARCH=${HIL_SWE_ARCH:?HIL_SWE_ARCH: where the .tar.zst archives are kept}
HIL_WORK=${HIL_WORK:?HIL_WORK: where runs are written}
BUCKET=${HIL_SWE_BUCKET:-ScaleAI/hil-bench-swe-images}

TASK=$HIL_BENCH/harbor_swe/swe_$N
META=$TASK/shared/image_archive.json
OUT=$HIL_WORK/runs/swe-check/swe_$N
[ -f "$META" ] || { echo "swe_$N: no image_archive.json in $TASK/shared"; exit 1; }

field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$META"; }
number() { sed -n "s/.*\"$1\": *\([0-9]*\).*/\1/p" "$META"; }
IMAGE=$(field local_image_ref)
ARTIFACT=$(field artifact_path)
THEIR_SHA=$(field artifact_sha256)
THEIR_IMAGE_ID=$(field image_id)
THEIR_BYTES=$(number artifact_bytes)
[ -n "$IMAGE" ] && [ -n "$ARTIFACT" ] && [ -n "$THEIR_SHA" ] && [ -n "$THEIR_BYTES" ] \
  || { echo "swe_$N: $META does not name local_image_ref/artifact_path/artifact_sha256/artifact_bytes"; exit 1; }

ARCHIVE=$HIL_SWE_ARCH/$ARTIFACT
mkdir -p "$(dirname "$ARCHIVE")" "$OUT/verifier"
echo "swe_$N: $IMAGE"

# ---- 1. the archive ------------------------------------------------------------------------------
# Downloaded to .partial and moved only once zstd has read it end to end: an interrupted download
# must never be found by the next run and taken for a whole one.
DL_S=0
if [ ! -f "$ARCHIVE" ]; then
  echo "--- download from $BUCKET"
  t0=$(date +%s)
  docker run --rm -v "$HIL_SWE_ARCH:/arch" -e HF_HOME=/tmp/hf python:3.12-slim sh -c \
    "pip install --quiet --root-user-action=ignore huggingface_hub && python - <<'PY'
from huggingface_hub import HfFileSystem
HfFileSystem().get('hf://buckets/$BUCKET/$ARTIFACT', '/arch/$ARTIFACT.partial')
PY"
  DL_S=$(( $(date +%s) - t0 ))
  zstd -t "$ARCHIVE.partial" >/dev/null 2>&1 \
    || { echo "swe_$N: the downloaded archive does not decompress; left at $ARCHIVE.partial"; exit 1; }
  mv "$ARCHIVE.partial" "$ARCHIVE"
fi
zstd -t "$ARCHIVE" >/dev/null 2>&1 || { echo "swe_$N: $ARCHIVE does not decompress"; exit 1; }

GOT_SHA=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)
GOT_BYTES=$(wc -c < "$ARCHIVE")
if [ "$GOT_SHA" = "$THEIR_SHA" ]; then ARCHIVE_MATCH=yes; else ARCHIVE_MATCH=no; fi
echo "archive: $GOT_BYTES bytes, sha256 $GOT_SHA"
echo "         their metadata names $THEIR_BYTES / $THEIR_SHA  -> match=$ARCHIVE_MATCH"

# ---- 2. load, measuring what it costs inside docker.img ------------------------------------------
FREE_BEFORE=$(df -k /var/lib/docker | awk 'NR==2 {print $4}')
LOAD_S=0
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "--- load: already present, skipped"
  LOADED=0
else
  echo "--- load"
  t0=$(date +%s)
  zstd -dc "$ARCHIVE" | docker load
  LOAD_S=$(( $(date +%s) - t0 ))
  LOADED=1
fi
FREE_AFTER=$(df -k /var/lib/docker | awk 'NR==2 {print $4}')
COST_MIB=$(( (FREE_BEFORE - FREE_AFTER) / 1024 ))
GOT_IMAGE_ID=$(docker image inspect "$IMAGE" --format '{{.Id}}')
if [ "$GOT_IMAGE_ID" = "$THEIR_IMAGE_ID" ]; then IMAGE_MATCH=yes; else IMAGE_MATCH=no; fi
echo "image id: $GOT_IMAGE_ID"
echo "          their metadata names $THEIR_IMAGE_ID  -> match=$IMAGE_MATCH"

# What this run actually ran, written beside it. Not a pin — a record, which is what can be honest
# while their bucket and their repository disagree.
cat > "$OUT/provenance.json" <<JSON
{
  "task": "swe_$N",
  "fetchedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "bucket": "$BUCKET",
  "archive": { "path": "$ARTIFACT", "bytes": $GOT_BYTES, "sha256": "$GOT_SHA" },
  "image": { "ref": "$IMAGE", "id": "$GOT_IMAGE_ID", "costMiBInDockerImg": $COST_MIB },
  "theirMetadata": { "bytes": $THEIR_BYTES, "sha256": "$THEIR_SHA", "imageId": "$THEIR_IMAGE_ID" },
  "matches": { "archive": "$ARCHIVE_MATCH", "image": "$IMAGE_MATCH" },
  "seconds": { "download": $DL_S, "load": $LOAD_S }
}
JSON

# ---- 3. their gold patch, then their verifier ----------------------------------------------------
# One throwaway container. Their image's ENTRYPOINT is `sh -c "sleep infinity"`, so it is overridden:
# a command passed without --entrypoint becomes an ARGUMENT to sleep and never runs (measured 16/09,
# a container that looked busy for three hours at 0% CPU). Their solve.sh is bash (`set -o pipefail`)
# and must not be run with sh.
# A verdict from an earlier run must not pass for this one: a container that died on its first line
# would leave the old reward.txt standing and the gate would "pass" having measured nothing.
rm -f "$OUT/verifier/reward.txt" "$OUT/verifier/reward.json"
echo "--- their gold patch, then their verifier"
t0=$(date +%s)
docker run --rm --entrypoint bash \
  -v "$TASK/ask_human/tests:/tests:ro" \
  -v "$TASK/ask_human/solution:/solution:ro" \
  -v "$OUT/verifier:/logs/verifier" \
  "$IMAGE" -c 'cd /app && bash /solution/solve.sh && bash /tests/test.sh' >"$OUT/run.txt" 2>&1 || true
RUN_S=$(( $(date +%s) - t0 ))
REWARD=$(cat "$OUT/verifier/reward.txt" 2>/dev/null || echo '')
[ "$DROP" != "--drop" ] || [ "$LOADED" = 0 ] || docker rmi "$IMAGE" >/dev/null

# ---- 4. what was measured ------------------------------------------------------------------------
echo "================ swe_$N ================"
echo "archive (compressed)   : $((GOT_BYTES / 1048576)) MiB     (download ${DL_S}s)"
echo "cost inside docker.img : ${COST_MIB} MiB     (load ${LOAD_S}s)"
echo "gold patch + verifier  : ${RUN_S}s"
echo "pinned to their metadata: archive=$ARCHIVE_MATCH image=$IMAGE_MATCH   (recorded in provenance.json)"
echo "reward                 : ${REWARD:-NONE}"
[ "$REWARD" = "1" ] || { echo "
FAILED: their gold patch did not score 1. The chain measures nothing yet; no agent should be run
against it until this prints 1. The last lines of the run:"; tail -20 "$OUT/run.txt"; exit 1; }
echo "
OK: their gold patch scores 1 through their verifier. The chain holds."
