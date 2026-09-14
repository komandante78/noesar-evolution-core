#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# One HiL-Bench SQL task, end to end:
#   fresh MCP servers (the ask-human server keeps its metrics IN MEMORY, so a task never shares one),
#   the agent (hil-sql-agent.mjs), then THEIR verifier (tests/test_verify.py) writing reward.json.
#
# This file names no machine. Required:
#   HIL_BENCH            their repository (setup.sh)
#   HIL_WORK             tasks/ and runs/ (setup.sh); snapshots of NOESAR go to noesar-src/
#   HIL_MODEL_CONTAINER  the container whose network namespace serves the model at HIL_MODEL_URL
#                        (default http://127.0.0.1:8420). The judge and the agent JOIN that namespace:
#                        the model is reached without being exposed.
#   HIL_NETWORK          a Docker network that container is attached to; the two other MCP servers
#                        join it, and the agent reaches them by name through it.
#
# usage: RUN=<name> sh run-sql-task.sh <N>                                               arm B0
#        RUN=<name> HIL_NOESAR=interpret HIL_NOESAR_COMMIT=<sha> sh run-sql-task.sh <N>  arm B1
set -eu
N=$1
RUN=${RUN:?RUN is required: two runs never share an output directory}
HIL_BENCH=${HIL_BENCH:?HIL_BENCH: their repository, see setup.sh}
HIL_WORK=${HIL_WORK:?HIL_WORK: tasks and runs, see setup.sh}
MODEL_CONTAINER=${HIL_MODEL_CONTAINER:?HIL_MODEL_CONTAINER: the container serving the model}
NETWORK=${HIL_NETWORK:?HIL_NETWORK: a network that container is attached to}
MODEL_URL=${HIL_MODEL_URL:-http://127.0.0.1:8420}
# The model name the judge sends, as the 14/09/2026 runs sent it.
MODEL=${HIL_JUDGE_MODEL:-/models/Qwen3.6-35B-A3B-UD-IQ4_XS.gguf}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
TASK=$HIL_WORK/tasks/sql_$N
OUT=$HIL_WORK/runs/$RUN/sql_$N

[ -f "$TASK/shared/data/database.sqlite" ] || { echo "sql_$N: no database.sqlite in $TASK"; exit 1; }
[ ! -e "$OUT/verifier/reward.json" ] || { echo "sql_$N: already graded in $OUT"; exit 0; }

# Arm B1: the product's reasoning sources at a NAMED commit, extracted once with `git archive` and
# mounted read-only. Never the working tree: a batch takes a day, and the repository must stay free
# to move during it without a task running other code than the commit it names.
# Checked before anything starts.
SRC=services/reference-control-plane/src
NOESAR_ARGS=""
if [ "${HIL_NOESAR:-}" = interpret ]; then
  [ -n "${HIL_NOESAR_COMMIT:-}" ] || { echo "sql_$N: arm B1 names the commit it runs: HIL_NOESAR_COMMIT=<sha>"; exit 1; }
  COMMIT=$(git -C "$REPO" rev-parse --verify --quiet "$HIL_NOESAR_COMMIT^{commit}") || { echo "sql_$N: '$HIL_NOESAR_COMMIT' is not a commit"; exit 1; }
  SNAP=$HIL_WORK/noesar-src/$COMMIT
  if [ ! -d "$SNAP" ]; then
    mkdir -p "$SNAP.partial"
    git -C "$REPO" archive "$COMMIT" "$SRC" | tar -x -C "$SNAP.partial"
    mv "$SNAP.partial" "$SNAP"
  fi
  NOESAR_ARGS="-v $SNAP/$SRC:/noesar/src:ro -e HIL_NOESAR_SRC=/noesar/src -e HIL_NOESAR_COMMIT=$COMMIT"
elif [ -n "${HIL_NOESAR:-}" ]; then
  echo "sql_$N: HIL_NOESAR='$HIL_NOESAR' is not an arm (interpret, or unset)"; exit 1
fi

mkdir -p "$OUT/harbor_shared" "$OUT/verifier"

stop_servers() { docker stop hil-sql-tools hil-business-info hil-ask-human >/dev/null 2>&1 || true; }
trap stop_servers EXIT
stop_servers

docker run -d --rm --name hil-sql-tools --network "$NETWORK" \
  -v "$TASK/shared/data:/data:ro" -v "$OUT/harbor_shared:/harbor_shared" \
  -e DATA_DIR=/data -e SUBMISSION_FILE=/harbor_shared/submitted_query.sql -e SQL_QUERY_TIMEOUT_SECONDS=1200 \
  hil-bench-harbor/sql-tools:latest >/dev/null
docker run -d --rm --name hil-business-info --network "$NETWORK" \
  -v "$TASK/shared/data:/data:ro" -e DATA_DIR=/data \
  hil-bench-harbor/business-info:latest >/dev/null
# ask-human shares the model's network namespace: the judge reaches the model without exposing it,
# and the agent reaches ask-human on 127.0.0.1:8000.
docker run -d --rm --name hil-ask-human --network "container:$MODEL_CONTAINER" \
  -v "$TASK/shared/ask-human-data:/ask-human-data:ro" -v "$OUT/harbor_shared:/harbor_shared" \
  -e BLOCKER_REGISTRY_PATH=/ask-human-data/blocker_registry.json -e OUTPUT_DIR=/harbor_shared \
  -e ASK_HUMAN_BACKEND=vllm -e VLLM_BASE_URL="$MODEL_URL" -e VLLM_MODEL="$MODEL" \
  hil-bench-harbor/ask-human:latest >/dev/null

agent() {
  # $NOESAR_ARGS unquoted on purpose: it is a list of arguments, and no path in it has a space.
  docker run --rm --network "container:$MODEL_CONTAINER" $NOESAR_ARGS -e HIL_MODEL_URL="$MODEL_URL" \
    -v "$HIL_BENCH:/bench/hil-bench:ro" -v "$HERE:/harness:ro" -v "$HIL_WORK:/work" \
    node:22-bookworm-slim node /harness/hil-sql-agent.mjs "$@"
}
tries=0
while :; do
  rc=0
  agent --smoke "/work/tasks/sql_$N/ask_human" >"$OUT/smoke.txt" 2>&1 || rc=$?
  [ $rc -ne 0 ] || break
  # 3 = the agent refused the arm itself; retrying cannot fix that.
  [ $rc -ne 3 ] || { echo "sql_$N: $(tail -1 "$OUT/smoke.txt")"; exit 1; }
  tries=$((tries + 1)); [ $tries -lt 30 ] || { echo "sql_$N: MCP servers never became ready: $(tail -1 "$OUT/smoke.txt")"; exit 1; }
  sleep 2
done

agent "/work/tasks/sql_$N/ask_human" "/work/runs/$RUN/sql_$N/trajectory.json" || echo "sql_$N: agent failed, grading what it left"

docker run --rm \
  -v "$TASK/shared/data:/data:ro" -v "$OUT/harbor_shared:/harbor_shared" \
  -v "$TASK/ask_human/tests:/tests:ro" -v "$OUT/verifier:/logs/verifier" \
  hil-bench-harbor/sql-main:latest python /tests/test_verify.py >"$OUT/verifier/stdout.txt" 2>&1 || true
echo "sql_$N: $(cat "$OUT/verifier/reward.json" 2>/dev/null || echo 'NO reward.json')"
