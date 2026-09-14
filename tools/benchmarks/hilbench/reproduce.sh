#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# The SQL half of HiL-Bench for NOESAR, in one command: setup (skipped where done), both arms on
# every task, both scores. A day or more on one consumer GPU; resumable by running it again.
#
# usage: HIL_BENCH=<dir> HIL_WORK=<dir> HIL_MODEL_CONTAINER=<name> HIL_NETWORK=<name> \
#          sh reproduce.sh [from] [to]
#        (see README.md for what each one is)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
sh "$HERE/setup.sh"
sh "$HERE/run-sql-batch.sh" "${1:-0}" "${2:-99}"
for arm in b0-full b1-full; do
  echo "=== $arm"
  docker run --rm -v "$HERE:/harness:ro" -v "$HIL_WORK:/work:ro" node:22-bookworm-slim \
    node /harness/hil-sql-score.mjs "/work/runs/$arm"
done
