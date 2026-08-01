// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0284/D-0285, end to end: `POST /api/v1/debug-evolution/triage` against a REAL server.mjs
// boot, a stub Debug Evolution (findings/evidence/transition) and a stub ATOM
// (`/v1/hypothesize`), proving the whole chain a curl cannot: NOESAR reads a DETECTED
// finding, calls the real wire shape ATOM answers on for all three roles (discovery,
// security, root-cause), converts each answer into Debug Evolution's own evidence rows, and
// attempts the transition Debug Evolution's own state machine decides. The stub ATOM
// answers differently per `intent.goal`, so the test can tell the three calls apart the same
// way the real sidecar would answer three genuinely different questions.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';
import { OWNER_MODULE_CATALOG } from '../src/owner-module-catalog.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';
const DEBUG_EVOLUTION_TOKEN = 'stub-debug-evolution-token';
const ATOM_TOKEN = 'stub-atom-token';

const FINDINGS = [
  { id: 'f-detected', project_id: 'p1', rule_id: 'sql-injection', title: 'Possible SQL injection', description: 'user input flows into a raw query', severity: 'high', state: 'DETECTED', path: 'src/db.py', line: 42 },
  { id: 'f-confirmed', project_id: 'p1', rule_id: 'sql-injection', title: 'Already judged', description: 'x', severity: 'high', state: 'CONFIRMED', path: 'src/other.py', line: 1 },
];
const evidenceCalls = [];
const hypothesizeCalls = [];
let transitionCall = null;

const stubDebugEvolution = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${DEBUG_EVOLUTION_TOKEN}`) {
    res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return;
  }
  if (req.method === 'GET' && req.url === '/api/v2/projects') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ projects: [{ id: 'p1', name: 'NOESAR EVOLUTION - apps' }] }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/v2/findings?project_id=p1') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ findings: FINDINGS }));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/v2/findings/f-detected/evidence') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    evidenceCalls.push(body);
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: evidenceCalls.length, finding_id: 'f-detected', ...body }));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/v2/findings/f-detected/transition') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    transitionCall = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    // Stateful, like the real store: the next GET /findings must see the new state, which
    // is exactly what makes the idempotency test below a real property instead of a fixture
    // that happens to look right once.
    FINDINGS.find((finding) => finding.id === 'f-detected').state = transitionCall.target;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'f-detected', state: transitionCall.target }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unknown' }));
});
await new Promise((resolve) => stubDebugEvolution.listen(0, '127.0.0.1', resolve));

const stubAtom = createServer(async (req, res) => {
  if (req.headers['x-atom-token'] !== ATOM_TOKEN) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: { kind: 'UNAUTHORIZED', reason: 'bad token' } }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/hypothesize') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const { intent } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    hypothesizeCalls.push(intent.goal);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (/reachable/.test(intent.goal)) {
      // security
      res.end(JSON.stringify({
        ok: true,
        value: [{
          statement: 'reachable from the public /search endpoint with no authentication in between',
          supporting: [{ kind: 'SUPPORTED', sources: [{ locator: 'src/routes.py:12', excerpt: 'app.route("/search")(lambda: db_query(request.args))' }] }],
          contrary: 'NOT_SOUGHT',
        }],
      }));
      return;
    }
    if (/causal defect/.test(intent.goal)) {
      // root-cause
      res.end(JSON.stringify({
        ok: true,
        value: [{
          statement: 'the query builder concatenates instead of parameterising because it predates the ORM migration',
          supporting: [{ kind: 'SUPPORTED', sources: [{ locator: 'src/db.py:38', excerpt: 'def raw_query(s): return f"SELECT * FROM t WHERE x={s}"' }] }],
          contrary: 'NONE_FOUND',
        }],
      }));
      return;
    }
    // discovery
    res.end(JSON.stringify({
      ok: true,
      value: [{
        statement: 'the query at src/db.py:42 concatenates unsanitised user input',
        supporting: [{ kind: 'SUPPORTED', sources: [{ locator: 'src/db.py:42', excerpt: 'raw_query(user_input)' }] }],
        contrary: 'FOUND',
        contraryEvidence: [{ kind: 'SUPPORTED', sources: [{ locator: 'src/db.py:40', excerpt: 'user_input = quote(user_input)' }] }],
      }],
    }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unknown surface' }));
});
await new Promise((resolve) => stubAtom.listen(0, '127.0.0.1', resolve));

const workspace = mkdtempSync(join(tmpdir(), 'noesar-de-triage-http-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';
process.env.NOESAR_DEBUG_EVOLUTION_URL = `http://127.0.0.1:${stubDebugEvolution.address().port}`;
process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = DEBUG_EVOLUTION_TOKEN;
process.env.NOESAR_REASONING_MODE = 'rust-external';
process.env.NOESAR_RUST_REASONING_ENDPOINT = `http://127.0.0.1:${stubAtom.address().port}`;
process.env.NOESAR_RUST_REASONING_TOKEN = ATOM_TOKEN;
// Only `hypothesize` is routed -- this design needs no direct call to the bare `evidence`
// surface, since `Hypothesis` already carries both supporting AND contrary evidence in one
// answer (debug-evolution-triage.mjs's own header explains why).
process.env.NOESAR_EXTERNAL_SURFACES = 'hypothesize';

// D-0283: the module must be installed and active for either bridge route to run at all.
const moduleRoot = join(workspace, 'sector-modules', 'debug-evolution');
mkdirSync(moduleRoot, { recursive: true });
writeFileSync(join(moduleRoot, 'manifest.json'), JSON.stringify(OWNER_MODULE_CATALOG[0].buildManifest(), null, 2));
writeFileSync(join(moduleRoot, 'state.json'), JSON.stringify({
  status: 'active', installedAtUnix: 1, activatedAtUnix: 2, deactivatedAtUnix: null,
  history: [{ event: 'installed', atUnix: 1 }, { event: 'activated', atUnix: 2 }],
}, null, 2));

const { server } = await import('../src/server.mjs');

const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

let base = null;
let cookie = null;
let csrf = null;

async function raw(path, { method = 'GET', payload, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: response.status, json, text };
}
function authed(path, opts = {}) { return raw(path, { ...opts, headers: { cookie, 'x-noesar-csrf': csrf, ...(opts.headers ?? {}) } }); }

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const begun = await raw('/api/v1/auth/setup', {
    method: 'POST', payload: { username: 'owner', displayName: 'Owner', password: PASSWORD },
    headers: { 'x-noesar-setup-token': SETUP_TOKEN },
  });
  assert.equal(begun.status, 201, `setup failed: ${begun.text.slice(0, 200)}`);
  const response = await fetch(`${base}/api/v1/auth/setup/confirm`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge: begun.json.challenge, totpCode: totpCode(begun.json.totpSecret, stepStart()) }),
  });
  assert.equal(response.status, 201, 'setup confirm failed');
  const confirmed = await response.json();
  const setCookie = response.headers.getSetCookie?.() ?? [];
  cookie = setCookie.find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
  csrf = confirmed.csrfToken;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => stubDebugEvolution.close(resolve));
  await new Promise((resolve) => stubAtom.close(resolve));
});

describe('D-0284/D-0285 — Phase 2 discovery+skeptic+security+root-cause triage works end to end against real ATOM and Debug Evolution wire shapes', () => {
  test('triage without a session is refused', async () => {
    const attempt = await raw('/api/v1/debug-evolution/triage', { method: 'POST' });
    assert.equal(attempt.status, 401);
  });

  test('triage without CSRF is refused', async () => {
    const attempt = await raw('/api/v1/debug-evolution/triage', { method: 'POST', headers: { cookie } });
    assert.equal(attempt.status, 403);
  });

  test('triage only visits the DETECTED finding, calls ATOM once per role for real, and writes real evidence + a real transition', async () => {
    const result = await authed('/api/v1/debug-evolution/triage', { method: 'POST', payload: {} });
    assert.equal(result.status, 200, `triage failed: ${result.text.slice(0, 300)}`);
    assert.equal(result.json.triaged, 1, 'the already-CONFIRMED finding must not be re-triaged');
    assert.equal(result.json.succeeded, 1);
    assert.equal(result.json.results[0].id, 'f-detected');
    assert.equal(result.json.results[0].skipped, false);
    assert.equal(result.json.results[0].hypotheses, 3, 'one hypothesis per role: discovery, security, root-cause');
    assert.equal(result.json.results[0].evidenceAdded, 4, 'discovery: 1 supporting + 1 counter-evidence; security: 1 supporting; root-cause: 1 supporting');
    assert.equal(result.json.results[0].state, 'HYPOTHESIZED');
    assert.ok(result.json.provenance.filter((entry) => entry.surface === 'hypothesize' && entry.provider === 'atom').length >= 3, 'provenance must show ATOM answered all three hypothesize calls, not the reference provider');

    assert.equal(hypothesizeCalls.length, 3, 'exactly one hypothesize() call per declared role, not six');
    assert.ok(hypothesizeCalls.some((goal) => /real defect/.test(goal)), 'discovery intent was asked');
    assert.ok(hypothesizeCalls.some((goal) => /reachable/.test(goal)), 'security intent was asked');
    assert.ok(hypothesizeCalls.some((goal) => /causal defect/.test(goal)), 'root-cause intent was asked');

    assert.equal(evidenceCalls.length, 4);
    assert.equal(evidenceCalls[0].evidence_type, 'AI_HYPOTHESIS');
    assert.equal(evidenceCalls[0].source, 'atom');
    assert.equal(evidenceCalls[0].metadata.role, 'discovery');
    assert.equal(evidenceCalls[1].evidence_type, 'COUNTER_EVIDENCE');
    assert.equal(evidenceCalls[1].metadata.role, 'discovery');
    assert.match(evidenceCalls[1].summary, /quote\(user_input\)/, 'the real counter-evidence text from the stub must reach Debug Evolution unchanged');
    assert.equal(evidenceCalls[2].metadata.role, 'security');
    assert.equal(evidenceCalls[2].evidence_type, 'AI_HYPOTHESIS', 'D-0285: security reasoning is AI_HYPOTHESIS, never SEMANTIC_REACHABILITY');
    assert.match(evidenceCalls[2].summary, /public \/search endpoint/);
    assert.equal(evidenceCalls[3].metadata.role, 'root-cause');
    assert.match(evidenceCalls[3].summary, /ORM migration/);

    assert.equal(transitionCall.target, 'HYPOTHESIZED');
    assert.equal(transitionCall.actor, 'atom', 'the actor recorded must distinguish this from a human using the WebUI (actor:"webui")');
    assert.match(transitionCall.rationale, /discovery:.*concatenates unsanitised user input/);
    assert.match(transitionCall.rationale, /security:.*reachable/);
    assert.match(transitionCall.rationale, /root-cause:.*ORM migration/);
  });

  test('a second triage run adds no new evidence to a finding that already moved past DETECTED — the filter, not memory, does the work', async () => {
    evidenceCalls.length = 0;
    hypothesizeCalls.length = 0;
    const result = await authed('/api/v1/debug-evolution/triage', { method: 'POST', payload: {} });
    assert.equal(result.status, 200);
    assert.equal(result.json.triaged, 0, 'f-detected is no longer DETECTED after the previous test moved it to HYPOTHESIZED in the stub\'s own state');
    assert.equal(evidenceCalls.length, 0);
    assert.equal(hypothesizeCalls.length, 0, 'no role is asked anything for a finding that is not DETECTED');
  });
});
