// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-12: "hai tolto in #/settings/appearance la possibilita di cambiare colore personalizzato".
//
// The accent picker was never removed from the markup. It sat inside the block that only the Advanced level
// shows, so a person at the Base level (the level everyone starts at) had no colour to change. And the picker
// moved the old accent tokens only, while look.css draws with its own --n-accent family, so even where it was
// reachable most of the new look did not follow it.
//
// Two properties are held here, not two values:
//   1. what a person changes to make the interface their own (the accent colour, the zoom, the motion setting)
//      is reachable at every level — the level adds details, it never takes a personal setting away;
//   2. every accent variable look.css reads is one the picker sets, so a chosen colour reaches everything
//      the look draws with it.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, '../../../apps/webui-static', name), 'utf8');
const html = read('index.html');
const app = read('app.js');
const look = read('look.css');

describe('appearance: what makes the interface a person\'s own is not an Advanced detail', () => {
  const advancedBlocks = [...html.matchAll(/<details\b[^>]*\blevel-advanced\b[^>]*>[\s\S]*?<\/details>/g)].map((m) => m[0]);

  for (const id of ['accentPicker', 'accentHex', 'accentReset', 'zoomRange', 'reduceMotion']) {
    test(`#${id} exists and is not inside a block only the Advanced level shows`, () => {
      assert.ok(html.includes(`id="${id}"`), `#${id} is in the markup`);
      for (const block of advancedBlocks) assert.ok(!block.includes(`id="${id}"`), `#${id} sits in an Advanced-only block`);
    });
  }

  test('the nine themes and the legend of the seven states stay in the Advanced block', () => {
    const holder = advancedBlocks.find((block) => block.includes('id="themeGrid"'));
    assert.ok(holder, 'the themes are in a block the level shows');
    assert.ok(holder.includes('id="stateLegend"'), 'and so is the legend of the seven states');
  });
});

describe('appearance: the chosen colour reaches what look.css draws with', () => {
  const applyAccent = app.slice(app.indexOf('function applyAccent('), app.indexOf('\napplyAccent(readAccent());'));

  test('applyAccent is found', () => assert.ok(applyAccent.length > 100));

  test('every --n-accent* / --n-on-accent variable look.css reads is set by applyAccent', () => {
    const read = new Set([...look.matchAll(/var\(--(n-accent[a-z-]*|n-on-accent)\)/g)].map((m) => m[1]));
    assert.ok(read.size >= 4, `look.css reads the family (${[...read].join(', ')})`);
    for (const token of read) {
      assert.ok(applyAccent.includes(`'--${token}'`) || applyAccent.includes(`\`--${token}\``), `applyAccent does not set --${token}`);
    }
  });

  test('and every one of them is cleared again when the accent is reset', () => {
    const tokens = [...look.matchAll(/var\(--(n-accent[a-z-]*|n-on-accent)\)/g)].map((m) => m[1]);
    const cleared = app.slice(app.indexOf('const NEW_LOOK_ACCENT_TOKENS'), app.indexOf('\n', app.indexOf('const NEW_LOOK_ACCENT_TOKENS')));
    for (const token of new Set(tokens)) assert.ok(cleared.includes(`'${token}'`), `reset leaves --${token} behind`);
  });
});
