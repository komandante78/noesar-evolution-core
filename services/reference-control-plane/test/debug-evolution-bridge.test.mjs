// SPDX-License-Identifier: AGPL-3.0-or-later
// D-0278: Debug Evolution as a real tool. rescanNoesarEvolutionProjects() is the one
// action the generic Agents/Workflows tool executor cannot express directly (Debug
// Evolution's rebuild endpoint needs a project id in the URL path) — everything else
// (list projects, all findings, SARIF) is a plain fixed-endpoint GET tool and needs no
// bridge code of its own to test here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { rescanNoesarEvolutionProjects } from '../src/debug-evolution-bridge.mjs';

async function withStubDebugEvolution(handler, run) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    handler(req, res, body ? JSON.parse(body) : null);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const previousUrl = process.env.NOESAR_DEBUG_EVOLUTION_URL;
  const previousToken = process.env.NOESAR_DEBUG_EVOLUTION_TOKEN;
  process.env.NOESAR_DEBUG_EVOLUTION_URL = `http://127.0.0.1:${port}`;
  process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = 'test-token-not-a-real-secret';
  try {
    await run();
  } finally {
    if (previousUrl === undefined) delete process.env.NOESAR_DEBUG_EVOLUTION_URL; else process.env.NOESAR_DEBUG_EVOLUTION_URL = previousUrl;
    if (previousToken === undefined) delete process.env.NOESAR_DEBUG_EVOLUTION_TOKEN; else process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = previousToken;
    await new Promise((resolve) => server.close(resolve));
  }
}

test('rescanNoesarEvolutionProjects refuses when no token is configured', async () => {
  const previous = process.env.NOESAR_DEBUG_EVOLUTION_TOKEN;
  delete process.env.NOESAR_DEBUG_EVOLUTION_TOKEN;
  try {
    await assert.rejects(() => rescanNoesarEvolutionProjects(), (error) => error.status === 503);
  } finally {
    if (previous !== undefined) process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = previous;
  }
});

test('rescanNoesarEvolutionProjects rebuilds only NOESAR EVOLUTION projects, sends the bearer token, and reports per-project results', async () => {
  const rebuiltIds = [];
  await withStubDebugEvolution((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-token-not-a-real-secret');
    if (req.method === 'GET' && req.url === '/api/v2/projects') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        projects: [
          { id: 'p1', name: 'NOESAR EVOLUTION - apps' },
          { id: 'p2', name: 'NOESAR EVOLUTION - schemas' },
          { id: 'p3', name: 'CODEN DEBUG' },
        ],
      }));
      return;
    }
    const rebuildMatch = req.url.match(/^\/api\/v2\/projects\/([^/]+)\/genome\/rebuild$/);
    if (req.method === 'POST' && rebuildMatch) {
      rebuiltIds.push(rebuildMatch[1]);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ finding_count: 3, node_count: 40 }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unknown endpoint' }));
  }, async () => {
    const summary = await rescanNoesarEvolutionProjects();
    assert.deepEqual(rebuiltIds.sort(), ['p1', 'p2']);
    assert.equal(summary.rescanned, 2);
    assert.equal(summary.succeeded, 2);
    assert.equal(summary.results.find((r) => r.id === 'p1').findingCount, 3);
  });
});

test('rescanNoesarEvolutionProjects reports a per-project failure without aborting the rest', async () => {
  await withStubDebugEvolution((req, res) => {
    if (req.method === 'GET' && req.url === '/api/v2/projects') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ projects: [
        { id: 'ok', name: 'NOESAR EVOLUTION - apps' },
        { id: 'broken', name: 'NOESAR EVOLUTION - schemas' },
      ] }));
      return;
    }
    if (req.url === '/api/v2/projects/ok/genome/rebuild') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ finding_count: 1, node_count: 5 }));
      return;
    }
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'boom' }));
  }, async () => {
    const summary = await rescanNoesarEvolutionProjects();
    assert.equal(summary.rescanned, 2);
    assert.equal(summary.succeeded, 1);
    const failed = summary.results.find((r) => r.id === 'broken');
    assert.equal(failed.ok, false);
    assert.match(failed.error, /500/);
  });
});
