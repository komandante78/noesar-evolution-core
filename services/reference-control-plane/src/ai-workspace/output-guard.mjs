// SPDX-License-Identifier: AGPL-3.0-or-later
//
// No stray Chinese in an Italian answer.
//
// A small local model that writes Italian sometimes writes one Chinese word in the middle of a sentence ("Ecco un primo
// 草稿"). Measured on 2026-10-08 against the real 7B (Qwen2.5 7B, 4-bit), the product's own prompt for a person, 36 drafts:
// 4 of them had it. Four remedies on the PROMPT side changed nothing (a sentence saying "only Italian", a lower temperature,
// no opening line, all together: 3, 3, 6, 4 of 24 against 4 of 24). Forbidding the characters at the OUTPUT did: 0 of 36, at
// the same speed (35 tokens a second with four requests at once).
//
// llama.cpp takes a GBNF grammar with the request. This one forbids the Chinese, Japanese and Korean characters (and the
// full-width forms that come with them) and nothing else, so every Latin letter, accent, digit, punctuation mark and emoji is
// as free as before.
//
// When it is NOT sent: when the page's language is written in another script (the person reads Chinese, Russian, Arabic…);
// when the person's own message contains those characters or asks for Chinese, Japanese or Korean (a translation is a
// request for exactly the characters this forbids); when the turn offers tools (a tool call has its own grammar). And the
// gateway only puts it on the request of a llama.cpp server — the product's own runtime, or one the person connected under
// the name "llama.cpp" — because any other endpoint may refuse an unknown field.

// Kana, CJK ideographs, Hangul syllables, and the full-width forms that come with them.
const RANGES = [[0x3040, 0x30ff], [0x3400, 0x9fff], [0xac00, 0xd7af], [0xff00, 0xffef]];
const FORBIDDEN = RANGES.map(([from, to]) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`).join('');

// Languages whose own script is not Latin: for these the answer legitimately contains other characters, and the guard has
// no opinion. An unknown or missing language is treated the same way: no guard.
const OTHER_SCRIPTS = new Set(['zh', 'ja', 'ko', 'ru', 'uk', 'bg', 'sr', 'mk', 'be', 'kk', 'mn', 'ar', 'fa', 'ur', 'he', 'yi', 'th', 'lo', 'km', 'my', 'hi', 'bn', 'ta', 'te', 'ne', 'si', 'el', 'ka', 'hy']);

const ASKS_FOR_THEM = new RegExp(`[${FORBIDDEN}]|\\b(cines[ei]|chinese|mandarin\\w*|cantonese|giappones\\w*|japanese|corean\\w*|korean|kanji|hanzi|hiragana|katakana|ideogramm\\w*)\\b`, 'i');

/**
 * The grammar to send with a turn, or '' for none.
 * @param {{language?: string, userText?: string, hasTools?: boolean}} turn
 */
export function scriptGrammar({ language = '', userText = '', hasTools = false } = {}) {
  const primary = typeof language === 'string' ? language.toLowerCase().split(/[-_]/)[0] : '';
  if (!/^[a-z]{2,3}$/.test(primary) || OTHER_SCRIPTS.has(primary)) return '';
  if (hasTools) return '';
  if (ASKS_FOR_THEM.test(String(userText ?? ''))) return '';
  return `root ::= [^${FORBIDDEN}]*`;
}
