// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The chat offers the tool families a message needs, chosen by ONE typed decision
// (`narrowToolsByDecision`, `NOESAR_DECIDE=on`), instead of every granted schema on every turn.
//
// THE ORACLE: against the tree before this file there is no `narrowToolsByDecision`; the chat
// offered every granted tool whatever the message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrowToolsByDecision } from '../src/ai-workspace/chat-orchestrator.mjs';
import { DecisionUnavailable } from '../src/decide.mjs';

const TOOLS = [
  { id: 'b:plan', name: 'engine_workspace_plan', description: 'Plan a change' },
  { id: 'b:iter', name: 'engine_workspace_iterate', description: 'Measure, repair, measure again' },
  { id: 'b:web', name: 'engine_research_search', description: 'Search the web' },
  { id: 'b:doc', name: 'engine_documents_check', description: 'Judge every sentence of a document' },
  { id: 'b:ses', name: 'engine_sessions_list', description: 'List sessions' },
  { id: 'b:st', name: 'engine_status', description: 'Engine status' },
  { id: 'op:1', name: 'my_ticket_tool', description: 'Registered by the operator' },
];
// Options are offered in the order the families first appear: workspace, research, documents, sessions, status, none.
const distribution = (probabilities) => async ({ options }) => {
  assert.equal(options.length, probabilities.length, 'one option per family, plus «none»');
  return { abstained: false, answer: 0, probabilities, confidence: Math.max(...probabilities), mass: 1, record: {} };
};

test('one decision keeps the two most probable families and any at ≥ 0.1 — and never an operator tool less', async () => {
  const { tools, narrowed } = await narrowToolsByDecision(TOOLS, 'find me a review of this card online', distribution([0.05, 0.8, 0.1, 0.02, 0.01, 0.02]));
  assert.deepEqual(tools.map((tool) => tool.id), ['b:web', 'b:doc', 'op:1']);
  assert.deepEqual(narrowed.families.sort(), ['documents', 'research']);
  assert.equal(narrowed.offered, 7);
  assert.equal(narrowed.kept, 3);
});

test('an abstention or a decider that cannot answer leaves every granted tool offered', async () => {
  const abstains = async () => ({ abstained: true, answer: null, probabilities: [], confidence: 0, mass: 0.1, record: {} });
  assert.equal((await narrowToolsByDecision(TOOLS, 'x', abstains)).tools.length, TOOLS.length);
  const down = async () => { throw new DecisionUnavailable('down'); };
  const result = await narrowToolsByDecision(TOOLS, 'x', down);
  assert.equal(result.tools.length, TOOLS.length);
  assert.deepEqual(result.narrowed, { available: false, reason: 'down' });
});

test('with fewer than three families there is nothing worth choosing, and no decision is asked', async () => {
  let asked = 0;
  const { tools, narrowed } = await narrowToolsByDecision(TOOLS.slice(0, 3), 'x', async () => { asked += 1; return null; });
  assert.equal(tools.length, 3);
  assert.equal(narrowed, null);
  assert.equal(asked, 0);
});
