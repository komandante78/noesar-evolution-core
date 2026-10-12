// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Found in a screenshot of Health and logs (2026-10-12): the Watchdog panel said "safe mode  [object Object]" and showed the
// "Leave safe mode" button while safe mode was off. The report's safeMode is an object ({ active, reason, since, incidentId }):
// it was interpolated into a string, and "is there one?" was asked of the object, which is always true.
//
// The line and the button's visibility now come from one pure function, so the answer to "is safe mode on?" is one value,
// asked of the field that holds it.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { safeModeLine } from '../../../apps/webui-static/simple-mode.js';

describe('the watchdog panel\'s safe-mode line', () => {
  test('off: says off, and the Leave button has nothing to leave', () => {
    const line = safeModeLine({ active: false, reason: null, since: null, incidentId: null });
    assert.equal(line.active, false);
    assert.equal(line.text, 'off');
  });

  test('on: says so, with the reason and since when', () => {
    const line = safeModeLine({ active: true, reason: 'crash loop', since: '2026-10-12T05:00:00.000Z', incidentId: 'i-1' });
    assert.equal(line.active, true);
    assert.match(line.text, /^ACTIVE/);
    assert.ok(line.text.includes('crash loop') && line.text.includes('2026-10-12T05:00:00.000Z'), line.text);
  });

  test('an object is never printed as one', () => {
    for (const value of [{ active: false }, { active: true }, {}, null, undefined, true, false]) {
      assert.ok(!safeModeLine(value).text.includes('[object Object]'), JSON.stringify(value));
    }
  });

  test('only an explicit active:true counts: an object that merely exists does not turn the Leave button on', () => {
    assert.equal(safeModeLine({}).active, false);
    assert.equal(safeModeLine({ active: 'yes' }).active, false);
    assert.equal(safeModeLine(null).active, false);
    assert.equal(safeModeLine({ active: true }).active, true);
  });

  test('a safe mode with no reason or time still reads', () => {
    const line = safeModeLine({ active: true });
    assert.match(line.text, /^ACTIVE/);
    assert.ok(!/undefined|null/.test(line.text), line.text);
  });
});
