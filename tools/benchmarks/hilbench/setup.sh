#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# The SQL half of HiL-Bench, set up the way the NOESAR runs were set up: their repository at a pinned
# commit, their dataset at a pinned revision, their generator, their images. A step already done is
# skipped, so this can be run again.
#
#   HIL_BENCH          where their repository is, or is to be cloned
#   HIL_WORK           where tasks/, runs/ and the rebuilt CSV go (all 100 tasks take 19 GB)
#   HIL_GENERATE_ARGS  default --all; e.g. "--indices 0 1 2" for fewer tasks
#
# usage: HIL_BENCH=<dir> HIL_WORK=<dir> sh setup.sh
set -eu
HIL_BENCH=${HIL_BENCH:?HIL_BENCH: where the hil-bench repository is, or is to be cloned}
HIL_WORK=${HIL_WORK:?HIL_WORK: where tasks, runs and the CSV go}
GENERATE_ARGS=${HIL_GENERATE_ARGS:---all}
HERE=$(cd "$(dirname "$0")" && pwd)
COMMIT=a98052f7bcb3a92d6ce1a3c1da20237b8b3d2e8c

[ -d "$HIL_BENCH/.git" ] || git clone -q https://github.com/hilbenchauthors/hil-bench.git "$HIL_BENCH"
[ "$(git -C "$HIL_BENCH" rev-parse HEAD)" = "$COMMIT" ] || git -C "$HIL_BENCH" checkout -q "$COMMIT"
mkdir -p "$HIL_WORK/tasks" "$HIL_WORK/runs"

if ls "$HIL_WORK"/tasks/sql_*/shared/data/database.sqlite >/dev/null 2>&1; then
  echo "tasks: already in $HIL_WORK/tasks, not regenerated"
else
  # Their repository read-only: the generator writes only to --output-dir.
  docker run --rm -v "$HIL_BENCH:/hil-bench:ro" -v "$HIL_WORK:/work" -v "$HERE:/harness:ro" \
    -e HF_HOME=/work/hfcache -w /hil-bench python:3.12-slim sh -c "
      set -e
      pip install --quiet --root-user-action=ignore pandas pyarrow datasets huggingface_hub
      pip freeze | grep -iE '^(pandas|pyarrow|datasets|huggingface.hub)==' > /work/setup-versions.txt
      python /harness/build-csv.py /hil-bench /work/sql_delivered_tasks_and_attempts_PUBLIC.csv
      python harbor_sql/generate_harbor_sql_tasks.py $GENERATE_ARGS --output-dir /work/tasks --csv-path /work/sql_delivered_tasks_and_attempts_PUBLIC.csv
    "
fi

missing=''
for image in sql-tools business-info ask-human sql-main; do
  docker image inspect "hil-bench-harbor/$image:latest" >/dev/null 2>&1 || missing="$missing $image"
done
if [ -n "$missing" ]; then
  echo "images: building$missing"
  bash "$HIL_BENCH/harbor_sql/build_images.sh"
  # The verifier's image. Its Dockerfile is the same in every task (one sha256 across all 100):
  # built once, from the first task generated.
  set -- "$HIL_WORK"/tasks/sql_*/ask_human/environment
  docker build -q -t hil-bench-harbor/sql-main:latest "$1"
fi
echo "setup: $(ls -d "$HIL_WORK"/tasks/sql_* | wc -l) tasks in $HIL_WORK/tasks; hil-bench at $(git -C "$HIL_BENCH" rev-parse --short HEAD)"
