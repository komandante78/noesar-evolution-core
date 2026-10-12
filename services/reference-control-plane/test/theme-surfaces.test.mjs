// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-12, on the colour presets: the themes that bring surfaces of their own (Slate, Graphite, High contrast)
// painted Midnight's grey in the new look. Measured on the live page: Slate says --surface-root #060c12, Graphite #0d0c0b,
// High contrast #010101, and the page behind the chat was rgb(20, 23, 28) in all three. look.css draws with --n-bg, --n-card
// and their friends, and those themes set only the old --surface-* tokens. For High contrast that is an accessibility defect.
//
// And, the same day: "devi farlo con i colori che c'erano sul sito, decidi tu". The themes that change only the accent
// (Indigo, Teal, Amber, Violet) are the site's themes (noesar.com's themes.css was extracted from this stylesheet's :root):
// their accent on the site's navy black. The new look had put Midnight's grey under all of them.
//
// Held here as properties, not as a list of names:
//   1. every theme that defines its own surfaces (--surface-root) and is not one look.css draws itself reaches the look;
//   2. a bridge may only name a token the theme really defines. A token that theme leaves alone is look.css's own
//      var(--n-*), and mapping it back would be a cycle: both ends invalid, and the page loses its colour altogether;
//   3. a theme that changes only the accent wears the site's surfaces, and those are the :root of styles.css, value for
//      value — not a palette chosen again here — and a person can read the text on them.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHex, contrast } from '../../../apps/webui-static/colour.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, '../../../apps/webui-static', name), 'utf8');
const styles = read('styles.css');
const look = read('look.css');
const app = read('app.js');

const NATIVE = (app.match(/const NATIVE_LOOK_THEMES=\[([^\]]*)\]/)?.[1].match(/'([a-z]+)'/g) ?? []).map((s) => s.slice(1, -1));

// styles.css: the declarations of each :root[data-theme="x"]{...} block (a theme may have two: its tokens, and its color-scheme)
const themeBlocks = new Map();
for (const m of styles.matchAll(/^:root\[data-theme="([a-z]+)"\]\{([^}]*)\}/gm)) themeBlocks.set(m[1], (themeBlocks.get(m[1]) ?? '') + m[2]);
const definesSurfaces = [...themeBlocks].filter(([, body]) => /--surface-root:/.test(body)).map(([id]) => id).filter((id) => !NATIVE.includes(id));
const accentOnly = [...themeBlocks].filter(([, body]) => !/--surface-root:/.test(body)).map(([id]) => id).filter((id) => !NATIVE.includes(id));

// the first :root of styles.css: the palette the interface had, and the site's
const oldRoot = new Map([...(styles.match(/^:root\{([\s\S]*?)\n\}/m)?.[1] ?? '').matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const norm = (value) => String(value).toLowerCase().replace(/\s+/g, '');

// look.css: a block whose selector list is exactly the given themes
function blockFor(ids, bodyPattern) {
  for (const m of look.matchAll(/((?::root\[data-theme="[a-z]+"\],?)+)\{([^}]*)\}/g)) {
    const listed = [...m[1].matchAll(/data-theme="([a-z]+)"/g)].map((x) => x[1]).sort();
    if (JSON.stringify(listed) === JSON.stringify([...ids].sort()) && bodyPattern.test(m[2])) return m[2];
  }
  return null;
}
const declarations = (body) => new Map([...body.matchAll(/--(n-[a-z-]+):([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

describe('a theme\'s surfaces reach the new look', () => {
  test('the themes that bring surfaces of their own are found', () => {
    assert.ok(NATIVE.length >= 2, 'NATIVE_LOOK_THEMES is read');
    assert.ok(definesSurfaces.includes('slate') && definesSurfaces.includes('graphite') && definesSurfaces.includes('contrast'), definesSurfaces.join(','));
  });

  const bridge = blockFor(definesSurfaces, /--n-bg:var\(/);

  test('look.css has a bridge block for exactly those themes', () => {
    assert.ok(bridge, 'no block in look.css sets --n-bg from a theme\'s own token, for exactly those themes');
  });

  test('every token the bridge reads is one each of those themes defines (a token it leaves alone would be a cycle)', () => {
    assert.ok(bridge);
    const reads = [...bridge.matchAll(/--n-[a-z-]+:var\((--[a-z-]+)\)/g)].map((m) => m[1]);
    assert.ok(reads.length >= 8, `the bridge maps the surfaces, the text and the lines (${reads.length})`);
    for (const id of definesSurfaces) {
      for (const token of reads) assert.ok(themeBlocks.get(id).includes(`${token}:`), `${id} does not define ${token}`);
    }
  });

  test('the bridge sets the colours a person reads and the surfaces they sit on', () => {
    assert.ok(bridge);
    for (const token of ['--n-bg', '--n-side', '--n-card', '--n-sunken', '--n-field', '--n-ink', '--n-muted', '--n-line']) {
      assert.ok(bridge.includes(`${token}:var(`), `the bridge does not set ${token}`);
    }
  });
});

describe('every theme the look does not draw has an accent to hand over', () => {
  test('its own --blue, or one look.css gives it - not the look\'s default teal (seen on High contrast: teal buttons and a blue link)', () => {
    assert.ok(themeBlocks.size >= 8, 'the theme blocks of styles.css are read');
    for (const [id, body] of themeBlocks) {
      if (NATIVE.includes(id)) continue;
      const own = /--blue:/.test(body);
      const given = new RegExp(`:root\\[data-theme="${id}"\\]\\{[^}]*--blue:`).test(look);
      assert.ok(own || given, `${id} would hand the look the default teal`);
    }
  });
});

describe('the themes that change only the accent wear the site\'s surfaces', () => {
  const PAIRS = [
    ['n-bg', 'surface-root'], ['n-side', 'surface-sidebar'], ['n-card', 'surface-card'], ['n-sunken', 'surface-sunken'],
    ['n-field', 'surface-field'], ['n-bubble', 'surface-message-own'], ['n-hover', 'surface-secondary'],
    ['n-ink', 'text-primary'], ['n-muted', 'muted'], ['n-line', 'line'], ['n-edge', 'line'],
  ];
  const block = blockFor(accentOnly, /--n-bg:#/);

  test('the accent-only themes are Indigo, Teal, Amber and Violet', () => {
    assert.deepEqual([...accentOnly].sort(), ['amber', 'indigo', 'teal', 'violet']);
  });

  test('look.css has a block for exactly those themes, with literal colours', () => {
    assert.ok(block, 'no block in look.css gives exactly those themes surfaces of their own');
  });

  test('every colour in it is the site\'s: the :root of styles.css, value for value', () => {
    assert.ok(block);
    const given = declarations(block);
    for (const [target, source] of PAIRS) {
      assert.ok(given.has(target), `--${target} is not set`);
      assert.ok(oldRoot.has(source), `the :root of styles.css has no --${source}`);
      assert.equal(norm(given.get(target)), norm(oldRoot.get(source)), `--${target} is not the site's --${source}`);
    }
  });

  test('the text on them can be read: the ink at 7:1 and the grey at 4.5:1 on the card', () => {
    assert.ok(block);
    const given = declarations(block);
    const card = parseHex(given.get('n-card'));
    assert.ok(contrast(parseHex(given.get('n-ink')), card) >= 7, 'ink on the card');
    assert.ok(contrast(parseHex(given.get('n-muted')), card) >= 4.5, 'grey on the card');
  });
});
