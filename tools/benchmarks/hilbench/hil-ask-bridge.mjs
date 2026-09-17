// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one piece of their SWE pipeline that is not in what they published: the host server their
// ask_human tool talks to.
//
// Their tool (SWE-agent/tools/ask_human/bin/ask_human) POSTs {question, instance_id} to
// $ASK_HUMAN_SERVER_URL and prints resp["response"]. Their judge (hil-bench-harbor/ask-human) is an
// MCP server — FastMCP, streamable-http on 8000, tool `ask_human(question)`. Nothing in the package
// joins the two; their own runs used a host bridge at :9521 that routes by instance_id. One task at
// a time needs no routing, so this is that bridge and nothing more.
//
// It is also where arm B1 injects, and that is deliberate: NOESAR's questions go through the SAME
// entry point as the agent's, so their server counts them, resolves the same blockers, and writes
// them into the same ask_human_metrics.json in the same order — asked before the agent's first turn.
// Nothing here scores, rewrites or filters an answer: what their judge says is what is returned and
// what is logged, a degraded answer included.
//
// It also carries the model's forward, because the two share one lifecycle exactly: the agent runs on
// the host network (SWE-ReX dials 127.0.0.1:<published port>, swerex/deployment/docker.py:270), and
// the model is bound to 127.0.0.1 inside its own container, unreachable from the host by design.
// Listening on 0.0.0.0 inside that namespace makes it reachable at the container's address on its
// network, and nowhere else.
//
// usage: node hil-ask-bridge.mjs --selfcheck
//        node hil-ask-bridge.mjs <log.jsonl>          serve until HIL_DONE_FILE appears
//   HIL_ASK_HUMAN    their MCP judge         (default http://127.0.0.1:8000/mcp)
//   HIL_BRIDGE_PORT  the port to listen on   (default 8521)
//   HIL_FORWARD      "listen:target" to forward 0.0.0.0:listen -> 127.0.0.1:target (unset = none)
//   HIL_DONE_FILE    exit when this file exists. Measured 16/09/2026 why: sidecars that live out their
//                    whole budget after the agent has finished hold the model namespace's ports, and
//                    the next task cannot bind them.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as tcpServer, connect as tcpConnect } from 'node:net';
import { appendFileSync, existsSync } from 'node:fs';

const ASK_HUMAN = process.env.HIL_ASK_HUMAN ?? 'http://127.0.0.1:8000/mcp';
const PORT = Number(process.env.HIL_BRIDGE_PORT ?? 8521);
const FORWARD = process.env.HIL_FORWARD ?? '';
const DONE = process.env.HIL_DONE_FILE ?? '';

export function parseForward(spec) {
  const m = /^(\d+):(\d+)$/.exec(spec);
  if (!m) throw new Error(`HIL_FORWARD must be listen:target, got '${spec}'`);
  return { listen: Number(m[1]), target: Number(m[2]) };
}

function forward({ listen, target }) {
  tcpServer((c) => {
    const up = tcpConnect(target, '127.0.0.1');
    c.pipe(up).pipe(c);
    c.on('error', () => up.destroy());
    up.on('error', () => c.destroy());
  })
    // A port another run still holds must stop this one, loudly: the runner's readiness check would
    // otherwise find the OLD forward answering and wave a broken bridge through.
    .on('error', (error) => {
      console.error(`forward: cannot listen on ${listen}: ${error.message}`);
      process.exit(1);
    })
    .listen(listen, '0.0.0.0', () => console.log(`forward: 0.0.0.0:${listen} -> 127.0.0.1:${target}`));
}
// Their tool prints exactly this when it cannot reach the server, and treats it as an answer rather
// than an error. A bridge that invented its own string would be a second dialect in the metrics.
const CANT_ANSWER = "can't answer (perhaps transient hiccup)";

// Same MCP client as hil-sql-agent.mjs: one dialect for one server, not two.
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

export function textOf(msg) {
  if (msg.error) return null;
  const text = (msg.result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return text || null;
}

async function connect(url) {
  const init = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'noesar-hil-bridge', version: '1' } };
  const { session } = await rpc(url, { jsonrpc: '2.0', id: 0, method: 'initialize', params: init });
  let id = 1;
  return async (question) => {
    const { msg } = await rpc(url, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'ask_human', arguments: { question } } }, session);
    return textOf(msg);
  };
}

// Their tool sends {question, instance_id}. instance_id is theirs for routing between concurrent
// tasks; one task at a time has nothing to route, so it is logged and not acted on.
export function readAsk(body) {
  const { question, instance_id: instanceId } = JSON.parse(body);
  if (typeof question !== 'string' || !question.trim()) throw new Error('no question');
  return { question, instanceId: instanceId ?? null };
}

// Their judge and this bridge start together, and the judge is the slower of the two. Waited for
// rather than raced: a bridge that exits on a connection refused takes its own logs with it when the
// container is --rm, which is how the first run of this file left nothing to read.
async function connectWhenUp(url, tries = 30) {
  for (let i = 1; ; i++) {
    try {
      return await connect(url);
    } catch (error) {
      if (i >= tries) throw new Error(`${url} never answered after ${tries} tries: ${error.message}`);
      console.log(`waiting for ${url} (${i}/${tries}): ${error.message.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function serve(log) {
  if (DONE) {
    setInterval(() => {
      if (existsSync(DONE)) {
        console.log(`bridge: ${DONE} seen, exiting`);
        process.exit(0);
      }
    }, 2000);
  }
  // Up before the judge is: the runner checks the model through it before anything else starts.
  if (FORWARD) forward(parseForward(FORWARD));
  const ask = await connectWhenUp(ASK_HUMAN);
  let n = 0;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      if (req.method !== 'POST' || !req.url.startsWith('/ask')) {
        res.writeHead(404).end('{}');
        return;
      }
      let entry;
      try {
        const { question, instanceId } = readAsk(Buffer.concat(chunks).toString());
        // Their judge unreachable or unreadable is THEIR tool's own outcome, not an error of ours:
        // answered with their string, logged as degraded, never dropped and never invented.
        const answer = await ask(question).catch(() => null);
        entry = { n: ++n, at: new Date().toISOString(), who: req.headers['x-noesar'] ? 'noesar' : 'agent', instanceId, question, answer: answer ?? CANT_ANSWER, degraded: answer === null };
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ response: entry.answer }));
      } catch (error) {
        entry = { n: ++n, at: new Date().toISOString(), who: 'agent', question: null, answer: CANT_ANSWER, degraded: true, error: error.message };
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ response: CANT_ANSWER }));
      }
      appendFileSync(log, `${JSON.stringify(entry)}\n`);
      console.log(`${entry.who} #${entry.n}${entry.degraded ? ' DEGRADED' : ''}: ${String(entry.question).slice(0, 60)} -> ${entry.answer.slice(0, 60)}`);
    });
  });
  server.listen(PORT, '0.0.0.0', () => console.log(`bridge: :${PORT}/ask -> ${ASK_HUMAN}, logging to ${log}`));
}

function selfcheck() {
  assert.deepEqual(readAsk('{"question":"why?","instance_id":"swe_0"}'), { question: 'why?', instanceId: 'swe_0' });
  assert.deepEqual(readAsk('{"question":"why?"}'), { question: 'why?', instanceId: null }, 'their tool may send no instance_id');
  assert.throws(() => readAsk('{"question":"   "}'), /no question/, 'a blank question is not a question');
  assert.throws(() => readAsk('not json'), 'a body that is not JSON is refused, not guessed');
  assert.equal(textOf({ result: { content: [{ type: 'text', text: 'yes' }, { type: 'image' }] } }), 'yes');
  assert.equal(textOf({ error: { code: -1 } }), null, 'an MCP error is not an answer');
  assert.equal(textOf({ result: { content: [] } }), null, 'an empty answer is degraded, not an empty string');
  assert.deepEqual(parseForward('8421:8420'), { listen: 8421, target: 8420 });
  assert.throws(() => parseForward('8421'), /listen:target/, 'half a forward is refused, not guessed');
  assert.throws(() => parseForward(':8420'), /listen:target/);
  console.log('selfcheck: ok');
}

const [arg] = process.argv.slice(2);
if (arg === '--selfcheck') selfcheck();
else if (arg) await serve(arg);
else {
  console.error('usage: --selfcheck | <log.jsonl>');
  process.exit(2);
}
