// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ATOM returns a file WHOLE inside a 4096-token answer and refuses one that dropped most of it;
// a refusal from a reachable ATOM stands (nothing asks the model beneath). So a file that cannot
// fit that answer must never be sent to it: it goes to the model below, which writes it as edits.
//
// Found reading `ATOM-EVOLUTION/crates/atom-provider/src/author_model.rs` on 2026-09-25, while a
// resolve run was logging `ATOM refused … MODEL_UNAVAILABLE … os error 11` on every file. That
// error is the OLD atomd's 30 s read timeout, and it is what currently hides this: the rebuilt
// atomd would not time out, and would refuse every large file instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Author, AuthoringUnavailable, atomAuthoringGenerator, declaredFallbackGenerator } from '../src/author.mjs';

const BIG = `// session\n${'x'.repeat(20_000)}\n`;       // 20 KB: cannot come back whole inside 4096 tokens
const SMALL = 'export const a = 1;\n';

const atomThatCounts = () => {
  const calls = [];
  return {
    calls,
    generate: atomAuthoringGenerator({
      endpoint: 'http://atom.test', token: 't',
      fetchImpl: async (url, init) => {
        calls.push(JSON.parse(init.body).path);
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: { contents: SMALL, discardedPaths: [] } }) };
      },
    }),
  };
};

test('a file above what ATOM can return whole is never sent to it, and the reason says why', async () => {
  const atom = atomThatCounts();
  await assert.rejects(() => atom.generate({ path: 'big.py', contents: BIG }), (error) => {
    assert.ok(error instanceof AuthoringUnavailable, 'unavailable, so the declared fallback can answer — not a refusal, which stands');
    assert.match(error.reason ?? error.message, /4096-token answer.*big\.py.*bytes.*edits/s);
    return true;
  });
  assert.deepEqual(atom.calls, [], 'ATOM was not called');
});

test('a file that fits is still sent to ATOM, exactly as before', async () => {
  const atom = atomThatCounts();
  const answer = await atom.generate({ path: 'small.py', contents: SMALL });
  assert.equal(answer.checkedBy, 'atom');
  assert.deepEqual(atom.calls, ['small.py']);
});

test('the bound follows maxTokens rather than being a second number', async () => {
  const calls = [];
  const generous = atomAuthoringGenerator({ endpoint: 'http://atom.test', maxTokens: 16_384,
    fetchImpl: async () => { calls.push(1); return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: { contents: SMALL } }) }; } });
  await generate20k(generous);
  assert.equal(calls.length, 1, 'a larger answer budget admits the same 20 KB file');
});
const generate20k = (generate) => generate({ path: 'big.py', contents: BIG });

test('through the declared chain: the model writes the big file as edits, and the swap is recorded, not silent', async () => {
  const atom = atomThatCounts();
  const degradations = [];
  const generate = declaredFallbackGenerator({
    primary: atom.generate,
    fallback: async ({ contents }) => `<<<<<<< SEARCH\n${contents.split('\n')[0]}\n=======\n// edited by the model\n>>>>>>> REPLACE`,
    onDegrade: (record) => degradations.push(record),
  });
  const result = await new Author({ generate, model: 'chain' }).author({ goal: 'g', step: 's', files: [{ path: 'big.py', contents: BIG }] });

  assert.equal(result.summary.authored, 1, 'the file was written — ATOM refusing it would have ended it');
  assert.ok(result.contents.get('big.py').startsWith('// edited by the model'));
  assert.deepEqual(atom.calls, [], 'ATOM never saw the 20 KB');
  assert.equal(degradations.length, 1, 'and the swap is recorded');
  assert.match(degradations[0].reason, /does not fit/);
});
