// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-16: "lavora con estensione chrome per fare tutti i test della grafica dal vivo". On the Owner's own instance, with the
// real model list and the real sessions, two things showed that no screenshot of the empty disposable probe could show:
//
//  1. The model menu of the chat was left open, cut by the top edge of the window, covering the greeting. The rule that draws it in
//     look.css sets bottom: calc(100% + 8px) and no position, so the legacy rule .model-picker {position: relative} won: a relative
//     box keeps its place in the flow (the composer grew by the height of the menu) and is then moved up by 100% of the container it
//     just enlarged. Measured: the composer 132 px high closed; open, a menu of 528 px moved up by 650 px, its top at y = -412.
//  2. Radios of 13 px in labels 19 px high, and the selection boxes of the sessions list at 20 x 13 px with no label around them:
//     under the 24 px that WCAG 2.5.8 asks of a target. The empty probe has none of these rows, so neither the sweep nor the audit saw them.
//
// Held as properties of the stylesheet, not as a list of pages.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const look = readFileSync(join(here, '../../../apps/webui-static/look.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...look.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2].replace(/\s+/g, '') }));
const declared = (body, property) => body.match(new RegExp(`(?:^|;)${property}:([^;]+)`))?.[1];

describe('the model menu of the chat stays on screen', () => {
  const menu = rules.find((r) => r.selector === '.chat-composer .model-picker');

  test('the rule that places it exists', () => {
    assert.ok(menu, 'no rule for .chat-composer .model-picker in look.css');
  });

  test('it is taken out of the flow: offsets with no position are the defect, the legacy rule makes it relative', () => {
    assert.equal(declared(menu?.body ?? '', 'position'), 'absolute', 'bottom/top offsets on a position: relative box move it, they do not anchor it');
  });

  test('it cannot be taller than the room the chat leaves it, and scrolls inside', () => {
    const max = declared(menu?.body ?? '', 'max-height');
    assert.ok(max, 'no max-height: a list of models of any length is as tall as the list');
    assert.match(max, /^(\d+)vh$/, `max-height must be a share of the window, got ${max}`);
    assert.ok(Number.parseInt(max, 10) <= 40, `at 40vh it fits above the box of the empty chat (which starts at 42 % of the window); got ${max}`);
    assert.equal(declared(menu?.body ?? '', 'overflow-y'), 'auto');
  });

  test('its list does not scroll by itself inside a menu that already scrolls', () => {
    const list = rules.find((r) => r.selector === '.chat-composer .model-picker .model-picker-list');
    assert.ok(list, 'no rule for the list inside the chat menu');
    assert.equal(declared(list.body, 'max-height'), 'none');
  });
});

describe('boxes and radios are targets of at least 24 px', () => {
  const control = rules.find((r) => /input\[type=checkbox\]/.test(r.selector) && /input\[type=radio\]/.test(r.selector) && declared(r.body, 'width'));

  test('one rule sizes them all', () => {
    assert.ok(control, 'no rule in look.css sets the size of input[type=checkbox], input[type=radio]');
  });

  test('1.5rem is 24 px at the default size, and it never goes under it when the text grows', () => {
    for (const property of ['width', 'height', 'min-width', 'min-height']) {
      assert.match(declared(control?.body ?? '', property) ?? '', /^1\.5rem$/, `${property} of a checkbox or a radio must be 1.5rem`);
    }
  });
});
