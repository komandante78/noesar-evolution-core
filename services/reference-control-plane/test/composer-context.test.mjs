// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Seen in a screenshot of the chat at the Advanced level: "No context selec" cut in the middle of a word beside the context icon.
// look.css gives .composer-context the ingredients of an ellipsis (overflow hidden, nowrap, min-width 0, text-overflow), but at the
// Advanced level a rule makes every .level-advanced inside the composer row display:inline-flex !important, and text-overflow does
// not act on the text inside a flex container: the text is clipped without its dots. The context summary has to stay a block.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const look = readFileSync(join(here, '../../../apps/webui-static/look.css'), 'utf8');
const html = readFileSync(join(here, '../../../apps/webui-static/index.html'), 'utf8');

describe('the context summary in the composer is cut with dots, not in the middle of a word', () => {
  test('the summary is a .composer-context that only the Advanced level shows', () => {
    assert.match(html, /<span class="composer-context level-advanced" id="chatContextSummary">/);
  });

  test('it has what an ellipsis needs: overflow hidden, no wrapping, room to shrink, text-overflow', () => {
    const rule = look.match(/\.composer-context\{([^}]*)\}/)?.[1] ?? '';
    for (const part of ['overflow:hidden', 'white-space:nowrap', 'min-width:0', 'text-overflow:ellipsis']) assert.ok(rule.includes(part), `.composer-context lacks ${part}`);
  });

  test('and at the Advanced level it stays a block: the rule that makes the other details inline-flex does not take it', () => {
    assert.match(look, /body\[data-level=advanced\] \.composer-row \.composer-context\.level-advanced\{display:block!important\}/);
  });
});
