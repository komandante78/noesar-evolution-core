// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Author was writing from a title, not the report.
//
// `interpret()` keeps `intent.goal` to the request's first sentence on purpose — it is what
// four places in `app.js` show as a run's heading, and a multi-paragraph issue report does not
// belong in an `<h3>`. But that same short string was ALL `buildAuthoringPrompt` ever received
// as `goal`/`step`, so the Author never saw whatever came after the first period.
//
// Measured 11/09 on astropy-12907, a real SWE-bench instance whose report is a title plus three
// runnable code examples (expected output vs actual, for a plain compound model and a nested
// one) that together point at one specific line. On the title alone — "Modeling's
// `separability_matrix` does not compute separability correctly for nested CompoundModels" —
// the model renamed an unrelated function and left the real bug untouched. The file was right.
// The instruction was a fifth of itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthoringPrompt, Author } from '../src/author.mjs';

const GOAL = 'Widgets should not crash on empty input';
const FULL_REPORT = `${GOAL}\n\nReproduction:\n\`\`\`js\nrenderWidget([])\n\`\`\`\nExpected: an empty list. Actual: TypeError on items[0].`;

test('the request reaches the prompt when it carries more than its own first sentence', () => {
  const prompt = buildAuthoringPrompt({ goal: GOAL, step: 'fix it', path: 'x.js', contents: 'old\n', background: FULL_REPORT });
  assert.ok(prompt.includes('Full request, verbatim'), 'the section is present');
  assert.ok(prompt.includes('Expected: an empty list. Actual: TypeError'), 'the reproduction detail is in it');
});

test('nothing extra is said when there is nothing extra to say', () => {
  const bare = buildAuthoringPrompt({ goal: GOAL, step: 'fix it', path: 'x.js', contents: 'old\n' });
  assert.ok(!bare.includes('Full request, verbatim'), 'omitted background adds no section');
  const same = buildAuthoringPrompt({ goal: GOAL, step: 'fix it', path: 'x.js', contents: 'old\n', background: GOAL });
  assert.ok(!same.includes('Full request, verbatim'), 'background identical to goal adds no section');
});

test('background sits with the task description, not inside the untrusted fence', () => {
  const prompt = buildAuthoringPrompt({ goal: GOAL, step: 'fix it', path: 'x.js', contents: 'old\n', background: FULL_REPORT });
  const fileAt = prompt.indexOf('File:');
  const bgAt = prompt.indexOf('Full request, verbatim');
  const fenceAt = prompt.indexOf('<<<CURRENT_CONTENTS');
  assert.ok(fileAt < bgAt && bgAt < fenceAt);
});

test('end to end: Author.author() forwards background into the built prompt', async () => {
  let seenPrompt = null;
  const author = new Author({
    generate: async ({ prompt, contents }) => {
      seenPrompt = prompt;
      return `<<<<<<< SEARCH\n${String(contents).trimEnd()}\n=======\nfixed\n>>>>>>> REPLACE`;
    },
  });
  await author.author({
    goal: GOAL, step: 'fix it', background: FULL_REPORT,
    files: [{ path: 'x.js', contents: 'old\n' }],
  });
  assert.ok(seenPrompt.includes('Expected: an empty list. Actual: TypeError'), 'the model actually received the detail');
});
