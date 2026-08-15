// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOURCE_TIERS, SUPPORTED_LOCALES, TimezoneService, formatInZone, isValidTimeZone,
  offsetMinutesAt, readHostTimeZone, resolveLocale, resolveTimeZone, toUtcIso,
} from '../src/timezone.mjs';
import { JsonStore } from '../src/store.mjs';
import { AuditLedger } from '../src/audit.mjs';
import { freshTempDir } from './support/workspace.mjs';

function workspace() { return freshTempDir('noesar-tz-'); }
function service(options = {}) {
  const root = workspace();
  const store = new JsonStore(join(root, 'state/state.json'));
  const ledger = new AuditLedger(join(root, 'audit/events.jsonl'));
  return {
    root, store, ledger,
    tz: new TimezoneService({
      store, ledger,
      env: options.env ?? {},
      hostReader: options.hostReader ?? (() => ({ zone: null, via: 'unavailable' })),
    }),
  };
}

test('IANA zone validation accepts real zones and rejects invented ones', () => {
  assert.equal(isValidTimeZone('Europe/Berlin'), true);
  assert.equal(isValidTimeZone('Europe/Rome'), true);
  assert.equal(isValidTimeZone('UTC'), true);
  assert.equal(isValidTimeZone('Not/AZone'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(null), false);
  assert.equal(isValidTimeZone('Europe/Berlin; rm -rf /'), false);
});

test('the resolution chain honours tier precedence 1 to 5', () => {
  const all = { manual: 'America/New_York', browser: 'Europe/Rome', host: 'Europe/Berlin', installer: 'Asia/Tokyo' };
  assert.equal(resolveTimeZone(all).sourceTier, SOURCE_TIERS.MANUAL);
  assert.equal(resolveTimeZone({ ...all, manual: null }).sourceTier, SOURCE_TIERS.BROWSER);
  assert.equal(resolveTimeZone({ ...all, manual: null, browser: null }).sourceTier, SOURCE_TIERS.HOST);
  assert.equal(resolveTimeZone({ installer: 'Asia/Tokyo' }).sourceTier, SOURCE_TIERS.INSTALLER);
  assert.equal(resolveTimeZone({}).sourceTier, SOURCE_TIERS.UTC_FALLBACK);
});

test('each tier can be forced in isolation and yields its own zone', () => {
  assert.equal(resolveTimeZone({ manual: 'America/New_York' }).effective, 'America/New_York');
  assert.equal(resolveTimeZone({ browser: 'Europe/Rome' }).effective, 'Europe/Rome');
  assert.equal(resolveTimeZone({ host: 'Europe/Berlin' }).effective, 'Europe/Berlin');
  assert.equal(resolveTimeZone({ installer: 'Asia/Tokyo' }).effective, 'Asia/Tokyo');
});

test('an invalid value at one tier falls through and is reported, not silently used', () => {
  const resolved = resolveTimeZone({ manual: 'Not/AZone', host: 'Europe/Berlin' });
  assert.equal(resolved.effective, 'Europe/Berlin');
  assert.equal(resolved.sourceTier, SOURCE_TIERS.HOST);
  assert.equal(resolved.rejected.length, 1);
  assert.equal(resolved.rejected[0].tier, SOURCE_TIERS.MANUAL);
});

test('with every tier unavailable the result is UTC and the warning surfaces', () => {
  const resolved = resolveTimeZone({});
  assert.equal(resolved.effective, 'UTC');
  assert.equal(resolved.sourceTier, SOURCE_TIERS.UTC_FALLBACK);
  assert.match(resolved.warning, /UTC/);
});

test('the host zone is read from the /etc/localtime symlink when /etc/timezone is absent', () => {
  const root = workspace();
  const localtime = join(root, 'localtime');
  symlinkSync('/usr/share/zoneinfo/Europe/Rome', localtime);
  const result = readHostTimeZone({ localtimePath: localtime, timezoneFilePath: join(root, 'does-not-exist') });
  assert.equal(result.zone, 'Europe/Rome');
  assert.equal(result.via, 'localtime-symlink');
});

test('this host really is readable that way (Unraid has no /etc/timezone)', () => {
  // Forced non-container reading: on the host itself /etc/localtime is the truth.
  const result = readHostTimeZone({ containerMarkerPath: '/definitely-not-present' });
  assert.ok(result.zone, 'the host timezone must resolve from /etc/localtime');
  assert.equal(isValidTimeZone(result.zone), true);
});

test('inside a container the image default must not shadow the installer TZ', () => {
  const root = workspace();
  const marker = join(root, 'dockerenv');
  writeFileSync(marker, '');
  const imageLocaltime = join(root, 'localtime');
  symlinkSync('/usr/share/zoneinfo/Etc/UTC', imageLocaltime);
  const result = readHostTimeZone({ localtimePath: imageLocaltime, containerMarkerPath: marker });
  assert.equal(result.zone, null, 'a container image default is not the host timezone');
  assert.equal(result.via, 'unavailable-in-container');
  // With tier 3 correctly unavailable, the installer TZ takes effect.
  const resolved = resolveTimeZone({ host: result.zone, installer: 'Europe/Berlin' });
  assert.equal(resolved.effective, 'Europe/Berlin');
  assert.equal(resolved.sourceTier, SOURCE_TIERS.INSTALLER);
});

test('a deliberately exposed host zoneinfo is honoured inside a container', () => {
  const root = workspace();
  const marker = join(root, 'dockerenv');
  writeFileSync(marker, '');
  const hostLocaltime = join(root, 'host-localtime');
  symlinkSync('/usr/share/zoneinfo/Europe/Rome', hostLocaltime);
  const result = readHostTimeZone({ containerMarkerPath: marker, hostLocaltimePath: hostLocaltime });
  assert.equal(result.zone, 'Europe/Rome');
});

test('/etc/timezone is still honoured where it exists', () => {
  const root = workspace();
  const timezoneFile = join(root, 'timezone');
  writeFileSync(timezoneFile, 'Asia/Tokyo\n');
  const result = readHostTimeZone({ localtimePath: join(root, 'absent'), timezoneFilePath: timezoneFile });
  assert.equal(result.zone, 'Asia/Tokyo');
  assert.equal(result.via, 'etc-timezone');
});

test('an unreadable host yields no zone rather than a guess', () => {
  const root = workspace();
  const result = readHostTimeZone({ localtimePath: join(root, 'absent'), timezoneFilePath: join(root, 'absent2') });
  assert.equal(result.zone, null);
  assert.equal(result.via, 'unavailable');
});

test('storage is UTC with an explicit Z and no offset', () => {
  const stored = toUtcIso(Date.UTC(2026, 6, 25, 6, 5, 0));
  assert.equal(stored, '2026-07-25T06:05:00.000Z');
  assert.ok(stored.endsWith('Z'));
  assert.ok(!/[+-]\d{2}:\d{2}$/.test(stored));
});

test('a record written at 08:05 local in Europe/Berlin is stored as 06:05Z', () => {
  // Same instant, expressed with an offset. Storage must normalise it.
  const stored = toUtcIso('2026-07-25T08:05:00+02:00');
  assert.equal(stored, '2026-07-25T06:05:00.000Z');
  assert.equal(formatInZone(stored, 'Europe/Berlin').includes('08:05:00'), true);
});

test('DST is resolved from the zone database, not by arithmetic', () => {
  assert.equal(offsetMinutesAt(Date.parse('2026-01-15T12:00:00Z'), 'Europe/Berlin'), 60);
  assert.equal(offsetMinutesAt(Date.parse('2026-07-15T12:00:00Z'), 'Europe/Berlin'), 120);
});

test('the skipped local hour of the spring transition is handled', () => {
  // 2026-03-29: 02:00 local never occurs in Europe/Berlin.
  const before = Date.parse('2026-03-29T00:30:00Z');
  const after = Date.parse('2026-03-29T01:30:00Z');
  assert.equal(offsetMinutesAt(before, 'Europe/Berlin'), 60);
  assert.equal(offsetMinutesAt(after, 'Europe/Berlin'), 120);
  assert.ok(formatInZone(before, 'Europe/Berlin').includes('01:30:00'));
  assert.ok(formatInZone(after, 'Europe/Berlin').includes('03:30:00'));
});

test('the duplicated local hour of the autumn transition renders the same wall clock twice', () => {
  // 2026-10-25: 02:30 local occurs twice in Europe/Berlin, an hour apart in UTC.
  const first = Date.parse('2026-10-25T00:30:00Z');
  const second = Date.parse('2026-10-25T01:30:00Z');
  assert.equal(offsetMinutesAt(first, 'Europe/Berlin'), 120);
  assert.equal(offsetMinutesAt(second, 'Europe/Berlin'), 60);
  assert.ok(formatInZone(first, 'Europe/Berlin').includes('02:30:00'));
  assert.ok(formatInZone(second, 'Europe/Berlin').includes('02:30:00'));
  assert.notEqual(first, second, 'the stored instants stay distinct even though they render alike');
});

test('a user override wins over the host and is persisted', () => {
  const { tz } = service({ hostReader: () => ({ zone: 'Europe/Berlin', via: 'localtime-symlink' }) });
  assert.equal(tz.effectiveFor('u1').effective, 'Europe/Berlin');
  tz.setUserTimezone('u1', 'Europe/Rome');
  assert.equal(tz.effectiveFor('u1').effective, 'Europe/Rome');
  assert.equal(tz.effectiveFor('u1').sourceTier, SOURCE_TIERS.MANUAL);
  assert.equal(tz.effectiveFor('u2').effective, 'Europe/Berlin', 'other users are unaffected');
});

test('an invalid override is rejected and the effective zone is unchanged', () => {
  const { tz } = service({ hostReader: () => ({ zone: 'Europe/Berlin', via: 'localtime-symlink' }) });
  assert.throws(() => tz.setUserTimezone('u1', 'Not/AZone'), /Unknown IANA timezone/);
  assert.equal(tz.effectiveFor('u1').effective, 'Europe/Berlin');
});

test('the browser zone is recorded as a suggestion and never applied silently', () => {
  const { tz } = service({ hostReader: () => ({ zone: 'Europe/Berlin', via: 'localtime-symlink' }) });
  const recorded = tz.recordBrowserTimezone('u1', 'Europe/Rome');
  assert.equal(recorded.recorded, true);
  assert.equal(recorded.applied, false);
  const effective = tz.effectiveFor('u1');
  assert.equal(effective.effective, 'Europe/Berlin', 'the browser must not change the effective zone by itself');
  assert.equal(effective.browserReported, 'Europe/Rome');
  assert.equal(effective.mismatch, true);
});

test('accepting the browser suggestion clears the mismatch', () => {
  const { tz } = service({ hostReader: () => ({ zone: 'Europe/Berlin', via: 'localtime-symlink' }) });
  tz.recordBrowserTimezone('u1', 'Europe/Rome');
  tz.setUserTimezone('u1', 'Europe/Rome');
  assert.equal(tz.effectiveFor('u1').mismatch, false);
});

test('changing the timezone writes an audit entry carrying the source tier', () => {
  const { tz, ledger } = service({ hostReader: () => ({ zone: 'Europe/Berlin', via: 'localtime-symlink' }) });
  tz.setUserTimezone('u1', 'Europe/Rome', { actorId: 'owner-1' });
  const events = ledger.readAll().filter((event) => event.action === 'settings.timezone-changed');
  assert.equal(events.length, 1);
  assert.equal(events[0].actor, 'owner-1');
  assert.equal(events[0].details.oldZone, 'Europe/Berlin');
  assert.equal(events[0].details.newZone, 'Europe/Rome');
  assert.equal(events[0].details.sourceTier, SOURCE_TIERS.MANUAL);
  assert.ok(events[0].details.utcTimestamp.endsWith('Z'));
  assert.equal(ledger.verify(), true);
});

test('the server default is recorded separately from user overrides', () => {
  const { tz, ledger } = service({ env: { TZ: 'Asia/Tokyo' } });
  assert.equal(tz.serverDefault().effective, 'Asia/Tokyo');
  assert.equal(tz.serverDefault().sourceTier, SOURCE_TIERS.INSTALLER);
  tz.setServerTimezone('Europe/Lisbon', { actorId: 'owner-1' });
  assert.equal(tz.serverDefault().effective, 'Europe/Lisbon');
  const events = ledger.readAll().filter((event) => event.details?.scope === 'server');
  assert.equal(events.length, 1);
});

test('installer TZ is used when the host cannot be read', () => {
  const { tz } = service({ env: { TZ: 'Asia/Tokyo' } });
  const effective = tz.effectiveFor('u1');
  assert.equal(effective.effective, 'Asia/Tokyo');
  assert.equal(effective.sourceTier, SOURCE_TIERS.INSTALLER);
});

test('with no host and no installer TZ the user falls back to UTC with a warning', () => {
  const { tz } = service({});
  const effective = tz.effectiveFor('u1');
  assert.equal(effective.effective, 'UTC');
  assert.equal(effective.sourceTier, SOURCE_TIERS.UTC_FALLBACK);
  assert.match(effective.warning, /UTC/);
});

test('locale detection follows Accept-Language and honours quality values', () => {
  assert.equal(resolveLocale({ acceptLanguage: 'it-IT,it;q=0.9,en;q=0.8' }).effective, 'it');
  assert.equal(resolveLocale({ acceptLanguage: 'en-GB,en;q=0.9' }).effective, 'en');
  assert.equal(resolveLocale({ acceptLanguage: 'de-DE,de;q=0.9' }).effective, 'en');
  assert.equal(resolveLocale({ acceptLanguage: 'de;q=0.9,it;q=0.95' }).effective, 'it');
  assert.equal(resolveLocale({}).effective, 'en');
  assert.equal(resolveLocale({}).source, 'fallback');
});

test('a manual locale override always wins', () => {
  assert.equal(resolveLocale({ manual: 'it', acceptLanguage: 'en-GB' }).effective, 'it');
  assert.equal(resolveLocale({ manual: 'de', acceptLanguage: 'it' }).effective, 'it', 'an unsupported override is ignored');
});

test('locale and timezone are independent: English UI with Europe/Rome is valid', () => {
  const { tz } = service({ hostReader: () => ({ zone: 'Europe/Berlin', via: 'localtime-symlink' }) });
  tz.setUserTimezone('u1', 'Europe/Rome');
  tz.setUserLocale('u1', 'en');
  assert.equal(tz.effectiveFor('u1').effective, 'Europe/Rome');
  assert.equal(tz.localeFor('u1', 'it-IT').effective, 'en');
});

test('a locale change is audited', () => {
  const { tz, ledger } = service({});
  tz.setUserLocale('u1', 'it', { actorId: 'owner-1' });
  const events = ledger.readAll().filter((event) => event.action === 'settings.locale-changed');
  assert.equal(events.length, 1);
  assert.equal(events[0].details.newLocale, 'it');
  assert.deepEqual(SUPPORTED_LOCALES, ['en', 'it']);
});

test('no code path infers the timezone from IP or GPS', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/timezone.mjs', import.meta.url)), 'utf8');
  // The module may *declare* `geolocation: 'never-used'`; what it must not do is
  // call a positioning or IP-lookup API, or reach the network at all.
  for (const forbidden of ['getCurrentPosition', 'navigator.geolocation', 'geoip', 'ipapi', 'ip-api',
    'maxmind', 'ipinfo', 'fetch(', 'http.request', 'https.request', 'node:http', 'node:net', 'node:dns']) {
    assert.ok(!source.includes(forbidden), `timezone resolution must not reference ${forbidden}`);
  }
  const { tz } = service({ hostReader: () => ({ zone: 'Europe/Berlin', via: 'localtime-symlink' }) });
  assert.equal(tz.effectiveFor('u1').geolocation, 'never-used');
});
