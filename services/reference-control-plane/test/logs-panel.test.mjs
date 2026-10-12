// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-12: "nei log ... 200 di default, dai modo di ripulire i logs ed eliminarli". Looking at the page in a screenshot (the
// window of the real browser is covered, so a headless one on a throwaway instance is how it is looked at) the panel still failed
// the person it was fixed for, in three ways the first fix did not touch:
//   - the number box had a name for a screen reader and none for the eye: a bare "8" beside the Search button, the very thing the
//     complaint was about (a 200 that nobody could tell the meaning of);
//   - the "Delete logs" button sat after the list: 200 rows at ~66 px is 13 000 px of scrolling to reach it;
//   - the time of a row wrapped in two ("2026-10-" / "12T10:01:38.164Z") because its column was 150 px for 24 characters.
// Held here as properties of the markup and the stylesheet.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, '../../../apps/webui-static', name), 'utf8');
const html = read('index.html');
const look = read('look.css');

describe('the logs panel says what its controls are and puts them where they can be found', () => {
  test('the number box has a name a person can see: "Show up to"', () => {
    assert.match(html, /<label class="log-limit"><span>Show up to<\/span><input id="logLimit"/);
  });

  test('"Delete logs" is before the list it would otherwise hide behind', () => {
    const button = html.indexOf('id="logsDelete"');
    assert.ok(button > 0, 'the button is in the markup');
    assert.ok(button < html.indexOf('id="logResults"'), 'it sits after the list');
  });

  test('and it sits beside the figure it acts on, "Logs on this device"', () => {
    assert.match(html, /<div class="log-disk-row"><p class="hint"><span>Logs on this device:<\/span> <b id="logDisk"[^>]*>[^<]*<\/b><\/p><button class="danger" id="logsDelete"/);
  });
});

describe('a log row reads on one line', () => {
  test('a time does not wrap, and the rows are read at 14px', () => {
    assert.match(look, /\.log-row time\{white-space:nowrap\}/);
    assert.match(look, /\.log-row\{font-size:0\.875rem\}/);
  });

  test('on a wide screen the time has the width it needs; the narrow layout (styles.css, under 851px) is left alone', () => {
    assert.match(look, /@media\(min-width:851px\)\{\.log-row\{grid-template-columns:max-content 4\.5rem minmax\(0,1fr\)\}\}/);
  });
});
