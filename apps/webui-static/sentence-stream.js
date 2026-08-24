// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Turn a stream of model tokens into whole sentences, as soon as each one is whole.
//
// # Why this exists
//
// Measured on the live installation 2026-08-24, for one spoken question:
//
//   chat, first token          66 ms
//   chat, COMPLETE answer    4790 ms   (562 characters)
//   synthesis                ~800 ms
//   silence before a word    ~5794 ms
//
// The product waited for the LAST token before sending anything to be spoken, so the person sat
// in six seconds of silence for an answer whose first sentence had been ready after a few
// hundred milliseconds. Speaking the first sentence while the rest is still being written turns
// that into ~866 ms. Nothing about the model, the network or the speech engine changed — only
// when the product decides it has enough to say.
//
// # Why a whole sentence, and not a token or a clause
//
// A speech engine synthesises prosody over the unit it is given. Feed it words as they arrive
// and it produces flat, chopped speech that sounds worse than the wait it saved; feed it a
// paragraph and the wait comes back. A sentence is the largest unit that is complete on its own
// and the smallest one that carries intonation, so it is the unit that is both fast and human.
//
// # The rule this file follows
//
// **Never emit a sentence that might still grow.** A sentence emitted early cannot be recalled —
// it has already been spoken aloud. So every ambiguous case resolves towards WAITING: an
// abbreviation, an initial, a decimal number and an unclosed quotation all hold the buffer. The
// tail is flushed when the stream ends, which is the only place an incomplete sentence may be
// released, and by then nothing can grow.

/** Terminators that can end a sentence. Includes the ellipsis, and the full-width CJK forms. */
const TERMINATORS = /[.!?…。！？]/;

/**
 * Words that end in a period WITHOUT ending a sentence.
 *
 * English and Italian both, because the interface ships in both and a spoken answer follows the
 * language of the question. Deliberately short: every entry is a word that a wrong split would
 * make audibly wrong ("Dott." spoken as a sentence, then a name spoken as another), and a list
 * that tried to be exhaustive would hold real sentences back instead.
 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e', 'approx', 'no',
  'sig', 'sig.ra', 'dott', 'dott.ssa', 'ing', 'avv', 'ecc', 'es', 'p.es', 'nr', 'pag', 'art',
]);

/** Terminators that need no following space, because the scripts that use them do not use one. */
const FULL_WIDTH_TERMINATORS = /[。！？]/;
/** Closing punctuation allowed to trail a terminator and still belong to the same sentence. */
const TRAILING = /^[)\]"'»”’\s]/;

function endsWithAbbreviation(text) {
  // The token immediately before the period, letters and inner dots only ("e.g", "dott.ssa").
  const match = /([\p{L}.]+)\.$/u.exec(text.trimEnd());
  if (!match) return false;
  return ABBREVIATIONS.has(match[1].toLowerCase());
}

function endsWithInitial(text) {
  // "J. R. R. Tolkien" — a single capital letter before the period is an initial, never an end.
  return /(^|[\s(])\p{Lu}\.$/u.test(text.trimEnd());
}

function endsInsideNumber(text, next) {
  // "3.14" and "1.000" — a digit on both sides of the period.
  return /\d\.$/.test(text) && /^\d/.test(next);
}

/**
 * A sentence accumulator for a token stream.
 *
 * `push()` returns the sentences that became COMPLETE with this chunk, in order — usually none,
 * occasionally one, rarely more. `flush()` returns whatever is left, and is the only way an
 * unterminated fragment is ever released.
 *
 * It is deliberately a plain object with no timers, no events and no async: the caller owns the
 * scheduling, which is what lets the voice session keep every leg under the one generation token
 * that barge-in cancels.
 */
export function createSentenceStream({ minLength = 2 } = {}) {
  let buffer = '';
  let released = 0;

  function takeSentences() {
    const out = [];
    let index = 0;
    while (index < buffer.length) {
      const char = buffer[index];
      if (!TERMINATORS.test(char)) { index += 1; continue; }

      // Run past a group of terminators ("?!", "...") so they stay with their sentence.
      let end = index + 1;
      while (end < buffer.length && TERMINATORS.test(buffer[end])) end += 1;
      // …and past the closing punctuation that belongs to it.
      while (end < buffer.length && /^[)\]"'»”’]/.test(buffer[end])) end += 1;

      const candidate = buffer.slice(0, end);
      const rest = buffer.slice(end);

      // Nothing after it yet: the stream may still be mid-token, and "Dr" + "." + "Who" would
      // split wrongly if judged now. Wait for at least one more character.
      if (!rest.length) break;
      // Full-width terminators are unambiguous: CJK does not put a space after 。！？, so
      // requiring one would hold a whole Japanese answer back to a single sentence — which is
      // exactly the six seconds of silence this file exists to remove, for those languages only.
      if (FULL_WIDTH_TERMINATORS.test(buffer[end - 1])) {
        const sentence = candidate.trim();
        if (sentence.replace(/[^\p{L}\p{N}]/gu, '').length < minLength) { index = end; continue; }
        out.push(sentence);
        buffer = rest.replace(/^\s+/, '');
        index = 0;
        continue;
      }
      // The terminator must be followed by whitespace or a closing mark; "3.14" is not an end.
      if (!TRAILING.test(rest)) {
        if (endsInsideNumber(candidate, rest)) { index = end; continue; }
        if (!/^\s/.test(rest)) { index = end; continue; }
      }
      if (endsWithAbbreviation(candidate) || endsWithInitial(candidate)) { index = end; continue; }

      const sentence = candidate.trim();
      // A stray "." on its own line is not worth a round trip to the speech engine; it is kept
      // and merged into whatever follows.
      if (sentence.replace(/[^\p{L}\p{N}]/gu, '').length < minLength) { index = end; continue; }

      out.push(sentence);
      buffer = rest.replace(/^\s+/, '');
      index = 0;
    }
    return out;
  }

  return {
    /** Feed the next chunk of streamed text. Returns the sentences completed by it. */
    push(chunk) {
      buffer += String(chunk ?? '');
      const sentences = takeSentences();
      released += sentences.length;
      return sentences;
    },
    /** End the stream. Returns the trailing fragment, if it carries anything worth speaking. */
    flush() {
      const tail = buffer.trim();
      buffer = '';
      if (!tail || tail.replace(/[^\p{L}\p{N}]/gu, '').length < minLength) return [];
      released += 1;
      return [tail];
    },
    /** How many sentences have been handed out. Lets a caller tell "first" from "the rest". */
    get count() { return released; },
    /** What is still held back. Exposed for tests and for an honest state report, never spoken. */
    get pending() { return buffer; },
  };
}
