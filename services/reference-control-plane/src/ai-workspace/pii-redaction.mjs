// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Zero-dependency, identifiers-only redaction: codice fiscale, IBAN, email, phone. Owner
// decision, 2026-09-08: names and addresses are NOT covered here (no fixed pattern to match
// without a model or a third-party library, and this project has never carried a runtime
// dependency) — the UI must say so, not imply broader coverage than this actually gives.
//
// Order matters: codice fiscale must run before a looser IBAN-shaped match could ever
// misfire on it, and email before phone so an address's digits are never read as a number.
const PATTERNS = [
  { type: 'CODICE_FISCALE', placeholder: '[CODICE_FISCALE]',
    re: /\b[A-Za-z]{6}\d{2}[A-Za-z]\d{2}[A-Za-z]\d{3}[A-Za-z]\b/g },
  { type: 'EMAIL', placeholder: '[EMAIL]',
    re: /\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b/g },
  { type: 'IBAN', placeholder: '[IBAN]',
    re: /\b[A-Za-z]{2}\d{2}[ ]?[A-Za-z0-9]{4}(?:[ ]?[A-Za-z0-9]{4}){2,6}[ ]?[A-Za-z0-9]{1,4}\b/g },
  { type: 'TELEFONO', placeholder: '[TELEFONO]',
    re: /\b(?:\+39[ ]?)?(?:3\d{2}[ .-]?\d{6,7}|0\d{1,3}[ .-]?\d{5,8})\b/g },
];

export function redactIdentifiers(text) {
  let redacted = String(text ?? '');
  const types = new Set();
  let count = 0;
  for (const { type, placeholder, re } of PATTERNS) {
    redacted = redacted.replace(re, (match) => {
      types.add(type);
      count += 1;
      return placeholder;
    });
  }
  return { redacted, types: [...types], count, piiFound: count > 0 };
}
