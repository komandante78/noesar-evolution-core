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

/**
 * The PRODUCT's question, with the repository in hand — F1c, 25/09/2026. A separate function, so the
 * campaign prompt above stays byte-for-byte what HiL-Bench measured.
 *
 * Why it exists, measured the same day: given the request alone, the local model asked on 6 of 6
 * clear requests, mostly "what does this file contain?" — `namerPrompt` tells it not to ask what the
 * code shows and never shows it the code. Here the files the grounding found come with the request.
 *
 * ponytail: plain head-of-file truncation under a character budget (≈4 k tokens at the default), so
 * the prompt fits a 16 k window with the request; a smarter excerpt when a measurement says so.
 */
export const CODE_BUDGET_CHARS = 16000;
export const PER_FILE_CHARS = 4000;

export function namerPromptWithCode(problem, files = [], budget = CODE_BUDGET_CHARS) {
  const shown = [];
  let left = budget;
  for (const file of files) {
    if (left <= 0) break;
    const body = String(file?.contents ?? '');
    const cut = body.slice(0, Math.min(PER_FILE_CHARS, left));
    left -= cut.length;
    shown.push(`--- ${file.path}${cut.length < body.length ? ' (truncated)' : ''}`, cut);
  }
  return [
    'Below is a task description given to a developer, followed by files of the repository it concerns.',
    '',
    'Some tasks are missing information that CANNOT be worked out from the text, from these files,',
    'or by an ordinary default a competent developer would choose: a value that is never given, a',
    'name that is never stated, a choice between two readings, or two statements that contradict',
    'each other.',
    '',
    'Do not ask about anything the files show. List only what is genuinely missing. One per line,',
    'each phrased as a short, specific question you would have to ask before starting. No',
    'numbering, no preamble, no explanation.',
    'If nothing is genuinely missing, answer with exactly: NOTHING',
    '',
    '--- task description ---',
    problem,
    '',
    '--- repository files ---',
    ...(shown.length ? shown : ['(no file of the repository was found for this task)']),
  ].join('\n');
}
