# HiL-Bench — the harness NOESAR is measured with

[HiL-Bench](https://arxiv.org/abs/2604.09408) (Scale AI) scores whether an agent **asks** when a task
leaves something out: Ask-F1 is the harmonic mean of precision (blockers resolved per question) and
recall (blockers resolved per blocker present), aggregated over all questions and blockers of a run.

This directory runs the **SQL half** (100 public tasks) with their pieces wherever a piece exists,
and the **SWE half** one task at a time ([below](#the-swe-half--one-task-at-a-time)), in two arms that
differ in one thing only:

| arm | what runs |
|---|---|
| **B0** | the model alone, with their prompt and their tools |
| **B1** | the same agent, after NOESAR has asked: the product's own `ReasoningRouter`, with `interpret` routed to the local model (`NOESAR_LOCAL_MODEL_SURFACES=interpret`), names what the question leaves open |

**No result is written here.** A number in this repository that a reader cannot reproduce is a
defect; results are published with the command and the run that produced them.

## One command

```sh
HIL_BENCH=/data/hil-bench HIL_WORK=/data/hilwork \
HIL_MODEL_CONTAINER=my-llama HIL_NETWORK=my-net \
  sh tools/benchmarks/hilbench/reproduce.sh
```

It runs `setup.sh` (skipping what is done), both arms on every task, and prints both scores. Run it
again to resume. `sh gate-check.sh` shows the harness's own gates failing and passing.

| variable | what it is |
|---|---|
| `HIL_BENCH` | their repository; cloned there at the pinned commit if absent |
| `HIL_WORK` | tasks (19 GB for all 100), runs, NOESAR snapshots |
| `HIL_GENERATE_ARGS` | which tasks `setup.sh` generates: default `--all`; e.g. `--indices 0 1 2` for three |
| `HIL_MODEL_CONTAINER` | the container whose network namespace serves the model at `HIL_MODEL_URL` (default `http://127.0.0.1:8420`). The judge and the agent join that namespace, so the model is never exposed |
| `HIL_NETWORK` | a Docker network that container is attached to; two MCP servers join it |

Needs Docker, git, and an OpenAI-compatible server with tool calls serving the model (the runs of
14/09/2026: llama.cpp `llama-server --jinja --reasoning off -c 16384 -np 1`, Qwen3.6-35B-A3B
UD-IQ4_XS).

## What is theirs

- **Tasks**: their generator (`harbor_sql/generate_harbor_sql_tasks.py`) from their dataset.
- **Tools**: names, descriptions and schemas read from their MCP servers at run time.
- **Prompt**: read at run time from their `configs/sql/ask_sql_config_qwen3_30b_a3b_instruct_2507.yaml`.
- **Judge**: their `ask-human` server and its prompt; **grading**: their `tests/test_verify.py`.
- **Score**: `hil-sql-score.mjs` aggregates exactly as their `hil_bench/utils/compute_hil_metrics.py`
  and refuses to print when its recomputed per-task F1 differs from the one their server wrote.

## What differs, stated with every number

| | theirs | here |
|---|---|---|
| judge model | Llama-3.3-70B-Instruct, frozen | the same local model as the agent |
| passes | Pass@3 | one |
| context window | 65 536, whole history kept | 16 384; when full, the oldest half of the observations are elided, then the oldest half of earlier turns dropped (`conditions.contextPolicy`) |
| stopping | cost cap | 100 turns |
| output cap | none | 2048 tokens |
| CSV of the task order | not in their repository | rebuilt by `build-csv.py` (below) |

Every trajectory records its conditions; the scorer refuses a run whose trajectories disagree.

## The B1 rule

Written once, before any B1 score existed, and not revised against one:

1. the request is the task's question, verbatim;
2. every ambiguity NOESAR names goes to their `ask_human`, verbatim and in order, before the agent's
   first turn;
3. the agent receives those questions and the answers, verbatim, after the question;
4. a degraded answer of the model (unreachable, unreadable) is still asked and is recorded as degraded.

The scorer checks that the first questions their server logged are NOESAR's, in NOESAR's order.

## The SWE half — one task at a time

Their pieces again: their SWE-agent fork (1.1.0, SWE-ReX 1.4.0) with their config for this model
(`configs/swe/ask_config_qwen3_30b_a3b_instruct_2507.yaml`), their task images, their `ask-human`
judge, and their verifier (`tests/test.sh`) run on the agent's patch in a clean copy of the image. The
one piece they did not publish, the server their `ask_human` tool posts to, is `hil-ask-bridge.mjs`;
arm B1 asks through it too, under the same B1 rule as the SQL half. `run-swe-batch.sh [from] [to]` runs
both arms task by task, resumable; there is no `reproduce.sh` for this half yet.

```sh
docker build -t hil-swe-agent:1.1.0 -f tools/benchmarks/hilbench/swe-agent.Dockerfile "$HIL_BENCH/SWE-agent"
HIL_BENCH=… HIL_SWE_ARCH=… HIL_WORK=… sh tools/benchmarks/hilbench/swe-pipeline-check.sh 0
HIL_BENCH=… HIL_SWE_ARCH=… HIL_WORK=… HIL_MODEL_CONTAINER=… HIL_NETWORK=… \
  RUN=b0 sh tools/benchmarks/hilbench/run-swe-task.sh 0
HIL_BENCH=… HIL_SWE_ARCH=… HIL_WORK=… HIL_MODEL_CONTAINER=… HIL_NETWORK=… \
  RUN=b1 HIL_NOESAR=interpret HIL_NOESAR_COMMIT=<sha> sh tools/benchmarks/hilbench/run-swe-task.sh 0
node tools/benchmarks/hilbench/hil-swe-score.mjs "$HIL_WORK/runs/b0"
```

`swe-pipeline-check.sh` proves the chain with no model in it (their gold patch must score 1); run it
before any agent.

| variable | what it is |
|---|---|
| `HIL_SWE_ARCH` | where the image archives are kept (185.8 GiB for all 100; the largest is 5.77 GiB) |
| `HIL_TASK_TIMEOUT` | the whole task's budget, default 7200 s (their agent cap) |
| `HIL_CONTEXT_TOKENS` | the model's context window, default 16384 |
| `HIL_OBSERVATION_CHARS` | the most one observation may carry, default 6000 (the SQL half's cap) |
| `HIL_B0_RUN`, `HIL_B1_RUN` | the two run names of `run-swe-batch.sh`, default `b0-swe` / `b1-swe`; new conditions take new names |
| `HIL_CLEANUP` | `1` (default) removes the task containers SWE-ReX leaves behind for this task's image only; `0` reports them |
| `HIL_AGENT_IMAGE` | default `hil-swe-agent:1.1.0` |

What differs, stated with every number:

| | theirs | here |
|---|---|---|
| judge model | Llama-3.3-70B-Instruct, frozen | the same local model as the agent |
| context window | `max_input_tokens` 96 000, whole history kept, one observation up to 100 000 characters | `HIL_CONTEXT_TOKENS`; the history kept inside it with their own `last_n_observations` (n 5), and each observation clipped at `HIL_OBSERVATION_CHARS` |
| task images | pinned by size, sha256 and image id in their repository | **not pinned**: the bucket serves rebuilt images for all 100 tasks; what was loaded is written to `provenance.json` beside every run, and a number names the date its images were fetched |
| agent image | not published | `swe-agent.Dockerfile`; Python packages unpinned beyond their setup |

Their config places `history_processors` under `agent.tools`, where SWE-agent does not read it; it
applies neither there nor here.

## Pins

| what | pinned at | enforced by |
|---|---|---|
| their repository | `a98052f7bcb3a92d6ce1a3c1da20237b8b3d2e8c` | `setup.sh` checks it out |
| their dataset `ScaleAI/hil-bench` | revision `045419da0f51f10efc621efdb481a6502df810d5` | `build-csv.py` stops if the dataset has moved: their generator reads the newest revision |
| the task-order CSV | sha256 `dc7118f9878e12770ee9b048d61f86329dc8d10574ea62698d85ec998ebcfd1e` | `build-csv.py` writes nothing that hashes otherwise |
| NOESAR in arm B1 | one commit per batch (`runs/b1-full.commit`) | `run-sql-task.sh` runs a `git archive` of it, never the working tree |
| Python packages of the generator | not pinned | their versions are written to `HIL_WORK/setup-versions.txt` |

## Files

| file | does |
|---|---|
| `reproduce.sh` | the one command |
| `setup.sh` | their repository, the CSV, the 100 tasks, the four images |
| `build-csv.py` | the CSV their generator needs, proved against their dataset |
| `run-sql-batch.sh` | both arms, interleaved per task, resumable |
| `run-sql-task.sh` | one task: fresh servers, the agent, their verifier |
| `hil-sql-agent.mjs` | the agent (`--selfcheck` for its own checks) |
| `hil-sql-score.mjs` | the score of one run |
| `gate-check.sh` | the gates, each seen failing and passing; safe beside a run in progress |
| `swe-agent.Dockerfile` | their SWE-agent, installed as is |
| `swe-image.sh` | one SWE task's image, loaded, and a record of which image it was |
| `swe-pipeline-check.sh` | the SWE chain on one task with their gold patch, no model |
| `run-swe-batch.sh` | both arms of the SWE half, task by task, resumable |
| `run-swe-task.sh` | one SWE task: judge, bridge, (B1) NOESAR's questions, their agent, their verifier |
| `hil-ask-bridge.mjs` | the server their `ask_human` tool posts to, in front of their MCP judge |
| `hil-noesar-ask.mjs` | arm B1 of the SWE half (`--selfcheck`) |
| `hil-swe-score.mjs` | the score of one SWE run |

## Provenance of the first runs

The runs started on 14/09/2026 were produced by copies of these files on the development machine,
before they were brought here. What differs, and nothing else: here every file carries its licence
header, the paths and container names are variables instead of that machine's, and one loop in the
agent reads `Object.values(SERVERS)` instead of destructuring a name it never used (the linter).
