#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# One HiL-Bench SWE task, end to end, in two arms that differ in one thing only:
#   B0  their SWE-agent, their tools, their prompt, on the local model.
#   B1  the same, after NOESAR has asked (see hil-noesar-ask.mjs).
#
# What is theirs and is not reimplemented here: the agent (SWE-agent 1.1.0), its tool bundles, the
# config for this model (configs/swe/ask_config_qwen3_30b_a3b_instruct_2507.yaml), the judge
# (hil-bench-harbor/ask-human) and the verifier (the task's own tests/test.sh). What is ours: the
# wiring, and the one piece they did not publish — the host server their ask_human tool posts to,
# which is hil-ask-bridge.mjs.
#
#   HIL_BENCH            their repository
#   HIL_SWE_ARCH         where the image archives are kept
#   HIL_WORK             tasks, runs, NOESAR snapshots
#   HIL_MODEL_CONTAINER  the container whose network namespace serves the model at HIL_MODEL_URL.
#                        The judge and the bridge JOIN it, so the model is never exposed; the task
#                        container reaches the bridge at http://$HIL_MODEL_CONTAINER:8521/ask over
#                        HIL_NETWORK, which is a network that container is attached to.
#   HIL_NETWORK          that network
#
# usage: RUN=<name> sh run-swe-task.sh <N>                                               arm B0
#        RUN=<name> HIL_NOESAR=interpret HIL_NOESAR_COMMIT=<sha> sh run-swe-task.sh <N>  arm B1
set -eu
N=$1
RUN=${RUN:?RUN is required: two runs never share an output directory}
HIL_BENCH=${HIL_BENCH:?HIL_BENCH: their repository}
HIL_SWE_ARCH=${HIL_SWE_ARCH:?HIL_SWE_ARCH: where the image archives are kept}
HIL_WORK=${HIL_WORK:?HIL_WORK: tasks and runs}
MODEL_CONTAINER=${HIL_MODEL_CONTAINER:?HIL_MODEL_CONTAINER: the container serving the model}
NETWORK=${HIL_NETWORK:?HIL_NETWORK: a network that container is attached to}
MODEL_URL=${HIL_MODEL_URL:-http://127.0.0.1:8420}
MODEL=${HIL_JUDGE_MODEL:-/models/Qwen3.6-35B-A3B-UD-IQ4_XS.gguf}
# Their agent cap for a SWE task (task.toml: agent.timeout_sec 7200). Used for the whole task here,
# and as the lifetime of the sidecars, so a runner that dies leaves nothing running behind it: that
# is why this does not use `docker stop` in a trap the way its SQL sibling does.
BUDGET=${HIL_TASK_TIMEOUT:-7200}
AGENT_IMAGE=${HIL_AGENT_IMAGE:-hil-swe-agent:1.1.0}

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
SWEAGENT=$HIL_BENCH/SWE-agent
TASK=$HIL_BENCH/harbor_swe/swe_$N
CONFIG=${HIL_SWE_CONFIG:-$HIL_BENCH/configs/swe/ask_config_qwen3_30b_a3b_instruct_2507.yaml}
OUT=$HIL_WORK/runs/$RUN/swe_$N
INSTANCE=swe_$N

[ -f "$TASK/shared/problem_statement.txt" ] || { echo "swe_$N: no problem_statement.txt in $TASK/shared"; exit 1; }
[ -f "$TASK/shared/metadata.json" ] || { echo "swe_$N: no metadata.json in $TASK/shared"; exit 1; }
[ -f "$CONFIG" ] || { echo "swe_$N: their config is not at $CONFIG"; exit 1; }
# verifier/stdout.txt, not reward.txt: their verifier writes a reward only when there is a patch, and a
# task without one is graded too (reward 0, with its reason). hil-swe-score.mjs reads the same file.
[ ! -e "$OUT/verifier/stdout.txt" ] || { echo "swe_$N: already graded in $OUT"; exit 0; }
mkdir -p "$OUT/verifier" "$OUT/agent"

# Arm B1: the product's reasoning sources at a NAMED commit, extracted with `git archive` and mounted
# read-only. Never the working tree: a batch takes days, and the repository must stay free to move
# during it without a task running other code than the commit it names.
SRC=services/reference-control-plane/src
ARM=B0
NOESAR_MOUNT=""
if [ "${HIL_NOESAR:-}" = interpret ]; then
  ARM=B1
  [ -n "${HIL_NOESAR_COMMIT:-}" ] || { echo "swe_$N: arm B1 names the commit it runs: HIL_NOESAR_COMMIT=<sha>"; exit 1; }
  COMMIT=$(git -C "$REPO" rev-parse --verify --quiet "$HIL_NOESAR_COMMIT^{commit}") || { echo "swe_$N: '$HIL_NOESAR_COMMIT' is not a commit"; exit 1; }
  SNAP=$HIL_WORK/noesar-src/$COMMIT
  if [ ! -d "$SNAP" ]; then
    mkdir -p "$SNAP.partial"
    git -C "$REPO" archive "$COMMIT" "$SRC" | tar -x -C "$SNAP.partial"
    mv "$SNAP.partial" "$SNAP"
  fi
  NOESAR_MOUNT="-v $SNAP/$SRC:/noesar/src:ro"
elif [ -n "${HIL_NOESAR:-}" ]; then
  echo "swe_$N: HIL_NOESAR='$HIL_NOESAR' is not an arm (interpret, or unset)"; exit 1
fi
echo "swe_$N: arm $ARM, run $RUN"

IMAGE=$(HIL_BENCH="$HIL_BENCH" HIL_SWE_ARCH="$HIL_SWE_ARCH" sh "$HERE/swe-image.sh" "$N" "$OUT/provenance.json")
echo "swe_$N: image $IMAGE"

# ---- their judge and the bridge, in the model's network namespace --------------------------------
# All of them share that namespace, and so its ports: sidecars that outlive their task make the next
# task fail to bind 8000/8521/8421. Measured 16/09/2026 — an agent that exited in 5 s left its judge
# and bridge up for the whole 30-minute budget. So they end when this task ends ($OUT/.done, written
# on every exit of this script), and the budget's timeout stays only as the net for a runner that is
# killed outright and never gets to write it.
for s in judge bridge; do
  if docker ps -q --filter "name=^hil-swe-$s-$N$" | grep -q .; then
    echo "swe_$N: hil-swe-$s-$N is still running from an earlier run; it ends by itself within ${BUDGET}s, or remove it"
    exit 1
  fi
done
rm -f "$OUT/.done"
trap 'touch "$OUT/.done"' EXIT
docker run -d --rm --name "hil-swe-judge-$N" --network "container:$MODEL_CONTAINER" --entrypoint sh \
  -v "$TASK/shared/ask-human-data:/ask-human-data:ro" -v "$OUT:/harbor_shared" \
  -e BLOCKER_REGISTRY_PATH=/ask-human-data/blocker_registry.json -e OUTPUT_DIR=/harbor_shared \
  -e ASK_HUMAN_BACKEND=vllm -e VLLM_BASE_URL="$MODEL_URL" -e VLLM_MODEL="$MODEL" \
  hil-bench-harbor/ask-human:latest -c "timeout $BUDGET sh -c 'python server.py & p=\$!; while kill -0 \$p 2>/dev/null && [ ! -e /harbor_shared/.done ]; do sleep 2; done; kill \$p 2>/dev/null'" >/dev/null
# The agent runs on the HOST network (SWE-ReX dials 127.0.0.1:<published port>, docker.py:270), and
# the model is bound to 127.0.0.1 inside its own container: the bridge carries the forward that makes
# it reachable at the model container's address on HIL_NETWORK (see hil-ask-bridge.mjs).
docker run -d --rm --name "hil-swe-bridge-$N" --network "container:$MODEL_CONTAINER" \
  -v "$HERE:/h:ro" -v "$OUT:/out" \
  -e HIL_FORWARD="8421:$(echo "$MODEL_URL" | sed 's|.*:||')" -e HIL_DONE_FILE=/out/.done \
  node:22-bookworm-slim timeout "$BUDGET" node /h/hil-ask-bridge.mjs /out/ask.jsonl >/dev/null
MODEL_IP=$(docker inspect "$MODEL_CONTAINER" --format "{{(index .NetworkSettings.Networks \"$NETWORK\").IPAddress}}")
[ -n "$MODEL_IP" ] || { echo "swe_$N: $MODEL_CONTAINER has no address on $NETWORK"; exit 1; }
AGENT_MODEL_URL=http://$MODEL_IP:8421

# The agent reaches the model AND the bridge's /ask, or this run does not start. Checked from the host
# network, which is where the agent will run, against the same doors it will knock on. /ask opens only
# once their judge answers (hil-ask-bridge.mjs, serve()), so it covers the judge too; a GET gets a 404,
# which curl counts as reached. Measured 17/09/2026 (b1-swe-07): with only the model checked, arm B1's
# first question hit ECONNREFUSED on :8521 while the bridge was still waiting for the judge — B0 never
# saw it, because the agent takes longer to start than the judge. 30 tries: the bridge waits 30 x 2 s.
ok=no
for _ in $(seq 30); do
  if docker run --rm --network host curlimages/curl:latest -s -o /dev/null --max-time 5 "$AGENT_MODEL_URL/v1/models" \
     && docker run --rm --network host curlimages/curl:latest -s -o /dev/null --max-time 5 "http://$MODEL_IP:8521/ask"; then
    ok=yes; break
  fi
  sleep 2
done
[ "$ok" = yes ] || { echo "swe_$N: the model or the bridge is not reachable at $MODEL_IP (8421, 8521) — bridge log:"; docker logs "hil-swe-bridge-$N" 2>&1 | tail -5; exit 1; }
echo "swe_$N: model reachable at $AGENT_MODEL_URL, bridge at http://$MODEL_IP:8521/ask"

# ---- the problem statement, and arm B1's questions before the first turn -------------------------
# THEIR problem statement for SWE-agent is shared/problem_statement.txt, as their own instance builder
# reads it (hil_bench/utils/instance_utils.py). ask_human/instruction.md is the Harbor rendering of
# the same task and wraps it in Harbor's own text; SWE-agent wraps it again in <pr_description>.
STATEMENT=$OUT/problem_statement.md
cp "$TASK/shared/problem_statement.txt" "$STATEMENT"
if [ "$ARM" = B1 ]; then
  # In the model's namespace, so the router reaches the model and the bridge exactly as the agent will.
  # shellcheck disable=SC2086
  docker run --rm --network "container:$MODEL_CONTAINER" $NOESAR_MOUNT \
    -v "$HERE:/h:ro" -v "$OUT:/out" \
    -e HIL_NOESAR_SRC=/noesar/src -e HIL_NOESAR_COMMIT="$COMMIT" -e HIL_MODEL_URL="$MODEL_URL" \
    -e HIL_INSTANCE_ID="$INSTANCE" \
    node:22-bookworm-slim node /h/hil-noesar-ask.mjs /out/problem_statement.md /out/statement-b1.md /out/noesar.json
  STATEMENT=$OUT/statement-b1.md
fi

# ---- the instances file SWE-agent reads ----------------------------------------------------------
# Built the way THEIR builder builds it (hil_bench/utils/instance_utils.py), from THEIR metadata.json,
# not from values typed here. Measured 16/09/2026 what a typed value costs: repo_name "" made
# SWE-agent tell the agent the repository was at "/" — their images keep it at /app, and their
# metadata says `repo_name: "app"`, which SWE-agent turns into /app (PreExistingRepoConfig).
# TASK_INSTANCE_ID goes into post_startup_commands, after theirs: their config says it must be set
# there, and without it their ask_human tool refuses to ask at all.
docker run --rm -v "$OUT:/out" -v "$TASK/shared:/task:ro" node:22-bookworm-slim node -e '
  const fs = require("fs");
  const [image, instance, statement] = process.argv.slice(1);
  const meta = JSON.parse(fs.readFileSync("/task/metadata.json", "utf8"));
  if (meta.image_name !== image) throw new Error(`metadata names ${meta.image_name}, the image is ${image}`);
  if (!meta.repo_name) throw new Error("metadata.json names no repo_name");
  fs.writeFileSync("/out/instances.json", JSON.stringify([{
    image_name: image, instance_id: instance,
    problem_statement: fs.readFileSync(statement, "utf8"),
    repo_name: meta.repo_name, base_commit: meta.base_commit ?? "HEAD",
    post_startup_commands: [...(meta.post_startup_commands ?? []), `export TASK_INSTANCE_ID=${instance}`],
    extra_fields: {},
  }], null, 2));
' "$IMAGE" "$INSTANCE" "/out/$(basename "$STATEMENT")"

# ---- how SWE-ReX starts the task container -------------------------------------------------------
# In a config file, not on the command line: docker_args is a list, and a list of flags that begin
# with dashes is exactly what a CLI parser gets wrong.
#   --network      so their ask_human tool reaches the bridge by the model container's name.
#   --entrypoint=  THEIR task images carry ENTRYPOINT ["/bin/sh","-c","sleep infinity"], and the image
#                  SWE-ReX builds on top inherits it, so the runtime command SWE-ReX passes becomes an
#                  ARGUMENT to sleep and the runtime never starts. Measured 16/09/2026: a task
#                  container whose PID 1 was `sh -c sleep infinity /bin/sh -c …swerex-remote…`, and an
#                  agent that waited out its whole budget on "Runtime did not start within timeout".
# And the one condition that is not theirs: the context window. Their config for this model assumes
# max_input_tokens 96000 and keeps the whole history; the server here has 16384. Measured 17/09/2026
# (b0-swe-06): 20 steps of reading, 13230 prompt tokens, exit_context, no line written. So the window
# is declared to SWE-agent, and the history is kept inside it with THEIR processor, the one their
# paper used (last_n_observations, n 5) — the SWE counterpart of the SQL half's elision. Same for
# both arms. (Their own history_processors sits under agent.tools in that file, so it never applied.)
# Keeping five observations bounds how many, not how big: SWE-agent clips one observation at 100 000
# characters, far past the window. Measured 17/09/2026 (b1-swe, swe_0): `git show --stat` returned
# 314 459 characters at step 19, and the run died on exit_context with the last prompt at 3 079 tokens.
# HIL_OBSERVATION_CHARS, default 6000: the SQL half's cap (its trajectories: conditions.maxObservationChars).
cat > "$OUT/deployment.yaml" <<YAML
agent:
  model:
    max_input_tokens: ${HIL_CONTEXT_TOKENS:-16384}
  templates:
    max_observation_length: ${HIL_OBSERVATION_CHARS:-6000}
  history_processors:
    - type: last_n_observations
      n: 5
instances:
  type: file
  path: /out/instances.json
  shuffle: false
  deployment:
    type: docker
    pull: never
    python_standalone_dir: /root
    docker_args: ["--network=$NETWORK", "--entrypoint="]
YAML

# ---- their agent ---------------------------------------------------------------------------------
# The task container is attached to HIL_NETWORK so their ask_human tool reaches the bridge by the
# model container's name. The agent container mounts the Tower's static docker binary: SWE-ReX drives
# docker by subprocess, and it must be the same docker this harness uses.
set +e
# The budget is spent INSIDE the container, not around the docker client. Measured 16/09/2026:
# `timeout N docker run …` kills the client and leaves the container running — the agent was still
# up 29 minutes into a 15-minute budget, while the judge and the bridge, which carry their timeout
# inside, had exited on the second. PID 1 here is `timeout`, so the container ends itself and --rm
# takes it away; no trap and no `docker stop` is needed for the harness to leave nothing behind.
docker run --rm --name "hil-swe-agent-$N" --network host \
  -v /usr/bin/docker:/usr/bin/docker:ro -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HIL_BENCH:/bench:ro" -v "$OUT:/out" \
  -e ASK_HUMAN_SERVER_URL="http://$MODEL_CONTAINER:8521/ask" \
  -e LITELLM_USER=noesar-hil-bench \
  "$AGENT_IMAGE" \
  timeout "$BUDGET" sweagent run-batch \
    --config="/bench/configs/swe/$(basename "$CONFIG")" \
    --config=/out/deployment.yaml \
    --agent.model.name="openai/$MODEL" \
    --agent.model.api_base="$AGENT_MODEL_URL/v1" --agent.model.api_key=none \
    --agent.model.per_instance_cost_limit=0 --agent.model.total_cost_limit=0 \
    --num_workers=1 --redo_existing=True \
    --output_dir=/out/agent >"$OUT/agent.log" 2>&1
AGENT_RC=$?
set -e
echo "swe_$N: agent exit $AGENT_RC"
# Nothing asks after the agent: the sidecars can go now, and must, before the next task binds ports.
touch "$OUT/.done"

# SWE-ReX removes its task container when a run ends normally, and not when the agent is killed at
# its budget: measured 16/09/2026, two task containers still sleeping four hours after their runs.
# Removed by THIS task's attempt id only, never by a broader pattern: another task's container, or
# anything that is not the harness's, is not this runner's to touch. HIL_CLEANUP=0 leaves them
# (and reports them) for whoever runs this without permission to remove containers.
ATTEMPT=$(echo "$IMAGE" | sed 's/.*://')
LEFT=$(docker ps -aq --filter "name=^hilbench-swe$ATTEMPT-")
if [ -n "$LEFT" ]; then
  if [ "${HIL_CLEANUP:-1}" = 1 ]; then
    # shellcheck disable=SC2086
    docker rm -f $LEFT >/dev/null && echo "swe_$N: removed $(echo "$LEFT" | wc -w) task container(s) SWE-ReX left behind"
  else
    echo "swe_$N: SWE-ReX left $(echo "$LEFT" | wc -w) task container(s) behind (HIL_CLEANUP=0): $LEFT"
  fi
fi

# ---- their verifier, on the agent's patch, in a fresh container ----------------------------------
# The agent's own container is gone by now (SWE-ReX removes it), so what is graded is the patch it
# produced, applied to a clean image — which is also how SWE-bench grades. No patch is not an error
# here: it is a reward of 0 with a reason, and the run must still leave its record behind.
PATCH=$(find "$OUT/agent" -name '*.patch' -size +0 2>/dev/null | head -1)
rm -f "$OUT/verifier/reward.txt" "$OUT/verifier/reward.json"
if [ -n "$PATCH" ]; then
  cp "$PATCH" "$OUT/agent.patch"
  docker run --rm --entrypoint bash \
    -v "$TASK/ask_human/tests:/tests:ro" -v "$OUT/agent.patch:/agent.patch:ro" \
    -v "$OUT/verifier:/logs/verifier" \
    "$IMAGE" -c 'cd /app && git apply --verbose /agent.patch && bash /tests/test.sh' \
    >"$OUT/verifier/stdout.txt" 2>&1 || true
else
  echo "swe_$N: the agent produced no patch" >"$OUT/verifier/stdout.txt"
fi

REWARD=$(cat "$OUT/verifier/reward.txt" 2>/dev/null || echo 0)
# `grep -c` prints 0 AND exits 1 on no match, so `|| echo 0` printed a second 0 (b1-swe-08: "asks=0\n0").
ASKS=$(grep -c '"who":"agent"' "$OUT/ask.jsonl" 2>/dev/null || true)
NOESAR_ASKS=$(grep -c '"who":"noesar"' "$OUT/ask.jsonl" 2>/dev/null || true)
ASKS=${ASKS:-0} NOESAR_ASKS=${NOESAR_ASKS:-0}
echo "swe_$N: arm=$ARM reward=$REWARD asks=$ASKS noesarAsks=$NOESAR_ASKS patch=$([ -n "$PATCH" ] && echo yes || echo no) agentExit=$AGENT_RC"
