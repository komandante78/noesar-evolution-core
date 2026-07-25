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
