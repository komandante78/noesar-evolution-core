// SPDX-License-Identifier: AGPL-3.0-or-later
const RULES = Object.freeze([
  ['bearer_token', /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, '[REDACTED_BEARER_TOKEN]'],
  ['api_key', /\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]'],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]'],
  ['credit_card', /\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_PAYMENT_NUMBER]'],
  ['ipv4', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]'],
  ['phone', /(?<!\w)(?:\+?\d[\d .()-]{7,}\d)(?!\w)/g, '[REDACTED_PHONE]'],
]);

// A canonical UUID is an identifier: never a phone number, never a payment card, never an
// address. Before this guard existed the phone rule matched inside one — "…-2822-4650-…"
// is nine characters of digits and hyphens — and rewrote the middle of it, at a measured
// rate of 6.75% of all UUIDs. The consequences were not cosmetic: correlation ids exist so
// that a user-visible failure can be found in the log, incident ids tie a debug bundle to
// the incident that produced it, and roughly one record in fifteen had one that no longer
// matched anything. It also caused an intermittent test failure that Phase 4 observed once,
// could not reproduce, and attributed to a timing race in two unrelated files.
//
// So UUIDs are lifted out before any rule runs and put back afterwards. Redaction still
// applies to everything around them.
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// NUL-delimited and letter-led on purpose: every rule below either needs a word boundary
// before a digit, an "@", or a dot, and "PLACEHOLDER<n>" offers none of them — the digits
// of the index are preceded by a word character, so the phone and payment rules cannot
// anchor on them.
const PLACEHOLDER_PREFIX = '\u0000NOESAR_UUID_PLACEHOLDER';
const PLACEHOLDER_PATTERN = /\u0000NOESAR_UUID_PLACEHOLDER(\d+)\u0000/g;

export function redactText(value) {
  // Strip U+0000 before anything else. The placeholder below is NUL-delimited, and a NUL
  // in attacker-controlled text — a JSON string may encode one — would otherwise let that
  // text forge a placeholder and be substituted with a UUID lifted from elsewhere in the
  // same value, or with "undefined" when the index is out of range. A control character
  // has no business in a log line in the first place, so removing it costs nothing.
  let text = String(value ?? '').replace(/\u0000/g, '');
  const preservedUuids = [];
  text = text.replace(UUID_PATTERN, (match) => {
    preservedUuids.push(match);
    return `${PLACEHOLDER_PREFIX}${preservedUuids.length - 1}\u0000`;
  });
  const counts = {};
  for (const [name, pattern, replacement] of RULES) {
    let count = 0;
    text = text.replace(pattern, (match) => {
      if (name === 'credit_card') {
        const digits = match.replace(/\D/g, '');
        if (digits.length < 13 || digits.length > 19) return match;
      }
      count += 1;
      return replacement;
    });
    if (count) counts[name] = count;
  }
  text = text.replace(PLACEHOLDER_PATTERN, (_match, index) => preservedUuids[Number(index)]);
  return { text, counts, replacements:Object.values(counts).reduce((sum, count) => sum + count, 0) };
}

export function redactMessages(messages) {
  const aggregate = {};
  const redacted = messages.map((message) => {
    if (typeof message.content !== 'string') return message;
    const result = redactText(message.content);
    for (const [name, count] of Object.entries(result.counts)) aggregate[name] = (aggregate[name] ?? 0) + count;
    return { ...message, content:result.text };
  });
  return { messages:redacted, counts:aggregate, replacements:Object.values(aggregate).reduce((sum, count) => sum + count, 0) };
}
