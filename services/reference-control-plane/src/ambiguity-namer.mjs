// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the local model is asked when it names what a request leaves out — ONE implementation,
// shared by the product (`ReasoningRouter`, when `interpret` is routed to the local model) and by
// the instrument that measured whether routing it was worth doing (`tools/measure-ask-f1.mjs`).
//
// The prompt was written once, for that measurement, and is not revised against a score: tuning
// it while watching HiL-Bench would be fitting the test set, the one thing that would make the
// campaign worthless. It moved here unchanged, so the product asks exactly what was measured and
// the two copies cannot drift apart.

export function namerPrompt(problem) {
  return [
    'Below is a task description given to a developer.',
    '',
    'Some tasks are missing information that CANNOT be worked out from the text or the code:',
    'a value that is never given, a name that is never stated, a choice between two readings,',
    'or two statements that contradict each other.',
    '',
    'List only those. One per line, each phrased as a short, specific question you would have',
    'to ask before starting. No numbering, no preamble, no explanation.',
    'If nothing is genuinely missing, answer with exactly: NOTHING',
    '',
    '--- task description ---',
    problem,
  ].join('\n');
}

/**
 * The questions the model named, and whether its answer could be read at all.
 *
 * `NOTHING` is an answer: nothing is missing. An answer with no question in it and no `NOTHING`
 * is not one, and `unreadable` says so — the router degrades on it rather than reporting an empty
 * list as though the model had found the request complete.
 */
export function readNamed(text) {
  const lines = String(text ?? '').split('\n').map((line) => line.replace(/^[-*\d.)\s]+/, '').trim());
  if (lines.some((line) => /^NOTHING$/i.test(line))) return { named: [], unreadable: false };
  // A line that asks nothing is not a question, and a namer padding its list must not be paid
  // for the padding — precision is what punishes over-asking, so the filter stays this plain.
  const named = lines.filter((line) => line.length > 10 && line.includes('?')).slice(0, 12);
  return { named, unreadable: named.length === 0 };
}
