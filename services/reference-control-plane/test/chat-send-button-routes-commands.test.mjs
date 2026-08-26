// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner-reported (2026-08-26): clicking a command straight out of the chat `/` menu — fill,
// then click Send instead of pressing Enter — sent the line to the model as ordinary prose
// instead of running it. Root cause: the composer has two ways to submit, and only the Enter
// keydown handler routed a `/` line through submitChatPrompt(); `#sendMessage`'s click handler
// called sendChat() unconditionally. Structural check, in this project's established style
// (`coden-shell-parity.test.mjs`) rather than a DOM/jsdom test — this codebase has none, and
// app.js exposes no module boundary a jsdom test could import through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const appJs = readFileSync(join(ROOT, 'apps/webui-static/app.js'), 'utf8');

test('the composer has exactly one function that decides whether a submit is a command', () => {
  const defs = appJs.match(/function submitComposer\(\)\{/g) ?? [];
  assert.equal(defs.length, 1, 'submitComposer() must be defined exactly once');
});

test('the Send button routes through submitComposer(), not sendChat() directly', () => {
  assert.match(
    appJs,
    /\$\('#sendMessage'\)\.addEventListener\('click',\(\)=>submitComposer\(\)\);/,
    "#sendMessage's click handler must call submitComposer(), the same gate Enter uses — " +
    'calling sendChat() directly is the regression this test guards against',
  );
});

test('Enter also routes through submitComposer(), the same gate as the button', () => {
  assert.match(
    appJs,
    /if\(event\.key==='Enter'&&!event\.shiftKey\)\{event\.preventDefault\(\);return submitComposer\(\);\}/,
  );
});

test('submitComposer() itself still tells a `/` line from prose', () => {
  const body = appJs.match(/function submitComposer\(\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(body, /typed\.startsWith\('\/'\)/, 'must gate on the leading slash');
  assert.match(body, /submitChatPrompt\(typed\)/, 'a `/` line must reach submitChatPrompt, the command path');
  assert.match(body, /else sendChat\(\)/, 'plain text must still reach sendChat, the prose path');
});
