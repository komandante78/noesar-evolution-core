// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-12: "il logo non e quello originale".
//
// The project has an original mark (docs/brand/noesar-mark-on-*.svg), drawn once and used on the site and in the
// README. The WebUI never used it: it drew a letter N in a coloured square, and the one interface of 2026-10-11
// drew that letter in a flat black one. Neither is the mark.
//
// What is held here is the property, not the picture: the product wears the project's OWN mark, byte for byte
// (a redraw would differ and fail), in both places a person meets it (the sign-in window and the menu), as the
// tab icon, and exactly one variant of it shows in every theme.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const webui = (name) => readFileSync(join(root, 'apps/webui-static', name), 'utf8');
const html = webui('index.html');
const look = webui('look.css');
const MARKS = ['noesar-mark-on-light.svg', 'noesar-mark-on-dark.svg'];

describe('the mark the interface wears is the project\'s own', () => {
  for (const name of MARKS) {
    test(`${name} is the one in docs/brand, byte for byte`, () => {
      const served = readFileSync(join(root, 'apps/webui-static/brand', name));
      const original = readFileSync(join(root, 'docs/brand', name));
      assert.ok(served.equals(original), `${name} differs from docs/brand: a redraw is not the mark`);
    });
  }

  test('no letter drawn in a square stands in for it, in either place', () => {
    assert.ok(!/<span class="brand-mark">[^<]*<\/span>/.test(html), 'a text brand-mark is left');
    assert.equal(html.split('class="brand-on-dark"').length - 1, 2, 'the dark variant is in the sign-in window and in the menu');
    assert.equal(html.split('class="brand-on-light"').length - 1, 2, 'so is the light one');
    assert.ok(html.includes('src="/brand/noesar-mark-on-dark.svg"') && html.includes('src="/brand/noesar-mark-on-light.svg"'));
  });

  test('the menu says whose it is: NOESAR, and Evolution beside it', () => {
    const menu = html.slice(html.indexOf('<div class="brand">'), html.indexOf('</div>', html.indexOf('<div class="brand">')));
    assert.ok(menu.includes('<strong>NOESAR</strong>'));
    assert.ok(/<span class="brand-sub"[^>]*>Evolution<\/span>/.test(menu));
  });

  test('the tab icon is the mark, in the variant the browser\'s own colour scheme needs', () => {
    assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/brand\/noesar-mark-on-light\.svg" media="\(prefers-color-scheme: light\)">/);
    assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/brand\/noesar-mark-on-dark\.svg" media="\(prefers-color-scheme: dark\)">/);
  });
});

describe('exactly one variant shows, in every theme', () => {
  test('the light variant is hidden except in Daylight, the one light theme, where the dark one is hidden', () => {
    assert.match(look, /\.brand-mark \.brand-on-dark\{display:block\}/);
    assert.match(look, /\.brand-mark \.brand-on-light\{display:none\}/);
    assert.match(look, /:root\[data-theme="daylight"\] \.brand-mark \.brand-on-light\{display:block\}/);
    assert.match(look, /:root\[data-theme="daylight"\] \.brand-mark \.brand-on-dark\{display:none\}/);
  });

  test('no rule on the image in general sets display: it would out-rank the one that hides a variant (seen on the live page, 2026-10-12)', () => {
    const generic = look.match(/(^|\n)\.brand-mark img\{[^}]*\}/g) ?? [];
    assert.ok(generic.length > 0, 'the rule on the mark\'s images is found');
    for (const rule of generic) assert.ok(!/display\s*:/.test(rule), `a generic image rule sets display: ${rule.trim()}`);
  });
});

describe('it can be served and loaded', () => {
  test('the static server names an svg, and the page\'s policy lets it load its own images', () => {
    const server = readFileSync(join(root, 'services/reference-control-plane/src/server.mjs'), 'utf8');
    assert.ok(server.includes("'.svg':'image/svg+xml'"));
    const security = readFileSync(join(root, 'services/reference-control-plane/src/http-security.mjs'), 'utf8');
    assert.match(security, /MAIN_CSP = "[^"]*img-src 'self'/);
  });
});
