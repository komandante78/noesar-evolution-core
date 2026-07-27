// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scheduling arithmetic for the initial screen · UI-062.
//
// It lives in its own module for the same reason the colour arithmetic does: it must be
// testable without a browser. And it must be tested, because it repairs a defect that
// reading the code does not show and clicking through the interface shows only if the
// reader happens to sit in a zone other than the server's.
//
// The defect: `<input type="datetime-local">` yields a WALL CLOCK with no zone —
// "2026-07-28T09:30". The interface sent that string as-is, and the control plane resolved
// it with `new Date(value)`, which for a date-time form without an offset means "local
// time of whichever process is parsing". That process is the container, running UTC. So a
// person in Europe/Rome asking for 09:30 stored 09:30Z, which is 11:30 to them — and the
// panel then re-rendered it in their effective zone, so the interface disagreed with the
// person about the time the person had just typed. Two hours of drift, silently, in the
// one panel whose whole subject is when something happens.
//
// The repair is to resolve the wall clock HERE, against the effective zone, and send an
// instant. An instant has one meaning everywhere; a wall clock has as many as there are
// zones.

/**
 * Offset of `zone` from UTC at a given instant, in milliseconds.
 *
 * Derived by asking Intl what the wall clock reads in that zone at that instant, then
 * asking how far that wall clock is from the instant itself. `hourCycle:'h23'` is not
 * decoration: with `hour12:false` some locales render midnight as hour "24", and a
 * modulo left as an exercise for the reader is a bug waiting for a specific date.
 */
export function zoneOffsetMs(instant, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const field = {};
  for (const part of parts) if (part.type !== 'literal') field[part.type] = part.value;
  const asIfUtc = Date.UTC(
    Number(field.year), Number(field.month) - 1, Number(field.day),
    Number(field.hour), Number(field.minute), Number(field.second),
  );
  return asIfUtc - instant.getTime();
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * A wall clock plus a named zone becomes an instant.
 *
 * Two passes, and the second one is the whole point. The offset depends on the instant,
 * and the instant is what we are solving for, so the first pass uses the offset in force
 * at the wrong moment. On any ordinary day the two agree and the second pass changes
 * nothing; across a daylight-saving boundary the first pass lands on the far side of the
 * transition and the second corrects it.
 *
 * Two boundary cases have no honest answer. They are MEASURED and written down here, not
 * assumed — the first draft of this comment claimed the opposite of what the second case
 * actually does, which is how a comment becomes the least reliable file in a repository:
 *   · a wall clock inside a spring-forward GAP never happens in that zone. Europe/Rome
 *     2026-03-29T02:30 returns 01:30Z, which reads 03:30 locally — the instant the clock
 *     reaches once it has jumped.
 *   · a wall clock inside an autumn-fallback OVERLAP happens twice. Europe/Rome
 *     2026-10-25T02:30 returns 01:30Z, the SECOND of the two — the one after the clocks
 *     go back, not the first.
 * Both are stable and both are covered by a test, so a change of behaviour is a failure
 * rather than a surprise.
 */
export function zonedWallClockToUtcIso(wallClock, zone) {
  const match = WALL_CLOCK.exec(String(wallClock ?? '').trim());
  if (!match) throw new Error(`Not a wall clock: ${wallClock}`);
  // Throws RangeError on an unknown zone, which the caller must handle: falling back
  // silently would reintroduce the very ambiguity this function exists to remove.
  new Intl.DateTimeFormat('en-CA', { timeZone: zone });
  const naiveUtcMs = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), match[6] ? Number(match[6]) : 0,
  );
  let instantMs = naiveUtcMs - zoneOffsetMs(new Date(naiveUtcMs), zone);
  instantMs = naiveUtcMs - zoneOffsetMs(new Date(instantMs), zone);
  return new Date(instantMs).toISOString();
}

/** The inverse, used to prefill a `datetime-local` and to check the round trip. */
export function wallClockInZone(instant, zone) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const field = {};
  for (const part of parts) if (part.type !== 'literal') field[part.type] = part.value;
  return `${field.year}-${field.month}-${field.day}T${field.hour}:${field.minute}`;
}

/**
 * Does this stored value carry a zone of its own?
 *
 * A record written before the repair above holds a string the server resolved against
 * its own clock, and no amount of reading it tells you what the person meant. The
 * interface marks such a value rather than rendering it as if it were precise: a time
 * shown without a qualification is a promise that it is the right time.
 */
export function isZonelessInstant(value) {
  if (typeof value !== 'string') return false;
  return WALL_CLOCK.test(value.trim());
}

/**
 * Which of the two groups on the initial screen a task belongs to · UI-062.
 *
 * The criterion asks for active and scheduled work in ONE place, so the two must partition
 * rather than overlap: a task listed twice is a task counted twice, and a person reading a
 * queue counts it. The rule, stated here and stated again on the panel so it cannot be
 * misread: work that has finished is in neither group; work that carries a recurrence rule
 * or a start still in the future is scheduled; everything else that is not finished is
 * active. `running` outranks a rule, because something happening now is not something
 * planned for later.
 */
export function classifyTask(task, nowMs = Date.now()) {
  const status = String(task?.status ?? '');
  if (status === 'completed' || status === 'cancelled') return 'finished';
  if (status === 'running') return 'active';
  const rule = String(task?.recurrence ?? '').trim();
  if (rule) return 'scheduled';
  const startsAt = task?.scheduledAt ? new Date(task.scheduledAt).getTime() : Number.NaN;
  if (!Number.isNaN(startsAt) && startsAt > nowMs) return 'scheduled';
  return 'active';
}

/** Both groups, each in the order a reader wants: soonest first, newest first. */
export function splitTasks(tasks, nowMs = Date.now()) {
  const active = [];
  const scheduled = [];
  const finished = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const group = classifyTask(task, nowMs);
    if (group === 'scheduled') scheduled.push(task);
    else if (group === 'active') active.push(task);
    else finished.push(task);
  }
  const key = (task) => {
    const value = task?.scheduledAt ? new Date(task.scheduledAt).getTime() : Number.NaN;
    return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
  };
  scheduled.sort((a, b) => key(a) - key(b));
  active.sort((a, b) => String(b?.updatedAt ?? '').localeCompare(String(a?.updatedAt ?? '')));
  return { active, scheduled, finished };
}
