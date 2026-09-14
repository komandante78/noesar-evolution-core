#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# The harness's own gates, each seen failing where it must and passing where it must.
# It starts no server, joins no network and stops nothing, so it is safe beside a run in progress:
# every refusal it provokes happens before run-sql-task.sh touches a container.
#
# usage: HIL_WORK=<dir> sh gate-check.sh      (needs at least one generated task, see setup.sh)
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../../.." && pwd)/services/reference-control-plane/src
IMG=node:22-bookworm-slim
: "${HIL_WORK:?HIL_WORK: tasks and runs, see setup.sh}"
set -- "$HIL_WORK"/tasks/sql_*/shared/data/database.sqlite
[ -f "$1" ] || { echo "no generated task in $HIL_WORK/tasks: run setup.sh first"; exit 1; }
N=$(echo "$1" | sed 's|.*/tasks/sql_\([0-9]*\)/.*|\1|')
MUTANT=$(mktemp -d)
# Dummies for what run-sql-task.sh requires before it reads the arm: each refusal below comes first.
REFUSE="HIL_BENCH=/nonexistent HIL_MODEL_CONTAINER=gate-check HIL_NETWORK=gate-check"

echo "=== 1. selfcheck on a mutant with the OLD behaviour (a length reply is never the window): must FAIL"
sed 's/const contextExhausted = (r) => r.status/const contextExhausted = (r) => false \&\& r.status/' "$HERE/hil-sql-agent.mjs" > "$MUTANT/agent.mjs"
echo "mutated lines: $(grep -c 'false && r.status' "$MUTANT/agent.mjs")"
docker run --rm -v "$MUTANT:/m:ro" $IMG node /m/agent.mjs --selfcheck > "$MUTANT/out.txt" 2>&1
echo "exit=$?"
grep -m1 'AssertionError' "$MUTANT/out.txt"

echo "=== 1b. selfcheck on a mutant that never drops a turn (observations only): must FAIL"
sed 's/  if (!starts.length) return null;/  if (starts.length >= 0) return null;/' "$HERE/hil-sql-agent.mjs" > "$MUTANT/agent.mjs"
echo "mutated lines: $(grep -c 'starts.length >= 0' "$MUTANT/agent.mjs")"
docker run --rm -v "$MUTANT:/m:ro" $IMG node /m/agent.mjs --selfcheck > "$MUTANT/out.txt" 2>&1
echo "exit=$?"
grep -m1 'AssertionError' "$MUTANT/out.txt"

echo "=== 2. selfcheck on the real agent: must PASS"
docker run --rm -v "$HERE:/harness:ro" $IMG node /harness/hil-sql-agent.mjs --selfcheck
echo "exit=$?"

echo "=== 3. B1 with no model endpoint: the arm must REFUSE with exit 3, not run as B0"
docker run --rm --network none -v "$SRC:/noesar/src:ro" -e HIL_NOESAR_SRC=/noesar/src -e HIL_MODEL_URL= \
  -v "$HERE:/harness:ro" -v "$HIL_WORK:/work:ro" $IMG node /harness/hil-sql-agent.mjs --smoke "/work/tasks/sql_$N/ask_human"
echo "exit=$?"

echo "=== 4. B1 with an endpoint: the product's router must load with the route on (tools then fail: no network here)"
docker run --rm --network none -v "$SRC:/noesar/src:ro" -e HIL_NOESAR_SRC=/noesar/src \
  -v "$HERE:/harness:ro" -v "$HIL_WORK:/work:ro" $IMG node /harness/hil-sql-agent.mjs --smoke "/work/tasks/sql_$N/ask_human" > "$MUTANT/smoke4.txt" 2>&1
echo "exit=$?"
head -1 "$MUTANT/smoke4.txt" | cut -c1-160

echo "=== 5. runner with an arm that does not exist: must REFUSE before starting anything"
env $REFUSE HIL_NOESAR=bogus RUN=gate-check-bogus sh "$HERE/run-sql-task.sh" "$N"
echo "exit=$?"
if [ -e "$HIL_WORK/runs/gate-check-bogus" ]; then echo "LEFT A DIRECTORY"; else echo "no directory left"; fi

echo "=== 5b. runner in arm B1 with no commit named: must REFUSE before starting anything"
env $REFUSE HIL_NOESAR=interpret RUN=gate-check-nocommit sh "$HERE/run-sql-task.sh" "$N"
echo "exit=$?"
if [ -e "$HIL_WORK/runs/gate-check-nocommit" ]; then echo "LEFT A DIRECTORY"; else echo "no directory left"; fi

echo "=== 5c. runner in arm B1 with a name that is not a commit: must REFUSE before starting anything"
env $REFUSE HIL_NOESAR=interpret HIL_NOESAR_COMMIT=notacommit RUN=gate-check-badcommit sh "$HERE/run-sql-task.sh" "$N"
echo "exit=$?"
if [ -e "$HIL_WORK/runs/gate-check-badcommit" ]; then echo "LEFT A DIRECTORY"; else echo "no directory left"; fi
