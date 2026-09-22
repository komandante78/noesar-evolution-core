// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ATOM is told what was asked, not only interpret's summary of it. Measured live on 2026-09-22:
// asked for "one line saying this file was written by CodeN during the live test", ATOM wrote
// `Attribution: PROVA_LIVE_20260922` — its body carried the goal and never the request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Author, atomAuthoringGenerator } from '../src/author.mjs';

function recordingAtom() {
  const bodies = [];
  const generate = atomAuthoringGenerator({
    endpoint: 'http://atom.test', token: 't',
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, value: {
        contents: '# x\n', discardedPaths: [], regenerated: false, firstRejection: null, worldDigest: null,
      } }) };
    },
  });
  return { generate, bodies };
}

test('the verbatim request reaches ATOM through the Author, beside the goal', async () => {
  const { generate, bodies } = recordingAtom();
  const request = 'Create a new markdown file named A.md with one line saying this file was written by CodeN';
  await new Author({ generate, model: 'atom' }).author({
    goal: 'Create a markdown file containing a specific attribution line.', step: 's',
    files: [{ path: 'A.md', contents: '' }], background: request,
  });
  assert.ok(bodies[0].goal.startsWith('Create a markdown file containing a specific attribution line.'));
  assert.ok(bodies[0].goal.includes('this file was written by CodeN'), 'the words the goal dropped are there');
  assert.deepEqual(Object.keys(bodies[0]).sort(), ['attempts', 'contents', 'goal', 'path', 'profile', 'step'],
    'no new field: ATOM\'s wire contract is unchanged');
});

test('a request that says no more than the goal is not repeated', async () => {
  const { generate, bodies } = recordingAtom();
  await generate({ goal: 'fix it', step: 's', path: 'a.js', contents: 'x', background: ' fix it ' });
  await generate({ goal: 'fix it', step: 's', path: 'a.js', contents: 'x' });
  assert.equal(bodies[0].goal, 'fix it');
  assert.equal(bodies[1].goal, 'fix it');
});
