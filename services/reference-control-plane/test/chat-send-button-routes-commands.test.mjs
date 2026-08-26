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

test('picking a command from the menu (click) runs it when it takes no required argument', () => {
  assert.match(
    appJs,
    /button\.addEventListener\('click',\(\)=>runOrCompleteCommand\(button\.dataset\.command\)\)/,
    'the menu row click handler must call runOrCompleteCommand, not completeCommand — ' +
    'Owner-reported: picking a row only ever filled the box, a click was never itself the action',
  );
});

test('Enter on the highlighted row also runs it, through the same function as a click', () => {
  assert.match(
    appJs,
    /if\(event\.key==='Enter'&&!event\.shiftKey&&!menu\.hits\.some\(\(c\)=>c\.name===menu\.parsed\.word\)\)\{\n\s*event\.preventDefault\(\);return runOrCompleteCommand\(menu\.hits\[commandMenuIndex\]\.name\);/,
  );
});

test('runOrCompleteCommand() only completes (never runs) a command with a required argument', () => {
  const body = appJs.match(/function runOrCompleteCommand\(name\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(
    body,
    /if\(command\.argument\.startsWith\('<'\)\)return completeCommand\(name\);/,
    "a command like /plan <goal> has nowhere to put the argument but the composer, so it must " +
    'still only complete — running it with an empty argument would be a worse regression',
  );
  assert.match(body, /submitChatPrompt\(/, 'a command with no required argument must actually run');
});
