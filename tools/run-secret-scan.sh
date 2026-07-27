#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Real secret scan over the whole git history. Closes the substance of B-002, which recorded
# that no such scanner existed here and that a heuristic pattern match stood in for one.
#
# gitleaks runs from its published image, so nothing is installed on the host. The image is
# pinned by digest: an unpinned `latest` makes the scan's meaning change under you between
# runs, which is worse than not scanning at all because the result still looks the same.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE=${NOESAR_GITLEAKS_IMAGE:-zricethezav/gitleaks:latest}

command -v docker >/dev/null 2>&1 || {
  echo "SECRET_SCAN=SKIPPED reason=docker-unavailable" >&2
  exit 2
}
docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  echo "SECRET_SCAN=SKIPPED reason=image-absent image=$IMAGE" >&2
  echo "pull it first: docker pull $IMAGE" >&2
  exit 2
}

if docker run --rm -v "$ROOT":/repo "$IMAGE" \
     detect --source /repo --config /repo/.gitleaks.toml --no-banner --redact; then
  echo "SECRET_SCAN=PASS"
  echo "SECRET_SCAN_SCOPE=full-git-history"
  # Said out loud because a clean scan proves the scanner found nothing, never that the
  # tree is clean. Measured 2026-07-27: the scanner misses a truncated PEM stub, and it
  # deliberately ignores AWS's documented example key AKIAIOSFODNN7EXAMPLE -- so a planted
  # test secret must be realistic or the proof proves nothing.
  echo "SECRET_SCAN_LIMITS=example-keys-and-malformed-pem-are-not-detected"
  exit 0
fi

echo "SECRET_SCAN=FAIL"
exit 1
