// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Arm B1 of the SWE half: NOESAR asks before the agent's first turn.
//
// The product, not a copy of it — NOESAR's own ReasoningRouter with the local-model route for
// `interpret` switched on, exactly as an installation switches it on. It names what the problem
// statement leaves open; each name goes to THEIR judge through the SAME bridge the agent's own
// ask_human tool uses, so their server counts it, resolves the same blockers, and writes it into the
// same ask_human_metrics.json — first, and in the order named.
//
// This is the SQL arm's rule, unchanged, with one thing swapped: there a question about a database,
// here a PR description. Written before any B1 SWE score existed and not to be revised against one.
// What the product returns is what is asked; a degraded answer is asked, recorded as degraded, never
// dropped and never replaced.
//
// usage: node hil-noesar-ask.mjs --selfcheck
//        node hil-noesar-ask.mjs <statement.md> <augmented.md> <noesar.json>
//   HIL_NOESAR_SRC     services/reference-control-plane/src at a NAMED commit (git archive, ro)
//   HIL_NOESAR_COMMIT  that commit, recorded with the questions
//   HIL_BRIDGE_URL     the bridge (default http://127.0.0.1:8521/ask)
//   HIL_MODEL_URL      the local model (default http://127.0.0.1:8420)
//   HIL_INSTANCE_ID    the task id, sent as their tool sends it
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const NOESAR_SRC = process.env.HIL_NOESAR_SRC ?? '';
const BRIDGE = process.env.HIL_BRIDGE_URL ?? 'http://127.0.0.1:8521/ask';
const MODEL_URL = process.env.HIL_MODEL_URL ?? 'http://127.0.0.1:8420';
const INSTANCE = process.env.HIL_INSTANCE_ID ?? '';

// Word for word the preamble the SQL arm uses: two arms of one campaign must not speak two dialects.
const PREAMBLE = "Before this question reached you, NOESAR asked the human about what it leaves open. The questions and the human's answers, verbatim:";

export function augment(statement, asked) {
  if (!asked.length) return statement;
  return `${statement}\n\n${PREAMBLE}\n\n${asked.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}`;
}

async function router() {
  const { ReasoningRouter } = await import(`${NOESAR_SRC}/reasoning-router.mjs`);
  const r = new ReasoningRouter({ env: { NOESAR_LOCAL_MODEL_SURFACES: 'interpret', NOESAR_AUTHORING_ENDPOINT: MODEL_URL } });
  // A B1 run with the route off would be a B0 run wearing B1's name.
  if (!r.routing.localModelSurfaces.includes('interpret')) {
    throw new Error(`NOESAR: the local-model route for interpret is off (endpoint '${MODEL_URL}', src '${NOESAR_SRC}')`);
  }
  return r;
}

// Through the bridge, not around it: the header is what tells the log who asked, and their server
// sees no difference between this and the agent — which is the point.
async function ask(question) {
  const res = await fetch(BRIDGE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-noesar': '1' },
    body: JSON.stringify({ question, instance_id: INSTANCE }),
  });
  const body = await res.json();
  return body.response;
}

async function run(statementPath, outPath, jsonPath) {
  const statement = readFileSync(statementPath, 'utf8');
  const r = await router();
  const intent = await r.interpret(statement);
  const asked = [];
  for (const question of intent.ambiguities) {
    const answer = await ask(question);
    asked.push({ question, answer });
    console.log(`noesar ask ${asked.length}: ${question.slice(0, 60)} -> ${String(answer).slice(0, 60)}`);
  }
  writeFileSync(outPath, augment(statement, asked));
  writeFileSync(jsonPath, JSON.stringify({
    commit: process.env.HIL_NOESAR_COMMIT ?? null,
    instance: INSTANCE,
    asked,
    provenance: r.provenance(),
    degradations: r.degradations(),
    // The prompt is reproducible from the commit; its digest is enough here.
    modelCalls: r.modelCalls().map(({ prompt, ...call }) => call),
  }, null, 2));
  console.log(`noesar: ${asked.length} asked, ${r.degradations().length} degraded, commit ${process.env.HIL_NOESAR_COMMIT ?? 'none'}`);
}

function selfcheck() {
  assert.equal(augment('S', []), 'S', 'nothing asked, nothing added');
  const one = augment('S', [{ question: 'q1', answer: 'a1' }]);
  assert.ok(one.startsWith('S\n\n'), 'the statement is never rewritten, only followed');
  assert.ok(one.includes(PREAMBLE) && one.includes('Q: q1\nA: a1'));
  const two = augment('S', [{ question: 'q1', answer: 'a1' }, { question: 'q2', answer: 'a2' }]);
  assert.ok(two.indexOf('Q: q1') < two.indexOf('Q: q2'), 'in the order NOESAR named them');
  assert.ok(augment('S', [{ question: 'q', answer: "can't answer (perhaps transient hiccup)" }]).includes("can't answer"),
    'a degraded answer is carried, not dropped: the agent sees what the human said');
  console.log('selfcheck: ok');
}

const [a, b, c] = process.argv.slice(2);
if (a === '--selfcheck') selfcheck();
else if (a && b && c) await run(a, b, c);
else {
  console.error('usage: --selfcheck | <statement.md> <augmented.md> <noesar.json>');
  process.exit(2);
}
