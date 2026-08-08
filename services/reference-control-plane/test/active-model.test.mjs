// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The rows for "which model is loaded" — one answer, for everyone who asks (s335).
//
// The property that matters most here is not that a loaded model is reported. It is that the
// four outcomes stay FOUR: not-configured, unreachable, none-served, loaded. Collapsing
// `unreachable` into "no model" is the failure that would tell an operator to install a model
// they already have, and it is the failure a single `if (!id)` would produce.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ActiveModelState, modelIdFromServed, probeModelEndpoint, resolveActiveModel, activeModelReport,
} from '../src/active-model.mjs';

const at = () => '2026-08-08T00:00:00.000Z';
const answering = (body, { ok = true, status = 200 } = {}) => async () => ({ ok, status, json: async () => body });

test('a served path becomes the id the catalogue keys on, and never invents one', () => {
  assert.equal(modelIdFromServed('/models/phi-4-q4_k_m.gguf'), 'phi-4-q4_k_m');
  assert.equal(modelIdFromServed('qwen2.5-coder-7b-instruct-q5_k_m.gguf'), 'qwen2.5-coder-7b-instruct-q5_k_m');
  assert.equal(modelIdFromServed('/models/weights.safetensors'), 'weights');
  // Nothing in, nothing out — an empty answer must not become an empty-string id that the
  // catalogue would then treat as a model.
  assert.equal(modelIdFromServed(''), null);
  assert.equal(modelIdFromServed(null), null);
  assert.equal(modelIdFromServed('   '), null);
});

test('no endpoint configured is its own answer, not a failure', async () => {
  const r = await probeModelEndpoint('', { fetchImpl: () => { throw new Error('must not be called'); }, now: at });
  assert.equal(r.state, ActiveModelState.NOT_CONFIGURED);
  assert.equal(r.id, null);
  assert.match(r.reason, /no model endpoint is configured/);
});

test('an endpoint that answers names the model, and keeps the raw string alongside it', async () => {
  const r = await probeModelEndpoint('http://model:8420/', {
    fetchImpl: answering({ data: [{ id: '/models/phi-4-q4_k_m.gguf' }] }), now: at,
  });
  assert.equal(r.state, ActiveModelState.LOADED);
  assert.equal(r.id, 'phi-4-q4_k_m');
  // The raw identifier travels, so nothing downstream has to trust the normalisation.
  assert.equal(r.served, '/models/phi-4-q4_k_m.gguf');
  // The trailing slash must not produce `//v1/models`.
  assert.equal(r.endpoint, 'http://model:8420');
});

test('UNREACHABLE IS NOT ABSENT — the distinction this file exists for', async () => {
  const refused = await probeModelEndpoint('http://model:8420', {
    fetchImpl: async () => { throw Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' }); }, now: at,
  });
  assert.equal(refused.state, ActiveModelState.UNREACHABLE);
  assert.notEqual(refused.state, ActiveModelState.NOT_CONFIGURED);
  assert.notEqual(refused.state, ActiveModelState.NONE_SERVED);
  // The endpoint is still reported: an operator must be able to see WHAT did not answer.
  assert.equal(refused.endpoint, 'http://model:8420');
  assert.match(refused.reason, /could not be reached/);

  const timedOut = await probeModelEndpoint('http://model:8420', {
    fetchImpl: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); },
    timeoutMs: 1500, now: at,
  });
  assert.equal(timedOut.state, ActiveModelState.UNREACHABLE);
  assert.match(timedOut.reason, /within 1500ms/);

  const refusedStatus = await probeModelEndpoint('http://model:8420', {
    fetchImpl: answering({}, { ok: false, status: 503 }), now: at,
  });
  assert.equal(refusedStatus.state, ActiveModelState.UNREACHABLE);
  assert.match(refusedStatus.reason, /answered 503/);
});

test('an endpoint that answers with an empty list says so, and is not called unreachable', async () => {
  for (const body of [{ data: [] }, {}, { data: [{ id: '' }] }]) {
    const r = await probeModelEndpoint('http://model:8420', { fetchImpl: answering(body), now: at });
    assert.equal(r.state, ActiveModelState.NONE_SERVED, `body ${JSON.stringify(body)}`);
    assert.equal(r.id, null);
  }
});

test('with no way to make a request at all, the answer is unreachable — never loaded', async () => {
  const r = await probeModelEndpoint('http://model:8420', { fetchImpl: undefined, now: at });
  assert.equal(r.state, ActiveModelState.UNREACHABLE);
  assert.match(r.reason, /no way to reach the endpoint/);
});

test('the local runtime wins when it has a model, and says that it was the one that spoke', async () => {
  const r = await resolveActiveModel({
    localRuntimeModel: 'phi-4-q4_k_m',
    endpoint: 'http://model:8420',
    fetchImpl: () => { throw new Error('the endpoint must not be asked when the runtime knows'); },
    now: at,
  });
  assert.equal(r.state, ActiveModelState.LOADED);
  assert.equal(r.source, 'local-runtime');
  assert.equal(r.id, 'phi-4-q4_k_m');
});

test('with no local runtime model the endpoint answers, and the source is declared', async () => {
  const r = await resolveActiveModel({
    localRuntimeModel: null, endpoint: 'http://model:8420',
    fetchImpl: answering({ data: [{ id: '/models/phi-4-q4_k_m.gguf' }] }), now: at,
  });
  assert.equal(r.source, 'endpoint');
  assert.equal(r.id, 'phi-4-q4_k_m');
});

test('a source is never claimed when nothing is configured', async () => {
  const r = await resolveActiveModel({ localRuntimeModel: '', endpoint: '', fetchImpl: undefined, now: at });
  assert.equal(r.state, ActiveModelState.NOT_CONFIGURED);
  assert.equal(r.source, null);
});

test('the report a module receives carries who uses it, and cannot be edited by the reader', () => {
  const report = activeModelReport(
    { state: ActiveModelState.LOADED, source: 'endpoint', id: 'phi-4-q4_k_m', served: '/models/phi-4-q4_k_m.gguf', endpoint: 'http://model:8420', at: at(), reason: null },
    { usedBy: ['noesar-authoring', 'atom'] },
  );
  assert.equal(report.loaded, true);
  assert.deepEqual([...report.usedBy], ['noesar-authoring', 'atom']);
  // A module holding this must not be able to change what the next reader sees.
  assert.throws(() => { report.id = 'something-else'; }, TypeError);
  assert.throws(() => { report.usedBy.push('invented'); }, TypeError);
});

test('an unreachable endpoint reports loaded:false WITH the reason, so nobody reads it as absent', () => {
  const report = activeModelReport(
    { state: ActiveModelState.UNREACHABLE, source: 'endpoint', id: null, served: null, endpoint: 'http://model:8420', at: at(), reason: 'the model endpoint could not be reached: ECONNREFUSED' },
    { usedBy: [] },
  );
  assert.equal(report.loaded, false);
  assert.equal(report.state, ActiveModelState.UNREACHABLE);
  assert.equal(report.endpoint, 'http://model:8420');
  assert.ok(report.reason, 'a false without a reason is the flattening this module forbids');
});
