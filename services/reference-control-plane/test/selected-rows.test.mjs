// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-13: "DEVI FARE TEST SU TUTTO". A sweep of the live pages (the Chrome extension, 67 addresses, computed styles)
// found the selected row of seven controls at 1.2 to 2.2 : 1 in eight themes of nine: near-black text on navy. Measured in the
// default theme, the CodeN terminal tab "Terminal 1": rgb(6, 32, 28) on rgb(36, 58, 104).
//
// The old stylesheet marks "the one you are on" with the pair --surface-selected (an old navy) and --text-on-accent (white text).
// The bridge in look.css turned --text-on-accent into the ink an accent FILL wears, and on a light accent such as Midnight's
// teal that ink is near-black; the navy behind it stayed. Each end of the pair was right alone.
//
// Held as a property, not as a list of names: every rule of styles.css that pairs the two is drawn again by look.css with the
// accent's soft wash and its readable ink, the way .composer-web already is. A rule added later with the same pair is caught here.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, '../../../apps/webui-static', name), 'utf8');
const rules = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean), body: m[2].replace(/\s+/g, '') }));
const legacy = rules(read('styles.css')).filter((r) => r.body.includes('background:var(--surface-selected)') && r.body.includes('color:var(--text-on-accent)'));
const drawn = new Set(rules(read('look.css')).filter((r) => r.body.includes('background:var(--n-accent-soft)') && r.body.includes('color:var(--n-accent-ink)')).flatMap((r) => r.selectors));

describe('the selected row of a control is readable in every theme', () => {
  test('the sweep still finds the seven rows that pair the old navy with the fill ink', () => {
    const found = legacy.flatMap((r) => r.selectors);
    assert.ok(found.length >= 7, `expected at least seven selectors in styles.css, found ${found.length}: the parser or the stylesheet moved`);
  });

  test('look.css draws each of them with the accent soft wash and the accent ink', () => {
    const missing = legacy.flatMap((r) => r.selectors).filter((s) => !drawn.has(s));
    assert.deepEqual(missing, [], `selected rows still on --surface-selected + --text-on-accent: ${missing.join(' | ')}`);
  });
});
