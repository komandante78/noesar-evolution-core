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

// --- the same two rules, in all THREE shells ------------------------------------------------
//
// Both defects above were reported against chat and fixed only there, and CodeN and the TUI
// carried them untouched for a full deploy cycle — the Owner found them again at the CodeN
// prompt. That is the divergence `coden-shell-parity.test.mjs` exists to refuse, so the rules
// are pinned per shell here rather than trusting three separate readings to agree.

const codenViewModel = readFileSync(join(ROOT, 'apps/webui-static/coden-view-model.js'), 'utf8');
const tuiFullscreen = readFileSync(join(ROOT, 'tools/tui-fullscreen.mjs'), 'utf8');

test('CodeN: picking a row runs it, and Enter resolves the highlighted row', () => {
  assert.match(
    appJs,
    /button\.addEventListener\('click',\(\)=>runOrCompleteCodenCommand\(button\.dataset\.codenCommand\)\)/,
    'a click on a CodeN menu row must run it, not merely fill the prompt',
  );
  assert.match(
    appJs,
    /if\(event\.key==='Enter'&&!event\.shiftKey&&!hits\.some\(\(entry\)=>entry\.name===parsed\.word\)\)/,
    'Enter with the CodeN menu open must resolve the highlighted row, not the raw prefix',
  );
  const body = appJs.match(/function runOrCompleteCodenCommand\(name\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(body, /startsWith\('<'\)\)return completeCodenCommand\(name\)/,
    'a CodeN command needing an argument must still only complete');
  assert.match(body, /submitCodenPrompt\(\)/, 'everything else must actually run');
});

test('TUI: Enter resolves the highlighted row too', () => {
  assert.match(
    tuiFullscreen,
    /if \(name === 'return'\) \{\n\s*const parsed = parseCommandPrompt\(view\.prompt\);/,
    'Return with the TUI menu open must look at the highlighted row before submitting',
  );
  assert.match(
    tuiFullscreen,
    /const needsArgument = String\(chosen\.argument \?\? ''\)\.startsWith\('<'\);/,
    'the TUI must make the same required-argument distinction as the two browser shells',
  );
});

test('all three menus offer only what runs — one function decides it', () => {
  const body = codenViewModel.match(/export function menuEntriesFor\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.doesNotMatch(body, /\.\.\.addressEntries\(/,
    'menuEntriesFor must not fold destinations into the menu — a row that moves the page ' +
    'next to a row that runs is the collision reported twice',
  );
  assert.match(body, /return \[\.\.\.commands\];/);
  // And every shell's menu goes through it, so none can quietly grow its own list.
  assert.match(appJs, /matchCommands\(parsed\.word,menuEntriesFor\(/, 'chat must use it');
  assert.match(appJs, /menuFrame\(parsed,\{commands:codenMenu\(\)\.entries/, 'CodeN must use it via menuFrame');
  assert.match(tuiFullscreen, /menuFrame\(parsed, \{/, 'the TUI must use it via menuFrame');
});
