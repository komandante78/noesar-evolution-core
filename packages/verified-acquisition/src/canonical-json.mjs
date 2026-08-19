// SPDX-License-Identifier: AGPL-3.0-or-later

export function canonicalJson(value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonical JSON rejects non-finite numbers');
    }
    if (Object.is(value, -0)) return '0';
    return JSON.stringify(value);
  }

  if (typeof value === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (typeof value === 'object') {
    // `D-0548`. A class instance is not a JSON object, and encoding one by its own enumerable
    // properties is silent data loss at the worst possible moment: `new Date(0)` has none, so it
    // encoded as `{}` and a publisher would have signed an empty object where they wrote a
    // timestamp. The signature would be valid over bytes that mean nothing they intended.
    // `undefined` and `bigint` already threw; this closes the same hole for objects.
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`canonical JSON rejects ${value.constructor?.name ?? 'a non-plain object'}: only plain objects, arrays, strings, finite numbers, booleans and null are JSON values`);
    }
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }

  throw new TypeError(`canonical JSON rejects ${typeof value}`);
}

export function canonicalJsonBytes(value) {
  return Buffer.from(canonicalJson(value), 'utf8');
}
