// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0456. `codenTerminalState()` hides the legacy prompt/transcript/menu (`#codenShell`) the
// instant the modern xterm.js terminal reaches `state==='live'` — by design, `#/coden` shows
// one chat, never both. That handshake is async and can land while a person has `#codenPrompt`
// focused or mid-sentence: found automated (an e2e probe driving the box got its Enter silently
// swallowed by a box that had just stopped being rendered), and real for a human too — words
// typed into a box that vanishes out from under you, no error, nothing to read.
//
// This does not run app.js (no DOM host in this suite) — it holds the guard to the shape it
// has to keep: the hide is conditional on the box NOT being busy, and every place a busy spell
// can end (submit, empty the box, look away) retries the hide instead of leaving it silently
// deferred forever.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const app = readFileSync(join(root, 'apps/webui-static/app.js'), 'utf8');

describe('legacy #codenShell hide defers to the person, not just the terminal state', () => {
  test('busy is defined as focused OR holding unsent text, not just focused', () => {
    assert.match(app, /function legacyPromptBusy\(\)\{[\s\S]{0,220}?document\.activeElement===box\|\|box\.value\.trim\(\)!==''/,
      'legacyPromptBusy must treat unsent text as busy too — focus alone misses "typed something, tabbed away"');
  });

  test('the hide path asks legacyPromptBusy() before hiding, rather than hiding unconditionally', () => {
    assert.match(app, /if\(hide\)\{if\(legacyPromptBusy\(\)\)legacyHidePending=true;else applyLegacyHide\(\);\}/,
      'codenTerminalState must defer the hide (legacyHidePending) when the box is busy, not hide it out from under the person');
  });

  test('showing the legacy shell again always clears a pending hide', () => {
    assert.match(app, /else if\(show\)\{legacyShell\.classList\.remove\('hidden'\);[\s\S]{0,80}?legacyHidePending=false;\}/,
      'a pending hide left set after the terminal fails/refuses/goes idle would fire the NEXT time the box is touched, for a reason that no longer applies');
  });

  test('every way a busy spell ends retries the deferred hide', () => {
    // submit clears the box — the point busy-because-of-text stops being true.
    assert.match(app, /box\.value='';codenMenuIndex=0;renderCodenMenu\(\);maybeApplyLegacyHide\(\);/,
      'submitCodenPrompt clears the box but never asks whether a deferred hide can now apply');
    // typing the box back to empty without submitting is the second way.
    assert.match(app, /box\.addEventListener\('input',\(\)=>\{codenMenuIndex=0;renderCodenMenu\(\);maybeApplyLegacyHide\(\);\}\);/,
      'the input listener never retries a deferred hide, so emptying the box by hand leaves it stuck');
    // looking away without submitting or emptying it is the third.
    assert.match(app, /box\.addEventListener\('blur',\(\)=>\{maybeApplyLegacyHide\(\);\}\);/,
      'no blur listener retries a deferred hide, so tabbing away with text left in the box leaves it stuck forever');
  });
});
