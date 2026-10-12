// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-12, on the colour presets: the themes that bring their own SURFACES (Slate, Graphite, High contrast) painted
// Midnight's grey in the new look. Measured on the live page: Slate says --surface-root #060c12, Graphite #0d0c0b, High
// contrast #010101, and the page behind the chat was rgb(20, 23, 28) in all three. look.css draws with --n-bg, --n-card and
// their friends, and those themes set only the old --surface-* tokens. For High contrast that is an accessibility defect.
//
// Held here as properties, not as a list of three names:
//   1. every theme that defines its own surfaces (--surface-root) and is not one look.css draws itself reaches the look;
//   2. a bridge may only name a token the theme really defines. A token that theme leaves alone is look.css's own
//      var(--n-*), and mapping it back would be a cycle: both ends invalid, and the page loses its colour altogether.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, '../../../apps/webui-static', name), 'utf8');
const styles = read('styles.css');
const look = read('look.css');
const app = read('app.js');

const NATIVE = (app.match(/const NATIVE_LOOK_THEMES=\[([^\]]*)\]/)?.[1].match(/'([a-z]+)'/g) ?? []).map((s) => s.slice(1, -1));

// styles.css: the body of each :root[data-theme="x"]{...} block
const themeBlocks = new Map([...styles.matchAll(/^:root\[data-theme="([a-z]+)"\]\{([\s\S]*?)\n\}/gm)].map((m) => [m[1], m[2]]));
const definesSurfaces = [...themeBlocks].filter(([, body]) => /--surface-root:/.test(body)).map(([id]) => id).filter((id) => !NATIVE.includes(id));

// look.css: the bridge block, whose selector lists every such theme
const bridge = look.match(/((?::root\[data-theme="[a-z]+"\],?)+)\{([^}]*--n-bg:var\([^}]*)\}/);

describe('a theme\'s surfaces reach the new look', () => {
  test('the themes that bring surfaces of their own are found', () => {
    assert.ok(NATIVE.length >= 2, 'NATIVE_LOOK_THEMES is read');
    assert.ok(definesSurfaces.includes('slate') && definesSurfaces.includes('graphite') && definesSurfaces.includes('contrast'), definesSurfaces.join(','));
  });

  test('look.css has a bridge block for exactly those themes', () => {
    assert.ok(bridge, 'no block in look.css sets --n-bg from a theme\'s own token');
    const bridged = [...bridge[1].matchAll(/data-theme="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(bridged.sort(), [...definesSurfaces].sort());
  });

  test('every token the bridge reads is one each of those themes defines (a token it leaves alone would be a cycle)', () => {
    assert.ok(bridge);
    const reads = [...bridge[2].matchAll(/--n-[a-z-]+:var\((--[a-z-]+)\)/g)].map((m) => m[1]);
    assert.ok(reads.length >= 8, `the bridge maps the surfaces, the text and the lines (${reads.length})`);
    for (const id of definesSurfaces) {
      for (const token of reads) assert.ok(themeBlocks.get(id).includes(`${token}:`), `${id} does not define ${token}`);
    }
  });

  test('the bridge sets the colours a person reads and the surfaces they sit on', () => {
    assert.ok(bridge);
    for (const token of ['--n-bg', '--n-side', '--n-card', '--n-sunken', '--n-field', '--n-ink', '--n-muted', '--n-line']) {
      assert.ok(bridge[2].includes(`${token}:var(`), `the bridge does not set ${token}`);
    }
  });
});
