#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# The SWE half, both arms, task by task: run-sql-batch.sh with run-swe-task.sh in its place. B0, then
# B1, interleaved per task, so whatever else the machine does during the hours this takes falls on both
# arms alike. Resumable: run-swe-task.sh skips a task already graded (its verifier/stdout.txt).
#
# B1 runs ONE commit for the whole batch, pinned in $HIL_WORK/runs/<B1 run>.commit at the first start
# (HIL_NOESAR_COMMIT, or this repository's HEAD) and read back on every restart: a restart after the
# repository has moved must not mix two commits in one run.
#
# HIL_B0_RUN / HIL_B1_RUN name the two runs (default b0-swe / b1-swe). A batch under new conditions
# takes new names: the scorer refuses a run that mixes them, and resuming would skip what is graded.
#
# ponytail: task images stay loaded after their task; nothing here removes one. Fine for a handful of
# tasks (swe_0 cost 1.2 GiB inside docker.img; the largest archive is 5.77 GiB compressed). A batch of
# all 100 needs a drop step between tasks.
#
# usage: sh run-swe-batch.sh [from] [to]      with the variables run-swe-task.sh requires
set -u
FROM=${1:-0}
TO=${2:-99}
HERE=$(cd "$(dirname "$0")" && pwd)
HIL_WORK=${HIL_WORK:?HIL_WORK: tasks and runs}
B0=${HIL_B0_RUN:-b0-swe}
B1=${HIL_B1_RUN:-b1-swe}
PIN=$HIL_WORK/runs/$B1.commit
mkdir -p "$HIL_WORK/runs"
if [ ! -f "$PIN" ]; then
  COMMIT=$(git -C "$HERE" rev-parse --verify --quiet "${HIL_NOESAR_COMMIT:-HEAD}^{commit}") || { echo "'${HIL_NOESAR_COMMIT:-HEAD}' is not a commit"; exit 1; }
  echo "$COMMIT" > "$PIN"
fi
COMMIT=$(cat "$PIN")
echo "swe batch $FROM-$TO start $(date '+%F %T'), runs $B0 / $B1, B1 at $COMMIT"
for N in $(seq "$FROM" "$TO"); do
  RUN=$B0 sh "$HERE/run-swe-task.sh" "$N"
  RUN=$B1 HIL_NOESAR=interpret HIL_NOESAR_COMMIT=$COMMIT sh "$HERE/run-swe-task.sh" "$N"
done
echo "swe batch $FROM-$TO done $(date '+%F %T')"
