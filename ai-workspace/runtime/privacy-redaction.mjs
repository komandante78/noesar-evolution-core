// SPDX-License-Identifier: AGPL-3.0-or-later
const RULES = Object.freeze([
  ['bearer_token', /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, '[REDACTED_BEARER_TOKEN]'],
  ['api_key', /\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]'],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]'],
  ['credit_card', /\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_PAYMENT_NUMBER]'],
  ['phone', /(?<!\w)(?:\+?\d[\d .()-]{7,}\d)(?!\w)/g, '[REDACTED_PHONE]'],
  ['ipv4', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]'],
]);

export function redactText(value) {
  let text = String(value ?? '');
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
