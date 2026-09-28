// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The search finds candidates by words; with decisions (`NOESAR_DECIDE=on`) the model judges them
// and the plan keeps the five it ranks highest.
//
// WHY. On the 0.3.0 resolve-rate sample the file the fix is in was outside the five the search chose
// in 4 of 14 instances: the words that rank a file are not the words that say where a bug is.
//
// THE ORACLE: against the tree before this file, a plan never contains `target.py` below — it is the
// search's 7th candidate and the plan keeps five.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { DecisionUnavailable } from '../src/decide.mjs';

const NOW = Math.floor(Date.now() / 1000);

function fixture(decide = null) {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-gd-ws-'));
  // Six files that say `widget` often, and the one that holds the bug says it once.
  for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
    writeFileSync(join(ws, `${name}.py`), `def ${name}_widget():\n${'    widget = widget + 1  # widget widget\n'.repeat(6)}`);
  }
  writeFileSync(join(ws, 'target.py'), 'def resize_widget(w):\n    return w * 0\n');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-gd-shadows-'));
  const judged = [];
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32), { ceiling: null }), events: new EventLedger(), env: {},
    ...(decide ? { decide: async (args) => { judged.push(args); return decide(args); } } : {}),
  });
  const plan = () => orch.plan({ request: 'resizing a widget makes it vanish', files: [], actor: 'owner', nowUnix: NOW });
  return { ws, shadows, judged, plan };
}
const cleanup = ({ ws, shadows }) => { rmSync(ws, { recursive: true, force: true }); rmSync(shadows, { recursive: true, force: true }); };
const sayYesTo = (path) => async ({ context }) => {
  const yes = context.includes(`File: ${path}\n`) ? 0.9 : 0.1;
  return { abstained: false, answer: yes > 0.5 ? 0 : 1, probabilities: [yes, 1 - yes], confidence: 0.9, mass: 1, record: {} };
};

test('without decisions the plan keeps the search\'s first five — and the file with the bug is not one of them', async () => {
  const fx = fixture();
  try {
    const planned = await fx.plan();
    assert.equal(planned.grounding.selected.length, 5);
    assert.ok(!planned.grounding.selected.includes('target.py'));
    assert.equal('decisions' in planned.grounding, false, 'no new field without a decider');
  } finally { cleanup(fx); }
});

test('with decisions every candidate is judged by its path and its definitions, and the plan keeps the best five', async () => {
  const fx = fixture(sayYesTo('target.py'));
  try {
    const planned = await fx.plan();
    assert.equal(planned.grounding.selected.length, 5);
    assert.ok(planned.grounding.selected.includes('target.py'), 'the decision brought in the file the words ranked low');
    assert.equal(planned.grounding.decisions.available, true);
    assert.equal(planned.grounding.decisions.judged.length, 7, 'all seven candidates of the wider pool were judged');
    const target = planned.grounding.decisions.judged.find((entry) => entry.path === 'target.py');
    assert.ok(target.searchRank > 5, 'and the record shows the search had ranked it outside the five');
    assert.match(fx.judged.find((j) => j.context.includes('File: target.py')).context, /1: def resize_widget\(w\):/, 'shown its table of contents, not its bytes');
  } finally { cleanup(fx); }
});

test('a decider that cannot answer leaves the plan with the search\'s first five, and says why', async () => {
  const fx = fixture(async () => { throw new DecisionUnavailable('down'); });
  try {
    const planned = await fx.plan();
    assert.equal(planned.grounding.selected.length, 5);
    assert.ok(!planned.grounding.selected.includes('target.py'));
    assert.deepEqual(planned.grounding.decisions, { available: false, reason: 'down' });
  } finally { cleanup(fx); }
});
