// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0293: judging ONE finding. The sweep (`triageUnclassifiedFindings`) could not do this
// for two independent reasons, and both are asserted here rather than described:
//
//   * it only ever looks at `DETECTED` findings, and everything an API probe or the sandbox
//     produces is born `HYPOTHESIZED` — observed, not guessed;
//   * `HYPOTHESIZED -> HYPOTHESIZED` is not a legal edge in Debug Evolution's own state
//     machine, so a naive per-finding call would attach its evidence and THEN fail on the
//     transition, leaving the caller with an error and the database with the evidence.
//
// The stub Debug Evolution below records every write it receives, so what the bridge did is
// read off the requests it actually made, not off its own return value.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { triageFindingById } from '../src/debug-evolution-bridge.mjs';

function findingAt(state) {
  return {
    id: 'finding-1', project_id: 'p-1', rule_id: 'DE-API-UNAUTHENTICATED-ACCESS',
    title: 'Percorso protetto raggiungibile senza credenziale',
    description: 'ha risposto 200 senza credenziale e 200 con la credenziale registrata',
    severity: 'CRITICAL', state, path: 'http://target.test/healthz', line: 1,
    confidence: { aggregate: 0.43 }, metadata: { source: 'api-probe' },
  };
}

/** A stub Debug Evolution that answers the court read and records every write. */
async function withStub(state, run) {
  const writes = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (req.method === 'POST') writes.push({ url: req.url, body: raw ? JSON.parse(raw) : null });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url.endsWith('/court')) {
      res.end(JSON.stringify({ finding: findingAt(state), evidence: [], available_transitions: [] }));
    } else if (req.url.endsWith('/transition')) {
      res.end(JSON.stringify({ ...findingAt('HYPOTHESIZED') }));
    } else {
      res.end(JSON.stringify({ id: writes.length }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const prevUrl = process.env.NOESAR_DEBUG_EVOLUTION_URL;
  const prevToken = process.env.NOESAR_DEBUG_EVOLUTION_TOKEN;
  process.env.NOESAR_DEBUG_EVOLUTION_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = 'test-token-not-a-real-secret';
  try {
    return await run(writes);
  } finally {
    server.close();
    if (prevUrl === undefined) delete process.env.NOESAR_DEBUG_EVOLUTION_URL; else process.env.NOESAR_DEBUG_EVOLUTION_URL = prevUrl;
    if (prevToken === undefined) delete process.env.NOESAR_DEBUG_EVOLUTION_TOKEN; else process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = prevToken;
  }
}

// The real `Hypothesis` shape `hypothesisToEvidenceRows` consumes: `supporting` is a list of
// ATOM evidence objects, and `contrary` is one of NOT_SOUGHT / NONE_FOUND / FOUND — three
// different answers, only the last of which produces a COUNTER_EVIDENCE row.
const HYPOTHESIS = {
  statement: 'il percorso non e protetto',
  supporting: [{ kind: 'SUPPORTED', sources: [{ locator: 'GET /healthz', excerpt: '200 senza credenziale' }] }],
  contrary: 'NONE_FOUND',
};

/** A router that answers every role with one hypothesis, so the evidence rows are real. */
function stubRouter(hypotheses = [HYPOTHESIS]) {
  return {
    calls: 0,
    async hypothesize() { this.calls += 1; return hypotheses; },
    provenance() { return { provider: 'stub' }; },
    routing: 'stub',
  };
}

describe('D-0293 — triageFindingById', () => {
  test('a HYPOTHESIZED finding gets its evidence and NO transition attempt', async () => {
    await withStub('HYPOTHESIZED', async (writes) => {
      const router = stubRouter();
      const result = await triageFindingById('finding-1', router);
      assert.equal(result.ok, true);
      assert.equal(result.transitioned, false);
      assert.equal(result.state, 'HYPOTHESIZED');
      assert.ok(result.evidenceAdded > 0, 'the hypotheses must have been attached');
      assert.equal(writes.some((w) => w.url.endsWith('/transition')), false,
        'asking for HYPOTHESIZED -> HYPOTHESIZED would fail after the evidence was already written');
      assert.ok(writes.every((w) => w.url.endsWith('/evidence')), 'every write must be an evidence row');
    });
  });

  test('a DETECTED finding still gets the transition, so the sweep behaviour is unchanged', async () => {
    await withStub('DETECTED', async (writes) => {
      const result = await triageFindingById('finding-1', stubRouter());
      assert.equal(result.transitioned, true);
      assert.equal(result.state, 'HYPOTHESIZED');
      const transition = writes.find((w) => w.url.endsWith('/transition'));
      assert.ok(transition, 'a DETECTED finding must still be advanced');
      assert.equal(transition.body.target, 'HYPOTHESIZED');
      assert.equal(transition.body.actor, 'atom');
      assert.ok(transition.body.rationale.includes('discovery'), 'the rationale carries the roles that spoke');
    });
  });

  test('every declared role is asked, once', async () => {
    await withStub('HYPOTHESIZED', async () => {
      const router = stubRouter();
      await triageFindingById('finding-1', router);
      assert.equal(router.calls, 3, 'discovery+skeptic, security, root-cause — three calls, not six');
    });
  });

  test('a role set that returns nothing is a real answer, not a failure', async () => {
    await withStub('HYPOTHESIZED', async (writes) => {
      const result = await triageFindingById('finding-1', stubRouter([]));
      assert.equal(result.ok, true);
      assert.equal(result.skipped, true);
      assert.equal(result.evidenceAdded, 0);
      assert.equal(writes.length, 0, 'nothing may be written when nothing was hypothesised');
    });
  });

  test('a deployment with no module token refuses before reading anything', async () => {
    const prev = process.env.NOESAR_DEBUG_EVOLUTION_TOKEN;
    delete process.env.NOESAR_DEBUG_EVOLUTION_TOKEN;
    try {
      await assert.rejects(() => triageFindingById('finding-1', stubRouter()), (error) => error.status === 503);
    } finally {
      if (prev !== undefined) process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = prev;
    }
  });
});
