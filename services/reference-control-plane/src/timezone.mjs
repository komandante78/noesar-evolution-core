// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Timezone resolution and locale selection.
//
// Two rules are absolute:
//   - Every stored timestamp is UTC with an explicit `Z`. Timezone is a
//     presentation concern; conversion happens at render time, never on write.
//   - Timezone is never inferred from an IP address or from GPS. The resolution
//     chain below is the only permitted source.
import { existsSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';

export const SOURCE_TIERS = Object.freeze({
  MANUAL: 1,
  BROWSER: 2,
  HOST: 3,
  INSTALLER: 4,
  UTC_FALLBACK: 5,
});

export const TIER_NAMES = Object.freeze({
  1: 'manual-override',
  2: 'browser-reported',
  3: 'host-operating-system',
  4: 'installer-tz',
  5: 'utc-fallback',
});

export const SUPPORTED_LOCALES = Object.freeze(['en', 'it']);
export const FALLBACK_LOCALE = 'en';

/** True when the runtime's IANA database recognises this zone name. */
export function isValidTimeZone(zone) {
  const name = String(zone ?? '').trim();
  if (!name) return false;
  // Reject anything that is not a plain zone identifier before handing it to Intl.
  if (!/^[A-Za-z0-9+_-]+(?:\/[A-Za-z0-9+_.-]+){0,2}$/.test(name)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch { return false; }
}

/**
 * Read the operating system timezone.
 *
 * Unraid ships `/etc/localtime` as a symlink into the zoneinfo tree and has **no**
 * `/etc/timezone`. Reading the symlink target is therefore mandatory: an
 * implementation that only reads `/etc/timezone` silently falls through to a lower
 * tier on this host.
 */
export function readHostTimeZone({
  localtimePath = '/etc/localtime',
  timezoneFilePath = '/etc/timezone',
  containerMarkerPath = '/.dockerenv',
  hostLocaltimePath = process.env.NOESAR_HOST_LOCALTIME ?? null,
} = {}) {
  // Inside a container, /etc/localtime describes the *image*, not the host: on this
  // deployment it is Etc/UTC regardless of what the host is set to. Reading it would
  // make tier 3 shadow the installer's explicit TZ with an image default — the
  // operator's setting would be silently ignored. So when containerised, tier 3 is
  // only available if the host zoneinfo was deliberately exposed.
  if (existsSync(containerMarkerPath) && !hostLocaltimePath) {
    return { zone: null, via: 'unavailable-in-container' };
  }
  if (hostLocaltimePath) localtimePath = hostLocaltimePath;
  const fromLink = (target) => {
    const match = String(target).match(/zoneinfo\/(?:posix\/|right\/)?(.+)$/);
    if (!match) return null;
    const zone = match[1].replace(/^\/+/, '');
    return isValidTimeZone(zone) ? zone : null;
  };
  try {
    const zone = fromLink(readlinkSync(localtimePath));
    if (zone) return { zone, via: 'localtime-symlink' };
  } catch { /* not a symlink, or absent; fall through */ }
  try {
    const zone = fromLink(realpathSync(localtimePath));
    if (zone) return { zone, via: 'localtime-realpath' };
  } catch { /* unreadable */ }
  try {
    const zone = readFileSync(timezoneFilePath, 'utf8').trim();
    if (isValidTimeZone(zone)) return { zone, via: 'etc-timezone' };
  } catch { /* absent, which is normal on Unraid */ }
  return { zone: null, via: 'unavailable' };
}

/**
 * Resolve the effective zone through the fixed chain. The first tier that yields a
 * valid IANA zone wins; UTC is the last resort and always carries a warning.
 */
export function resolveTimeZone({ manual = null, browser = null, host = null, installer = null } = {}) {
  const candidates = [
    [SOURCE_TIERS.MANUAL, manual],
    [SOURCE_TIERS.BROWSER, browser],
    [SOURCE_TIERS.HOST, host],
    [SOURCE_TIERS.INSTALLER, installer],
  ];
  const rejected = [];
  for (const [tier, value] of candidates) {
    if (value === null || value === undefined || String(value).trim() === '') continue;
    if (isValidTimeZone(value)) {
      return { effective: String(value).trim(), sourceTier: tier, source: TIER_NAMES[tier], warning: null, rejected };
    }
    rejected.push({ tier, source: TIER_NAMES[tier], value: String(value).slice(0, 64), reason: 'not a valid IANA timezone' });
  }
  return {
    effective: 'UTC',
    sourceTier: SOURCE_TIERS.UTC_FALLBACK,
    source: TIER_NAMES[SOURCE_TIERS.UTC_FALLBACK],
    warning: 'No timezone could be resolved from the user, browser, host or installer. Times are shown in UTC.',
    rejected,
  };
}

/** Canonical storage form: UTC, ISO-8601, explicit Z, millisecond precision. */
export function toUtcIso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error('Invalid instant.'), { status: 400 });
  return date.toISOString();
}

/** Offset in minutes east of UTC for a given instant in a given zone. */
export function offsetMinutesAt(instant, zone) {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== 'literal') accumulator[part.type] = part.value;
    return accumulator;
  }, {});
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(hour), Number(parts.minute), Number(parts.second),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Render a stored UTC instant for display. Never used to compute a stored value. */
export function formatInZone(instant, zone, locale = FALLBACK_LOCALE) {
  const date = instant instanceof Date ? instant : new Date(instant);
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone, hour12: false, timeZoneName: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}

/** Locale negotiation: manual override wins, then Accept-Language, then English. */
export function resolveLocale({ manual = null, acceptLanguage = null, supported = SUPPORTED_LOCALES } = {}) {
  const list = supported.map((value) => value.toLowerCase());
  if (manual && list.includes(String(manual).toLowerCase())) {
    return { effective: String(manual).toLowerCase(), source: 'manual-override', supported: [...supported] };
  }
  const ranked = String(acceptLanguage ?? '')
    .split(',')
    .map((entry) => {
      const [tag, ...parameters] = entry.trim().split(';');
      const quality = parameters.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: quality ? Number(quality.slice(2)) : 1 };
    })
    .filter((entry) => entry.tag && !Number.isNaN(entry.q) && entry.q > 0)
    .sort((left, right) => right.q - left.q);
  for (const entry of ranked) {
    if (list.includes(entry.tag)) return { effective: entry.tag, source: 'accept-language', supported: [...supported] };
    const base = entry.tag.split('-')[0];
    if (list.includes(base)) return { effective: base, source: 'accept-language', supported: [...supported] };
  }
  return { effective: FALLBACK_LOCALE, source: 'fallback', supported: [...supported] };
}

/**
 * Timezone and locale state for the installation and per user.
 *
 * State lives in the injected store so it is persisted with the rest of the
 * workspace; every effective change is written to the audit ledger with its
 * source tier, because a shift in how timestamps render must be explainable
 * afterwards.
 */
export class TimezoneService {
  constructor({ store, ledger = null, env = process.env, hostReader = readHostTimeZone, logger = null } = {}) {
    this.store = store;
    this.ledger = ledger;
    this.logger = logger;
    this.installerZone = env.TZ ?? null;
    this.host = hostReader();
  }

  #settings() {
    const state = this.store.read();
    const settings = state.settings ?? {};
    return {
      serverTimezone: settings.serverTimezone ?? null,
      userTimezones: settings.userTimezones ?? {},
      userLocales: settings.userLocales ?? {},
      browserTimezones: settings.browserTimezones ?? {},
    };
  }

  #mutate(apply) {
    const state = this.store.read();
    state.settings = state.settings ?? {};
    apply(state.settings);
    this.store.write(state);
  }

  /** What the installation resolves to when no user override applies. */
  serverDefault() {
    const settings = this.#settings();
    return resolveTimeZone({
      manual: settings.serverTimezone,
      browser: null,
      host: this.host.zone,
      installer: this.installerZone,
    });
  }

  /** Effective zone for one user, including the browser-reported suggestion. */
  effectiveFor(userId) {
    const settings = this.#settings();
    const manual = settings.userTimezones[userId] ?? settings.serverTimezone ?? null;
    const browserReported = settings.browserTimezones[userId] ?? null;
    const resolved = resolveTimeZone({
      manual,
      browser: null, // the browser value is a suggestion, never applied silently
      host: this.host.zone,
      installer: this.installerZone,
    });
    const serverDefault = this.serverDefault();
    return {
      ...resolved,
      serverDefault: serverDefault.effective,
      serverDefaultTier: serverDefault.sourceTier,
      browserReported,
      // A user reading timestamps in an unexpected zone is a correctness problem,
      // so a mismatch is surfaced rather than silently resolved either way.
      mismatch: Boolean(browserReported && browserReported !== resolved.effective),
      hostSource: this.host.via,
      installerTimezone: this.installerZone,
      geolocation: 'never-used',
      utcNow: toUtcIso(),
      offsetMinutes: offsetMinutesAt(Date.now(), resolved.effective),
    };
  }

  /** Record what the browser reported. Stored as a suggestion only. */
  recordBrowserTimezone(userId, zone) {
    if (!isValidTimeZone(zone)) return { recorded: false, reason: 'not a valid IANA timezone' };
    this.#mutate((settings) => {
      settings.browserTimezones = settings.browserTimezones ?? {};
      settings.browserTimezones[userId] = String(zone).trim();
    });
    return { recorded: true, browserReported: String(zone).trim(), applied: false };
  }

  setUserTimezone(userId, zone, { actorId = userId } = {}) {
    if (!isValidTimeZone(zone)) throw Object.assign(new Error('Unknown IANA timezone.'), { status: 400 });
    const previous = this.effectiveFor(userId);
    this.#mutate((settings) => {
      settings.userTimezones = settings.userTimezones ?? {};
      settings.userTimezones[userId] = String(zone).trim();
    });
    const next = this.effectiveFor(userId);
    this.#audit({ actorId, scope: 'user', subject: userId, previous, next });
    return next;
  }

  clearUserTimezone(userId, { actorId = userId } = {}) {
    const previous = this.effectiveFor(userId);
    this.#mutate((settings) => {
      if (settings.userTimezones) delete settings.userTimezones[userId];
    });
    const next = this.effectiveFor(userId);
    this.#audit({ actorId, scope: 'user', subject: userId, previous, next });
    return next;
  }

  setServerTimezone(zone, { actorId = 'system' } = {}) {
    if (!isValidTimeZone(zone)) throw Object.assign(new Error('Unknown IANA timezone.'), { status: 400 });
    const previous = this.serverDefault();
    this.#mutate((settings) => { settings.serverTimezone = String(zone).trim(); });
    const next = this.serverDefault();
    this.#audit({ actorId, scope: 'server', subject: 'installation', previous, next });
    return next;
  }

  localeFor(userId, acceptLanguage) {
    const settings = this.#settings();
    return resolveLocale({ manual: settings.userLocales[userId] ?? null, acceptLanguage });
  }

  setUserLocale(userId, locale, { actorId = userId } = {}) {
    const normalized = String(locale ?? '').toLowerCase();
    if (!SUPPORTED_LOCALES.includes(normalized)) throw Object.assign(new Error('Unsupported locale.'), { status: 400 });
    const previous = this.localeFor(userId, null);
    this.#mutate((settings) => {
      settings.userLocales = settings.userLocales ?? {};
      settings.userLocales[userId] = normalized;
    });
    const next = this.localeFor(userId, null);
    this.ledger?.append({
      actor: actorId, action: 'settings.locale-changed', result: 'success',
      details: { userId, oldLocale: previous.effective, newLocale: next.effective, utcTimestamp: toUtcIso() },
    });
    return next;
  }

  #audit({ actorId, scope, subject, previous, next }) {
    if (previous.effective === next.effective && previous.sourceTier === next.sourceTier) return;
    this.ledger?.append({
      actor: actorId,
      action: 'settings.timezone-changed',
      result: 'success',
      details: {
        scope, subject,
        oldZone: previous.effective, newZone: next.effective,
        sourceTier: next.sourceTier, sourceName: TIER_NAMES[next.sourceTier],
        utcTimestamp: toUtcIso(),
      },
    });
    this.logger?.info('settings.timezone.changed', {
      component: 'timezone', scope, old_zone: previous.effective, new_zone: next.effective, source_tier: next.sourceTier,
    });
  }
}
