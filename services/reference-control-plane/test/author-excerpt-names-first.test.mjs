// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A file too big for the window is shown around the RARE names the request carries.
//
// Measured 2026-09-26 on SWE-bench Verified (grounding-t0-codenames, temperature 0): the file the
// real fix touches was in the plan for 9 of 14 instances, and for 4 of those 9 the model never saw it.
// The whole file did not fit the window (CONTEXT_EXCEEDED), and the excerpt that exists for exactly
// that case came back `null` on all four: it searched the first sentence of the request, one common
// word in it (`column`, `queryset`, `variable`, `latex`) covered most of the file, and the rule
// «a view nearly the size of the file is no view» threw the whole excerpt away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Author, AuthoringRefused, excerptAround, excerptBudget } from '../src/author.mjs';

// 400 lines; `column` on 300 of them, one rare identifier far from the start.
const FILE = (() => {
  const lines = [];
  for (let i = 1; i <= 400; i += 1) lines.push(i % 4 === 0 ? `x_${i} = ${i}` : `column_${i} = column(${i})`);
  lines[319] = 'class NdarrayMixin(np.ndarray):';
  lines[320] = '    info = NdarrayMixinInfo()';
  // A second specific name, commoner than the first (three places, far from it).
  for (const at of [10, 50, 90]) lines[at] = 'def helper_func(): pass';
  // A plain word that happens to occur once: rarer than the name, and not what the request is about.
  lines[150] = '# we consider this later';
  return lines.join('\n');
})();

const onlyRealLines = (view) => {
  const real = new Set(FILE.split('\n'));
  for (const line of view.split('\n')) {
    if (line.startsWith('… lines ')) continue;
    assert.ok(real.has(line), `the view introduced a line the file does not have: ${JSON.stringify(line)}`);
  }
};

test('a word that is everywhere no longer throws away the rare one', () => {
  const view = excerptAround(FILE, 'Consider removing auto-transform of structured column into NdarrayMixin');
  assert.ok(view, 'the rare name alone is enough for a view');
  assert.ok(view.includes('class NdarrayMixin(np.ndarray):'));
  assert.ok(view.split('\n').length < FILE.split('\n').length / 2, 'and the view is really smaller');
  onlyRealLines(view);
});

test('under a budget the rarest name wins, and the budget is kept', () => {
  // `ndarraymixin` is on 2 lines, `helper_func` on 3: with room for about one neighbourhood, the rarer one is shown.
  const budget = 1700;
  const view = excerptAround(FILE, 'helper_func NdarrayMixin', { budgetChars: budget });
  assert.ok(view.includes('class NdarrayMixin(np.ndarray):'), 'the rarest name is shown');
  assert.ok(!view.includes('def helper_func(): pass'), 'the commoner one did not fit and was left out');
  const kept = view.split('\n').filter((line) => !line.startsWith('… lines '));
  assert.ok(kept.join('\n').length <= budget, `kept ${kept.join('\n').length} chars for a budget of ${budget}`);
  onlyRealLines(view);
});

test('a name written as code goes before a plain word, even a rarer one', () => {
  // `consider` is on 1 line, `NdarrayMixin` on 2: rarity alone would show the wrong place.
  const view = excerptAround(FILE, 'Consider NdarrayMixin', { budgetChars: 1700 });
  assert.ok(view.includes('class NdarrayMixin(np.ndarray):'), 'the name of the bug is shown');
  assert.ok(!view.includes('# we consider this later'), 'the rare plain word did not take its place');
});

test('a request in plain words still gets an excerpt', () => {
  // No code name at all, as in «correggi il calcolo»: the plain words are the whole search, as before.
  const view = excerptAround(FILE, 'please consider it');
  assert.ok(view && view.includes('# we consider this later'));
});

test('the budget comes from the numbers the runtime put in its refusal', () => {
  const reason = 'request (60012 tokens) exceeds the available context size (16384 tokens)';
  assert.equal(excerptBudget(reason, 'x'.repeat(1000)), Math.floor((1000 * 8192) / 60012));
  // No numbers, no invented window: the caller keeps the ceiling it already had.
  assert.equal(excerptBudget('exceeds the available context size', 'x'.repeat(1000)), null);
  assert.equal(excerptBudget('', 'x'), null);
});

test('through Author: the rare name in the full request reaches the excerpt, and the edit lands on the real file', async () => {
  const prompts = [];
  const generate = async ({ prompt }) => {
    prompts.push(prompt);
    if (!prompt.includes('EXCERPT')) {
      throw new AuthoringRefused('CONTEXT_EXCEEDED', 'request (9000 tokens) exceeds the available context size (4096 tokens)', 'table.py');
    }
    return ['<<<<<<< SEARCH', '    info = NdarrayMixinInfo()', '=======', '    info = NdarrayMixinInfo()  # repaired', '>>>>>>> REPLACE'].join('\n');
  };
  const result = await new Author({ generate, model: 'test' }).author({
    // The first sentence says only `column`; the identifier is further down, as in the real report.
    goal: 'Consider removing auto-transform of structured column', step: 'change the column handling',
    background: 'Consider removing auto-transform of structured column.\n\nIt becomes an NdarrayMixin today.',
    files: [{ path: 'table.py', contents: FILE }],
  });
  assert.equal(prompts.length, 2, 'the whole file, then one excerpt');
  assert.ok(prompts[1].includes('class NdarrayMixin(np.ndarray):'), 'the excerpt is around the rare name');
  const after = result.contents.get('table.py');
  assert.equal(after.trimEnd(), FILE.replace('    info = NdarrayMixinInfo()', '    info = NdarrayMixinInfo()  # repaired').trimEnd());
});
