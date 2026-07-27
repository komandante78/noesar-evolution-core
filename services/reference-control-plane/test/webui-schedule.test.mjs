// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The scheduling arithmetic behind the initial screen · UI-062.
//
// Anchored to offsets computed BY HAND from the zone rules, not to this implementation's
// own output — an encoder checked against itself proves only that it is consistent. The
// round trip is a second, weaker check kept alongside: it shares the Intl machinery with
// the code under test, so it can only catch a mistake the fixed vectors would also catch,
// and it is here to show a failure's direction rather than to stand in for them.
//
// Two of the vectors use half-hour and three-quarter-hour zones on purpose. An offset
// arithmetic bug that only ever sees whole hours passes every test written in Europe.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTask, isZonelessInstant, splitTasks, wallClockInZone, zonedWallClockToUtcIso,
} from '../../../apps/webui-static/schedule.js';

describe('a wall clock plus a zone becomes one instant', () => {
  // zone, wall clock, expected instant, and the offset that makes it true.
  const VECTORS = [
    ['Europe/Rome',        '2026-01-15T09:30', '2026-01-15T08:30:00.000Z', 'CET, UTC+1'],
    ['Europe/Rome',        '2026-07-28T09:30', '2026-07-28T07:30:00.000Z', 'CEST, UTC+2'],
    ['UTC',                '2026-07-28T09:30', '2026-07-28T09:30:00.000Z', 'UTC+0'],
    ['Asia/Kolkata',       '2026-07-28T09:30', '2026-07-28T04:00:00.000Z', 'UTC+5:30, no DST'],
    ['America/New_York',   '2026-01-15T09:30', '2026-01-15T14:30:00.000Z', 'EST, UTC-5'],
    ['America/New_York',   '2026-07-28T09:30', '2026-07-28T13:30:00.000Z', 'EDT, UTC-4'],
    ['Australia/Lord_Howe','2026-07-28T09:30', '2026-07-27T23:00:00.000Z', 'UTC+10:30, and the date goes back a day'],
    ['Pacific/Chatham',    '2026-07-28T09:30', '2026-07-27T20:45:00.000Z', 'UTC+12:45'],
  ];
  for (const [zone, wall, expected, why] of VECTORS) {
    test(`${zone} ${wall} — ${why}`, () => {
      assert.equal(zonedWallClockToUtcIso(wall, zone), expected);
      assert.equal(wallClockInZone(expected, zone), wall);
    });
  }
});

describe('the two boundaries where a wall clock has no single meaning', () => {
  // Neither of these is a preference. They are what the two-pass resolution does, written
  // down so that changing it is a test failure instead of a silent change of behaviour.
  test('a time inside the spring-forward gap resolves past the jump', () => {
    const instant = zonedWallClockToUtcIso('2026-03-29T02:30', 'Europe/Rome');
    assert.equal(instant, '2026-03-29T01:30:00.000Z');
    // 02:30 does not exist that night; the clock reads 03:30 at the instant returned.
    assert.equal(wallClockInZone(instant, 'Europe/Rome'), '2026-03-29T03:30');
  });
  test('a time inside the autumn overlap resolves to the second occurrence', () => {
    const instant = zonedWallClockToUtcIso('2026-10-25T02:30', 'Europe/Rome');
    assert.equal(instant, '2026-10-25T01:30:00.000Z');
    assert.equal(wallClockInZone(instant, 'Europe/Rome'), '2026-10-25T02:30');
    // The first occurrence is an hour earlier and is NOT what this returns.
    assert.equal(wallClockInZone('2026-10-25T00:30:00.000Z', 'Europe/Rome'), '2026-10-25T02:30');
  });
});

describe('an unusable input is refused rather than guessed at', () => {
  test('an unknown zone throws instead of falling back to UTC', () => {
    assert.throws(() => zonedWallClockToUtcIso('2026-07-28T09:30', 'Mars/Olympus'), RangeError);
  });
  for (const bad of ['', 'tomorrow', '2026-07-28', '28/07/2026 09:30', null, undefined]) {
    test(`refuses ${JSON.stringify(bad)}`, () => {
      assert.throws(() => zonedWallClockToUtcIso(bad, 'UTC'), /Not a wall clock/);
    });
  }
});

describe('a stored value that carries no zone is recognised as such', () => {
  test('a bare wall clock is zoneless', () => {
    assert.equal(isZonelessInstant('2026-07-28T09:30'), true);
    assert.equal(isZonelessInstant('2026-07-28T09:30:00'), true);
  });
  test('an instant is not', () => {
    assert.equal(isZonelessInstant('2026-07-28T09:30:00.000Z'), false);
    assert.equal(isZonelessInstant('2026-07-28T09:30:00+02:00'), false);
    assert.equal(isZonelessInstant(null), false);
  });
});

describe('active and scheduled partition the queue · UI-062', () => {
  const NOW = Date.parse('2026-07-27T12:00:00.000Z');
  const task = (over) => ({ id: over.id, status: 'planned', recurrence: null, scheduledAt: null, updatedAt: '2026-07-27T10:00:00.000Z', ...over });

  test('finished work is in neither group', () => {
    assert.equal(classifyTask(task({ id: 'a', status: 'completed' }), NOW), 'finished');
    assert.equal(classifyTask(task({ id: 'b', status: 'cancelled' }), NOW), 'finished');
  });
  test('a recurrence rule makes a task scheduled', () => {
    assert.equal(classifyTask(task({ id: 'c', recurrence: 'FREQ=WEEKLY' }), NOW), 'scheduled');
  });
  test('a start still in the future makes a task scheduled', () => {
    assert.equal(classifyTask(task({ id: 'd', scheduledAt: '2026-07-27T18:00:00.000Z' }), NOW), 'scheduled');
  });
  test('a start already past does not', () => {
    assert.equal(classifyTask(task({ id: 'e', scheduledAt: '2026-07-27T06:00:00.000Z' }), NOW), 'active');
  });
  test('running outranks a rule: something happening now is not planned for later', () => {
    assert.equal(classifyTask(task({ id: 'f', status: 'running', recurrence: 'FREQ=DAILY' }), NOW), 'active');
  });
  test('every task lands in exactly one group', () => {
    const tasks = [
      task({ id: '1' }), task({ id: '2', status: 'running', recurrence: 'FREQ=DAILY' }),
      task({ id: '3', recurrence: 'FREQ=WEEKLY' }), task({ id: '4', status: 'completed' }),
      task({ id: '5', scheduledAt: '2026-07-27T18:00:00.000Z' }),
      task({ id: '6', scheduledAt: '2026-07-27T06:00:00.000Z' }),
    ];
    const { active, scheduled, finished } = splitTasks(tasks, NOW);
    const seen = [...active, ...scheduled, ...finished].map((item) => item.id).sort();
    assert.deepEqual(seen, ['1', '2', '3', '4', '5', '6']);
    assert.equal(active.length + scheduled.length + finished.length, tasks.length);
  });
  test('scheduled work is ordered soonest first, and a rule with no date sits last', () => {
    const { scheduled } = splitTasks([
      task({ id: 'later', scheduledAt: '2026-07-29T09:00:00.000Z' }),
      task({ id: 'ruleonly', recurrence: 'every Monday' }),
      task({ id: 'sooner', scheduledAt: '2026-07-28T09:00:00.000Z' }),
    ], NOW);
    assert.deepEqual(scheduled.map((item) => item.id), ['sooner', 'later', 'ruleonly']);
  });
});
