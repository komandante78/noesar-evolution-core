// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-12: "hai tolto in #/settings/appearance la possibilita di cambiare colore personalizzato" and, a little
// later, "i colori che si mettevano nella vecchia grafica non li hai messi: c'era oro e nero preimpostato, come sul sito".
//
// The accent picker was never removed from the markup. It sat inside the block that only the Advanced level shows, together
// with the nine themes (Amber is the gold-on-black one the site has too), so a person at the Base level — the level
// everyone starts at — had no colour to change. And both the picker and the themes moved the OLD accent tokens only, while
// look.css draws with its own --n-accent family, so even where they were reachable most of the new look did not follow.
//
// Three properties are held here, not values:
//   1. what a person changes to make the interface their own (the themes, the accent colour, the zoom, the motion setting)
//      is reachable at every level — the level adds details, it never takes a personal setting away;
//   2. every accent variable look.css reads is one the picker sets, so a chosen colour reaches everything the look draws;
//   3. a theme look.css does not draw itself (all but Midnight and Daylight) hands its accent to that same family, and a
//      theme that is applied re-derives it, so the gold of Amber reaches the buttons and not only the old tokens.

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

  for (const id of ['themeGrid', 'accentPicker', 'accentHex', 'accentReset', 'zoomRange', 'reduceMotion']) {
    test(`#${id} exists and is not inside a block only the Advanced level shows`, () => {
      assert.ok(html.includes(`id="${id}"`), `#${id} is in the markup`);
      for (const block of advancedBlocks) assert.ok(!block.includes(`id="${id}"`), `#${id} sits in an Advanced-only block`);
    });
  }

  test('only the legend of the seven states stays in the Advanced block', () => {
    const holder = advancedBlocks.find((block) => block.includes('id="stateLegend"'));
    assert.ok(holder, 'the legend is in a block the level shows');
  });
});

describe('appearance: the chosen colour reaches what look.css draws with', () => {
  const applyAccent = app.slice(app.indexOf('function applyAccent('), app.indexOf('\napplyAccent(readAccent());'));

  test('applyAccent is found', () => assert.ok(applyAccent.length > 100));

  test('every --n-accent* / --n-on-accent variable look.css reads is set by applyAccent', () => {
    const readTokens = new Set([...look.matchAll(/var\(--(n-accent[a-z-]*|n-on-accent)\)/g)].map((m) => m[1]));
    assert.ok(readTokens.size >= 4, `look.css reads the family (${[...readTokens].join(', ')})`);
    for (const token of readTokens) {
      assert.ok(applyAccent.includes(`'--${token}'`) || applyAccent.includes(`\`--${token}\``), `applyAccent does not set --${token}`);
    }
  });

  test('and every one of them is cleared again when the accent is reset', () => {
    const tokens = [...look.matchAll(/var\(--(n-accent[a-z-]*|n-on-accent)\)/g)].map((m) => m[1]);
    const cleared = app.slice(app.indexOf('const NEW_LOOK_ACCENT_TOKENS'), app.indexOf('\n', app.indexOf('const NEW_LOOK_ACCENT_TOKENS')));
    for (const token of new Set(tokens)) assert.ok(cleared.includes(`'${token}'`), `reset leaves --${token} behind`);
  });
});

describe('appearance: a theme reaches the look, not only the old tokens', () => {
  const themeIds = [...app.matchAll(/\{id:'([a-z]+)',label:'[^']+',hint:'[^']+'\}/g)].map((m) => m[1]);
  const applyAccent = app.slice(app.indexOf('function applyAccent('), app.indexOf('\napplyAccent(readAccent());'));
  const applyTheme = app.slice(app.indexOf('function applyTheme('), app.indexOf('function applyAccent('));

  test('the nine themes are found, Amber among them', () => {
    assert.equal(themeIds.length, 9, themeIds.join(','));
    assert.ok(themeIds.includes('amber'));
  });

  test('NATIVE_LOOK_THEMES lists exactly the themes look.css defines --n-accent for', () => {
    const drawn = new Set([...look.matchAll(/:root(?:\[data-theme="([a-z]+)"\])?\{[^}]*--n-accent:/g)].map((m) => m[1] ?? 'midnight'));
    const declared = app.match(/const NATIVE_LOOK_THEMES=\[([^\]]*)\]/);
    assert.ok(declared, 'NATIVE_LOOK_THEMES is declared');
    const native = [...declared[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    assert.deepEqual([...drawn].sort(), native.sort());
    for (const id of native) assert.ok(themeIds.includes(id), `${id} is a theme`);
  });

  test('any other theme hands its own accent to the look\'s family', () => {
    assert.ok(applyAccent.includes('NATIVE_LOOK_THEMES.includes('), 'the themes the look does not draw are told apart');
    assert.ok(applyAccent.includes("tokenValue('blue')"), 'and their accent is the theme\'s own token, not a colour chosen here');
  });

  test('applying a theme re-derives the accent, so a theme kept from the last visit is not left on the default teal', () => {
    assert.ok(applyTheme.includes('applyAccent(readAccent())'), 'applyTheme does not re-derive');
  });

  test('Amber says what it is: the gold-on-black preset', () => {
    assert.match(app, /\{id:'amber',label:'Amber',hint:'gold on black'\}/);
  });
});
