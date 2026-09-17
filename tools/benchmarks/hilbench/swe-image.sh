#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# One task's image, present locally, and a record of WHICH image that turned out to be.
#
# Their archives are not pinned: measured 16/09/2026, for all 100 tasks the artifact_bytes,
# artifact_sha256 AND image_id in their pinned repository disagree with what their bucket serves
# (the images were rebuilt after the repository was frozen, and their own warmup_images.sh checks
# none of the three). A gate that can never pass is a wall, so this refuses only what is actually
# broken — an archive that does not decompress — and RECORDS the rest into provenance.json.
#
# Prints the image ref on stdout and nothing else, so a caller can capture it. Everything the
# operator should read goes to stderr.
#
#   HIL_BENCH     their repository
#   HIL_SWE_ARCH  where archives are kept (their warmup_images.sh reads this same tree)
#
# usage: IMAGE=$(HIL_BENCH=... HIL_SWE_ARCH=... sh swe-image.sh <N> <provenance.json>)
set -eu
N=${1:?usage: sh swe-image.sh <N> <provenance.json>}
PROV=${2:?a provenance file is not optional: the images are not pinned}
HIL_BENCH=${HIL_BENCH:?HIL_BENCH: their repository}
HIL_SWE_ARCH=${HIL_SWE_ARCH:?HIL_SWE_ARCH: where the .tar.zst archives are kept}
BUCKET=${HIL_SWE_BUCKET:-ScaleAI/hil-bench-swe-images}

META=$HIL_BENCH/harbor_swe/swe_$N/shared/image_archive.json
[ -f "$META" ] || { echo "swe_$N: no image_archive.json" >&2; exit 1; }
field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$META"; }
number() { sed -n "s/.*\"$1\": *\([0-9]*\).*/\1/p" "$META"; }
IMAGE=$(field local_image_ref); ARTIFACT=$(field artifact_path)
THEIR_SHA=$(field artifact_sha256); THEIR_ID=$(field image_id); THEIR_BYTES=$(number artifact_bytes)
[ -n "$IMAGE" ] && [ -n "$ARTIFACT" ] || { echo "swe_$N: $META names no image" >&2; exit 1; }

ARCHIVE=$HIL_SWE_ARCH/$ARTIFACT
mkdir -p "$(dirname "$ARCHIVE")" "$(dirname "$PROV")"
DL_S=0; LOAD_S=0
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  if [ ! -f "$ARCHIVE" ]; then
    echo "swe_$N: downloading $ARTIFACT from $BUCKET" >&2
    t0=$(date +%s)
    docker run --rm -v "$HIL_SWE_ARCH:/arch" -e HF_HOME=/tmp/hf python:3.12-slim sh -c \
      "pip install --quiet --root-user-action=ignore huggingface_hub && python - <<'PY'
from huggingface_hub import HfFileSystem
HfFileSystem().get('hf://buckets/$BUCKET/$ARTIFACT', '/arch/$ARTIFACT.partial')
PY" >&2
    DL_S=$(( $(date +%s) - t0 ))
    # Moved only once zstd has read it end to end: a half-written archive must never be found by
    # the next run and taken for a whole one.
    zstd -t "$ARCHIVE.partial" >/dev/null 2>&1 \
      || { echo "swe_$N: the download does not decompress; kept at $ARCHIVE.partial" >&2; exit 1; }
    mv "$ARCHIVE.partial" "$ARCHIVE"
  fi
  zstd -t "$ARCHIVE" >/dev/null 2>&1 || { echo "swe_$N: $ARCHIVE does not decompress" >&2; exit 1; }
  FREE_BEFORE=$(df -k /var/lib/docker | awk 'NR==2 {print $4}')
  t0=$(date +%s)
  zstd -dc "$ARCHIVE" | docker load >&2
  LOAD_S=$(( $(date +%s) - t0 ))
  COST_MIB=$(( (FREE_BEFORE - $(df -k /var/lib/docker | awk 'NR==2 {print $4}')) / 1024 ))
else
  COST_MIB=0
fi

GOT_SHA=$(sha256sum "$ARCHIVE" 2>/dev/null | cut -d' ' -f1 || echo '')
GOT_BYTES=$(wc -c < "$ARCHIVE" 2>/dev/null || echo 0)
GOT_ID=$(docker image inspect "$IMAGE" --format '{{.Id}}')
cat > "$PROV" <<JSON
{
  "task": "swe_$N",
  "fetchedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "bucket": "$BUCKET",
  "archive": { "path": "$ARTIFACT", "bytes": $GOT_BYTES, "sha256": "$GOT_SHA" },
  "image": { "ref": "$IMAGE", "id": "$GOT_ID", "costMiBInDockerImg": $COST_MIB },
  "theirMetadata": { "bytes": $THEIR_BYTES, "sha256": "$THEIR_SHA", "imageId": "$THEIR_ID" },
  "matches": {
    "archive": "$([ "$GOT_SHA" = "$THEIR_SHA" ] && echo yes || echo no)",
    "image": "$([ "$GOT_ID" = "$THEIR_ID" ] && echo yes || echo no)"
  },
  "seconds": { "download": $DL_S, "load": $LOAD_S }
}
JSON
echo "$IMAGE"
