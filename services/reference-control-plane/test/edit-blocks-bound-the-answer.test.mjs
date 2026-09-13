// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The answer is bounded by the size of the CHANGE, not the size of the file.
//
// Measured on this installation, 11/09/2026, against SWE-bench Verified with a live model:
// ten instances, zero clean. Four were refused because the prompt carrying the whole file was
// over the window — the server said so itself, `request (20012 tokens) exceeds the available
// context size (16384 tokens)` — and the rest were asked for something no model can do. The
// file `astropy/modeling/tests/test_core.py` is 13 895 tokens by the model's own tokeniser and
// the answer budget is 4 096, so "return the COMPLETE new contents" could only ever come back
// truncated: a file with two thirds of it missing, offered as a repair.
//
// The instruction was impossible, not the model insufficient. These tests hold the contract
// that replaced it, and the last one is the reason the others exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Author, applyEditBlocks, buildAuthoringPrompt, replayAuthoringCall } from '../src/author.mjs';

const digest = (text) => createHash('sha256').update(String(text)).digest('hex');

const ORIGINAL = [
  'def _cstack(left, right):',
  '    noutp = _compute_n_outputs(left, right)',
  '    cright = _coord_matrix(right, "right", noutp)',
  '    return np.hstack([cleft, cright])',
  '',
  'def unrelated(right):',
  '    cright = _coord_matrix(right, "right", noutp)',
  '    return cright',
  '',
].join('\n');

const block = (search, replace) => ['<<<<<<< SEARCH', search, '=======', replace, '>>>>>>> REPLACE'].join('\n');

const refusal = (fn) => {
  try { fn(); return null; } catch (error) { return error.code; }
};

test('an edit changes what it names and cannot reach what it does not', () => {
  const answer = `Here is the fix.\n\n${block(
    '    cright = _coord_matrix(right, "right", noutp)\n    return np.hstack([cleft, cright])',
    '    cright = np.zeros((noutp, right.shape[1]))\n    return np.hstack([cleft, cright])',
  )}`;
  const { body, edits } = applyEditBlocks(answer, ORIGINAL, 'separable.py');

  assert.equal(edits, 1);
  assert.match(body, /cright = np\.zeros\(\(noutp, right\.shape\[1\]\)\)/);
  // The property that matters, and it is structural: the model never named the rest of the
  // file, so no answer it could have given — truncated, confused or hostile — reaches it.
  assert.match(body, /def unrelated\(right\):/);
  assert.ok(body.endsWith('    return cright\n'), 'the far end of the file is untouched');
});

test('an anchor that is not unique is refused, never guessed at', () => {
  // `    cright = _coord_matrix(...)` appears in both functions. Applying it to the first would
  // be a coin toss the caller never asked for, and applying it to both would be worse.
  const twice = block('    cright = _coord_matrix(right, "right", noutp)', '    cright = None');
  assert.equal(refusal(() => applyEditBlocks(twice, ORIGINAL, 'separable.py')), 'EDIT_NOT_UNIQUE');
});

// Measured 2026-09-13, astropy-12907 (SWE-bench, ctxfix-resolve-01): a real answer put a
// second `=======` inside its own replacement text -- not a second block, one block whose
// replacement happened to contain the separator again -- and the old parser had a rule for
// EDIT_OPEN appearing there (break, fall through to EDIT_UNTERMINATED) but none for
// EDIT_SEPARATOR, so it silently became four bytes of the replacement. Spliced into
// astropy/modeling/utils.py ahead of an unrelated function, it broke that module's import
// and every one of 15 unrelated tests failed to even collect. Confirmed in isolation:
// dropping that file and keeping only the other, well-formed edit made the same run 15/15.
test('a replacement that itself contains a second separator is refused, not spliced in', () => {
  const malformed = ['<<<<<<< SEARCH', '    return cright', '=======', '    return None', '=======', '    return cright', '>>>>>>> REPLACE'].join('\n');
  assert.equal(refusal(() => applyEditBlocks(malformed, ORIGINAL, 'a.py')), 'EDIT_MARKER_LEAKED');
});

test('an anchor that is absent is refused, and an empty one too', () => {
  assert.equal(refusal(() => applyEditBlocks(block('no such line', 'x'), ORIGINAL, 'a.py')), 'EDIT_NOT_FOUND');
  assert.equal(refusal(() => applyEditBlocks(block('', 'x'), ORIGINAL, 'a.py')), 'EDIT_EMPTY_ANCHOR');
});

test('a whole file sent back for a file that already exists is refused', () => {
  // The shape this contract exists to stop: it is either a rewrite nobody asked for or, far
  // more often, a truncation. Named and refused rather than written.
  assert.equal(refusal(() => applyEditBlocks('```\nwhole new file\n```', ORIGINAL, 'a.py')), 'NO_EDITS');
});

test('an edit that empties the file is a deletion asked for as a write', () => {
  assert.equal(refusal(() => applyEditBlocks(block(ORIGINAL.replace(/\n$/, ''), ''), ORIGINAL, 'a.py')), 'EMPTY');
});

test('new code is code: $& and $1 are not substitution syntax', () => {
  // `String.replace` reads those in a replacement string, and repository text is full of them.
  const answer = block('    return cright', '    return f"$& $1 {cright}"');
  assert.match(applyEditBlocks(answer, ORIGINAL, 'a.py').body, /return f"\$& \$1 \{cright\}"/);
});

test('rule 1 holds without a fence: a path outside a block is discarded, not read', () => {
  const answer = `// file: ../../etc/passwd\n${block('    return cright', '    return None')}`;
  const { body, discarded } = applyEditBlocks(answer, ORIGINAL, 'a.py');
  assert.deepEqual(discarded, ['../../etc/passwd']);
  assert.ok(!body.includes('etc/passwd'), 'the claim must not survive into the file');
});

test('the prompt asks for what the reader accepts, on both sides of the fork', () => {
  const editing = buildAuthoringPrompt({ goal: 'g', step: 's', path: 'a.py', contents: ORIGINAL });
  assert.ok(editing.includes('<<<<<<< SEARCH'), 'an existing file is edited');
  assert.ok(!editing.includes('COMPLETE new contents'), 'and is not asked for in full');

  // A file with nothing in it has nothing to anchor to, so it is still written whole.
  const writing = buildAuthoringPrompt({ goal: 'g', step: 's', path: 'a.py', contents: '' });
  assert.ok(writing.includes('COMPLETE contents'));
  assert.ok(!writing.includes('<<<<<<< SEARCH'));
});

test('an edited call replays from its record alone — CE-006 survives the new shape', async () => {
  // An edit means nothing without the bytes it edits, and the replay store never held those.
  // It does not have to: the prompt is recorded, is required, and is verified against its
  // digest — and the contents are inside it, because the model had to be shown them.
  const author = new Author({
    model: 'test',
    generate: async ({ contents }) => block(
      contents.split('\n')[0],
      'def _cstack(left, right):  # repaired',
    ),
  });
  const result = await author.author({
    goal: 'g', step: 's', files: [{ path: 'separable.py', contents: ORIGINAL }],
  });
  assert.equal(result.summary.authored, 1);

  const fixture = result.fixtures[0];
  const prompt = buildAuthoringPrompt({ goal: 'g', step: 's', path: 'separable.py', contents: ORIGINAL });
  assert.equal(digest(prompt), fixture.promptDigest, 'the prompt this test rebuilds is the one recorded');

  const replayed = replayAuthoringCall({
    fixture,
    prompt,
    answer: block(ORIGINAL.split('\n')[0], 'def _cstack(left, right):  # repaired'),
  });
  assert.equal(replayed.faithful, true, JSON.stringify(replayed.diffs));
  assert.equal(replayed.decision.contentsDigest, fixture.contentsDigest);
});

test('the ceiling this contract was built for: a file far larger than the answer', () => {
  // The measured case, in miniature. A file of 4 000 lines cannot be restated inside a bounded
  // answer; the change to it is four lines. Under the old contract this file was unrepairable
  // by construction — that is the whole finding, and this is what it looks like fixed.
  const huge = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n');
  const answer = block('line 2500', 'line 2500 — repaired');

  const { body } = applyEditBlocks(answer, huge, 'huge.py');

  // The ratio is the point, not either number: the answer stays the size of the change while
  // the file it repairs is two orders of magnitude bigger.
  assert.ok(body.length > answer.length * 100, `answer ${answer.length} vs file ${body.length}`);
  assert.match(body, /^line 2500 — repaired$/m);
  assert.match(body, /^line 0$/m);
  assert.match(body, /^line 3999$/m);
});
