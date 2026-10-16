// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The pages of the old stylesheet that the new look did not redraw (Audit and Health, Models, About, Tasks, the CodeN TUI page) set their
// text from 9 to 11 px: measured on the Owner's own instance on 2026-10-13, 592 pieces of text at 10 px on Health and Audit alone (every
// date and every code of the audit trail), about 170 on Models, about 60 on About. The project's own rule is 14 px for what the new look
// draws; for these dense pages a floor of 12 px was chosen: readable, and not enough to make a table of dates reflow.
//
// 71 declarations of styles.css were of the shape calc(var(--text-scale) * Npx) with N under 12. The person's text-size setting still
// scales them (at 1.3 a 10 px label is 13 px); what changes is where it starts. Held as a property, not a list: a size added later under
// 12 px with no floor is caught here.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FLOOR = 12;
const sizesUnderTheFloor = (file) => {
  const css = readFileSync(join(here, '../../../apps/webui-static', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((rule) => [...rule[2].matchAll(/font-size\s*:\s*([^;]+)/g)]
    .map((d) => d[1].trim())
    .filter((value) => {
      const px = value.match(/\*\s*([0-9.]+)px/)?.[1] ?? value.match(/^([0-9.]+)px/)?.[1];
      return px !== undefined && Number(px) < FLOOR && !new RegExp(`^max\\(\\s*${FLOOR}px`).test(value);
    })
    .map((value) => `${rule[1].trim().replace(/\s+/g, ' ').slice(0, 60)} { font-size: ${value} }`));
};

describe(`no text is set under ${FLOOR} px without a floor`, () => {
  for (const file of ['styles.css', 'look.css']) {
    test(`${file}: every size under ${FLOOR} px is guarded by max(${FLOOR}px, …)`, () => {
      const offenders = sizesUnderTheFloor(file);
      assert.equal(offenders.length, 0, `${offenders.length} sizes under ${FLOOR} px with no floor, for instance: ${offenders.slice(0, 4).join(' | ')}`);
    });
  }

  test('the floor is not a way around the text-size setting: the guarded value still carries --text-scale', () => {
    const css = readFileSync(join(here, '../../../apps/webui-static/styles.css'), 'utf8');
    const guarded = [...css.matchAll(/max\(\s*12px\s*,\s*calc\(var\(--text-scale\)\s*\*\s*[0-9.]+px\)\s*\)/g)];
    assert.ok(guarded.length >= 60, `expected the sizes that were under 12 px to be guarded and still scaled, found ${guarded.length}`);
  });
});
