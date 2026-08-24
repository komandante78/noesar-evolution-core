// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reassembling a tool call out of stream fragments, per API style.
//
// The fixtures are frame shapes, not prose descriptions of frame shapes: each block feeds the
// accumulator the sequence a real provider emits, including the part that makes this hard — the
// arguments arriving as a JSON document cut at arbitrary character boundaries.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import {
  newToolCallState, observeToolCallFrame, finishToolCalls, ToolCallDefect,
} from '../src/ai-workspace/tool-call-stream.mjs';
import { ProviderGateway, toolCallsPresent } from '../src/ai-workspace/provider-gateway.mjs';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { CredentialVault } from '../src/ai-workspace/credential-vault.mjs';
import { freshTempDir } from './support/workspace.mjs';

// Closed by `after()`, never only by the test body — see the sibling suites: a rejected assertion
// skips its own `close()`, and a live listener keeps the process alive forever.
const startedServers = [];
after(() => { for (const server of startedServers) { server.closeAllConnections?.(); server.close(); } });
const listening = async (server) => { startedServers.push(server); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); return server; };

/** A gateway with one enabled local profile pointed wherever the caller says. */
function gatewayWith(baseUrl) {
  const dir = freshTempDir('noesar-probe-');
  const store = new AtomicJsonStore(join(dir, 'state.json'));
  const gw = new ProviderGateway({ store, vault: new CredentialVault({ keyPath: join(dir, 'p.key') }), ledger: { append() {} } });
  const profile = gw.create({ type: 'custom-openai-compatible', name: 'probe', external: false, apiStyle: 'openai-chat', baseUrl, defaultModel: 'x', timeoutMs: 5000 });
  gw.update(profile.id, { enabled: true });
  return { gw, id: profile.id };
}

const fold = (style, frames) => {
  const state = newToolCallState();
  for (const frame of frames) observeToolCallFrame(style, frame, state);
  return finishToolCalls(state);
};

const openAiFragment = (index, fragment) => ({ choices: [{ delta: { tool_calls: [{ index, ...fragment }] } }] });

test('openai-chat: id and name arrive once, arguments arrive in slices', () => {
  const calls = fold('openai-chat', [
    openAiFragment(0, { id: 'call_a', type: 'function', function: { name: 'listProjects', arguments: '' } }),
    openAiFragment(0, { function: { arguments: '{"limit"' } }),
    openAiFragment(0, { function: { arguments: ': 5, "open' } }),
    openAiFragment(0, { function: { arguments: 'Only": true}' } }),
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { id: 'call_a', name: 'listProjects', arguments: { limit: 5, openOnly: true }, defect: null, raw: '{"limit": 5, "openOnly": true}' });
});

// `index` is legitimately 0 for the first call. A reader reaching for `fragment.index ||` instead
// of `??` drops every single-call turn, which is nearly every turn.
test('openai-chat: index 0 is a real key, not a missing one', () => {
  const calls = fold('openai-chat', [openAiFragment(0, { id: 'c', function: { name: 'x', arguments: '{}' } })]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'x');
});

test('openai-chat: two parallel calls stay apart', () => {
  const calls = fold('openai-chat', [
    openAiFragment(0, { id: 'c0', function: { name: 'alpha', arguments: '{"a":' } }),
    openAiFragment(1, { id: 'c1', function: { name: 'beta', arguments: '{"b":' } }),
    openAiFragment(0, { function: { arguments: '1}' } }),
    openAiFragment(1, { function: { arguments: '2}' } }),
  ]);
  assert.deepEqual(calls.map((c) => [c.name, c.arguments]), [['alpha', { a: 1 }], ['beta', { b: 2 }]]);
});

test('anthropic-messages: tool_use block then input_json_delta slices', () => {
  const calls = fold('anthropic-messages', [
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'findings' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"proj' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'ect":"noesar"}' } },
    { type: 'content_block_stop', index: 1 },
  ]);
  assert.deepEqual(calls, [{ id: 'toolu_1', name: 'findings', arguments: { project: 'noesar' }, defect: null, raw: '{"project":"noesar"}' }]);
});

// A text block's deltas share the `content_block_delta` event type. Folding those as arguments
// would assemble a "tool call" out of the model's prose.
test('anthropic-messages: a text block is not mistaken for a tool call', () => {
  const calls = fold('anthropic-messages', [
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"evil":1}' } },
  ]);
  assert.deepEqual(calls, [], 'no tool_use block was ever opened, so there is no call');
});

test('openai-responses: function_call item then argument deltas', () => {
  const calls = fold('openai-responses', [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'fc_1', name: 'sarif' } },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"id":' },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '"p1"}' },
  ]);
  assert.deepEqual(calls, [{ id: 'fc_1', name: 'sarif', arguments: { id: 'p1' }, defect: null, raw: '{"id":"p1"}' }]);
});

/* ---- the defects, which are reported and never silently repaired ---- */

test('arguments that do not parse are a refusal, not an empty object', () => {
  const calls = fold('openai-chat', [openAiFragment(0, { id: 'c', function: { name: 'x', arguments: '{"a": ' } })]);
  assert.equal(calls[0].defect, ToolCallDefect.MALFORMED_ARGUMENTS);
  assert.equal(calls[0].arguments, null, 'a half-parsed document must never become {} — that is a silent, plausible, wrong invocation');
  assert.equal(calls[0].raw, '{"a":');
});

test('a JSON scalar or array is not a valid argument object', () => {
  for (const text of ['"just a string"', '[1,2,3]', 'null', '42']) {
    const calls = fold('openai-chat', [openAiFragment(0, { id: 'c', function: { name: 'x', arguments: text } })]);
    assert.equal(calls[0].defect, ToolCallDefect.MALFORMED_ARGUMENTS, `${text} must be refused`);
  }
});

test('no arguments at all is valid — a tool may take none', () => {
  const calls = fold('openai-chat', [openAiFragment(0, { id: 'c', function: { name: 'x', arguments: '' } })]);
  assert.deepEqual(calls[0].arguments, {});
  assert.equal(calls[0].defect, null);
});

test('a call with no name is refused rather than executed against a guess', () => {
  const calls = fold('openai-chat', [openAiFragment(0, { id: 'c', function: { arguments: '{}' } })]);
  assert.equal(calls[0].defect, ToolCallDefect.NO_NAME);
});

test('oversized arguments are refused without allocating the payload', () => {
  const frames = [openAiFragment(0, { id: 'c', function: { name: 'x', arguments: '{"a":"' } })];
  for (let i = 0; i < 40; i += 1) frames.push(openAiFragment(0, { function: { arguments: 'y'.repeat(4096) } }));
  const calls = fold('openai-chat', frames);
  assert.equal(calls[0].defect, ToolCallDefect.OVERSIZED_ARGUMENTS);
  assert.equal(calls[0].raw, '', 'the truncated text is not carried back either');
});

test('more calls than the cap are dropped rather than growing without bound', () => {
  const frames = [];
  for (let i = 0; i < 100; i += 1) frames.push(openAiFragment(i, { id: `c${i}`, function: { name: 'x', arguments: '{}' } }));
  assert.equal(fold('openai-chat', frames).length, 32);
});

// A model is perfectly capable of emitting `__proto__` as a tool name or an argument key. The fold
// state is a Map for exactly this reason; the parsed arguments are asserted not to have polluted
// anything either.
test('a prototype-shaped name or key is data, not a hazard', () => {
  const calls = fold('openai-chat', [openAiFragment(0, { id: 'c', function: { name: '__proto__', arguments: '{"__proto__":{"polluted":true}}' } })]);
  assert.equal(calls[0].name, '__proto__');
  assert.equal({}.polluted, undefined, 'nothing may have reached Object.prototype');
});

test('an unknown style folds nothing rather than guessing a shape', () => {
  assert.deepEqual(fold('some-future-style', [openAiFragment(0, { id: 'c', function: { name: 'x', arguments: '{}' } })]), []);
});

test('a non-object frame is ignored instead of throwing', () => {
  for (const frame of [null, undefined, 'text', 42]) {
    assert.doesNotThrow(() => fold('openai-chat', [frame]));
  }
});

/* ---- the non-streaming twin: recognising a tool call in a whole answer ----
   Co-located because it answers the same question ("did the model call a tool?") across the same
   three styles; kept as its own function rather than folded into the accumulator because a
   complete response needs no reassembly, and sharing the fold would mean pretending it did. */

test('toolCallsPresent finds a call in each style, and its absence in each style', () => {
  const cases = [
    ['openai-chat', { choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'x' } }] } }] }, { choices: [{ message: { content: 'prose' } }] }],
    ['anthropic-messages', { content: [{ type: 'tool_use', id: 't', name: 'x' }] }, { content: [{ type: 'text', text: 'prose' }] }],
    ['openai-responses', { output: [{ type: 'function_call', name: 'x' }] }, { output: [{ type: 'message', content: [] }] }],
  ];
  for (const [style, withCall, withoutCall] of cases) {
    assert.equal(toolCallsPresent(style, withCall), true, `${style} should detect a call`);
    assert.equal(toolCallsPresent(style, withoutCall), false, `${style} should not invent one`);
  }
});

test('toolCallsPresent treats junk as "no call" rather than throwing', () => {
  for (const value of [null, undefined, 'text', 42, {}, { choices: [] }]) {
    assert.equal(toolCallsPresent('openai-chat', value), false);
  }
});

// Measured live on this installation 2026-08-24: a HEALTHY llama.cpp server accepted a tools array
// and answered in prose with no tool_calls, because it only honours them with `--jinja`. Reachable
// is not capable, and the probe must be able to say so — while never saying `false` when the
// question could not be asked at all.
test('probeToolCalling reports false for a healthy provider that ignores tools', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'I cannot access anything.' } }] }));
  });
  await listening(server);
  const gateway = gatewayWith(`http://127.0.0.1:${server.address().port}/v1`);
  const result = await gateway.gw.probeToolCalling(gateway.id);
  server.close();
  assert.equal(result.supported, false);
  assert.match(result.reason, /--jinja/, 'the reason must name the actual remedy, not just the symptom');
});

test('probeToolCalling reports true when the provider really calls the probe tool', async () => {
  let sawTools = false;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      sawTools = Boolean(JSON.parse(Buffer.concat(chunks).toString('utf8')).tools?.length);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'noesar_probe_echo', arguments: '{"word":"ok"}' } }] } }] }));
    });
  });
  await listening(server);
  const gateway = gatewayWith(`http://127.0.0.1:${server.address().port}/v1`);
  const result = await gateway.gw.probeToolCalling(gateway.id);
  server.close();
  assert.equal(sawTools, true, 'the probe must actually send a tools array');
  assert.deepEqual(result, { supported: true, reason: null });
});

test('an unreachable provider is "unknown", never "not supported"', async () => {
  const gateway = gatewayWith('http://127.0.0.1:1/v1');
  const result = await gateway.gw.probeToolCalling(gateway.id);
  assert.equal(result.supported, null, 'a probe that could not be asked must not answer for the model');
  assert.ok(result.reason);
});
