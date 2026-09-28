// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every sentence of a document, judged against its sources (`documents.check`, `NOESAR_DECIDE=on`).
//
// # What this is, and what it is not
//
// `verification.mjs` RECOMPUTES claims about files — existence, content, hash, a JSON field — and
// declares every other claim unrecomputed, by design. Whether a sentence is supported by a source
// is not recomputable that way: it is a judgment. So it is made as one, and SAID to be one: each
// sentence gets, per source, the probability of a typed decision (`decide.mjs`) that the source
// supports it; the verdict names itself `judged`, never `verified`, and a sentence no source
// supports is flagged instead of being delivered with the confidence of the ones that are.
//
// The model writes nothing here. It is shown the sentence and the passage of the source that shares
// the most words with it — the engine picks the passage, mechanically — and one letter is read.
//
// ponytail: sentences are cut on punctuation, passages are chosen by shared words, one decision per
// (sentence, source), sequential. Ceilings are returned (`sentencesChecked`, `sentencesSkipped`),
// never hidden. A passage-level retrieval that is not by words is the upgrade if it is ever needed.

export const SUPPORT_QUESTION = 'Does the source passage support the statement?';
const MIN_SENTENCE = 25;

/** Sentences worth checking: cut at `.`/`!`/`?` followed by a space, and at line breaks. */
export function sentencesOf(text) {
  return String(text ?? '')
    .split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}\p{N}«"(])/u)
    .map((sentence) => sentence.replace(/^[\s#>*\-|]+/, '').trim())
    .filter((sentence) => sentence.length >= MIN_SENTENCE);
}

const wordsOf = (text) => new Set((String(text).toLowerCase().match(/[\p{L}\p{N}_]{4,}/gu) ?? []));

/** The window of `source` (by paragraphs, up to `budget` characters) sharing the most words with the sentence. */
export function passageFor(sentence, source, { budget = 3000 } = {}) {
  const paragraphs = String(source ?? '').split(/\n\s*\n/);
  const wanted = wordsOf(sentence);
  let best = { score: -1, start: 0 };
  for (let start = 0; start < paragraphs.length; start += 1) {
    let text = '';
    let score = 0;
    for (let index = start; index < paragraphs.length && text.length < budget; index += 1) {
      text += `${paragraphs[index]}\n\n`;
    }
    for (const word of wordsOf(text)) if (wanted.has(word)) score += 1;
    if (score > best.score) best = { score, start, text };
  }
  return String(best.text ?? '').slice(0, budget).trim();
}

/**
 * `sources`: `[{ path, contents }]`. Returns one row per sentence with the probability each source
 * supports it, the best source, and a verdict: `supported` (some source ≥ `threshold`),
 * `not_supported` (every source answered, none reached it) or `unjudged` (no answer at all).
 * A decider that cannot answer stops the check and says so; the rows judged so far are kept.
 */
export async function checkDocument({ text, sources, decide, threshold = 0.5, maxSentences = 40 }) {
  const all = sentencesOf(text);
  const sentences = all.slice(0, maxSentences);
  const rows = [];
  let unavailable = null;
  outer: for (const sentence of sentences) {
    const support = [];
    for (const source of sources) {
      try {
        const decision = await decide({
          context: `Source (${source.path}):\n${passageFor(sentence, source.contents)}\n\nStatement:\n${sentence}`,
          question: SUPPORT_QUESTION,
          options: ['yes', 'no'],
        });
        support.push({ path: source.path, probability: decision.abstained ? null : decision.probabilities[0] });
      } catch (error) {
        if (error?.name !== 'DecisionUnavailable') throw error;
        unavailable = error.reason;
        break outer;
      }
    }
    const answered = support.filter((entry) => entry.probability !== null);
    const best = answered.sort((a, b) => b.probability - a.probability)[0] ?? null;
    rows.push({
      sentence, support, best,
      verdict: !best ? 'unjudged' : best.probability >= threshold ? 'supported' : 'not_supported',
    });
  }
  const count = (verdict) => rows.filter((row) => row.verdict === verdict).length;
  return {
    // Named for what it is, in every answer: a judgment by a model, not a recomputation.
    kind: 'judged',
    sentences: rows,
    sentencesChecked: rows.length,
    sentencesSkipped: all.length - rows.length,
    supported: count('supported'),
    notSupported: count('not_supported'),
    unjudged: count('unjudged'),
    ...(unavailable ? { decisionsUnavailable: unavailable } : {}),
    declaration: `${rows.length} sentences judged against ${sources.length} source${sources.length === 1 ? '' : 's'}: `
      + `${count('supported')} supported, ${count('not_supported')} NOT supported, ${count('unjudged')} unjudged`
      + (all.length > rows.length ? ` — ${all.length - rows.length} sentences beyond the first ${maxSentences} not checked` : '')
      + ' — judged by a model, not recomputed',
  };
}
