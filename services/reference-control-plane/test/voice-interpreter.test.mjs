// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The model as a CHOOSER, s336. Owner: «altre lingue, qui dovrebbe aiutare il modello … deve
// interagire con il modello oppure con ATOM, verifica tu la correttezza e dove deve andare».
//
// The verification the Owner asked for was done by driving the deployed `atomd`, and it decided
// the design rather than confirming it:
//
//     interpret("apri la memoria")           → goal: "Open the memory."                     ✔
//     interpret("sblindarifico quantistico") → goal: "Create a quantum circuit that
//                                                     implements the Sblindarifico gate."   ✖
//
// So ATOM is not where voice goes: it answers what WORK to do rather than WHERE to go, and it
// never declines. What is defended below is the shape that makes a model safe for something that
// then acts — a finite list decided before the question, and an answer accepted only if it names
// a member of it. Every test here exists to make invention harmless rather than to hope for its
// absence, because s320 measured that hope to be misplaced and s336 measured it again.
//
// Driven over real sockets rather than a stubbed fetch, for the reason `voice-engine.test.mjs`
// states: what breaks on this path is wire work, and a stub agrees with whatever the caller
// believes it is sending.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  VoiceChoice, NO_MATCH, choicePrompt, readChoice, chooseDestination,
} from '../src/voice-interpreter.mjs';

const ENTRIES = [
  { name: 'memory', summary: 'What the product remembers between sessions' },
  { name: 'documents', summary: 'Files ingested for the model to read' },
  { name: 'coden/bench/diff', summary: 'Diff' },
  { name: 'plan', summary: 'Start a plan from a goal' },
];

async function withModel(reply, run, { status = 200 } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: typeof reply === 'function' ? reply(seen.length) : reply } }] }));
    });
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  try { return await run(endpoint, seen); } finally { await new Promise((done) => server.close(done)); }
}

describe('the question is a choice, not an interpretation', () => {
  test('the list travels in the prompt, built from the entries rather than described', () => {
    const [system] = choicePrompt('apri la memoria', ENTRIES);
    for (const entry of ENTRIES) assert.ok(system.content.includes(entry.name), `${entry.name} is not offered`);
    assert.ok(system.content.includes(NO_MATCH), 'the model is never told how to decline');
  });

  test('the utterance is the user turn and nothing else', () => {
    const prompt = choicePrompt('  apri la memoria  ', ENTRIES);
    assert.equal(prompt.length, 2);
    assert.equal(prompt[1].role, 'user');
    assert.equal(prompt[1].content, '  apri la memoria  ');
  });

  test('no example is given — a demonstration teaches its own content too', () => {
    // Not style. An example mapping "open the memory" to `memory` makes `memory` likelier for
    // everything, and nobody would ever see it: the answer is always a plausible entry.
    const [system] = choicePrompt('anything', ENTRIES);
    assert.ok(!/example|for instance|e\.g\./i.test(system.content));
  });
});

describe('an answer is only accepted if it names something that exists', () => {
  test('an exact name is taken', () => {
    assert.deepEqual(readChoice('memory', ENTRIES), { kind: VoiceChoice.CHOSEN, name: 'memory' });
  });

  test('the model may be untidy — quotes, bullets, backticks, a second line', () => {
    for (const reply of ['`memory`', '- memory', '"memory"', 'memory\nbecause you asked for it', '  memory.  ']) {
      assert.equal(readChoice(reply, ENTRIES).name, 'memory', JSON.stringify(reply));
    }
  });

  test('an address with slashes survives the tidying', () => {
    // The stripping must not eat a name's own punctuation. `coden/bench/diff` is a real entry.
    assert.equal(readChoice('coden/bench/diff', ENTRIES).name, 'coden/bench/diff');
  });

  test('NONE is a decline, and it is not an error', () => {
    const result = readChoice(NO_MATCH, ENTRIES);
    assert.equal(result.kind, VoiceChoice.NONE);
    assert.match(result.reason, /nothing that fits/);
  });

  test('AN INVENTED NAME IS REFUSED — this is the whole guarantee', () => {
    // The `interpret` failure, arriving through this door instead: a confident, plausible,
    // entirely fabricated answer. It must be indistinguishable from NONE in what it CAUSES,
    // and distinguishable in what it SAYS, so a model that does this constantly is visible.
    const result = readChoice('quantum-circuit-editor', ENTRIES);
    assert.equal(result.kind, VoiceChoice.NONE);
    assert.match(result.reason, /does not have: quantum-circuit-editor/);
    assert.equal(result.name, undefined, 'a refused answer must not carry a name at all');
  });

  test('prose is refused, however reasonable it sounds', () => {
    const result = readChoice('I think the user wants to open the memory page.', ENTRIES);
    assert.equal(result.kind, VoiceChoice.NONE);
  });

  test('a name that is only a SUBSTRING of a real one is refused', () => {
    // `mem` is not `memory`. Accepting near misses here would put the fuzziness back that
    // `voice-intent.js` spends its whole ranking avoiding — and would do it out of sight.
    assert.equal(readChoice('mem', ENTRIES).kind, VoiceChoice.NONE);
    assert.equal(readChoice('memory page', ENTRIES).kind, VoiceChoice.NONE);
  });

  test('case is forgiven, because a model capitalising is not a model inventing', () => {
    assert.equal(readChoice('MEMORY', ENTRIES).name, 'memory');
  });
});

describe('asking a real model over a real socket', () => {
  test('a choice comes back as the entry it named', async () => {
    await withModel('documents', async (endpoint) => {
      const decision = await chooseDestination({ utterance: 'mostrami i file caricati', entries: ENTRIES, endpoint, fetchImpl: fetch });
      assert.deepEqual(decision, { kind: VoiceChoice.CHOSEN, name: 'documents' });
    });
  });

  test('the request is deterministic and short — a lookup, not a conversation', async () => {
    await withModel('memory', async (endpoint, seen) => {
      await chooseDestination({ utterance: 'memoria', entries: ENTRIES, endpoint, model: 'phi-4', fetchImpl: fetch });
      // Sampling would let the same sentence reach two different places on two days, which is
      // the one thing a navigation gesture may never do.
      assert.equal(seen[0].temperature, 0);
      assert.equal(seen[0].stream, false);
      assert.ok(seen[0].max_tokens <= 32, `max_tokens was ${seen[0].max_tokens}`);
      assert.equal(seen[0].model, 'phi-4');
    });
  });

  test('a model that answers off-list changes nothing', async () => {
    await withModel('the-memory-thing', async (endpoint) => {
      const decision = await chooseDestination({ utterance: 'whatever', entries: ENTRIES, endpoint, fetchImpl: fetch });
      assert.equal(decision.kind, VoiceChoice.NONE);
    });
  });

  test('an unreachable or refusing model is reported as unavailable, not as a decline', async () => {
    // The distinction matters: NONE means "understood, nothing fits" and the caller falls
    // through to dictation happily. UNAVAILABLE means the step did not happen.
    await withModel('memory', async (endpoint) => {
      const decision = await chooseDestination({ utterance: 'x', entries: ENTRIES, endpoint, fetchImpl: fetch });
      assert.equal(decision.kind, VoiceChoice.UNAVAILABLE);
      assert.match(decision.reason, /answered 503/);
    }, { status: 503 });

    const dead = await chooseDestination({
      utterance: 'x', entries: ENTRIES, endpoint: 'http://127.0.0.1:1', fetchImpl: fetch,
    });
    assert.equal(dead.kind, VoiceChoice.UNAVAILABLE);
  });

  test('nothing is asked when there is no model, and it says which', async () => {
    const decision = await chooseDestination({ utterance: 'apri la memoria', entries: ENTRIES, endpoint: null });
    assert.equal(decision.kind, VoiceChoice.NOT_CONFIGURED);
    assert.match(decision.reason, /no model is configured/);
  });

  test('an empty utterance never reaches the model at all', async () => {
    await withModel('memory', async (endpoint, seen) => {
      const decision = await chooseDestination({ utterance: '   ', entries: ENTRIES, endpoint, fetchImpl: fetch });
      assert.equal(decision.kind, VoiceChoice.NONE);
      assert.deepEqual(seen, [], 'the model was asked about nothing');
    });
  });

  test('an empty candidate list never reaches the model either', async () => {
    await withModel('memory', async (endpoint, seen) => {
      const decision = await chooseDestination({ utterance: 'anything', entries: [], endpoint, fetchImpl: fetch });
      assert.equal(decision.kind, VoiceChoice.NONE);
      assert.deepEqual(seen, [], 'a model cannot choose from nothing, so it must not be asked');
    });
  });
});
