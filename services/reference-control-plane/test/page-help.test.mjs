// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, s333 point 3c: «vanno messi i tasti `i` di informazione che cliccando danno
// suggerimenti».
//
// A missing help button is invisible — the panel simply looks like every other panel — so
// "every page has one" cannot be maintained by remembering. It is derived from the same census
// the router's addresses come from, and this file is what makes the derivation hold in both
// directions: a page with no entry fails, and an entry naming no page fails too. The second
// half matters as much as the first, because a stale entry is help text about something that
// is not there, which is worse than none.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PAGE_HELP } from '../../../apps/webui-static/page-help.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');

const census = () => JSON.parse(execFileSync('node', ['tools/measure-page-liveness.mjs', '--json'],
  { cwd: repoRoot, maxBuffer: 1e8 }).toString());

describe('every page can explain itself', () => {
  const addresses = [...new Set(census().map((row) => row.address))];

  test('the census found pages at all — an empty list would satisfy everything below', () => {
    assert.ok(addresses.length >= 30, `only ${addresses.length} addresses`);
  });

  test('every page has an entry', () => {
    const missing = addresses.filter((address) => !PAGE_HELP[address]);
    assert.deepEqual(missing, [], `these pages have no help text: ${missing.join(', ')}`);
  });

  test('every entry names a page that exists', () => {
    const known = new Set(addresses);
    const orphans = Object.keys(PAGE_HELP).filter((address) => !known.has(address));
    assert.deepEqual(orphans, [],
      `help written for pages that are not there: ${orphans.join(', ')} — help text about something absent is worse than none`);
  });

  test('every entry says what the page is AND what is worth doing on it', () => {
    for (const [address, entry] of Object.entries(PAGE_HELP)) {
      assert.ok(entry.what?.trim().length > 40, `${address}: "what" is too thin to be useful`);
      assert.ok(entry.howto?.trim().length > 40, `${address}: "howto" is too thin to be useful`);
    }
  });

  test('a page the census calls static says so in its own help, rather than describing a feature it has not got', () => {
    // The rule these texts are written under, made mechanical. An information button is where a
    // person arrives having already decided to trust the answer, so a help text that flatters a
    // static page is the precise failure this product argues against everywhere else.
    const rows = census();
    for (const row of rows.filter((entry) => entry.state === 'static')) {
      const entry = PAGE_HELP[row.address];
      assert.ok(/static|fixed|nothing to fetch|owns no content/i.test(entry.what),
        `${row.address} is static and its help does not say so: ${JSON.stringify(entry.what.slice(0, 90))}`);
    }
  });

  test('the buttons are installed by one mechanism, not written into the markup', () => {
    // Thirty-three hand-placed buttons is thirty-three places to forget one, and the thing
    // forgotten is invisible. If somebody starts writing them into index.html, the derivation
    // above stops being what guarantees coverage.
    const html = readFileSync(join(repoRoot, 'apps/webui-static/index.html'), 'utf8');
    assert.ok(!html.includes('class="help-button"'),
      'a help button was written into the markup; they are derived from the census in app.js');
    const app = readFileSync(join(repoRoot, 'apps/webui-static/app.js'), 'utf8');
    assert.ok(app.includes('installHelpButtons()'), 'the installer must be called at boot');
  });

  test('the help text goes through the translator like everything else', () => {
    const app = readFileSync(join(repoRoot, 'apps/webui-static/app.js'), 'utf8');
    assert.ok(/t\(entry\.what\)/.test(app) && /t\(entry\.howto\)/.test(app),
      'help text must be translated by the same mechanism as the rest, or point 3c ships a page that is half English by construction');
  });
});
