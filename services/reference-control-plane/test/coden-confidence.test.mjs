// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The regulator's first question: after the shadow measured a change, how likely is it that the
// change fixes what the report describes? (`NOESAR_DECIDE=on`, `decide.mjs`)
//
// WHY. A clean measurement says the effects were the declared ones — on SWE-bench Verified (0.3.0)
// 14 of 14 runs were clean and 3 were right. The person approving saw «clean» and nothing else.
//
// THE ORACLE: against the tree before this file, `iterate()` returns no `confidence` and the
// orchestrator takes no `decide` — every test below that asserts one fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator, compactDiff, CONFIDENCE_QUESTION } from '../src/workspace-actions.mjs';
import { Author } from '../src/author.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { DecisionUnavailable } from '../src/decide.mjs';

const NOW = Math.floor(Date.now() / 1000);
const ORIGINAL = 'total = a - b\n';
const edited = (contents, body) => ['<<<<<<< SEARCH', String(contents).replace(/\n$/, ''), '=======', String(body).replace(/\n$/, ''), '>>>>>>> REPLACE'].join('\n');

function fixture({ decide = null } = {}) {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-conf-ws-'));
  writeFileSync(join(ws, 'calc.py'), ORIGINAL);
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-conf-shadows-'));
  const events = new EventLedger();
  const asked = [];
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32), { ceiling: null }), events, env: {},
    author: new Author({ model: 'test', generate: async ({ contents }) => edited(contents, 'total = a + b\n') }),
    ...(decide ? { decide: async (args) => { asked.push(args); return decide(args); } } : {}),
  });
  const go = async () => {
    const { runId } = await orch.plan({ request: 'total should be the sum of a and b', files: [{ path: 'calc.py', contents: ORIGINAL }], actor: 'owner', nowUnix: NOW });
    return orch.iterate({ runId, actor: 'owner', nowUnix: NOW });
  };
  return { ws, shadows, events, asked, go };
}
const cleanup = ({ ws, shadows }) => { rmSync(ws, { recursive: true, force: true }); rmSync(shadows, { recursive: true, force: true }); };
const answering = (yes) => async () => ({ abstained: false, answer: yes > 0.5 ? 0 : 1, probabilities: [yes, 1 - yes], confidence: Math.max(yes, 1 - yes), mass: 1, record: { promptDigest: 'd'.repeat(64) } });

test('compactDiff shows only the lines that changed, per file', () => {
  const text = compactDiff([{ path: 'calc.py', before: 'x = 1\ntotal = a - b\ny = 2\n', after: 'x = 1\ntotal = a + b\ny = 2\n' }]);
  assert.equal(text, '--- calc.py (from line 2)\n- total = a - b\n+ total = a + b');
  assert.match(compactDiff([{ path: 'big', before: '', after: 'x'.repeat(100) }], { budget: 20 }), /cut at 20 characters/);
});

test('with a decider, iterate() returns how sure it is — asked of the diff the SHADOW measured', async () => {
  const fx = fixture({ decide: answering(0.82) });
  try {
    const iterated = await fx.go();
    assert.equal(iterated.clean, true);
    assert.equal(iterated.confidence.available, true);
    assert.equal(iterated.confidence.probability, 0.82);
    const [asked] = fx.asked;
    assert.equal(asked.question, CONFIDENCE_QUESTION);
    assert.match(asked.context, /- total = a - b\n\+ total = a \+ b/, 'the measured change, not a description of it');
    assert.match(asked.context, /total should be the sum/, 'and the report it is judged against');
    const recorded = fx.events.events().find((e) => e.action === 'workspace_action.confidence_assessed');
    assert.ok(recorded, 'the decision is in the ledger');
    assert.equal(JSON.parse(recorded.payload).probability, 0.82);
  } finally { cleanup(fx); }
});

test('an abstention is recorded as one, never turned into a number', async () => {
  const fx = fixture({ decide: async () => ({ abstained: true, answer: null, probabilities: [0.5, 0.5], confidence: 0, mass: 0.1, record: {} }) });
  try {
    const iterated = await fx.go();
    assert.equal(iterated.confidence.abstained, true);
    assert.equal(iterated.confidence.probability, null);
  } finally { cleanup(fx); }
});

test('a decider that cannot answer leaves the run exactly as measured, and says why', async () => {
  const fx = fixture({ decide: async () => { throw new DecisionUnavailable('down'); } });
  try {
    const iterated = await fx.go();
    assert.equal(iterated.clean, true, 'the measurement is untouched');
    assert.deepEqual(iterated.confidence, { available: false, reason: 'down' });
  } finally { cleanup(fx); }
});

test('without a decider, iterate() answers exactly what it answered before', async () => {
  const fx = fixture();
  try {
    const iterated = await fx.go();
    assert.equal('confidence' in iterated, false);
    assert.equal(fx.events.events().some((e) => e.action === 'workspace_action.confidence_assessed'), false);
  } finally { cleanup(fx); }
});
