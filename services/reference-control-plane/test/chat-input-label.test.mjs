// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-13: "DEVI FARE TEST SU TUTTO". The WCAG audit of the project (tools/accessibility-audit.mjs, npm run test:accessibility),
// which had stopped running when the interface became one (it waited for a Home that no longer opens), was repaired and run again, and
// reported at once: "every form field has a programmatic label (3.3.2) — 2 unlabelled: textarea#chatInput". The box where a person writes
// to the model had a placeholder and nothing else; a placeholder is gone as soon as one types and is not a label.
//
// The field sits inside translate="no" (what a person types is theirs), and the translator does not even read the attributes of an
// element with that attribute, so an aria-label ON the field would stay in English in every language. The label is a sibling, outside the
// exempted element, and the translator reads it as any other text.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '../../../apps/webui-static');
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const catalogs = ['i18n-catalog.js', 'i18n-catalog-es.js', 'i18n-catalog-fr.js', 'i18n-catalog-de.js', 'i18n-catalog-pt.js'];

describe('the box where a person writes to the model has a label', () => {
  const label = html.match(/<label\b[^>]*\bfor="chatInput"[^>]*>([^<]+)<\/label>/);

  test('a <label for="chatInput"> exists, with words in it', () => {
    assert.ok(label, 'no <label for="chatInput"> in index.html');
    assert.ok(label[1].trim().length >= 4, `the label says "${label[1].trim()}"`);
  });

  test('it is kept for screen readers (visually-hidden), so the box keeps the look the drawings gave it', () => {
    assert.match(label?.[0] ?? '', /class="[^"]*\bvisually-hidden\b/);
  });

  test('and it is outside the translate="no" element: the translator reads it', () => {
    const textarea = html.indexOf('<textarea id="chatInput"');
    assert.ok(textarea > 0, 'the textarea moved');
    const at = html.indexOf(label?.[0] ?? '\u0000');
    assert.ok(at > 0 && at < textarea, 'the label must come before the box, as its sibling');
    assert.doesNotMatch(label?.[0] ?? '', /translate="no"/);
  });

  test('every catalogue translates it', () => {
    const text = label?.[1].trim() ?? '';
    for (const file of catalogs) {
      const source = readFileSync(join(dir, file), 'utf8');
      assert.ok(source.includes(`'${text}': '`), `${file} has no entry for '${text}'`);
    }
  });
});
