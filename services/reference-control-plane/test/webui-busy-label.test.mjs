// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner-reported (2026-08-29), on the research page: the badge read "Sources read in full"
// while the button beside it still read "Read the pages, not the snippets" — the state and the
// offer contradicting each other on one line. Root cause: `withBusy` captured the button's text
// before the work and restored it unconditionally afterwards, overwriting the new verb that
// `loadResearchPagesSwitch` had just written from the server's answer. The badge escaped only
// because it does not pass through `withBusy`.
//
// All 42 call sites were exposed; the guard belongs in the shared function, not in the toggles.
// Structural check in this codebase's established style (`chat-send-button-routes-commands`):
// app.js exposes no module boundary a DOM test could import through. Written with `includes`
// rather than a regex on purpose — the first version of this file lost its escapes and passed
// nothing, which is the trap already recorded twice in this project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const appJs = readFileSync(join(ROOT, 'apps/webui-static/app.js'), 'utf8');

test('withBusy restores the label only if the work did not rewrite it', () => {
  assert.ok(
    appJs.includes('if(button.textContent===busyLabel)button.textContent=original;'),
    'an unconditional restore silently undoes every toggle that renames itself while it works',
  );
});

test('a toggle that renames itself is still reachable — the pattern this protects', () => {
  // If this disappears the guard above is guarding nothing, and the next reader deletes it.
  assert.ok(
    appJs.includes("toggle.textContent=info.consented?t('Go back to snippets')"),
    'the research page switch is the reported instance of a button that renames itself',
  );
});
