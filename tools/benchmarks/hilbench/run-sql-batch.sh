#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Both arms, task by task: B0 (the model with their prompt), then B1 (the same agent after NOESAR has
# asked). Interleaved per task, so whatever else the machine does during the hours this takes falls
# on both arms alike instead of on one of them. Resumable: a task already graded is skipped.
#
# B1 runs ONE commit for the whole batch, pinned in $HIL_WORK/runs/b1-full.commit at the first start
# (HIL_NOESAR_COMMIT, or this repository's HEAD) and read back on every restart: a restart after the
# repository has moved must not mix two commits in one run.
#
# usage: sh run-sql-batch.sh [from] [to]      with the variables run-sql-task.sh requires
set -u
FROM=${1:-0}
TO=${2:-99}
HERE=$(cd "$(dirname "$0")" && pwd)
HIL_WORK=${HIL_WORK:?HIL_WORK: tasks and runs, see setup.sh}
PIN=$HIL_WORK/runs/b1-full.commit
mkdir -p "$HIL_WORK/runs"
if [ ! -f "$PIN" ]; then
  COMMIT=$(git -C "$HERE" rev-parse --verify --quiet "${HIL_NOESAR_COMMIT:-HEAD}^{commit}") || { echo "'${HIL_NOESAR_COMMIT:-HEAD}' is not a commit"; exit 1; }
  echo "$COMMIT" > "$PIN"
fi
COMMIT=$(cat "$PIN")
echo "batch $FROM-$TO start $(date '+%F %T'), B1 at $COMMIT"
for N in $(seq "$FROM" "$TO"); do
  RUN=b0-full sh "$HERE/run-sql-task.sh" "$N"
  RUN=b1-full HIL_NOESAR=interpret HIL_NOESAR_COMMIT=$COMMIT sh "$HERE/run-sql-task.sh" "$N"
done
echo "batch $FROM-$TO done $(date '+%F %T')"
