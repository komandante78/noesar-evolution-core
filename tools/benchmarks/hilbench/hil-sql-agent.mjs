// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Drives the local model through ONE HiL-Bench SQL task, with their tools and their prompt.
//
// What is theirs, not ours — so the comparison is about the agent and not about a rewrite:
//   - the tools: names, descriptions and JSON schemas come from their MCP servers (tools/list)
//   - the system prompt: read at run time from their Qwen3-30B-A3B config, never copied
//   - the rules of a turn: exactly one tool call, their two error messages
//   - the score: their ask-human server writes ask_human_metrics.json, their test_verify.py grades
//
// What differs, and is recorded in the trajectory instead of hidden:
//   - the context window: 16384 tokens here, 65536 in their config, which keeps the whole history
//     (no history_processors). Observations are cut and, when the window is full, room is made
//     (see makeRoom).
//   - a turn cap (their SWE-agent config caps on cost, which a local model does not have).
//
// Two arms, the same agent:
//   B0  the model alone, as above.
//   B1  HIL_NOESAR_SRC set: NOESAR asks first (see noesarAsks), then the same agent runs.
//
// Usage (inside the model's network namespace; run-sql-task.sh does this):
//   node hil-sql-agent.mjs --selfcheck                 the harness's own checks, nothing reached
//   node hil-sql-agent.mjs --smoke <task_dir>          tools reachable, nothing asked, nothing run
//   node hil-sql-agent.mjs <task_dir> <out.json>       run the task
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const MODEL_URL = process.env.HIL_MODEL_URL ?? 'http://127.0.0.1:8420';
const SERVERS = {
  'sql-tools': process.env.HIL_SQL_TOOLS ?? 'http://hil-sql-tools:8000/mcp',
  'business-info': process.env.HIL_BUSINESS_INFO ?? 'http://hil-business-info:8000/mcp',
  'ask-human': process.env.HIL_ASK_HUMAN ?? 'http://127.0.0.1:8000/mcp',
};
const CONFIG = process.env.HIL_AGENT_CONFIG ?? '/bench/hil-bench/configs/sql/ask_sql_config_qwen3_30b_a3b_instruct_2507.yaml';
const OFFICIAL_TOOLS = ['execute_sql', 'get_database_info', 'get_table_info', 'get_column_info', 'get_business_info', 'ask_human', 'submit_sql'];
const TEMPERATURE = Number(process.env.HIL_TEMPERATURE ?? 1.0); // their config
// Their SWE-agent config stops on cost (per_instance_cost_limit 2.5), which a local model does not
// have. 100 so that the cap is not what ends a run; it is recorded with every trajectory.
const MAX_TURNS = Number(process.env.HIL_MAX_TURNS ?? 100);
const MAX_OBSERVATION_CHARS = Number(process.env.HIL_MAX_OBSERVATION_CHARS ?? 6000);
// Their config sets no output cap. Kept at 2048: on b0-pilot-02 no reply came near it (the 22 cut
// replies wrote 0 to 879 characters), so raising it would change nothing but the time a runaway costs.
const MAX_TOKENS = Number(process.env.HIL_MAX_TOKENS ?? 2048);
const ELIDED = '[observation elided: the local context window is 16384 tokens]';
// The product's reasoning sources (services/reference-control-plane/src), mounted read-only. Unset = B0.
const NOESAR_SRC = process.env.HIL_NOESAR_SRC ?? '';

// Their error_message template, rendered for the two codes a turn can hit here.
const MISSING = `Your last output did not use any tool calls! Please make sure your output has **exactly ONE tool call**. You must invoke the function directly using the function call format. You cannot invoke them with "\`\`\`", you MUST use the function call format.

If you did not use a tool because you are ready to submit your final SQL query, please use the \`submit_sql\` tool to submit and mark this task as complete: \`submit_sql <your_sql_query_here>\`

If you think you cannot solve the problem, use the \`submit_sql\` tool to submit an empty-string query.

Otherwise, continue with a new tool call.`;
const MULTIPLE = 'Your last output had multiple tool calls! Choose ONE of them to make at each step. Your outputs must each contain **exactly ONE tool call**.';

async function rpc(url, body, session) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session && { 'mcp-session-id': session }) },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`MCP ${url} ${res.status}: ${raw.slice(0, 300)}`);
  const frames = raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
  const msg = frames.findLast((f) => 'result' in f || 'error' in f) ?? JSON.parse(raw);
  return { session: res.headers.get('mcp-session-id') ?? session, msg };
}

async function connect(url) {
  const init = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'noesar-hil', version: '1' } };
  const { session } = await rpc(url, { jsonrpc: '2.0', id: 0, method: 'initialize', params: init });
  return {
    list: async () => (await rpc(url, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, session)).msg.result.tools,
    call: async (name, args) => {
      const { msg } = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, session);
      if (msg.error) return `ERROR: ${JSON.stringify(msg.error)}`;
      return (msg.result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    },
  };
}

function systemPrompt() {
  const yaml = readFileSync(CONFIG, 'utf8');
  const block = yaml.match(/system_template: \|-\n([\s\S]*?)\n {4}instance_template:/)?.[1];
  if (!block) throw new Error(`system_template not found in ${CONFIG}`);
  const text = block.split('\n').map((l) => l.replace(/^ {6}/, '')).join('\n').trim();
  if (!text.startsWith('You are a helpful data analyst') || !text.includes('ask_human')) throw new Error('system_template is not the ask_human SQL prompt');
  return text;
}

function readTask(dir) {
  const database = readFileSync(`${dir}/task.toml`, 'utf8').match(/database_name = "([^"]+)"/)?.[1];
  const question = readFileSync(`${dir}/instruction.md`, 'utf8').match(/Answer the following question:\s*\n([\s\S]*?)\n\s*\n#/)?.[1]?.trim();
  if (!database || !question) throw new Error(`task not readable in ${dir}: database=${database} question=${question}`);
  return { database, question };
}

async function tools() {
  const route = {};
  const specs = [];
  for (const url of Object.values(SERVERS)) {
    const client = await connect(url);
    for (const t of await client.list()) {
      if (!OFFICIAL_TOOLS.includes(t.name)) continue; // e.g. get_ask_human_metrics: the grader's, not the agent's
      route[t.name] = client;
      specs.push({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } });
    }
  }
  const missing = OFFICIAL_TOOLS.filter((n) => !route[n]);
  if (missing.length) throw new Error(`official tools not reachable: ${missing.join(', ')}`);
  return { route, specs };
}

async function chat(messages, specs) {
  try {
    const res = await fetch(`${MODEL_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, tools: specs, temperature: TEMPERATURE, max_tokens: MAX_TOKENS }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (error) {
    return { status: 0, body: { error: `model unreachable: ${error.message}` } };
  }
}

// The window is full in two ways. A prompt that does not fit is refused with a 400. A prompt that
// fits with little room left is answered and cut where the window ends, as `length` — llama.cpp runs
// here without --context-shift. Measured on b0-pilot-02: 22 of 275 turns ended `length` having
// written 0 to 879 characters, nowhere near max_tokens, and every one was a wasted turn (7 missing,
// 15 unparseable). A reply cut short of max_tokens is the window, not the cap. `usage` is recorded
// on every turn so the next run can confirm that reading: prompt + completion at the window's size.
const contextExhausted = (r) => r.status === 200 && r.body.choices?.[0]?.finish_reason === 'length'
  && Number.isFinite(r.body.usage?.completion_tokens) && r.body.usage.completion_tokens < MAX_TOKENS;
const contextFull = (r) => (r.status === 400 && /context/i.test(JSON.stringify(r.body))) || contextExhausted(r);

// Room, when the window is full: first the oldest half of the observations still shown are elided;
// once none is left, the oldest half of the earlier turns are dropped whole (the call and whatever
// answered it). Measured on plumbing-b0 sql_4: eliding observations alone ran out at turn 66 and the
// run died on a 400 with 16384 prompt tokens, the calls themselves (their SQL) filling the window.
// Halves, not one at a time: any change early in the history makes the runtime prefill the whole
// window again, and one-at-a-time did that on every turn once full (turns up to 119 s on that run).
// Never touched: the system prompt, the task message (with NOESAR's questions), the turn in progress.
// Returns what was taken, or null when nothing is left to take.
// ponytail: blind to relevance; a summary of what was dropped if runs show the agent redoing work.
function makeRoom(messages) {
  const shown = messages.slice(0, -2).filter((m) => m.role === 'tool' && m.content !== ELIDED);
  if (shown.length) {
    for (const m of shown.slice(0, Math.ceil(shown.length / 2))) m.content = ELIDED;
    return 'observations';
  }
  const starts = messages.map((m, i) => (i >= 2 && i < messages.length - 2 && m.role === 'assistant' ? i : -1)).filter((i) => i >= 0);
  if (!starts.length) return null;
  const end = starts[Math.ceil(starts.length / 2)] ?? messages.length - 2;
  messages.splice(starts[0], end - starts[0]);
  return 'turns';
}

// Arm B1. The product, not a copy of it: NOESAR's own ReasoningRouter with the local-model route for
// `interpret` switched on, exactly as an installation switches it on. It names what the question
// leaves open; each name goes to THEIR ask_human verbatim, in the order named, before the agent's
// first turn; the agent is handed the questions and the answers verbatim.
//
// This rule was written once, before any B1 score existed, and is not revised against one. What the
// product returns is what is asked — a degraded answer (the model unreachable or unreadable) included,
// recorded as degraded, never dropped and never replaced.
const NOESAR_PREAMBLE = "Before this question reached you, NOESAR asked the human about what it leaves open. The questions and the human's answers, verbatim:";

async function noesarRouter() {
  const { ReasoningRouter } = await import(`${NOESAR_SRC}/reasoning-router.mjs`);
  const router = new ReasoningRouter({ env: { NOESAR_LOCAL_MODEL_SURFACES: 'interpret', NOESAR_AUTHORING_ENDPOINT: MODEL_URL } });
  // A B1 run with the route off would be a B0 run under B1's name.
  if (!router.routing.localModelSurfaces.includes('interpret')) {
    throw new Error(`NOESAR: the local-model route for interpret is off (endpoint '${MODEL_URL}', src '${NOESAR_SRC}')`);
  }
  return router;
}

async function noesarAsks(question, askHuman) {
  const router = await noesarRouter();
  const intent = await router.interpret(question);
  const asked = [];
  for (const name of intent.ambiguities) {
    const answer = await askHuman.call('ask_human', { question: name });
    asked.push({ question: name, answer });
    console.log(`noesar ask -> ${answer.slice(0, 60)}`);
  }
  return {
    commit: process.env.HIL_NOESAR_COMMIT ?? null,
    asked,
    provenance: router.provenance(),
    degradations: router.degradations(),
    // The prompt is namerPrompt(question), reproducible from the commit; its digest is enough here.
    modelCalls: router.modelCalls().map(({ prompt, ...call }) => call),
  };
}

async function run(dir, out) {
  const { database, question } = readTask(dir);
  const { route, specs } = await tools();
  let failure = null;
  let noesar = null;
  let request = `Please answer the following question about the '${database}' database: ${question}`;
  if (NOESAR_SRC) {
    try {
      noesar = await noesarAsks(question, route.ask_human);
      if (noesar.asked.length) request += `\n\n${NOESAR_PREAMBLE}\n\n${noesar.asked.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}`;
    } catch (error) {
      failure = `noesar: ${error.message}`;
    }
  }
  const messages = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: request },
  ];
  const turns = [];
  let submitted = false;
  let elisions = 0;
  let drops = 0;
  for (let turn = 1; turn <= MAX_TURNS && !submitted && !failure; turn++) {
    const started = Date.now();
    let r = await chat(messages, specs);
    let room;
    while (contextFull(r) && (room = makeRoom(messages))) {
      if (room === 'observations') elisions++; else drops++;
      r = await chat(messages, specs);
    }
    if (r.status !== 200) {
      // Kept, not thrown here: a run that dies must still leave its trajectory behind.
      failure = `model ${r.status} at turn ${turn}: ${JSON.stringify(r.body).slice(0, 400)}`;
      break;
    }
    const reply = r.body.choices[0].message;
    const calls = reply.tool_calls ?? [];
    const record = { turn, ms: Date.now() - started, finish: r.body.choices[0].finish_reason, usage: r.body.usage ?? null, content: reply.content ?? '', calls: calls.map((c) => c.function) };
    turns.push(record);
    if (calls.length !== 1) {
      messages.push({ role: 'assistant', content: reply.content ?? '' });
      messages.push({ role: 'user', content: calls.length === 0 ? MISSING : MULTIPLE });
      record.error = calls.length === 0 ? 'missing' : 'multiple';
      console.log(`turn ${turn} ${record.ms}ms ERROR ${record.error} (${record.finish})`);
      continue;
    }
    const [call] = calls;
    let args;
    try {
      args = JSON.parse(call.function.arguments || '{}');
    } catch (error) {
      // A call whose arguments are not JSON must NOT enter the history: the runtime re-renders
      // every past call through its chat template and answers 500 to the next turn, for the rest
      // of the run (measured: b0-pilot sql_0, turn 41). Their harness treats it as a format
      // error and re-asks, with the else-branch of their error_message; so does this.
      messages.push({ role: 'assistant', content: reply.content ?? '' });
      messages.push({ role: 'user', content: `Your last output could not be parsed properly: ${error.message}.` });
      record.error = 'unparseable';
      console.log(`turn ${turn} ${record.ms}ms ERROR ${record.error} (${record.finish})`);
      continue;
    }
    messages.push({ role: 'assistant', content: reply.content ?? '', tool_calls: calls });
    let observation;
    try {
      observation = await route[call.function.name]?.call(call.function.name, args)
        ?? `Your last output could not be parsed properly: unknown tool ${call.function.name}.`;
    } catch (error) {
      observation = `Your last output could not be parsed properly: ${error.message}.`;
    }
    if (observation.length > MAX_OBSERVATION_CHARS) observation = `${observation.slice(0, MAX_OBSERVATION_CHARS)}\n[... cut at ${MAX_OBSERVATION_CHARS} characters]`;
    record.observation = observation.slice(0, 500);
    messages.push({ role: 'tool', tool_call_id: call.id, content: observation || 'Your last command ran successfully and did not produce any output.' });
    if (call.function.name === 'submit_sql') submitted = true;
    console.log(`turn ${turn} ${record.ms}ms ${call.function.name}${call.function.name === 'ask_human' ? ` -> ${observation.slice(0, 60)}` : ''}`);
  }
  const conditions = {
    modelUrl: MODEL_URL, temperature: TEMPERATURE, maxTurns: MAX_TURNS, maxObservationChars: MAX_OBSERVATION_CHARS, maxTokens: MAX_TOKENS, config: CONFIG,
    contextPolicy: 'full = a 400, or length short of max_tokens; room = the oldest half of shown observations, then the oldest half of earlier turns',
    arm: NOESAR_SRC ? 'B1' : 'B0', noesarCommit: noesar?.commit ?? null,
  };
  writeFileSync(out, JSON.stringify({ task: dir, database, question, submitted, elisions, drops, failure, conditions, noesar, turns }, null, 2));
  console.log(`${dir}: arm=${conditions.arm} turns=${turns.length} submitted=${submitted} elisions=${elisions} drops=${drops} noesarAsks=${noesar?.asked.length ?? 0} degraded=${noesar?.degradations.length ?? 0} asks=${turns.filter((t) => t.calls[0]?.name === 'ask_human').length} failure=${failure ?? 'none'}`);
  if (failure) throw new Error(failure);
}

function selfcheck() {
  const reply = (finish, completion) => ({ status: 200, body: { choices: [{ finish_reason: finish }], usage: { completion_tokens: completion } } });
  assert.equal(contextFull(reply('length', 12)), true, 'a reply cut long before max_tokens is the window');
  assert.equal(contextFull(reply('length', MAX_TOKENS)), false, 'a reply that spent every token it was allowed is the cap, not the window');
  assert.equal(contextFull(reply('stop', 12)), false, 'a finished reply is not a full window');
  assert.equal(contextFull({ status: 200, body: { choices: [{ finish_reason: 'length' }] } }), false, 'no usage, no claim about the window');
  assert.equal(contextFull({ status: 400, body: { error: { message: 'the request exceeds the available context size' } } }), true, 'the refusal is still the window');
  assert.equal(contextFull({ status: 400, body: { error: { message: 'bad tool schema' } } }), false, 'another 400 is not the window');

  const turn = (n) => [{ role: 'assistant', content: '', tool_calls: [{ id: `c${n}` }] }, { role: 'tool', tool_call_id: `c${n}`, content: `observation ${n}` }];
  const history = [{ role: 'system', content: 's' }, { role: 'user', content: 'task' }, ...turn(1), ...turn(2), ...turn(3), ...turn(4)];
  assert.equal(makeRoom(history), 'observations');
  assert.deepEqual(history.filter((m) => m.role === 'tool').map((m) => m.content === ELIDED), [true, true, false, false], 'the oldest half of the shown observations, never the turn in progress');
  assert.equal(makeRoom(history), 'observations');
  assert.equal(makeRoom(history), 'turns', 'every observation elided: earlier turns go');
  assert.deepEqual(history.filter((m) => m.role === 'assistant').map((m) => m.tool_calls[0].id), ['c3', 'c4'], 'the oldest half of the earlier turns, whole');
  assert.equal(makeRoom(history), 'turns');
  assert.equal(makeRoom(history), null, 'only the turn in progress is left: nothing more to take');
  assert.deepEqual(history.map((m) => m.content), ['s', 'task', '', 'observation 4'], 'system prompt, task message and the turn in progress are never taken');
  console.log('selfcheck: ok');
}

const [first, second] = process.argv.slice(2);
if (first === '--selfcheck') {
  selfcheck();
} else if (first === '--smoke') {
  if (NOESAR_SRC) {
    // Exit 3, not 1: the runner retries a smoke while the servers start, and must not retry this.
    const router = await noesarRouter().catch((error) => { console.error(error.message); process.exit(3); });
    console.log(`noesar ok: interpret -> local model at ${router.routing.localModelEndpoint}`);
  }
  const { database, question } = readTask(second);
  const { specs } = await tools();
  const prompt = systemPrompt();
  console.log(`task ok: ${database} — ${question.slice(0, 80)}…`);
  console.log(`tools ok: ${specs.map((s) => s.function.name).join(', ')}`);
  console.log(`prompt ok: ${prompt.length} chars`);
} else if (first && second) {
  await run(first, second);
} else {
  console.error('usage: --selfcheck | --smoke <task_dir> | <task_dir> <out.json>');
  process.exit(2);
}
