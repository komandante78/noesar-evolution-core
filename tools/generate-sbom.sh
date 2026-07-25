#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Produce CycloneDX and SPDX SBOMs for the image and for the source tree.
#
# Two decisions worth stating:
#
#   * syft runs from a container pinned BY DIGEST, not from a host installation. Nothing is
#     installed on this host (CLAUDE10 rule 45), and "whatever :latest is today" would make
#     the output unreproducible.
#   * the image is exported with `docker save` and scanned as a tar archive rather than
#     through the Docker daemon. That means the SBOM container never gets the Docker
#     socket — the socket this product's own threat model refuses to mount anywhere.
#
# Usage: tools/generate-sbom.sh [IMAGE_TAG]

set -euo pipefail

IMAGE="${1:-noesar-evolution:phase4-complete}"
SYFT_IMAGE="${NOESAR_SYFT_IMAGE:-anchore/syft@sha256:13b53ebabe3d215268c90cf8fb9b875f0183908245f376fd4b3a2cb69d21d484}"
PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
OUT="${NOESAR_SBOM_OUT:-${ARTIFACT_ROOT:-/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS}/sbom}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$OUT"

SYFT_VERSION="$(docker run --rm "$SYFT_IMAGE" version 2>/dev/null | awk '/^Version:/{print $2}')"
IMAGE_ID="$(docker image inspect "$IMAGE" --format '{{.Id}}')"
BASE_DIGEST="$(docker image inspect noesar-evolution:phase3 --format '{{index .Config.Labels "org.noesar.base-image"}}' 2>/dev/null || echo unknown)"

echo "SBOM_TOOL=syft"
echo "SBOM_TOOL_VERSION=${SYFT_VERSION}"
echo "SBOM_TOOL_IMAGE=${SYFT_IMAGE}"
echo "SBOM_TARGET_IMAGE=${IMAGE}"
echo "SBOM_TARGET_IMAGE_ID=${IMAGE_ID}"
echo "SBOM_GENERATED_UTC=${STAMP}"

# ---- image ------------------------------------------------------------------
echo "exporting ${IMAGE} to a tar archive (no Docker socket is shared with syft)" >&2
docker save "$IMAGE" -o "$OUT/image.tar"

for FORMAT in cyclonedx-json spdx-json; do
  echo "scanning image -> ${FORMAT}" >&2
  docker run --rm \
    -v "$OUT":/work \
    -e SYFT_CHECK_FOR_APP_UPDATE=false \
    "$SYFT_IMAGE" \
    scan "docker-archive:/work/image.tar" -o "${FORMAT}=/work/image.${FORMAT}.json" -q
done

# ---- source tree -------------------------------------------------------------
# Mounted read-only at /src so the recorded paths are repository-relative and carry no
# host path, and so a scan can never modify what it is describing.
for FORMAT in cyclonedx-json spdx-json; do
  echo "scanning source tree -> ${FORMAT}" >&2
  docker run --rm \
    -v "$PROJECT_ROOT":/src:ro \
    -v "$OUT":/work \
    -e SYFT_CHECK_FOR_APP_UPDATE=false \
    "$SYFT_IMAGE" \
    scan "dir:/src" -o "${FORMAT}=/work/source.${FORMAT}.json" -q
done

# The tar is an intermediate, not a deliverable, and an 800 MB archive must never end up
# near the repository. Removed once both image SBOMs exist.
if [ -s "$OUT/image.cyclonedx-json.json" ] && [ -s "$OUT/image.spdx-json.json" ]; then
  rm -f "$OUT/image.tar"
fi

cd "$OUT"
sha256sum ./*.json > SHA256SUMS.txt

{
  echo "tool=syft"
  echo "tool_version=${SYFT_VERSION}"
  echo "tool_image=${SYFT_IMAGE}"
  echo "target_image=${IMAGE}"
  echo "target_image_id=${IMAGE_ID}"
  echo "base_image_label=${BASE_DIGEST}"
  echo "generated_utc=${STAMP}"
  echo "command_image=syft scan docker-archive:image.tar -o <format>"
  echo "command_source=syft scan dir:/src -o <format>"
} > PROVENANCE.txt

echo
echo "--- artefacts ---"
ls -la "$OUT"
echo
cat SHA256SUMS.txt
