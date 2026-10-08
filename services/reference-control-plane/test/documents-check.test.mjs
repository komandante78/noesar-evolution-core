// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `documents.check`: every sentence of a document judged against its sources (`document-check.mjs`).
//
// WHY. `verification.mjs` recomputes claims about files and declares the rest unrecomputed. Whether
// a sentence is supported by a source is a judgment, so it is made as one and SAID to be one — and a
// sentence no source supports is flagged instead of being delivered like the supported ones.
//
// THE ORACLE: against the tree before this file there is no `document-check.mjs` and no
// `documents.check` method; the dispatch answers UNKNOWN_METHOD.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { sentencesOf, passageFor, checkDocument, SUPPORT_QUESTION } from '../src/document-check.mjs';
import { createSessionDispatch, ProtocolError } from '../src/session-protocol.mjs';
import { DecisionUnavailable } from '../src/decide.mjs';

const SOURCE = 'The card has sixteen ports.\n\nIt was released in 2019 and draws 25 watts.\n\nUnrelated text about gardening and tomatoes.';
const DOC = 'The card was released in 2019 by the vendor.\nIt costs exactly nine hundred dollars in every shop.';
/** «yes» when the passage shown contains the year the sentence names. */
const judge = async ({ context }) => {
  const statement = context.split('Statement:\n')[1] ?? '';
  const shown = context.split('Statement:\n')[0];
  const yes = /2019/.test(statement) && /2019/.test(shown) ? 0.9 : 0.1;
  return { abstained: false, answer: yes > 0.5 ? 0 : 1, probabilities: [yes, 1 - yes], confidence: 0.9, mass: 1, record: {} };
};

test('sentences are cut at punctuation and line breaks, and fragments too short to claim anything are left out', () => {
  assert.deepEqual(sentencesOf('# Title\nShort.\nThe first real sentence is here. The second one follows it! ok'), [
    'The first real sentence is here.', 'The second one follows it! ok',
  ]);
});

test('the passage shown is the part of the source that shares the most words with the sentence', () => {
  const passage = passageFor('released in 2019', SOURCE, { budget: 60 });
  assert.match(passage, /released in 2019/);
  assert.doesNotMatch(passage, /tomatoes/);
});

test('every sentence judged per source; the unsupported one is flagged; the answer says it was judged', async () => {
  const asked = [];
  const report = await checkDocument({ text: DOC, sources: [{ path: 'spec.md', contents: SOURCE }], decide: async (args) => { asked.push(args); return judge(args); } });
  assert.equal(report.kind, 'judged');
  assert.equal(report.sentencesChecked, 2);
  assert.equal(report.sentences[0].verdict, 'supported');
  assert.equal(report.sentences[1].verdict, 'not_supported');
  assert.equal(report.notSupported, 1);
  assert.match(report.declaration, /judged by a model, not recomputed/);
  assert.equal(asked[0].question, SUPPORT_QUESTION);
});

test('a decider that cannot answer stops the check, keeps what was judged, and says why', async () => {
  const report = await checkDocument({ text: DOC, sources: [{ path: 's', contents: SOURCE }], decide: async () => { throw new DecisionUnavailable('down'); } });
  assert.equal(report.sentencesChecked, 0);
  assert.equal(report.decisionsUnavailable, 'down');
});

// --- the method, through the same dispatch both shells use ----------------------------------------

function resolveWorkspaceSubpath(root, subpath) {
  const base = resolve(root);
  if (!subpath) return base;
  const candidate = resolve(base, String(subpath));
  return candidate === base || candidate.startsWith(`${base}${sep}`) ? candidate : null;
}
const allowAll = () => true;

test('documents.check reads the document and its sources from the workspace, and refuses paths outside it', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-doccheck-'));
  try {
    writeFileSync(join(ws, 'doc.md'), DOC);
    writeFileSync(join(ws, 'spec.md'), SOURCE);
    const dispatch = createSessionDispatch({ workspaceRoot: ws, resolveWorkspaceSubpath, decide: judge });
    const report = await dispatch('documents.check', { path: 'doc.md', sources: ['spec.md'] }, 'owner', allowAll);
    assert.equal(report.path, 'doc.md');
    assert.equal(report.supported, 1);
    await assert.rejects(dispatch('documents.check', { path: '../../etc/passwd', sources: ['spec.md'] }, 'owner', allowAll),
      (error) => error instanceof ProtocolError && error.kind === 'INVALID_PATH');
    await assert.rejects(dispatch('documents.check', { path: 'doc.md', sources: [] }, 'owner', allowAll),
      (error) => error instanceof ProtocolError && error.kind === 'INVALID_REQUEST');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('documents.check does not read the engine\'s own state as a document or as a source', async () => {
  // It reads WHOLE files at paths a model can name and returns their sentences. The credential key, the authentication state
  // and the audit chain live inside the workspace, and the scanner hides them (`repo-map.mjs`); this method asked nothing.
  const ws = mkdtempSync(join(tmpdir(), 'noesar-doccheck-state-'));
  try {
    for (const dir of ['config', 'state', 'audit']) mkdirSync(join(ws, dir), { recursive: true });
    writeFileSync(join(ws, 'config/notes.md'), 'The credential key is CANARY_KEY and it never changes.');
    writeFileSync(join(ws, 'state/auth.json'), 'The password hash is CANARY_AUTH and it is long enough.');
    writeFileSync(join(ws, 'state/auth.json.bak_old'), 'A copy of the password hash is CANARY_COPY here.');
    writeFileSync(join(ws, 'audit/events.jsonl'), 'The audit chain says CANARY_AUDIT happened today.');
    writeFileSync(join(ws, 'state/notes.md'), DOC);          // an operator's own file in a visible folder
    writeFileSync(join(ws, 'spec.md'), SOURCE);
    const dispatch = createSessionDispatch({ workspaceRoot: ws, resolveWorkspaceSubpath, decide: judge });
    for (const path of ['config/notes.md', 'state/auth.json', 'state/auth.json.bak_old', 'audit/events.jsonl']) {
      await assert.rejects(dispatch('documents.check', { path, sources: ['spec.md'] }, 'owner', allowAll),
        (error) => error instanceof ProtocolError && error.kind === 'INVALID_PATH', `${path} as the document`);
      await assert.rejects(dispatch('documents.check', { path: 'spec.md', sources: [path] }, 'owner', allowAll),
        (error) => error instanceof ProtocolError && error.kind === 'INVALID_PATH', `${path} as a source`);
    }
    const ordinary = await dispatch('documents.check', { path: 'state/notes.md', sources: ['spec.md'] }, 'owner', allowAll);
    assert.equal(ordinary.supported, 1, 'an operator\'s own file in a folder called state/ is still a document');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('without decisions the method says which switch turns it on, instead of guessing', async () => {
  const dispatch = createSessionDispatch({ workspaceRoot: tmpdir(), resolveWorkspaceSubpath });
  await assert.rejects(dispatch('documents.check', { path: 'x', sources: ['y'] }, 'owner', allowAll),
    (error) => error instanceof ProtocolError && error.kind === 'UNAVAILABLE' && /NOESAR_DECIDE=on/.test(error.message));
});
