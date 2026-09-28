// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed decisions (`decide.mjs`) and their first use: the Author's view of a file too large for the
// model's window is chosen by decisions instead of by the words of the request.
//
// THE ORACLE: against the tree before `decide.mjs` existed this file does not load (no module), and
// the Author test asserts a view that the word-based excerpt cannot produce — the buggy function
// shares no word with the report, so `excerptAround` never keeps it.
//
// A fake endpoint, deliberately: what is tested here is the PROTOCOL — what is asked, what is read
// back, when it abstains — and it must hold on every machine that runs the suite. The live check on
// the real model is `BENCH_SWE/chat-logprobs-probe.mjs` (28/09: A 0,869 on the buggy function).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openAiDecider, letterDistribution, decisionPrompt, decideSwitchFromEnv, DecisionUnavailable, probabilityYes } from '../src/decide.mjs';
import { Author, AuthoringRefused, decidedExcerpt, regionsOf } from '../src/author.mjs';

const lp = (p) => Math.log(p);
/** A chat endpoint that answers every request with the given top_logprobs, and records the bodies. */
function endpoint(tops, { status = 200 } = {}) {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push({ url, body });
    const top = typeof tops === 'function' ? tops(body) : tops;
    return {
      ok: status === 200, status,
      text: async () => 'refused',
      json: async () => ({ choices: [{ message: { content: top[0]?.token ?? '' }, logprobs: { content: [{ top_logprobs: top }] } }] }),
    };
  };
  return { fetchImpl, bodies };
}

test('the switch is off unless NOESAR_DECIDE=on', () => {
  assert.equal(decideSwitchFromEnv({}), false);
  assert.equal(decideSwitchFromEnv({ NOESAR_DECIDE: 'yes' }), false);
  assert.equal(decideSwitchFromEnv({ NOESAR_DECIDE: 'ON' }), true);
});

test('one token, temperature 0, probabilities asked for, thinking off, context first', async () => {
  const { fetchImpl, bodies } = endpoint([{ token: 'A', logprob: lp(0.9) }, { token: 'B', logprob: lp(0.1) }]);
  const choose = openAiDecider({ endpoint: 'http://model:8420/', fetchImpl });
  await choose({ context: 'CTX', question: 'Q?', options: ['yes', 'no'] });
  const [{ url, body }] = bodies;
  assert.equal(url, 'http://model:8420/v1/chat/completions');
  assert.equal(body.max_tokens, 1);
  assert.equal(body.temperature, 0);
  assert.equal(body.logprobs, true);
  assert.equal(body.top_logprobs, 20);
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(body.messages[0].content, 'CTX\n\nQ?\nA) yes\nB) no\nAnswer with one letter.');
});

test('the answer is read off the letters, whatever the tokenizer glued to them', () => {
  const { total, probabilities } = letterDistribution([
    { token: 'A', logprob: lp(0.6) }, { token: ' A', logprob: lp(0.2) }, { token: 'B)', logprob: lp(0.1) },
    { token: 'The', logprob: lp(0.1) }, { token: 'AB', logprob: lp(0.05) },
  ], 2);
  assert.ok(Math.abs(total - 0.9) < 1e-9, 'only A, " A" and "B)" count — "The" and "AB" are not letters');
  assert.ok(Math.abs(probabilities[0] - 0.8 / 0.9) < 1e-9);
});

test('it abstains instead of guessing when the offered letters carry too little of the probability', async () => {
  const { fetchImpl } = endpoint([{ token: 'The', logprob: lp(0.7) }, { token: 'A', logprob: lp(0.2) }, { token: 'B', logprob: lp(0.1) }]);
  const choose = openAiDecider({ endpoint: 'http://m', fetchImpl });
  const decision = await choose({ question: 'Q?', options: ['yes', 'no'] });
  assert.equal(decision.abstained, true);
  assert.equal(decision.answer, null);
  const { probability } = await probabilityYes(choose, { question: 'Q?' });
  assert.equal(probability, null, 'an abstention is never reported as a probability');
});

test('a choice among more than two options, and a record with digests — never the prompt', async () => {
  const { fetchImpl } = endpoint([{ token: 'C', logprob: lp(0.7) }, { token: 'A', logprob: lp(0.2) }, { token: 'B', logprob: lp(0.1) }]);
  const decision = await openAiDecider({ endpoint: 'http://m', fetchImpl })({ context: 'secret context', question: 'Which?', options: ['x', 'y', 'z'] });
  assert.equal(decision.answer, 2);
  assert.equal(decision.record.options, 3);
  assert.match(decision.record.promptDigest, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(decision.record).includes('secret context'), 'the record carries no bytes of what was asked');
});

test('a runtime that cannot give probabilities, or refuses, is DecisionUnavailable — not a guess', async () => {
  const noProbs = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'A' } }] }) });
  await assert.rejects(openAiDecider({ endpoint: 'http://m', fetchImpl: noProbs })({ question: 'Q?', options: ['yes', 'no'] }), DecisionUnavailable);
  const { fetchImpl } = endpoint([], { status: 400 });
  await assert.rejects(openAiDecider({ endpoint: 'http://m', fetchImpl })({ question: 'Q?', options: ['yes', 'no'] }), DecisionUnavailable);
  await assert.rejects(openAiDecider({ endpoint: 'http://m', fetchImpl })({ question: 'Q?', options: ['only one'] }), DecisionUnavailable);
  assert.throws(() => openAiDecider({ endpoint: '' }), DecisionUnavailable);
});

// --- first use: the Author's view of a file that does not fit -------------------------------------

// Three functions; the bug is in `ratio`, which shares no word with the report below.
const FILE = [
  'import math', '',
  'def area(radius):', '    return math.pi * radius ** 2', '',
  'def ratio(a, b):', '    return a * b', '',
  'def perimeter(radius):', '    return 2 * math.pi * radius', '',
].join('\n');
const REPORT = 'Dividing two numbers gives their product instead of the quotient.';
/** A decider that says «yes» only for the region holding `a * b`. */
const oracleChoose = async ({ context }) => {
  const yes = context.includes('a * b') ? 0.9 : 0.05;
  return { abstained: false, answer: yes > 0.5 ? 0 : 1, probabilities: [yes, 1 - yes], confidence: Math.max(yes, 1 - yes), mass: 1, record: {} };
};

test('regionsOf cuts at every definition, and keeps the module header as the first region', () => {
  assert.deepEqual(regionsOf(FILE).map((r) => r.start), [0, 2, 5, 8]);
});

test('decidedExcerpt keeps the function the decisions point at, verbatim, and names the gaps', async () => {
  const decided = await decidedExcerpt(FILE, REPORT, oracleChoose, { budgetChars: 30 });
  assert.ok(decided.view.includes('def ratio(a, b):\n    return a * b'), 'the chosen function, exactly');
  assert.ok(!decided.view.includes('math.pi * radius ** 2'), 'the unchosen ones are left out');
  assert.match(decided.view, /… lines \d+-\d+ of this file are not shown …/);
  assert.equal(decided.decisions, 4);
  assert.equal(decided.kept[0].fromLine, 6);
});

test('the Author shows a refused file through the decisions, and says so in the fixture', async () => {
  const shown = [];
  const author = new Author({
    model: 'test',
    decide: oracleChoose,
    generate: async ({ contents }) => {
      shown.push(contents);
      if (contents === FILE) throw new AuthoringRefused('CONTEXT_EXCEEDED', 'request (9000 tokens) exceeds the available context size (8192 tokens)', 'calc.py');
      return ['<<<<<<< SEARCH', '    return a * b', '=======', '    return a / b', '>>>>>>> REPLACE'].join('\n');
    },
  });
  const result = await author.author({ goal: 'fix ratio', step: 'fix it', files: [{ path: 'calc.py', contents: FILE }], background: REPORT });
  assert.equal(shown.length, 2, 'whole file refused, then one partial view');
  assert.ok(shown[1].includes('return a * b'), 'the partial view holds the buggy line');
  assert.ok(result.contents.get('calc.py').includes('return a / b'), 'the edit applies to the REAL file');
  assert.equal(result.fixtures[0].excerpt.selectedBy, 'decisions');
});

test('without decisions the Author and its fixture are exactly what they were', async () => {
  const author = new Author({
    model: 'test',
    generate: async ({ contents }) => {
      if (contents === FILE) throw new AuthoringRefused('CONTEXT_EXCEEDED', 'too big', 'calc.py');
      return ['<<<<<<< SEARCH', 'import math', '=======', 'import math  # touched', '>>>>>>> REPLACE'].join('\n');
    },
  });
  const result = await author.author({ goal: 'fix ratio', step: 'fix it', files: [{ path: 'calc.py', contents: FILE }], background: REPORT });
  assert.equal('excerpt' in (result.fixtures[0] ?? {}), false, 'no new field when no decider was injected');
});

test('a decider that cannot be reached falls back to the words, and the fixture says why', async () => {
  const author = new Author({
    model: 'test',
    decide: async () => { throw new DecisionUnavailable('down'); },
    generate: async ({ contents }) => {
      if (contents === FILE) throw new AuthoringRefused('CONTEXT_EXCEEDED', 'too big', 'calc.py');
      return ['<<<<<<< SEARCH', 'import math', '=======', 'import math  # touched', '>>>>>>> REPLACE'].join('\n');
    },
  });
  const result = await author.author({ goal: 'numbers product quotient', step: 'x', files: [{ path: 'calc.py', contents: FILE }], background: 'math radius' });
  assert.equal(result.fixtures[0].excerpt.selectedBy, 'words');
  assert.equal(result.fixtures[0].excerpt.decisionsUnavailable, 'down');
});

test('the prompt puts the context first so questions about one context share a prefix', () => {
  const a = decisionPrompt({ context: 'SAME', question: 'Q1?', options: ['yes', 'no'] });
  const b = decisionPrompt({ context: 'SAME', question: 'Q2?', options: ['yes', 'no'] });
  assert.ok(a.startsWith('SAME\n\n') && b.startsWith('SAME\n\n'));
});
