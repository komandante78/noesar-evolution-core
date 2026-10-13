// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-13: "DEVI FARE TEST SU TUTTO". The same sweep of the live pages, run in the nine themes with the contrast of
// gradient buttons counted, found the selected chips and tabs ("All 13" in Models, "Working list" / "Archive" / "Bin" in Sessions)
// at 3.4 to 4.1 : 1 in seven themes (Midnight and Daylight passed at 8.1 : 1).
//
// Two sources met on one button. The fill is the theme's own gradient from styles.css (Indigo: #2f52e0 to #4260d6, a shade darker
// than its accent); the ink is --text-on-accent, which look.css bridges to --n-on-accent, and app.js derives that from the accent
// the page draws with (Indigo: #6584ff, so black). Black on #2f52e0 is 3.4 : 1. In the two themes look.css draws itself the fill IS
// the accent and the ink is the best of white and black on it, so the pair always passes.
//
// Held as a property: a theme may keep its own gradient only if the page does not draw with it. look.css gives every theme the same
// fill as the accent, with a selector that outweighs the theme blocks so the order of the two sheets does not decide it.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, '../../../apps/webui-static', name), 'utf8');
const styles = read('styles.css');
const look = read('look.css').replace(/\/\*[\s\S]*?\*\//g, '');

const themesWithOwnFill = [...styles.matchAll(/^:root\[data-theme="([a-z]+)"\]\{([^}]*)\}/gm)].filter((m) => /--accent-fill-from:/.test(m[2])).map((m) => m[1]);
const override = [...look.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].replace(/\s+/g, '') })).find((r) => r.body.includes('--accent-fill-from:var(--n-accent)') && r.body.includes('--accent-fill-to:var(--n-accent)') && /\[data-theme\]/.test(r.sel));

describe('every theme fills with the accent it draws with', () => {
  test('styles.css still gives themes a gradient of their own: that is what the override is for', () => {
    assert.ok(themesWithOwnFill.length >= 5, `expected several themes with their own --accent-fill-from, found: ${themesWithOwnFill.join(', ')}`);
  });

  test('look.css maps both fill tokens to --n-accent for any theme', () => {
    assert.ok(override, 'no rule in look.css maps --accent-fill-from and --accent-fill-to to var(--n-accent) under [data-theme]');
  });

  test('with a selector that outweighs the theme blocks (:root[data-theme="x"]), so source order does not decide it', () => {
    assert.ok(override, 'no override rule');
    assert.match(override.sel, /^:root:root\[data-theme\]$/, `the selector must be :root:root[data-theme] (0,3,0) against the theme blocks' (0,2,0), got ${override.sel}`);
  });
});
